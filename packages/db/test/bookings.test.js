/**
 * Bookings (BKG-23, BKG-25) against the real database: creation with a hold, confirming,
 * expiry, the state machine, the timeline, and two races.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createPrismaClient,
  seedDemoOperator,
  createBooking,
  confirmBooking,
  setBookingStatus,
  updateTraveller,
  releaseHold,
  createHold,
  syncScheduleDepartures,
  BookingError,
} from '../src/index.js';

let prisma;
const created = [];

beforeAll(() => {
  prisma = createPrismaClient(process.env.DATABASE_URL);
});
afterAll(() => prisma.$disconnect());
afterEach(async () => {
  await prisma.operator.deleteMany({ where: { id: { in: created.splice(0) } } });
});

const STAFF = { type: 'system' };

/** A seeded operator with its first upcoming Street Food Crawl departure (10 seats). */
async function setup() {
  const operator = await seedDemoOperator(prisma, { slug: `test-${randomUUID().slice(0, 8)}` });
  created.push(operator.id);
  const product = await prisma.product.findFirstOrThrow({
    where: { operatorId: operator.id, slug: 'lagos-street-food-crawl' },
    include: { addOns: true },
  });
  const departure = await prisma.departure.findFirstOrThrow({
    where: { productId: product.id, startsAt: { gt: new Date() } },
    orderBy: { startsAt: 'asc' },
  });
  const plate = product.addOns.find((a) => a.name === 'Extra tasting plate');
  return { operator, product, departure, plate };
}

/** Creates a booking for `n` adults, optionally with tasting plates and a custom clock. */
function book(ctx, { n = 2, plates = 0, now } = {}) {
  return createBooking(prisma, {
    operatorId: ctx.operator.id,
    operatorSlug: ctx.operator.slug,
    departureId: ctx.departure.id,
    productId: ctx.product.id,
    channel: 'staff',
    lead: { name: 'Ngozi Obi', email: 'ngozi@guest.example', phone: null, marketingConsent: false },
    travellers: Array.from({ length: n }, (_, i) => ({
      name: `Guest ${i + 1}`,
      age: 30,
      categoryKey: 'adult',
      dietaryNeeds: i === 0 ? 'vegetarian' : '',
    })),
    addOns: plates ? [{ addOnId: ctx.plate.id, quantity: plates, unitKobo: 500_000 }] : [],
    quote: {},
    totalKobo: 3_500_000 * n + 500_000 * plates,
    holdMinutes: 15,
    actor: STAFF,
    now,
  });
}

const seats = (id) => prisma.departure.findUniqueOrThrow({ where: { id } });
const events = (bookingId) =>
  prisma.bookingEvent.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } });

/** Runs a promise; returns 'OK' or the BookingError code. */
async function outcome(promise) {
  try {
    await promise;
    return 'OK';
  } catch (err) {
    if (err instanceof BookingError) return err.code;
    throw err;
  }
}

describe('creating a booking', () => {
  it('creates the booking, travellers, add-ons, hold and a "created" event together', async () => {
    const ctx = await setup();

    const { booking, hold } = await book(ctx, { n: 3, plates: 2 });

    expect(booking).toMatchObject({ status: 'held', channel: 'staff', holdId: hold.id });
    expect(booking.reference).toMatch(/^[A-Z]{1,3}-[0-9A-HJKMNP-TV-Z]{6}$/);
    const travellers = await prisma.traveller.findMany({
      where: { bookingId: booking.id },
      orderBy: { position: 'asc' },
    });
    expect(travellers.map((t) => [t.position, t.name, t.dietaryNeeds])).toEqual([
      [1, 'Guest 1', 'vegetarian'],
      [2, 'Guest 2', ''],
      [3, 'Guest 3', ''],
    ]);
    expect((await seats(ctx.departure.id)).seatsHeld).toBe(3);
    expect((await events(booking.id)).map((e) => [e.type, e.toStatus])).toEqual([
      ['created', 'held'],
    ]);
  });

  it('creates nothing at all if the seats are not available', async () => {
    const ctx = await setup();
    await book(ctx, { n: 9 });

    await expect(book(ctx, { n: 2 })).rejects.toMatchObject({ code: 'SOLD_OUT' });
    expect(await prisma.booking.count({ where: { departureId: ctx.departure.id } })).toBe(1);
  });
});

