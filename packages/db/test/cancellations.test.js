/**
 * Cancellations, no-shows and departure cancellations (BKG-26), against the real database.
 *
 * Payments don't exist until session 10, so "paid" bookings are made by securing the hold
 * and setting amountPaidKobo directly. Clocks are passed as `now`, relative to departure.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createPrismaClient,
  seedDemoOperator,
  createBooking,
  createHold,
  secureBookingInTx,
  setBookingStatus,
  confirmBooking,
  addPolicyVersion,
  cancelBooking,
  markNoShow,
  cancelDeparture,
  BookingError,
} from '../src/index.js';

let prisma;
const created = [];
const STAFF = { type: 'system' };
const HOUR = 3_600_000;

beforeAll(() => {
  prisma = createPrismaClient(process.env.DATABASE_URL);
});
afterAll(() => prisma.$disconnect());
afterEach(async () => {
  await prisma.operator.deleteMany({ where: { id: { in: created.splice(0) } } });
});

/** A seeded operator with the first upcoming Tarkwa Bay departure (12 seats). */
async function setup() {
  const operator = await seedDemoOperator(prisma, { slug: `test-${randomUUID().slice(0, 8)}` });
  created.push(operator.id);
  const product = await prisma.product.findFirstOrThrow({
    where: { operatorId: operator.id, slug: 'tarkwa-bay-beach-and-lagoon' },
  });
  const departure = await prisma.departure.findFirstOrThrow({
    where: { productId: product.id, startsAt: { gt: new Date() } },
    orderBy: { startsAt: 'asc' },
  });
  return { operator, product, departure };
}

/** A booking for `n` adults at ₦40,000 each, left "held". */
async function heldBooking(ctx, n = 2) {
  const { booking } = await createBooking(prisma, {
    operatorId: ctx.operator.id,
    operatorSlug: ctx.operator.slug,
    departureId: ctx.departure.id,
    productId: ctx.product.id,
    channel: 'web',
    lead: { name: 'Guest', email: 'guest@guest.example', phone: null, marketingConsent: false },
    travellers: Array.from({ length: n }, (_, i) => ({
      name: `G${i}`,
      age: 30,
      categoryKey: 'adult',
    })),
    addOns: [],
    quote: {},
    totalKobo: 4_000_000 * n,
    holdMinutes: 15,
    actor: STAFF,
  });
  return booking;
}

/** A booking that is "paid" in full (seats sold, amountPaidKobo set). */
async function paidBooking(ctx, n = 2) {
  const booking = await heldBooking(ctx, n);
  await prisma.$transaction((tx) => secureBookingInTx(tx, { booking, to: 'paid', actor: STAFF }));
  return prisma.booking.update({
    where: { id: booking.id },
    data: { amountPaidKobo: booking.totalKobo },
  });
}

const departureOf = (ctx) =>
  prisma.departure.findUniqueOrThrow({ where: { id: ctx.departure.id } });
const reload = (b) => prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
const hoursBefore = (ctx, h) => new Date(ctx.departure.startsAt.getTime() - h * HOUR);

/** Runs a promise; returns 'OK' or the BookingError code. */
async function outcome(promise) {
  try {
    await promise;
    return 'OK';
  } catch (err) {
    if (err instanceof BookingError || err?.code) return err.code;
    throw err;
  }
}

