// @ts-check
/**
 * dashboard.js — the owner's numbers (RPT-01, stage 18c; design D1): today, and the last 30
 * days against the 30 before.
 *
 *   today          departures (under way · to come · ended), bookings made (by channel),
 *                  money in (paid · refunded), travellers checked in
 *   days           30 days: money in and bookings made, each day
 *   previous       the 30 days before: the same two totals ("+12% on the 30 days before")
 *   channels       30 days: where bookings came from, and the money they brought
 *   tours          30 days: seats filled, by tour
 *
 * MONEY IN (decided 2026-11-23, designs D1): money that arrived minus refunds sent, read from
 * the ledger's money accounts (Cash 1000, Paystack clearing 1100, Bank 1200) by the day it
 * happened. A guest paying, a guide's cash handed in, an OTA paying what it owes: in. A refund
 * leaving: out. Paystack's fee is not a refund, so its posting (and a reversal of one) is
 * left out. A reversal of anything else counts, so a mistake undone nets to zero.
 *
 * Every day is the business's own (Lagos) day.
 */
import { addDays, localDate, zonedTimeToUtc } from '@okapigo/shared/time';

/** The money accounts. */
const MONEY_ACCOUNTS = ['1000', '1100', '1200'];
/**
 * A booking was MADE when its hold was converted (confirmed or paid). One whose hold lapsed or
 * was let go is "cancelled" too, but was never a booking anyone made.
 */
const MADE = { hold: { status: 'converted' } };
/** Bookings whose guests are coming (or came). */
const COMING = ['confirmed', 'part_paid', 'paid', 'amended', 'completed', 'no_show'];
export const DASHBOARD_DAYS = 30;

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, timeZone: string, now?: Date }} q
 */