describe('confirming (pay later)', () => {
  it('moves seats from held to sold and records the change', async () => {
    const ctx = await setup();
    const { booking, hold } = await book(ctx, { n: 2 });

    await confirmBooking(prisma, {
      operatorId: ctx.operator.id,
      bookingId: booking.id,
      actor: STAFF,
    });

    expect(await seats(ctx.departure.id)).toMatchObject({ seatsHeld: 0, seatsSold: 2 });
    expect((await prisma.hold.findUnique({ where: { id: hold.id } })).status).toBe('converted');
    expect((await events(booking.id)).at(-1)).toMatchObject({
      fromStatus: 'held',
      toStatus: 'confirmed',
    });
  });

  it('refuses once the hold has expired, and expiry has already cancelled the booking', async () => {
    const ctx = await setup();
    const { booking, hold } = await book(ctx, { now: new Date(Date.now() - 16 * 60_000) }); // made 16 min ago

    await releaseHold(prisma, hold.id, { reason: 'expired' });
    const result = await outcome(
      confirmBooking(prisma, { operatorId: ctx.operator.id, bookingId: booking.id, actor: STAFF }),
    );

    expect(result).toBe('INVALID_TRANSITION'); // it's "cancelled" now
    const after = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(after.status).toBe('cancelled');
    expect((await events(booking.id)).at(-1)).toMatchObject({
      toStatus: 'cancelled',
      actorType: 'system',
      data: { reason: 'hold_expired' },
    });
    expect(await seats(ctx.departure.id)).toMatchObject({ seatsHeld: 0, seatsSold: 0 });
  });

  it('RACE: staff confirm at the very moment the hold expires; exactly one wins', async () => {
    const ctx = await setup();
    const results = [];
    for (let i = 0; i < 5; i++) {
      const { booking, hold } = await book(ctx, { n: 1 });
      // Give both sides a clock that makes them eligible: confirm "just before" expiry,
      // the expiry job "just after". Fire them together and see who gets there first.
      const [confirmed, expired] = await Promise.all([
        outcome(
          confirmBooking(prisma, {
            operatorId: ctx.operator.id,
            bookingId: booking.id,
            actor: STAFF,
            now: new Date(hold.expiresAt.getTime() - 1),
          }),
        ),
        releaseHold(prisma, hold.id, {
          reason: 'expired',
          now: new Date(hold.expiresAt.getTime() + 1),
        }),
      ]);
      results.push([confirmed === 'OK', expired]);
    }

    // In every pair, exactly one side won…
    for (const [confirmWon, expiryWon] of results) expect(confirmWon !== expiryWon).toBe(true);
    // …and the seats agree with the winners: each confirmed booking holds 1 sold seat.
    const confirmedCount = results.filter(([c]) => c).length;
    expect(await seats(ctx.departure.id)).toMatchObject({
      seatsHeld: 0,
      seatsSold: confirmedCount,
    });
  });
});

describe('the state machine', () => {
  it('refuses a move the lifecycle does not allow (held → completed)', async () => {
    const ctx = await setup();
    const { booking } = await book(ctx);

    const result = await outcome(
      setBookingStatus(prisma, {
        operatorId: ctx.operator.id,
        bookingId: booking.id,
        to: 'completed',
        actor: STAFF,
      }),
    );
    expect(result).toBe('INVALID_TRANSITION');
  });

  it('RACE: two staff change the same booking at once; exactly one change lands', async () => {
    const ctx = await setup();
    const { booking } = await book(ctx);
    await confirmBooking(prisma, {
      operatorId: ctx.operator.id,
      bookingId: booking.id,
      actor: STAFF,
    });

    const results = await Promise.all(
      ['completed', 'no_show', 'completed', 'no_show'].map((to) =>
        outcome(
          setBookingStatus(prisma, {
            operatorId: ctx.operator.id,
            bookingId: booking.id,
            to,
            actor: STAFF,
          }),
        ),
      ),
    );

    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
    const statusEvents = (await events(booking.id)).filter((e) => e.type === 'status_changed');
    expect(statusEvents).toHaveLength(2); // held → confirmed, then exactly ONE more
  });
});

describe('seats and stock', () => {
  it('add-ons on confirmed bookings count against stock', async () => {
    const ctx = await setup(); // 10 tasting plates per night
    const { booking } = await book(ctx, { n: 1, plates: 6 });
    await confirmBooking(prisma, {
      operatorId: ctx.operator.id,
      bookingId: booking.id,
      actor: STAFF,
    });

    await expect(
      createHold(prisma, {
        operatorId: ctx.operator.id,
        departureId: ctx.departure.id,
        seats: 1,
        addOns: [{ addOnId: ctx.plate.id, quantity: 5 }],
        channel: 'web',
        travellers: [{ age: 30 }],
        quote: {},
        totalKobo: 0,
        holdMinutes: 15,
      }),
    ).rejects.toMatchObject({ code: 'ADD_ON_SOLD_OUT', details: { left: 4 } });
  });

  it('a departure with bookings is never removed by a schedule change, even if they were cancelled', async () => {
    const ctx = await setup();
    const { hold } = await book(ctx, { n: 1 });
    await releaseHold(prisma, hold.id, { reason: 'released' }); // booking cancelled, 0 seats

    const schedule = await prisma.schedule.findFirstOrThrow({
      where: { productId: ctx.product.id },
    });
    await prisma.schedule.update({ where: { id: schedule.id }, data: { isActive: false } });
    await syncScheduleDepartures(prisma, schedule.id);

    expect(await prisma.departure.findUnique({ where: { id: ctx.departure.id } })).not.toBeNull();
  });
});

describe('travellers (BKG-25)', () => {
  it('records corrections on the timeline with old and new values', async () => {
    const ctx = await setup();
    const { booking } = await book(ctx);
    const [first] = await prisma.traveller.findMany({
      where: { bookingId: booking.id },
      orderBy: { position: 'asc' },
    });

    await updateTraveller(prisma, {
      operatorId: ctx.operator.id,
      bookingId: booking.id,
      travellerId: first.id,
      changes: { name: 'Ngozi Obi', dietaryNeeds: 'vegan' },
      actor: STAFF,
    });

    expect((await events(booking.id)).at(-1)).toMatchObject({
      type: 'traveller_updated',
      data: { changed: { name: ['Guest 1', 'Ngozi Obi'], dietaryNeeds: ['vegetarian', 'vegan'] } },
    });
  });
});
