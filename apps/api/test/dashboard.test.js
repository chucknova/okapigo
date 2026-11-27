/**
 * Stage 18c: the dashboard (RPT-01).
 *   GET /api/dashboard   today's tiles, the 30-day trend, channels, seats filled
 * The money rules are checked on dashboardFigures with money events posted to the ledger
 * directly: in (a payment, cash, an OTA paying), out (a refund), not counted (Paystack's fee),
 * undone (a reversal), and the business's own day (23:30 in Lagos is still that day).
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { POSTINGS } from '@okapigo/shared/ledger';
import { addDays, localDate, zonedTimeToUtc } from '@okapigo/shared/time';
import {
  bookingIdFromGuestToken,
  dashboardFigures,
  postTransaction,
  reverseTransaction,
} from '@okapigo/db';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

const TZ = 'Africa/Lagos';

/** Posts one money event. @param {string} operatorId @param {string} type @param {any[]} lines @param {Date} occurredAt @param {string | null} [bookingId] */
const post = (operatorId, type, lines, occurredAt, bookingId = null) =>
  ctx.prisma.$transaction((tx) =>
    postTransaction(/** @type {any} */ (tx), {
      operatorId,
      type,
      idempotencyKey: `test:${randomUUID()}`,
      description: type,
      lines,
      occurredAt,
      bookingId,
    }),
  );

/**
 * A booking made through the public checkout (as a guest would), then set to a channel, paid,
 * and made at `at`.
 * @param {any} s @param {string} channel @param {Date} [at]
 */
async function madeBooking(s, channel, at = new Date()) {
  const today = localDate(new Date(), TZ);
  const deps = (
    await request(ctx.app).get(
      `/public/${s.operator.slug}/tours/lagos-island-heritage-walk/departures?to=${addDays(today, 20)}`,
    )
  ).body.departures;
  const { token } = (
    await request(ctx.app)
      .post(`/public/${s.operator.slug}/bookings`)
      .send({
        lead: { name: 'Test Guest', email: 'test@guest.example', acceptTerms: true },
        departureId: deps.find((/** @type {any} */ d) => d.localDate > today).id,
        travellers: [{ name: 'Test Guest', age: 30 }],
        addOns: [],
      })
  ).body;
  const id = /** @type {string} */ (bookingIdFromGuestToken(TEST_AUTH_SECRET, token));
  const b = await ctx.prisma.booking.update({
    where: { id },
    data: { channel, status: 'paid', createdAt: at },
  });
  await ctx.prisma.hold.update({
    where: { id: b.holdId },
    data: { status: 'converted', endedAt: new Date() },
  });
  return b;
}