describe('guest cancellations follow the policy the booking was sold under', () => {
  it.each([
    [72, 8_000_000, 'full'],
    [30, 4_000_000, 'partial'], // 50%
    [10, 0, 'none'],
  ])(
    '%i hours before → refund due %i kobo (%s), seats back on sale',
    async (h, refund, outcomeName) => {
      const ctx = await setup();
      const booking = await paidBooking(ctx); // ₦80,000

      const result = await cancelBooking(prisma, {
        operatorId: ctx.operator.id,
        bookingId: booking.id,
        initiatedBy: 'guest',
        reason: 'Change of plans',
        actor: STAFF,
        now: hoursBefore(ctx, h),
      });

      expect(result).toMatchObject({ refundKobo: refund, outcome: outcomeName, policyVersion: 1 });
      expect(await reload(booking)).toMatchObject({ status: 'cancelled', refundDueKobo: refund });
      expect(await departureOf(ctx)).toMatchObject({ seatsSold: 0, seatsHeld: 0 });
      const event = await prisma.bookingEvent.findFirst({
        where: { bookingId: booking.id, toStatus: 'cancelled' },
      });
      expect(event.data).toMatchObject({
        reason: 'Change of plans',
        initiatedBy: 'guest',
        refund: { refundKobo: refund },
      });
    },
  );

  it('an operator cancellation refunds everything, even an hour before', async () => {
    const ctx = await setup();
    const booking = await paidBooking(ctx);

    const result = await cancelBooking(prisma, {
      operatorId: ctx.operator.id,
      bookingId: booking.id,
      initiatedBy: 'operator',
      reason: 'Boat engine fault',
      actor: STAFF,
      now: hoursBefore(ctx, 1),
    });

    expect(result).toMatchObject({ refundKobo: 8_000_000, reason: 'OPERATOR_CANCELLED' });
  });

  it('staff can override the amount, but not above what was paid', async () => {
    const ctx = await setup();
    const a = await paidBooking(ctx, 1);
    const b = await paidBooking(ctx, 1);
    const base = {
      operatorId: ctx.operator.id,
      initiatedBy: 'guest',
      reason: 'Goodwill',
      actor: STAFF,
      now: hoursBefore(ctx, 10),
    };

    const ok = await cancelBooking(prisma, {
      ...base,
      bookingId: a.id,
      refundOverrideKobo: 2_000_000,
    });
    const tooHigh = await outcome(
      cancelBooking(prisma, { ...base, bookingId: b.id, refundOverrideKobo: 9_000_000 }),
    );

    expect(ok).toMatchObject({ refundKobo: 2_000_000, policyRefundKobo: 0, overridden: true });
    expect(tooHigh).toBe('REFUND_TOO_HIGH');
    expect((await reload(b)).status).toBe('paid'); // nothing changed
  });

  it('a held (unpaid) booking just releases its seats', async () => {
    const ctx = await setup();
    const booking = await heldBooking(ctx, 3);

    const result = await cancelBooking(prisma, {
      operatorId: ctx.operator.id,
      bookingId: booking.id,
      initiatedBy: 'guest',
      reason: 'Not now',
      actor: STAFF,
    });

    expect(result).toMatchObject({ refundKobo: 0, reason: 'NOTHING_PAID' });
    expect(await departureOf(ctx)).toMatchObject({ seatsHeld: 0, seatsSold: 0 });
    expect((await reload(booking)).status).toBe('cancelled');
  });

  it('a completed booking cannot be cancelled', async () => {
    const ctx = await setup();
    const booking = await paidBooking(ctx);
    await setBookingStatus(prisma, {
      operatorId: ctx.operator.id,
      bookingId: booking.id,
      to: 'completed',
      actor: STAFF,
    });

    const result = await outcome(
      cancelBooking(prisma, {
        operatorId: ctx.operator.id,
        bookingId: booking.id,
        initiatedBy: 'guest',
        reason: 'Too late',
        actor: STAFF,
      }),
    );

    expect(result).toBe('INVALID_TRANSITION');
    expect((await departureOf(ctx)).seatsSold).toBe(2); // seats untouched
  });
});

describe('policy versions', () => {
  it("a new version doesn't change existing bookings, only new ones", async () => {
    const ctx = await setup();
    const before = await paidBooking(ctx, 1);
    // The operator becomes generous: 100% refund at any time (version 2).
    await addPolicyVersion(prisma, ctx.product.cancellationPolicyId, {
      rules: [{ hoursBefore: 0, refundBasisPoints: 10_000 }],
      noShowRefundBasisPoints: 0,
      depositRefundable: false,
    });
    const after = await paidBooking(ctx, 1);
    const late = {
      operatorId: ctx.operator.id,
      initiatedBy: 'guest',
      reason: 'x',
      actor: STAFF,
      now: hoursBefore(ctx, 10),
    };

    expect(await cancelBooking(prisma, { ...late, bookingId: before.id })).toMatchObject({
      refundKobo: 0,
      policyVersion: 1,
    });
    expect(await cancelBooking(prisma, { ...late, bookingId: after.id })).toMatchObject({
      refundKobo: 4_000_000,
      policyVersion: 2,
    });
  });

  it('versions cannot be edited, not even directly in the database', async () => {
    const ctx = await setup();
    const version = await prisma.cancellationPolicyVersion.findFirstOrThrow({
      where: { policyId: ctx.product.cancellationPolicyId },
    });

    await expect(
      prisma.cancellationPolicyVersion.update({
        where: { id: version.id },
        data: { noShowRefundBasisPoints: 10_000 },
      }),
    ).rejects.toThrow(/immutable/);
  });
});

describe('no-shows', () => {
  it('apply the no-show rate (0% here) and keep the seats sold', async () => {
    const ctx = await setup();
    const booking = await paidBooking(ctx);

    const refund = await markNoShow(prisma, {
      operatorId: ctx.operator.id,
      bookingId: booking.id,
      actor: STAFF,
    });

    expect(refund).toMatchObject({ refundKobo: 0, reason: 'NO_SHOW' });
    expect(await reload(booking)).toMatchObject({ status: 'no_show', refundDueKobo: 0 });
    expect((await departureOf(ctx)).seatsSold).toBe(2);
  });
});

