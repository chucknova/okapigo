/**
 * Stage 19a-1: the demo business's history. Seeded once (on a fixed Monday morning, so the
 * story is the same whatever day the tests run), then held to the live system's rules: the
 * books balance, seats sold match the bookings, statuses are real ones, money and times make
 * sense, and the loose ends a manager should see are there.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { simulatedFeeKobo } from '@okapigo/payments';
import { BOOKING_STATUSES, SEAT_CONSUMING_STATUSES } from '@okapigo/shared/booking-status';
import { zonedTimeToUtc } from '@okapigo/shared/time';
import {
  createPrismaClient,
  dashboardFigures,
  inboxAlerts,
  seedDemoOperator,
  verifyLedger,
} from '../src/index.js';
import { seedDemoHistory, randomFrom, PAST_BOOKINGS } from '../src/seed/history.js';

/** @type {import('@prisma/client').PrismaClient} */
let prisma;
/** @type {any} */
let op;
/** @type {Awaited<ReturnType<typeof seedDemoHistory>>} */
let result;
const created = /** @type {string[]} */ ([]);
// Monday 23 November 2026, 08:00 in Lagos.
const NOW = zonedTimeToUtc('2026-11-23', '08:00', 'Africa/Lagos');

/** A smaller story for the extra businesses: the full one is seeded once (it's slow). */
const SMALL = { pastBookings: 40, upcomingBookings: 6 };

/** @param {string} tag @param {object} [size] */
async function seeded(tag, size = {}) {
  const operator = await seedDemoOperator(prisma, {
    slug: `test-${tag}-${randomUUID().slice(0, 6)}`,
    now: NOW,
  });
  created.push(operator.id);
  const r = await seedDemoHistory(prisma, operator, { now: NOW, feeOf: simulatedFeeKobo, ...size });
  return { operator, r };
}