describe('money in (the ledger’s money accounts, by the business’s day)', () => {
  it('in: payments and cash; out: refunds; Paystack’s fee is not counted; a reversal undoes', async () => {
    const s = await ctx.seedOperator();
    const op = s.operator.id;
    const now = new Date();
    const b = await madeBooking(s, 'web');
    const paid = await post(op, 'payment_received', POSTINGS.paymentReceived(2_500_000), now, b.id);
    await post(op, 'payment_fee', POSTINGS.paymentFee(37_500), now, b.id);
    await post(op, 'cash_received', POSTINGS.cashReceived(1_000_000), now, b.id);
    await post(op, 'refund_owed', POSTINGS.refundOwed(500_000), now, b.id); // owed: not money yet
    await post(op, 'refund_paid', POSTINGS.refundPaid(500_000), now, b.id);
    let f = await dashboardFigures(ctx.prisma, { operatorId: op, timeZone: TZ, now });
    expect(f.today.money).toEqual({ in: 3_500_000, out: 500_000 });
    expect(f.days.at(-1)?.moneyIn).toBe(3_000_000);

    // The payment was a mistake: reversed, it nets to nothing (and so does its day).
    await reverseTransaction(ctx.prisma, {
      operatorId: op,
      transactionId: paid.transactionId,
      reason: 'test',
    });
    f = await dashboardFigures(ctx.prisma, { operatorId: op, timeZone: TZ, now });
    expect(f.days.at(-1)?.moneyIn).toBe(500_000);
  });

  it('a reversed fee isn’t money in either', async () => {
    const s = await ctx.seedOperator();
    const op = s.operator.id;
    const now = new Date();
    const fee = await post(op, 'payment_fee', POSTINGS.paymentFee(37_500), now);
    await reverseTransaction(ctx.prisma, {
      operatorId: op,
      transactionId: fee.transactionId,
      reason: 'x',
    });
    const f = await dashboardFigures(ctx.prisma, { operatorId: op, timeZone: TZ, now });
    expect(f.today.money).toEqual({ in: 0, out: 0 });
  });

  it('the Lagos day: 23:30 in Lagos is that day, 00:30 the next', async () => {
    const s = await ctx.seedOperator();
    const op = s.operator.id;
    // "Now" is midday on 25 Nov in Lagos.
    const now = zonedTimeToUtc('2026-11-25', '12:00', TZ);
    await post(
      op,
      'payment_received',
      POSTINGS.paymentReceived(100),
      zonedTimeToUtc('2026-11-24', '23:30', TZ),
    );
    await post(
      op,
      'payment_received',
      POSTINGS.paymentReceived(200),
      zonedTimeToUtc('2026-11-25', '00:30', TZ),
    );
    const f = await dashboardFigures(ctx.prisma, { operatorId: op, timeZone: TZ, now });
    expect(f.days).toHaveLength(30);
    expect(f.days.at(-1)).toMatchObject({ date: '2026-11-25', moneyIn: 200 });
    expect(f.days.at(-2)).toMatchObject({ date: '2026-11-24', moneyIn: 100 });
    expect(f.days[0].date).toBe('2026-10-27');
  });

  it('the 30 days before: for the change; 60 days ago doesn’t count at all', async () => {
    const s = await ctx.seedOperator();
    const op = s.operator.id;
    const now = new Date();
    const today = localDate(now, TZ);
    await post(
      op,
      'payment_received',
      POSTINGS.paymentReceived(1_000_000),
      zonedTimeToUtc(addDays(today, -40), '10:00', TZ),
    );
    await post(
      op,
      'payment_received',
      POSTINGS.paymentReceived(9_000_000),
      zonedTimeToUtc(addDays(today, -60), '10:00', TZ),
    );
    await post(
      op,
      'payment_received',
      POSTINGS.paymentReceived(1_200_000),
      zonedTimeToUtc(addDays(today, -1), '10:00', TZ),
    );
    await post(
      op,
      'refund_paid',
      POSTINGS.refundPaid(300_000),
      zonedTimeToUtc(addDays(today, -38), '10:00', TZ),
    );
    await madeBooking(s, 'web', zonedTimeToUtc(addDays(today, -35), '10:00', TZ));
    const f = await dashboardFigures(ctx.prisma, { operatorId: op, timeZone: TZ, now });
    // Its refund comes off too.
    expect(f.previous).toEqual({ moneyIn: 700_000, bookings: 1 });
    expect(f.days.reduce((n, d) => n + d.moneyIn, 0)).toBe(1_200_000);
  });
});