export async function dashboardFigures(prisma, { operatorId, timeZone: tz, now = new Date() }) {
  const today = localDate(now, tz);
  const first = addDays(today, -(DASHBOARD_DAYS - 1)); // 30 days, today included
  const before = addDays(first, -DASHBOARD_DAYS); // the 30 before that
  const at = (/** @type {string} */ day) => zonedTimeToUtc(day, '00:00', tz);
  const todayStart = at(today);
  const tomorrow = at(addDays(today, 1));

  // --- Money, by day (60 days: these 30 and the 30 before) ---------------------------------
  /** @type {Array<{ day: string, money_in: bigint, money_out: bigint }>} */
  const moneyRows = await prisma.$queryRaw`
    WITH tx AS (
      SELECT t.id, t.occurred_at, SUM(e.debit_kobo - e.credit_kobo) AS delta
      FROM ledger_transactions t
      JOIN ledger_entries e ON e.transaction_id = t.id
      JOIN ledger_accounts a ON a.id = e.account_id
      LEFT JOIN ledger_transactions r ON r.id = t.reverses_id
      WHERE t.operator_id = ${operatorId}::uuid
        AND a.code = ANY(${MONEY_ACCOUNTS})
        AND t.type <> 'payment_fee'
        AND COALESCE(r.type, '') <> 'payment_fee'
        AND t.occurred_at >= ${at(before)} AND t.occurred_at < ${tomorrow}
      GROUP BY t.id, t.occurred_at
    )
    SELECT to_char(occurred_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
           SUM(GREATEST(delta, 0))::bigint AS money_in,
           SUM(GREATEST(-delta, 0))::bigint AS money_out
    FROM tx GROUP BY 1`;
  const money = new Map(
    moneyRows.map((r) => [r.day, { in: Number(r.money_in), out: Number(r.money_out) }]),
  );

  // --- Bookings made, by day and channel (60 days) ----------------------------------------
  const made = await prisma.booking.findMany({
    where: {
      operatorId,
      ...MADE,
      createdAt: { gte: at(before), lt: tomorrow },
    },
    select: {
      createdAt: true,
      channel: true,
      channelBooking: { select: { channel: { select: { name: true } } } },
    },
  });
  /** "WhatsApp", "Sojourna"…: the OTA's own name. @param {(typeof made)[number]} b */
  const channelOf = (b) =>
    b.channel === 'ota' ? (b.channelBooking?.channel.name ?? 'OTA') : b.channel;

  const days = [];
  for (let d = first; d <= today; d = addDays(d, 1)) {
    days.push({
      date: d,
      moneyIn: (money.get(d)?.in ?? 0) - (money.get(d)?.out ?? 0),
      bookings: made.filter((b) => localDate(b.createdAt, tz) === d).length,
    });
  }
  let previousMoney = 0;
  for (let d = before; d < first; d = addDays(d, 1)) {
    previousMoney += (money.get(d)?.in ?? 0) - (money.get(d)?.out ?? 0);
  }
  const previousBookings = made.filter((b) => b.createdAt < at(first)).length;

  // --- Where bookings came from (30 days) -------------------------------------------------
  const recent = made.filter((b) => b.createdAt >= at(first));
  /** @type {Array<{ channel: string, ota_name: string | null, kobo: bigint }>} */
  const byBooking = await prisma.$queryRaw`
    SELECT b.channel, c.name AS ota_name, SUM(e.debit_kobo - e.credit_kobo)::bigint AS kobo
    FROM ledger_entries e
    JOIN ledger_transactions t ON t.id = e.transaction_id
    JOIN ledger_accounts a ON a.id = e.account_id
    JOIN bookings b ON b.id = e.booking_id
    LEFT JOIN channel_bookings cb ON cb.booking_id = b.id
    LEFT JOIN channels c ON c.id = cb.channel_id
    WHERE e.operator_id = ${operatorId}::uuid
      AND a.code = ANY(${MONEY_ACCOUNTS})
      AND t.type <> 'payment_fee'
      AND t.occurred_at >= ${at(first)} AND t.occurred_at < ${tomorrow}
    GROUP BY b.channel, c.name`;
  // An OTA pays for many bookings at once: its money is what it paid in these 30 days.
  const otaPaid = await prisma.channelPayment.findMany({
    where: { operatorId, receivedOn: { gte: new Date(`${first}T00:00:00Z`) } },
    select: { amountKobo: true, channel: { select: { name: true } } },
  });
  /** @type {Map<string, { bookings: number, kobo: number }>} */
  const channels = new Map();
  const add = (/** @type {string} */ name, bookings = 0, kobo = 0) => {
    const c = channels.get(name) ?? { bookings: 0, kobo: 0 };
    channels.set(name, { bookings: c.bookings + bookings, kobo: c.kobo + kobo });
  };
  for (const b of recent) add(channelOf(b), 1);
  for (const r of byBooking)
    add(r.channel === 'ota' ? (r.ota_name ?? 'OTA') : r.channel, 0, Number(r.kobo));
  for (const p of otaPaid) add(p.channel.name, 0, p.amountKobo);

  // --- Seats filled, by tour (departures of the last 30 days) -----------------------------
  const past = await prisma.departure.findMany({
    where: { operatorId, startsAt: { gte: at(first), lt: now }, status: { not: 'cancelled' } },
    // Its van or boat may hold fewer than the departure's capacity (16b).
    select: {
      capacity: true,
      seatsSold: true,
      resource: { select: { seats: true } },
      product: { select: { title: true } },
    },
  });
  /** @type {Map<string, { sold: number, capacity: number }>} */
  const tours = new Map();
  for (const d of past) {
    const t = tours.get(d.product.title) ?? { sold: 0, capacity: 0 };
    tours.set(d.product.title, {
      sold: t.sold + d.seatsSold,
      capacity: t.capacity + Math.min(d.capacity, d.resource?.seats ?? d.capacity),
    });
  }

  // --- Today ---------------------------------------------------------------------------------
  const todays = await prisma.departure.findMany({
    where: {
      operatorId,
      startsAt: { gte: todayStart, lt: tomorrow },
      status: { not: 'cancelled' },
    },
    select: {
      startsAt: true,
      endsAt: true,
      bookings: {
        where: { status: { in: COMING } },
        select: { travellers: { select: { checkInStatus: true } } },
      },
    },
  });
  const travellers = todays.flatMap((d) => d.bookings.flatMap((b) => b.travellers));
  const madeToday = recent.filter((b) => b.createdAt >= todayStart);
  /** @type {Map<string, number>} */
  const todayChannels = new Map();
  for (const b of madeToday)
    todayChannels.set(channelOf(b), (todayChannels.get(channelOf(b)) ?? 0) + 1);

  return {
    today: {
      date: today,
      departures: {
        total: todays.length,
        underWay: todays.filter((d) => d.startsAt <= now && d.endsAt > now).length,
        toCome: todays.filter((d) => d.startsAt > now).length,
        ended: todays.filter((d) => d.endsAt <= now).length,
      },
      bookings: {
        total: madeToday.length,
        byChannel: [...todayChannels].map(([name, count]) => ({ name, count })),
      },
      money: { in: money.get(today)?.in ?? 0, out: money.get(today)?.out ?? 0 },
      checkIns: {
        done: travellers.filter((t) => t.checkInStatus === 'present' || t.checkInStatus === 'late')
          .length,
        total: travellers.length,
      },
    },
    days,
    previous: { moneyIn: previousMoney, bookings: previousBookings },
    channels: [...channels].map(([name, c]) => ({ name, ...c })),
    tours: [...tours].map(([title, t]) => ({ title, ...t })),
  };
}
