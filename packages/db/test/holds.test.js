/**
 * Checkout holds (INV-23) and NO DOUBLE-SELLING (INV-02), against the real PostgreSQL.
 *
 * The "concurrency" tests are the heart of this file: they fire many hold requests at the
 * SAME departure at the SAME time (Promise.all) and check that the seats and add-ons handed
 * out never exceed what exists.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createPrismaClient,
  seedDemoOperator,
  createHold,
  releaseHold,
  expireDueHolds,
  HoldError,
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

/** Seeds an operator and returns the first upcoming Street Food Crawl departure (10 seats). */
async function foodCrawlDeparture() {
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
  const plate = product.addOns.find((a) => a.name === 'Extra tasting plate'); // 10 per night
  return { operator, departure, plate };
}

/** Places a hold with sensible defaults. */
function hold(ctx, { seats = 1, addOns = [], now } = {}) {
  return createHold(prisma, {
    operatorId: ctx.operator.id,
    departureId: ctx.departure.id,
    seats,
    addOns,
    channel: 'web',
    travellers: Array.from({ length: seats }, () => ({ age: 30 })),
    quote: { note: 'test snapshot' },
    totalKobo: 3_500_000 * seats,
    holdMinutes: 15,
    now,
  });
}

/** Runs a promise and returns its HoldError code, or 'OK' if it succeeded. */
async function outcome(promise) {
  try {
    await promise;
    return 'OK';
  } catch (err) {
    if (err instanceof HoldError) return err.code;
    throw err; // anything else (a 500 in real life) fails the test loudly
  }
}

const seatsHeld = async (id) =>
  (await prisma.departure.findUniqueOrThrow({ where: { id } })).seatsHeld;
const count = (list, value) => list.filter((x) => x === value).length;

describe('placing and releasing holds', () => {
  it('a hold claims seats and stores the price snapshot', async () => {
    const ctx = await foodCrawlDeparture();

    const h = await hold(ctx, { seats: 3 });

    expect(h).toMatchObject({ status: 'active', seats: 3, channel: 'web', totalKobo: 10_500_000 });
    expect(h.expiresAt.getTime() - h.createdAt.getTime()).toBeGreaterThan(14 * 60_000);
    expect(await seatsHeld(ctx.departure.id)).toBe(3);
  });

  it('refuses more seats than are left, saying how many are', async () => {
    const ctx = await foodCrawlDeparture();
    await hold(ctx, { seats: 8 });

    await expect(hold(ctx, { seats: 3 })).rejects.toMatchObject({
      code: 'SOLD_OUT',
      details: { seatsAvailable: 2 },
    });
  });

  it('releasing gives the seats back exactly once', async () => {
    const ctx = await foodCrawlDeparture();
    const h = await hold(ctx, { seats: 4 });

    expect(await releaseHold(prisma, h.id, { reason: 'released' })).toBe(true);
    expect(await releaseHold(prisma, h.id, { reason: 'released' })).toBe(false); // already ended
    expect(await seatsHeld(ctx.departure.id)).toBe(0); // not −4
  });

  it('expiry only succeeds once the hold is actually due', async () => {
    const ctx = await foodCrawlDeparture();
    const h = await hold(ctx, { seats: 2 });

    expect(await releaseHold(prisma, h.id, { reason: 'expired' })).toBe(false); // too early
    const later = new Date(h.expiresAt.getTime() + 1000);
    expect(await releaseHold(prisma, h.id, { reason: 'expired', now: later })).toBe(true);
    expect((await prisma.hold.findUnique({ where: { id: h.id } })).status).toBe('expired');
  });

  it('the sweeper expires only holds whose time is up', async () => {
    const ctx = await foodCrawlDeparture();
    const old = await hold(ctx, { seats: 1, now: new Date(Date.now() - 20 * 60_000) }); // made 20 min ago
    const fresh = await hold(ctx, { seats: 1 });

    expect(await expireDueHolds(prisma)).toBeGreaterThanOrEqual(1);
    const statuses = await prisma.hold.findMany({ where: { id: { in: [old.id, fresh.id] } } });
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({
      [old.id]: 'expired',
      [fresh.id]: 'active',
    });
    expect(await seatsHeld(ctx.departure.id)).toBe(1);
  });

  it('refuses a cancelled departure', async () => {
    const ctx = await foodCrawlDeparture();
    await prisma.departure.update({
      where: { id: ctx.departure.id },
      data: { status: 'cancelled' },
    });

    expect(await outcome(hold(ctx))).toBe('DEPARTURE_CANCELLED');
  });

  it('add-ons have stock per departure, and releasing frees it', async () => {
    const ctx = await foodCrawlDeparture();
    const first = await hold(ctx, { seats: 1, addOns: [{ addOnId: ctx.plate.id, quantity: 8 }] });

    await expect(
      hold(ctx, { seats: 1, addOns: [{ addOnId: ctx.plate.id, quantity: 3 }] }),
    ).rejects.toMatchObject({ code: 'ADD_ON_SOLD_OUT', details: { left: 2 } });

    await releaseHold(prisma, first.id, { reason: 'released' });
    expect(
      await outcome(hold(ctx, { seats: 1, addOns: [{ addOnId: ctx.plate.id, quantity: 3 }] })),
    ).toBe('OK');
  });
});

describe('concurrency: zero oversells', () => {
  it('40 people grab the last 10 seats at the same moment: exactly 10 win', async () => {
    const ctx = await foodCrawlDeparture(); // capacity 10

    const results = await Promise.all(Array.from({ length: 40 }, () => outcome(hold(ctx))));

    expect(count(results, 'OK')).toBe(10);
    expect(count(results, 'SOLD_OUT')).toBe(30); // and no other kind of failure
    expect(await seatsHeld(ctx.departure.id)).toBe(10);
  });

  it('mixed group sizes never add up to more than the capacity', async () => {
    const ctx = await foodCrawlDeparture();
    const sizes = Array.from({ length: 30 }, (_, i) => 1 + (i % 4)); // 1,2,3,4,1,2,…

    const results = await Promise.all(sizes.map((seats) => outcome(hold(ctx, { seats }))));

    const seatsWon = sizes.filter((_, i) => results[i] === 'OK').reduce((a, b) => a + b, 0);
    expect(results.every((r) => r === 'OK' || r === 'SOLD_OUT')).toBe(true);
    expect(seatsWon).toBeLessThanOrEqual(10);
    expect(await seatsHeld(ctx.departure.id)).toBe(seatsWon);
  });

  it('30 people want the 10 extra tasting plates at once: exactly 10 get one', async () => {
    const ctx = await foodCrawlDeparture();
    // Plenty of seats, so the ADD-ON stock is the only limit (and it has no CHECK
    // constraint: the row lock is the only thing protecting it).
    await prisma.departure.update({ where: { id: ctx.departure.id }, data: { capacity: 60 } });

    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        outcome(hold(ctx, { seats: 1, addOns: [{ addOnId: ctx.plate.id, quantity: 1 }] })),
      ),
    );

    expect(count(results, 'OK')).toBe(10);
    expect(count(results, 'ADD_ON_SOLD_OUT')).toBe(20);
  });

  it('20 simultaneous releases of one hold give its seats back once', async () => {
    const ctx = await foodCrawlDeparture();
    const h = await hold(ctx, { seats: 5 });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => releaseHold(prisma, h.id, { reason: 'released' })),
    );

    expect(count(results, true)).toBe(1);
    expect(await seatsHeld(ctx.departure.id)).toBe(0);
  });
});