describe('bookings, channels, seats, check-ins', () => {
  it('bookings made by channel; a lapsed hold isn’t one; the OTA’s own name and what it paid', async () => {
    const s = await ctx.seedOperator();
    const op = s.operator.id;
    const now = new Date();
    const web = await madeBooking(s, 'web');
    await madeBooking(s, 'web');
    const wa = await madeBooking(s, 'whatsapp');
    const lapsed = await madeBooking(s, 'staff');
    // Its hold lapsed: "cancelled", but never a booking anyone made.
    await ctx.prisma.booking.update({ where: { id: lapsed.id }, data: { status: 'cancelled' } });
    await ctx.prisma.hold.update({ where: { id: lapsed.holdId }, data: { status: 'expired' } });
    await post(op, 'payment_received', POSTINGS.paymentReceived(2_500_000), now, web.id);
    await post(op, 'payment_received', POSTINGS.paymentReceived(4_500_000), now, wa.id);
    const channel =
      (await ctx.prisma.channel.findFirst({ where: { operatorId: op } })) ??
      (await ctx.prisma.channel.create({
        data: {
          operatorId: op,
          name: 'Sojourna',
          apiKeyHash: randomUUID(),
          apiKeyHint: 'x',
          commissionBasisPoints: 2000,
        },
      }));
    const ota = await madeBooking(s, 'ota');
    await ctx.prisma.channelBooking.create({
      data: {
        operatorId: op,
        channelId: channel.id,
        bookingId: ota.id,
        uuid: randomUUID(),
        unitItems: [],
        commissionBasisPoints: 2000,
      },
    });
    await ctx.prisma.channelPayment.create({
      data: {
        operatorId: op,
        channelId: channel.id,
        amountKobo: 2_000_000,
        receivedOn: new Date(`${localDate(now, TZ)}T00:00:00Z`),
      },
    });
    await post(op, 'ota_payment', POSTINGS.otaPayment(2_000_000), now);

    const f = await dashboardFigures(ctx.prisma, { operatorId: op, timeZone: TZ, now });
    expect(f.today.bookings.total).toBe(4);
    expect(f.today.bookings.byChannel).toEqual(
      expect.arrayContaining([
        { name: 'web', count: 2 },
        { name: 'whatsapp', count: 1 },
        { name: channel.name, count: 1 },
      ]),
    );
    expect(f.channels).toEqual(
      expect.arrayContaining([
        { name: 'web', bookings: 2, kobo: 2_500_000 },
        { name: 'whatsapp', bookings: 1, kobo: 4_500_000 },
        { name: channel.name, bookings: 1, kobo: 2_000_000 },
      ]),
    );
    // The OTA paying is money in too.
    expect(f.today.money.in).toBe(9_000_000);
  });

  it('seats filled: past departures of 30 days, a smaller van counts as its seats; cancelled ones don’t', async () => {
    const s = await ctx.seedOperator();
    const op = s.operator.id;
    const now = new Date();
    const deps = await ctx.prisma.departure.findMany({
      where: {
        operatorId: op,
        product: { slug: 'lagos-island-heritage-walk' },
        startsAt: { gt: now },
      },
      orderBy: { startsAt: 'asc' },
      take: 3,
    });
    const back = (/** @type {number} */ days) => new Date(now.getTime() - days * 86_400_000);
    const end = (/** @type {number} */ days) => new Date(back(days).getTime() + 3 * 3_600_000);
    await ctx.prisma.departure.update({
      where: { id: deps[0].id },
      data: { startsAt: back(3), endsAt: end(3), capacity: 10, seatsSold: 5 },
    });
    await ctx.prisma.departure.update({
      where: { id: deps[1].id },
      // Its van holds only 6, whatever the departure's own capacity says.
      data: {
        startsAt: back(5),
        endsAt: end(5),
        capacity: 10,
        seatsSold: 6,
        resource: {
          create: {
            operatorId: op,
            kind: 'van',
            name: `Test van ${randomUUID().slice(0, 4)}`,
            seats: 6,
          },
        },
      },
    });
    await ctx.prisma.departure.update({
      where: { id: deps[2].id },
      data: { startsAt: back(7), endsAt: end(7), capacity: 10, seatsSold: 0, status: 'cancelled' },
    });
    const f = await dashboardFigures(ctx.prisma, { operatorId: op, timeZone: TZ, now });
    expect(f.tours).toEqual([{ title: 'Lagos Island Heritage Walk', sold: 11, capacity: 16 }]);
  });

  it('today: departures under way, to come, ended; check-ins of guests coming', async () => {
    const s = await ctx.seedOperator();
    const op = s.operator.id;
    const today = localDate(new Date(), TZ);
    const noon = zonedTimeToUtc(today, '12:00', TZ);
    // Three of today's departures, placed around "now" = noon.
    const deps = await ctx.prisma.departure.findMany({
      where: { operatorId: op, product: { slug: 'lagos-island-heritage-walk' } },
      orderBy: { startsAt: 'asc' },
      take: 3,
      skip: 2,
    });
    const set = (/** @type {number} */ i, /** @type {string} */ from, /** @type {string} */ to) =>
      ctx.prisma.departure.update({
        where: { id: deps[i].id },
        data: { startsAt: zonedTimeToUtc(today, from, TZ), endsAt: zonedTimeToUtc(today, to, TZ) },
      });
    await set(0, '07:00', '10:00'); // ended
    await set(1, '11:00', '14:00'); // under way
    await set(2, '15:00', '18:00'); // to come
    // The seed has its own trips today too (which ones depends on the weekday: the Friday food
    // crawl, the morning walk…): called off, so only these three count (found on a Friday,
    // 19c-2). Cancelled departures aren't counted.
    await ctx.prisma.departure.updateMany({
      where: {
        operatorId: op,
        id: { notIn: deps.map((d) => d.id) },
        startsAt: {
          gte: zonedTimeToUtc(today, '00:00', TZ),
          lt: zonedTimeToUtc(addDays(today, 1), '00:00', TZ),
        },
      },
      data: { status: 'cancelled' },
    });
    const b = await madeBooking(s, 'web', zonedTimeToUtc(addDays(today, -3), '10:00', TZ));
    await ctx.prisma.booking.update({ where: { id: b.id }, data: { departureId: deps[1].id } });
    await ctx.prisma.traveller.createMany({
      data: [
        {
          operatorId: op,
          bookingId: b.id,
          position: 10,
          name: 'A',
          categoryKey: 'adult',
          checkInStatus: 'present',
        },
        {
          operatorId: op,
          bookingId: b.id,
          position: 11,
          name: 'B',
          categoryKey: 'adult',
          checkInStatus: 'late',
        },
        { operatorId: op, bookingId: b.id, position: 12, name: 'C', categoryKey: 'adult' },
      ],
    });
    // A cancelled booking on the same departure: its guest isn't coming, so isn't counted.
    const gone = await madeBooking(s, 'web', zonedTimeToUtc(addDays(today, -3), '10:00', TZ));
    await ctx.prisma.booking.update({
      where: { id: gone.id },
      data: { departureId: deps[1].id, status: 'cancelled' },
    });
    const f = await dashboardFigures(ctx.prisma, { operatorId: op, timeZone: TZ, now: noon });
    expect(f.today.departures).toMatchObject({ underWay: 1, toCome: 1, ended: 1 });
    expect(f.today.departures.total).toBe(3);
    // A, B (late counts) of A, B, C and the guest from the checkout.
    expect(f.today.checkIns).toEqual({ done: 2, total: 4 });
    expect(f.today.bookings.total).toBe(0); // made three days ago
  });
});