beforeAll(async () => {
  prisma = createPrismaClient(process.env.DATABASE_URL);
  ({ operator: op, r: result } = await seeded('hist'));
}, 180_000);
afterAll(async () => {
  await prisma.operator.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

const bookings = () =>
  prisma.booking.findMany({
    where: { operatorId: op.id },
    include: { departure: true, travellers: true, events: true, payments: true, refunds: true },
  });

describe('the story', () => {
  it('about 150 past and 20 upcoming bookings, over 60 days of departures', async () => {
    expect(result.departures).toBeGreaterThan(100);
    expect(result.past).toBeGreaterThanOrEqual(PAST_BOOKINGS);
    expect(result.upcoming).toBeGreaterThanOrEqual(18);
    const all = await bookings();
    expect(all).toHaveLength(result.past + result.upcoming);
    const past = all.filter((b) => b.departure.startsAt < NOW);
    const future = all.filter((b) => b.departure.startsAt >= NOW);
    expect(past.length).toBe(result.past);
    expect(future.length).toBe(result.upcoming);
  });

  it('every channel: website, widget, WhatsApp, the desk, Sojourna', async () => {
    const all = await bookings();
    const kinds = new Set(
      all.map(
        (b) =>
          `${b.channel}${b.channel === 'web' ? `:${/** @type {any} */ (b.attribution)?.via}` : ''}`,
      ),
    );
    expect([...kinds].sort()).toEqual(['ota', 'staff', 'web:website', 'web:widget', 'whatsapp']);
    const ota = await prisma.channelBooking.count({ where: { operatorId: op.id } });
    expect(ota).toBeGreaterThan(5);
  });

  it('only statuses the app knows; past trips completed (or no-show, cancelled), future ones paid', async () => {
    const all = await bookings();
    for (const b of all) expect(BOOKING_STATUSES).toContain(b.status);
    const pastStatuses = new Set(
      all.filter((b) => b.departure.startsAt < NOW).map((b) => b.status),
    );
    expect([...pastStatuses].sort()).toEqual([
      'cancelled',
      'completed',
      'confirmed',
      'no_show',
      'refunded',
    ]);
    const futureStatuses = new Set(
      all.filter((b) => b.departure.startsAt >= NOW).map((b) => b.status),
    );
    for (const s of futureStatuses) expect(['paid', 'part_paid']).toContain(s);
  });

  it('booked before the trip, never in the future; the timeline in order, from "created"', async () => {
    for (const b of await bookings()) {
      expect(b.createdAt.getTime()).toBeLessThan(b.departure.startsAt.getTime());
      expect(b.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
      const events = [...b.events].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
      expect(events[0]).toMatchObject({ type: 'created', toStatus: 'held' });
      expect(events.at(-1)?.toStatus).toBe(b.status);
      // Each step starts where the one before ended.
      for (let i = 1; i < events.length; i++)
        expect(events[i].fromStatus).toBe(events[i - 1].toStatus);
    }
  });

  it('the money: paid matches the payments; a part-paid Badagry has its deposit only', async () => {
    for (const b of await bookings()) {
      const paid = b.payments
        .filter((p) => p.status === 'succeeded')
        .reduce((n, p) => n + p.amountKobo, 0);
      expect(b.amountPaidKobo).toBe(paid);
      if (b.status === 'paid' || b.status === 'completed') expect(paid).toBe(b.totalKobo);
      if (b.status === 'part_paid') {
        expect(paid).toBeLessThan(b.totalKobo);
        expect(b.payments.map((p) => p.purpose)).toEqual(['deposit']);
      }
    }
  });
});

describe('held to the live system’s rules', () => {
  it('the books balance (the nightly check finds nothing wrong)', async () => {
    const { ok, issues } = await verifyLedger(prisma, { operatorId: op.id });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(ok).toBe(true);
  });

  it('every departure’s seats sold = its coming guests, never over capacity', async () => {
    const deps = await prisma.departure.findMany({
      where: { operatorId: op.id },
      include: { bookings: { include: { travellers: true } } },
    });
    for (const d of deps) {
      const guests = d.bookings
        .filter((b) => SEAT_CONSUMING_STATUSES.includes(/** @type {any} */ (b.status)))
        .reduce((n, b) => n + b.travellers.length, 0);
      expect(d.seatsSold, d.id).toBe(guests);
      expect(d.seatsSold).toBeLessThanOrEqual(d.capacity);
    }
  });

  it('past trips were guided and checked in; no-shows marked', async () => {
    const all = await bookings();
    for (const b of all.filter((x) => x.status === 'completed')) {
      expect(b.departure.guideId).not.toBeNull();
      for (const t of b.travellers) expect(['present', 'late']).toContain(t.checkInStatus);
    }
    const noShows = all.filter((b) => b.status === 'no_show');
    expect(noShows.length).toBe(2);
    for (const b of noShows) for (const t of b.travellers) expect(t.checkInStatus).toBe('no_show');
  });

  it('the weather: one Tarkwa Bay trip called off, everyone refunded in full', async () => {
    const off = await prisma.departure.findMany({
      where: { operatorId: op.id, status: 'cancelled' },
      include: { product: true, bookings: { include: { refunds: true } } },
    });
    expect(off).toHaveLength(1);
    expect(off[0].product.slug).toMatch(/^tarkwa-bay/);
    expect(off[0].cancelReason).toMatch(/^Weather/);
    expect(off[0].bookings).toHaveLength(3);
    for (const b of off[0].bookings) {
      expect(b.status).toBe('refunded');
      expect(b.refunds[0]).toMatchObject({ status: 'processed', amountKobo: b.amountPaidKobo });
    }
  });

  it('Sojourna paid what it owed, never more', async () => {
    const payments = await prisma.channelPayment.findMany({
      where: { operatorId: op.id },
      include: { allocations: { include: { channelBooking: { include: { booking: true } } } } },
    });
    expect(payments.length).toBeGreaterThanOrEqual(1);
    for (const p of payments) {
      expect(p.allocations.reduce((n, a) => n + a.amountKobo, 0)).toBe(p.amountKobo);
      for (const a of p.allocations) {
        const b = a.channelBooking.booking;
        expect(b.status).toBe('completed');
        expect(a.amountKobo).toBe(b.totalKobo - Math.round((b.totalKobo * 0.2) / 100) * 100);
      }
    }
  });
});

describe('as the books and the story say', () => {
  it('every fee on a payment is in the books; every refund sent is in the books', async () => {
    const payments = await prisma.payment.findMany({ where: { operatorId: op.id } });
    const fees = payments.reduce((n, p) => n + (p.feeKobo ?? 0), 0);
    /** @param {string} type */
    const posted = async (type) =>
      (
        await prisma.ledgerEntry.aggregate({
          where: { operatorId: op.id, transaction: { type }, debitKobo: { gt: 0 } },
          _sum: { debitKobo: true },
        })
      )._sum.debitKobo ?? 0;
    expect(await posted('payment_fee')).toBe(fees);
    const sent = await prisma.refund.aggregate({
      where: { operatorId: op.id, status: 'processed' },
      _sum: { amountKobo: true },
    });
    expect(await posted('refund_paid')).toBe(sent._sum.amountKobo);
    // A refund sent through Paystack takes money out of the Paystack account (1100).
    const out = await prisma.ledgerEntry.aggregate({
      where: { operatorId: op.id, transaction: { type: 'refund_paid' }, account: { code: '1100' } },
      _sum: { creditKobo: true },
    });
    const viaPaystack = await prisma.refund.aggregate({
      where: { operatorId: op.id, status: 'processed', provider: 'simulator' },
      _sum: { amountKobo: true },
    });
    expect(out._sum.creditKobo).toBe(viaPaystack._sum.amountKobo);
    expect(viaPaystack._sum.amountKobo).toBeGreaterThan(0);
  });

  it('a growing business; only a few bookings made today', async () => {
    const f = await dashboardFigures(prisma, {
      operatorId: op.id,
      timeZone: op.timeZone,
      now: NOW,
    });
    expect(f.days.reduce((n, d) => n + d.bookings, 0)).toBeGreaterThan(f.previous.bookings);
    expect(f.today.bookings.total).toBeLessThanOrEqual(4);
  });
});

describe('the loose ends a manager sorts out', () => {
  it('at most one balance overdue: the rest paid theirs when it was due', async () => {
    const owing = await prisma.booking.findMany({
      where: { operatorId: op.id, status: 'part_paid' },
      include: { departure: true },
    });
    const overdue = owing.filter(
      (b) => b.departure.startsAt.getTime() - 7 * 86_400_000 <= NOW.getTime(),
    );
    expect(overdue.length).toBeLessThanOrEqual(1);
  });

  it('a refund that failed, cash with a guide, a departure soon with no guide', async () => {
    expect(await prisma.refund.count({ where: { operatorId: op.id, status: 'failed' } })).toBe(1);
    expect(
      await prisma.cashReport.count({ where: { operatorId: op.id, status: 'reported' } }),
    ).toBe(1);
    const unguided = await prisma.departure.findUniqueOrThrow({
      where: { id: /** @type {string} */ (result.unguidedDepartureId) },
    });
    expect(unguided.guideId).toBeNull();
    // …with guests on it: what makes it urgent.
    expect(unguided.seatsSold).toBeGreaterThan(0);
    // Every other departure in the next week has its guide.
    const week = await prisma.departure.findMany({
      where: {
        operatorId: op.id,
        startsAt: { gt: NOW, lt: new Date(NOW.getTime() + 7 * 86_400_000) },
      },
    });
    expect(week.filter((d) => !d.guideId).map((d) => d.id)).toEqual([unguided.id]);
  });

  it('in the inbox: a change of date, and a question the assistant passed on', async () => {
    const requests = await prisma.guestRequest.findMany({ where: { operatorId: op.id } });
    expect(requests.map((r) => r.kind).sort()).toEqual(['change_date', 'question']);
    const handed = await prisma.companionMessage.findFirstOrThrow({ where: { operatorId: op.id } });
    expect(handed).toMatchObject({
      outcome: 'handed_over',
      guestRequestId: requests.find((r) => r.kind === 'question')?.id,
    });
  });

  it('the alerts show them', async () => {
    const { alerts } = await inboxAlerts(prisma, { operatorId: op.id, now: NOW });
    const kinds = new Set(alerts.map((a) => a.kind));
    expect(kinds.has('cash')).toBe(true);
    expect([...kinds].some((k) => /refund/.test(k))).toBe(true);
  });
});

describe('the dashboard has something to say', () => {
  it('money in and bookings over 30 days and the 30 before; channels; seats filled', async () => {
    const f = await dashboardFigures(prisma, {
      operatorId: op.id,
      timeZone: op.timeZone,
      now: NOW,
    });
    expect(f.days.reduce((n, d) => n + d.moneyIn, 0)).toBeGreaterThan(0);
    expect(f.previous.moneyIn).toBeGreaterThan(0);
    expect(f.days.filter((d) => d.bookings > 0).length).toBeGreaterThan(10);
    expect(f.channels.map((c) => c.name).sort()).toEqual(['Sojourna', 'staff', 'web', 'whatsapp']);
    expect(f.tours.length).toBe(5);
    for (const t of f.tours) expect(t.sold).toBeGreaterThan(0);
  });
});

describe('any day of the week', () => {
  // The story depends on the day (which trips run, what's full): a Wednesday and a Saturday
  // too, so a loose end never lands on a departure with no room (found on a real Monday).
  it.each([
    ['a Wednesday', '2026-11-25', '06:00'],
    ['a Saturday, late', '2026-11-28', '21:00'],
  ])(
    '%s: seeded, the books balance, seats add up',
    async (_, day, time) => {
      const now = zonedTimeToUtc(day, time, 'Africa/Lagos');
      const operator = await seedDemoOperator(prisma, {
        slug: `test-day-${randomUUID().slice(0, 6)}`,
        now,
      });
      created.push(operator.id);
      const r = await seedDemoHistory(prisma, operator, {
        now,
        feeOf: simulatedFeeKobo,
        ...SMALL,
      });
      expect(r.past).toBeGreaterThanOrEqual(SMALL.pastBookings);
      // The loose ends hold whatever the day: the unguided departure has guests; one overdue
      // balance at most.
      const unguided = await prisma.departure.findUniqueOrThrow({
        where: { id: /** @type {string} */ (r.unguidedDepartureId) },
      });
      expect(unguided.seatsSold).toBeGreaterThan(0);
      const owing = await prisma.booking.findMany({
        where: { operatorId: operator.id, status: 'part_paid' },
        include: { departure: true },
      });
      expect(
        owing.filter((b) => b.departure.startsAt.getTime() - 7 * 86_400_000 <= now.getTime())
          .length,
      ).toBeLessThanOrEqual(1);
      expect((await verifyLedger(prisma, { operatorId: operator.id })).ok).toBe(true);
      const over = await prisma.departure.findMany({ where: { operatorId: operator.id } });
      for (const d of over) expect(d.seatsSold).toBeLessThanOrEqual(d.capacity);
    },
    180_000,
  );
});

describe('the same story every time', () => {
  it('the random sequence is fixed; a second business gets the same guests and totals', async () => {
    const a = randomFrom(19);
    const b = randomFrom(19);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const { operator: twin } = await seeded('twin', SMALL);
    const { operator: other } = await seeded('twin2', SMALL);
    const story = async (/** @type {string} */ id) =>
      (
        await prisma.booking.findMany({
          where: { operatorId: id },
          orderBy: [{ createdAt: 'asc' }, { leadName: 'asc' }],
          select: { leadName: true, totalKobo: true, status: true },
        })
      ).map((x) => `${x.leadName}|${x.totalKobo}|${x.status}`);
    expect(await story(twin.id)).toEqual(await story(other.id));
  }, 180_000);
});
