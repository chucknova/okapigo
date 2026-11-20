// @ts-check
/**
 * alerts.js — the inbox's Alerts tab (stage 16d-3; designs: O9 Inbox — requests and alerts).
 *
 *   inboxAlerts()   what needs dealing with, each with its action:
 *                     cash to confirm · cash not handed in · a refund that failed · a refund
 *                     never sent · a refund the bank hasn't settled · a balance due or overdue ·
 *                     a departure soon with guests and no guide
 *                   and "Done this week": who dealt with what, and when.
 *
 * An alert is WORKED OUT from how things are, each time: it clears by itself when its cause is
 * fixed (cash confirmed, refund sent, balance paid, guide assigned). There's no "dismiss" for
 * money (designs).
 */
import { formatNaira } from '@okapigo/shared/money';
import { localDate, localTime } from '@okapigo/shared/time';
import { formatAt } from '@okapigo/shared/tour-facts';
import { balanceDueDate } from '@okapigo/shared/deposits';
import { deskStatus, notStartedKobo } from './desk.js';
import { firstName, shortOf } from './board.js';

const OWING = ['confirmed', 'part_paid', 'amended'];
const ENDED = ['cancelled', 'refunded', 'no_show'];
const GUIDE_DAYS = 7; // "Departure without a guide": the coming week
const DONE_DAYS = 7; // "Done this week"
const RANK = /** @type {Record<string, number>} */ ({ urgent: 0, warning: 1, info: 2 });

/** "Sat 5 Dec" @param {Date} at @param {string} tz */
const day = (at, tz) => formatAt(at.getTime(), tz).split(', ')[0];
/** "Sat 5 Dec" from "2026-12-05" @param {string} date */
const dateWords = (date) => formatAt(Date.parse(`${date}T12:00:00Z`), 'UTC').split(', ')[0];

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, now?: Date }} q
 */