describe('GET /api/dashboard', () => {
  it('the owner and managers see it, in words; a guide can’t', async () => {
    const s = await ctx.seedOperator();
    const b = await madeBooking(s, 'web');
    await post(
      s.operator.id,
      'payment_received',
      POSTINGS.paymentReceived(2_500_000),
      new Date(),
      b.id,
    );
    const res = await request(ctx.app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${await ctx.tokenFor(s.manager.id)}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const d = res.body.dashboard;
    expect(d.today.map((/** @type {any} */ t) => t.label)).toEqual([
      'Departures today',
      'Bookings today',
      'Money in today',
      'Checked in today',
    ]);
    expect(d.today[1]).toMatchObject({ value: '1', note: '1 website' });
    expect(d.today[2]).toMatchObject({ value: '₦25,000', note: '₦25,000 paid' });
    expect(d.money).toMatchObject({ total: '₦25,000', change: null });
    expect(d.money.bars).toHaveLength(30);
    expect(d.money.bars.at(-1)).toBe('100%');
    expect(d.channels).toEqual([{ name: 'Website and widget', bookings: '1', money: '₦25,000' }]);
    expect(d.range.to).toBe('Today');
    expect(d.updatedAt).toMatch(/^\d\d:\d\d$/);

    const guide = await request(ctx.app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${await ctx.tokenFor(s.guides[0].id)}`);
    expect(guide.status).toBe(403);
  });
});