describe('calling off a whole departure (weather at Tarkwa Bay)', () => {
  it('cancels every booking with a full refund, releases holds, and closes the departure', async () => {
    const ctx = await setup();
    const held = await heldBooking(ctx, 2);
    const confirmed = await heldBooking(ctx, 1);
    await confirmBooking(prisma, {
      operatorId: ctx.operator.id,
      bookingId: confirmed.id,
      actor: STAFF,
    });
    const paid = await paidBooking(ctx, 3);
    await createHold(prisma, {
      operatorId: ctx.operator.id,
      departureId: ctx.departure.id,
      seats: 1,
      channel: 'ota',
      travellers: [{ age: 30 }],
      quote: {},
      totalKobo: 0,
      holdMinutes: 15,
    });

    const result = await cancelDeparture(prisma, {
      operatorId: ctx.operator.id,
      departureId: ctx.departure.id,
      reason: 'Rough seas forecast',
      actor: STAFF,
    });

    expect(result).toEqual({ bookingsCancelled: 3, holdsReleased: 1, refundsDueKobo: 12_000_000 });
    for (const b of [held, confirmed, paid]) expect((await reload(b)).status).toBe('cancelled');
    expect((await reload(paid)).refundDueKobo).toBe(12_000_000); // 3 × ₦40,000, all back
    expect(await departureOf(ctx)).toMatchObject({
      status: 'cancelled',
      seatsSold: 0,
      seatsHeld: 0,
    });

    expect(
      await outcome(
        cancelDeparture(prisma, {
          operatorId: ctx.operator.id,
          departureId: ctx.departure.id,
          reason: 'again',
          actor: STAFF,
        }),
      ),
    ).toBe('ALREADY_CANCELLED');
  });

  it('RACE: guests keep booking while the departure is being called off; none slip through', async () => {
    // Deliberately NO existing bookings: cancelling a booking updates the departure row, which
    // would lock it as a side effect and hide a missing FOR UPDATE. With an empty departure,
    // only the explicit lock stops a hold sneaking in between "release loose holds" and
    // "mark the departure cancelled". (Session 9: the first version of this test, with a
    // booking, passed even with the lock removed.)
    const ctx = await setup();

    const hold = () =>
      createHold(prisma, {
        operatorId: ctx.operator.id,
        departureId: ctx.departure.id,
        seats: 1,
        channel: 'web',
        travellers: [{ age: 30 }],
        quote: {},
        totalKobo: 0,
        holdMinutes: 15,
      });
    await Promise.all([
      ...Array.from({ length: 5 }, () => outcome(hold())),
      outcome(
        cancelDeparture(prisma, {
          operatorId: ctx.operator.id,
          departureId: ctx.departure.id,
          reason: 'Storm',
          actor: STAFF,
        }),
      ),
      ...Array.from({ length: 5 }, () => outcome(hold())),
    ]);

    // Holds that got in before the lock were released by the cancellation; the rest were
    // refused (DEPARTURE_CANCELLED). Either way: nothing active, nothing sold.
    expect(await departureOf(ctx)).toMatchObject({
      status: 'cancelled',
      seatsHeld: 0,
      seatsSold: 0,
    });
    expect(
      await prisma.hold.count({ where: { departureId: ctx.departure.id, status: 'active' } }),
    ).toBe(0);
  });
});

describe('the ledger records refunds owed (stage 10a)', () => {
  it('cancelling with a refund posts Dr Sales refunds / Cr Refunds payable, once', async () => {
    const ctx = await setup();
    const booking = await paidBooking(ctx); // ₦80,000
    const args = {
      operatorId: ctx.operator.id,
      bookingId: booking.id,
      initiatedBy: 'guest',
      reason: 'x y',
      actor: STAFF,
    };

    await cancelBooking(prisma, { ...args, now: hoursBefore(ctx, 30) }); // 50% → ₦40,000

    const tx = await prisma.ledgerTransaction.findMany({
      where: { operatorId: ctx.operator.id },
      include: { entries: { include: { account: true } } },
    });
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({
      type: 'refund_owed',
      idempotencyKey: `refund-owed:${booking.id}`,
    });
    expect(tx[0].entries.map((e) => [e.account.key, e.debitKobo, e.creditKobo]).sort()).toEqual([
      ['REFUNDS_PAYABLE', 0, 4_000_000],
      ['SALES_REFUNDS', 4_000_000, 0],
    ]);
  });

  it('nothing is posted when nothing is owed', async () => {
    const ctx = await setup();
    const booking = await paidBooking(ctx);
    await cancelBooking(prisma, {
      operatorId: ctx.operator.id,
      bookingId: booking.id,
      initiatedBy: 'guest',
      reason: 'late',
      actor: STAFF,
      now: hoursBefore(ctx, 2), // 0% tier
    });
    expect(await prisma.ledgerTransaction.count({ where: { operatorId: ctx.operator.id } })).toBe(
      0,
    );
  });

  it('calling off a departure records every refund owed', async () => {
    const ctx = await setup();
    await paidBooking(ctx, 1);
    await paidBooking(ctx, 2);
    await cancelDeparture(prisma, {
      operatorId: ctx.operator.id,
      departureId: ctx.departure.id,
      reason: 'Storm',
      actor: STAFF,
    });

    const payable = await prisma.ledgerEntry.aggregate({
      where: { operatorId: ctx.operator.id, account: { key: 'REFUNDS_PAYABLE' } },
      _sum: { creditKobo: true },
    });
    expect(payable._sum.creditKobo).toBe(12_000_000); // 3 × ₦40,000 owed
  });
});