export async function inboxAlerts(prisma, { operatorId, now = new Date() }) {
  const operator = await prisma.operator.findUniqueOrThrow({ where: { id: operatorId } });
  const tz = operator.timeZone;
  const today = localDate(now, tz);
  /** @type {Array<{ key: string, kind: string, tone: string, icon: string, title: string, detail: string, action: string, href: string, at: number }>} */
  const alerts = [];
  const who = (/** @type {any} */ b) => `${b.leadName} · ${b.reference}`;

  // 1. Cash a guide reported, not yet confirmed (15c-4, 16c-2).
  const cash = await prisma.cashReport.findMany({
    where: { operatorId, status: { in: ['reported', 'possible_double'] } },
    include: { booking: true, reportedBy: true },
  });
  for (const c of cash) {
    alerts.push({
      key: `cash:${c.id}`,
      kind: 'cash',
      tone: c.status === 'possible_double' ? 'warning' : 'info',
      icon: '₦',
      title:
        c.status === 'possible_double'
          ? `Cash to sort out: ${formatNaira(c.amountKobo)} from ${firstName(c.reportedBy.name)}`
          : `Cash to confirm: ${formatNaira(c.amountKobo)} from ${firstName(c.reportedBy.name)}`,
      detail: [
        who(c.booking),
        `reported ${formatAt(c.reportedAt.getTime(), tz)}`,
        c.status === 'possible_double' ? 'they’d also paid by link' : null,
      ]
        .filter(Boolean)
        .join(' · '),
      action: 'Open booking',
      href: `/bookings/${c.bookingId}`,
      at: c.reportedAt.getTime(),
    });
  }

  // 2. Cash marked not received (16c-2): until the guest no longer owes.
  const missing = await prisma.notification.findMany({
    where: { operatorId, audience: 'staff', status: 'pending', kind: 'cash_not_received' },
    include: { booking: true },
  });
  for (const n of missing) {
    const b = n.booking;
    if (ENDED.includes(b.status) || b.totalKobo - b.amountPaidKobo <= 0) continue;
    const d = /** @type {any} */ (n.data) ?? {};
    alerts.push({
      key: `missing:${n.id}`,
      kind: 'cash_missing',
      tone: 'urgent',
      icon: '!',
      title: `Cash not handed in: ${formatNaira(d.amountKobo ?? 0)} from ${firstName(String(d.guide ?? 'the guide'))}`,
      detail: `${who(b)} · still owes ${formatNaira(b.totalKobo - b.amountPaidKobo)}`,
      action: 'Open booking',
      href: `/bookings/${b.id}`,
      at: n.createdAt.getTime(),
    });
  }

  // 3–4. Money owed back: a refund that failed, or that was never sent.
  const owedBack = await prisma.booking.findMany({
    where: { operatorId, status: { in: ['cancelled', 'no_show'] }, refundDueKobo: { gt: 0 } },
    include: {
      refunds: { orderBy: { createdAt: 'desc' } },
      cashReports: { select: { status: true } },
    },
  });
  for (const b of owedBack) {
    const chip = deskStatus(b);
    if (chip.key !== 'refund_failed' && chip.key !== 'refund_due') continue;
    const failed = b.refunds.find((r) => r.status === 'failed');
    alerts.push({
      key: `refund:${b.id}`,
      kind: chip.key,
      tone: 'urgent',
      icon: '!',
      title:
        chip.key === 'refund_failed'
          ? `Refund failed: ${formatNaira(notStartedKobo(b))}`
          : `Refund to send: ${formatNaira(notStartedKobo(b))}`,
      detail: [
        who(b),
        chip.key === 'refund_failed' ? (failed?.failureReason ?? 'not sent') : 'never started',
      ]
        .filter(Boolean)
        .join(' · '),
      action: 'Sort it out',
      href: `/bookings/${b.id}`,
      at: (failed?.updatedAt ?? b.updatedAt).getTime(),
    });
  }

  // 5. A refund the provider hasn't settled (the reconciliation's staff alert, 12f-2).
  const unsettled = await prisma.notification.findMany({
    where: { operatorId, audience: 'staff', status: 'pending', kind: 'refund_needs_attention' },
    include: { booking: true },
  });
  for (const n of unsettled) {
    alerts.push({
      key: `unsettled:${n.id}`,
      kind: 'refund_unsettled',
      tone: 'warning',
      icon: '!',
      title: `Refund needs a look: ${formatNaira(/** @type {any} */ (n.data)?.amountKobo ?? 0)}`,
      detail: `${who(n.booking)} · not settled by the bank yet`,
      action: 'Sort it out',
      href: `/bookings/${n.bookingId}`,
      at: n.createdAt.getTime(),
    });
  }

  // 6. Balances due today or overdue (deposits paid, the rest owed; nothing is cancelled
  // automatically: decided 2026-11-17).
  const owing = await prisma.booking.findMany({
    where: {
      operatorId,
      status: { in: OWING },
      amountPaidKobo: { gt: 0 },
      departure: { startsAt: { gt: now } },
    },
    include: {
      product: true,
      departure: true,
      notifications: {
        where: { kind: 'balance_reminder', status: 'failed' },
        select: { id: true },
      },
    },
  });
  for (const b of owing) {
    const owed = b.totalKobo - b.amountPaidKobo;
    if (owed <= 0) continue;
    const due = balanceDueDate(localDate(b.departure.startsAt, tz));
    if (due > today) continue;
    const failedReminders = b.notifications.length;
    alerts.push({
      key: `balance:${b.id}`,
      kind: 'balance',
      tone: 'warning',
      icon: '₦',
      title: `${due === today ? 'Balance due today' : 'Balance overdue'}: ${formatNaira(owed)}`,
      detail: [
        b.leadName,
        `${shortOf(b.product)} ${day(b.departure.startsAt, tz)}`,
        `due ${dateWords(due)}`,
        failedReminders
          ? `${failedReminders} ${failedReminders === 1 ? 'reminder' : 'reminders'} failed`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
      action: 'Send a link',
      href: `/bookings/${b.id}`,
      at: Date.parse(`${due}T00:00:00Z`),
    });
  }

  // 7. A departure in the coming week with guests and no guide.
  const unguided = await prisma.departure.findMany({
    where: {
      operatorId,
      status: 'scheduled',
      guideId: null,
      seatsSold: { gt: 0 },
      startsAt: { gt: now, lt: new Date(now.getTime() + GUIDE_DAYS * 86_400_000) },
    },
    include: { product: true },
    orderBy: { startsAt: 'asc' },
  });
  for (const d of unguided) {
    alerts.push({
      key: `guide:${d.id}`,
      kind: 'no_guide',
      tone: 'urgent',
      icon: '?',
      title: 'Departure without a guide',
      detail: `${shortOf(d.product)} · ${formatAt(d.startsAt.getTime(), tz)} · ${d.seatsSold} booked`,
      action: 'Assign a guide',
      href: `/departures/${d.id}`,
      at: d.startsAt.getTime(),
    });
  }

  alerts.sort((x, y) => RANK[x.tone] - RANK[y.tone] || x.at - y.at);
  return {
    alerts: alerts.map(({ at: _at, ...a }) => a),
    done: await doneThisWeek(prisma, { operatorId, tz, now }),
  };
}

/**
 * "Done this week": what the office dealt with, who, and when ("Refund retried by Kunle, Thu 3
 * Dec 15:02"), newest first.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, tz: string, now: Date }} q
 */
async function doneThisWeek(prisma, { operatorId, tz, now }) {
  const since = new Date(now.getTime() - DONE_DAYS * 86_400_000);
  const events = await prisma.bookingEvent.findMany({
    where: {
      operatorId,
      actorType: 'user',
      createdAt: { gte: since },
      type: {
        in: [
          'cash_confirmed',
          'cash_not_received',
          'refund_requested',
          'refund_by_transfer',
          'payment_link_created',
        ],
      },
    },
    include: { booking: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const assigned = await prisma.departure.findMany({
    where: { operatorId, guideAssignedAt: { gte: since }, guideAssignedById: { not: null } },
    include: { product: true, guide: true },
    orderBy: { guideAssignedAt: 'desc' },
    take: 50,
  });
  const ids = [
    ...new Set(
      [...events.map((e) => e.actorUserId), ...assigned.map((d) => d.guideAssignedById)].filter(
        (x) => x !== null,
      ),
    ),
  ];
  const names = new Map(
    (await prisma.user.findMany({ where: { id: { in: /** @type {string[]} */ (ids) } } })).map(
      (u) => [u.id, u.name],
    ),
  );
  const by = (/** @type {string | null} */ id) => firstName(names.get(id ?? '') ?? 'someone');
  const stamp = (/** @type {Date} */ at) => `${day(at, tz)} ${localTime(at, tz)}`;
  /** @type {Array<{ text: string, detail: string, href: string, at: number }>} */
  const done = [];
  for (const e of events) {
    const d = /** @type {any} */ (e.data) ?? {};
    const money = formatNaira(d.amountKobo ?? 0);
    const what = /** @type {Record<string, string>} */ ({
      cash_confirmed: `Cash ${money} confirmed`,
      cash_not_received: `Cash ${money} marked not received`,
      refund_requested: `Refund of ${money} sent`,
      refund_by_transfer: `Refund of ${money} recorded as a bank transfer`,
      payment_link_created: d.tourDay ? '' : `Payment link for ${money} sent`,
    })[e.type];
    if (!what) continue;
    done.push({
      text: `${what} by ${by(e.actorUserId)}, ${stamp(e.createdAt)}`,
      detail: `${e.booking.leadName} · ${e.booking.reference}`,
      href: `/bookings/${e.bookingId}`,
      at: e.createdAt.getTime(),
    });
  }
  for (const d of assigned) {
    const at = /** @type {Date} */ (d.guideAssignedAt);
    done.push({
      text: `Guide assigned by ${by(d.guideAssignedById)}, ${stamp(at)}`,
      detail: `${shortOf(d.product)} · ${formatAt(d.startsAt.getTime(), tz)} · ${d.guide ? firstName(d.guide.name) : ''}`,
      href: `/departures/${d.id}`,
      at: at.getTime(),
    });
  }
  done.sort((x, y) => y.at - x.at);
  return done.slice(0, 50).map(({ at: _at, ...x }) => x);
}
