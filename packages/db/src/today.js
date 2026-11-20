// @ts-check
/**
 * today.js — the manager's Today (designs: "Manager’s Today", desktop and phone; stage 16a).
 *
 *   Needs you      what a person should do now, most urgent first:
 *                    a departure soon with no guide       "Tarkwa Bay has no guide" · Assign
 *                    chats waiting for a person            "1 chat needs a person" · Reply
 *                    refunds that failed or need a look    "Refund failed: ₦62,500" · Sort it out
 *                    balances due today, or overdue        "Balance ₦45,500 due" · Send link
 *                    cash a guide took, not handed in yet  "₦45,500 cash with Femi" · Open
 *   Departures     today's: time, tour, guide and van, "11 of 12 checked in", and where it's at
 *   Guides’ phones when each guide's phone last synced (a phone behind by over an hour flagged)
 *
 * Everything is read fresh: the manager's screens need a connection (designs: Staff screens
 * — states, "Bookings need a connection, so you never act on old information").
 */
import { addDays, localDate, localTime, zonedTimeToUtc } from '@okapigo/shared/time';
import { formatNaira } from '@okapigo/shared/money';
import { formatAt } from '@okapigo/shared/tour-facts';
import { balanceDueDate } from '@okapigo/shared/deposits';

const HOUR = 3_600_000;
/** Bookings whose guests are coming. */
const SOLD = ['confirmed', 'part_paid', 'paid', 'amended', 'completed'];
/** A departure this soon without a guide needs someone now. */
const NO_GUIDE_WITHIN = 36 * HOUR;
/** A phone not heard from for longer than this is flagged (designs: "behind by more than an hour"). */
const PHONE_BEHIND = HOUR;

/**
 * @typedef {{
 *   kind: 'no_guide' | 'chats' | 'refund' | 'balance' | 'cash',
 *   tone: 'urgent' | 'soon' | 'info',
 *   key: string, title: string, detail: string, action: string, href: string,
 * }} Need
 */

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, now?: Date }} q
 */
export async function managerToday(prisma, { operatorId, now = new Date() }) {
  const operator = await prisma.operator.findUniqueOrThrow({ where: { id: operatorId } });
  const tz = operator.timeZone;
  const today = localDate(now, tz);
  const dayStart = zonedTimeToUtc(today, '00:00', tz);
  const dayEnd = zonedTimeToUtc(addDays(today, 1), '00:00', tz);
  /** "06:40" today, "Fri 4 Dec, 21:10" another day. @param {Date} d */
  const stamp = (d) => (localDate(d, tz) === today ? localTime(d, tz) : formatAt(d.getTime(), tz));

  // Today's departures that will run: with guests booked, or a guide on them. (Every tour has
  // a departure every scheduled day; one nobody booked isn't the manager's concern today.)
  const departures = await prisma.departure.findMany({
    where: {
      operatorId,
      status: 'scheduled',
      startsAt: { gte: dayStart, lt: dayEnd },
      OR: [{ seatsSold: { gt: 0 } }, { guideId: { not: null } }],
    },
    orderBy: { startsAt: 'asc' },
    include: {
      product: true,
      guide: true,
      resource: true,
      bookings: {
        where: { status: { in: SOLD } },
        include: { travellers: true },
      },
    },
  });

  // --- Needs you ---------------------------------------------------------------------------
  /** @type {Need[]} */
  const needs = [];

  // A departure soon (or under way) with guests and no guide: who's free to take it.
  const soon = await prisma.departure.findMany({
    where: {
      operatorId,
      status: 'scheduled',
      guideId: null,
      seatsSold: { gt: 0 },
      endsAt: { gt: now },
      startsAt: { lt: new Date(now.getTime() + NO_GUIDE_WITHIN) },
    },
    orderBy: { startsAt: 'asc' },
    include: { product: true },
  });
  if (soon.length) {
    const guides = await prisma.user.findMany({
      where: { operatorId, isActive: true, role: { key: 'guide' } },
      orderBy: { name: 'asc' },
    });
    for (const d of soon) {
      const busy = await prisma.departure.findMany({
        where: {
          operatorId,
          status: 'scheduled',
          guideId: { not: null },
          startsAt: { lt: d.endsAt },
          endsAt: { gt: d.startsAt },
        },
        select: { guideId: true },
      });
      const free = guides.find((g) => !busy.some((b) => b.guideId === g.id));
      const mins = Math.round((d.startsAt.getTime() - now.getTime()) / 60_000);
      needs.push({
        kind: 'no_guide',
        tone: 'urgent',
        key:
          mins <= 0
            ? 'STARTED'
            : `IN ${Math.floor(mins / 60) ? `${Math.floor(mins / 60)} H ` : ''}${mins % 60} MIN`.replace(
                ' 0 MIN',
                '',
              ),
        title: `${d.product.shortTitle || d.product.title} has no guide`,
        detail: [
          localDate(d.startsAt, tz) === today
            ? localTime(d.startsAt, tz)
            : formatAt(d.startsAt.getTime(), tz),
          `${d.seatsSold} booked`,
          free ? `${firstName(free.name)} is free` : 'no guide free',
        ].join(' · '),
        action: 'Assign',
        href: `/departures/${d.id}`,
      });
    }
  }

  // Chats where the guest asked for a person and nobody has answered yet.
  const waiting = await prisma.conversation.findMany({
    where: { operatorId, needsPersonSince: { not: null } },
    orderBy: { needsPersonSince: 'asc' },
    include: {
      messages: { where: { direction: 'in' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  if (waiting.length) {
    const first = waiting[0];
    const mins = Math.max(
      0,
      Math.round((now.getTime() - (first.needsPersonSince?.getTime() ?? 0)) / 60_000),
    );
    const said = textOf(first.messages[0]?.body);
    needs.push({
      kind: 'chats',
      tone: 'urgent',
      key: `WAITING ${mins < 60 ? `${mins} MIN` : `${Math.floor(mins / 60)} H`}`,
      title: `${waiting.length} ${waiting.length === 1 ? 'chat needs' : 'chats need'} a person`,
      detail: `${first.guestName || 'A guest'}${said ? `: “${clip(said, 60)}”` : ''}`,
      action: 'Reply',
      href: '/inbox',
    });
  }

  // Refunds that failed, or that the provider hasn't settled (the reconciliation's alert).
  const refunds = await prisma.refund.findMany({
    where: { operatorId, status: 'failed' },
    include: { booking: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const r of refunds) {
    needs.push({
      kind: 'refund',
      tone: 'urgent',
      key: 'REFUND',
      title: `Refund failed: ${formatNaira(r.amountKobo)}`,
      detail: [r.booking?.leadName, r.failureReason].filter(Boolean).join(' · '),
      action: 'Sort it out',
      href: r.bookingId ? `/bookings/${r.bookingId}` : '/bookings',
    });
  }
  const alerts = await prisma.notification.findMany({
    where: { operatorId, audience: 'staff', status: 'pending' },
    include: { booking: { include: { product: true, departure: true } } },
    orderBy: { createdAt: 'asc' },
  });
  for (const a of alerts) {
    const b = a.booking;
    if (!b) continue;
    if (a.kind === 'refund_needs_attention') {
      const amount = /** @type {any} */ (a.data)?.amountKobo ?? 0;
      needs.push({
        kind: 'refund',
        tone: 'urgent',
        key: 'REFUND',
        title: `Refund needs a look: ${formatNaira(amount)}`,
        detail: `${b.leadName} · not settled by the bank yet`,
        action: 'Sort it out',
        href: `/bookings/${b.id}`,
      });
    }
    // The office marked a guide's cash "not received" (16c-2): the owner hears of it here.
    if (a.kind === 'cash_not_received') {
      const d = /** @type {any} */ (a.data) ?? {};
      needs.push({
        kind: 'cash_missing',
        tone: 'urgent',
        key: 'CASH',
        title: `Cash not handed in: ${formatNaira(d.amountKobo ?? 0)}`,
        detail: `${b.leadName} · reported by ${String(d.guide ?? 'the guide').split(' ')[0]}`,
        action: 'Open',
        href: `/bookings/${b.id}`,
      });
    }
  }

  // Balances due today, or overdue (owed, not paid).
  const owing = await prisma.booking.findMany({
    where: {
      operatorId,
      status: { in: ['confirmed', 'part_paid', 'amended'] },
      departure: { startsAt: { gt: now } },
    },
    include: { product: true, departure: true },
  });
  for (const b of owing) {
    const owed = b.totalKobo - b.amountPaidKobo;
    if (owed <= 0 || b.amountPaidKobo === 0) continue; // deposit bookings: a balance to chase
    const due = balanceDueDate(localDate(b.departure.startsAt, tz));
    if (due > today) continue;
    const trip = `${b.product.shortTitle || b.product.title} ${formatAt(b.departure.startsAt.getTime(), tz).split(',')[0]}`;
    needs.push({
      kind: 'balance',
      tone: due === today ? 'soon' : 'urgent',
      key: due === today ? 'DUE TODAY' : 'OVERDUE',
      title: `Balance ${formatNaira(owed)} ${due === today ? 'due' : 'overdue'}`,
      detail: `${b.leadName} · ${trip}`,
      action: 'Send link',
      href: `/bookings/${b.id}`,
    });
  }

  // Cash guides took that the office hasn't confirmed (15c-4).
  const cash = await prisma.cashReport.findMany({
    where: { operatorId, status: { in: ['reported', 'possible_double'] } },
    include: { reportedBy: true },
    orderBy: { reportedAt: 'asc' },
  });
  /** @type {Map<string, { name: string, kobo: number, double: boolean, bookingId: string }>} */
  const byGuide = new Map();
  for (const c of cash) {
    const g = byGuide.get(c.reportedById) ?? {
      name: c.reportedBy.name,
      kobo: 0,
      double: false,
      bookingId: c.bookingId,
    };
    g.kobo += c.amountKobo;
    g.double ||= c.status === 'possible_double';
    byGuide.set(c.reportedById, g);
  }
  for (const g of byGuide.values()) {
    needs.push({
      kind: 'cash',
      tone: g.double ? 'urgent' : 'info',
      key: g.double ? 'PAID TWICE?' : 'CASH',
      title: `${formatNaira(g.kobo)} cash with ${firstName(g.name)}`,
      detail: g.double
        ? 'A guest also paid by link: sort it out with them'
        : 'Confirm when it’s handed in',
      action: 'Open',
      href: `/bookings/${g.bookingId}`,
    });
  }
  const rank = { urgent: 0, soon: 1, info: 2 };
  needs.sort((x, y) => rank[x.tone] - rank[y.tone]);

  // --- Departures today --------------------------------------------------------------------
  const rows = departures.map((d) => {
    const travellers = d.bookings.flatMap((b) => b.travellers.map((t) => ({ t, b })));
    const inCount = travellers.filter(
      ({ t }) => t.checkInStatus === 'present' || t.checkInStatus === 'late',
    ).length;
    const started = d.startsAt <= now;
    const ended = d.endsAt <= now;
    const points = /** @type {any[]} */ (d.product.pickupPoints ?? []);
    const pickup = points.length > 0;
    const short = d.product.shortTitle || d.product.title;
    const guideLine = d.guide
      ? `${firstName(d.guide.name)} · ${d.resource ? d.resource.name : 'on foot'}`
      : 'No guide yet';
    const nextStop = pickup
      ? points.find((p) =>
          travellers.some(
            ({ t, b }) =>
              /** @type {any} */ (b.pickupPoint)?.name === p.name && t.checkInStatus === 'pending',
          ),
        )
      : null;
    const synced = d.guide?.lastSyncedAt ? `synced ${stamp(d.guide.lastSyncedAt)}` : null;
    const mins = Math.round((d.startsAt.getTime() - now.getTime()) / 60_000);
    /** @type {{ text: string, tone: 'ok' | 'urgent' | 'muted' }} */
    const state = ended
      ? { text: 'Ended', tone: 'muted' }
      : !d.guide
        ? { text: started ? 'Under way · no guide' : 'Needs a guide', tone: 'urgent' }
        : started
          ? pickup && nextStop
            ? { text: `Picking up · ${nextStop.name} next`, tone: 'ok' }
            : { text: `Under way${synced ? ` · ${synced}` : ''}`, tone: 'ok' }
          : mins <= 180
            ? {
                text: `Starts in ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60}` : `${mins} min`}`,
                tone: 'muted',
              }
            : Number(localTime(d.startsAt, tz).slice(0, 2)) >= 17
              ? { text: 'This evening', tone: 'muted' }
              : { text: `Starts at ${localTime(d.startsAt, tz)}`, tone: 'muted' };
    return {
      id: d.id,
      time: localTime(d.startsAt, tz),
      tour: short,
      guide: guideLine,
      hasGuide: Boolean(d.guide),
      guideSynced: d.guide ? (synced ?? 'not seen yet') : null,
      progress: !d.guide
        ? `${d.seatsSold} booked of ${d.capacity}`
        : pickup
          ? `${inCount} of ${travellers.length} picked up`
          : `${inCount} of ${travellers.length} checked in`,
      pct: travellers.length ? Math.round((inCount / travellers.length) * 100) : 0,
      state,
    };
  });

  // --- Guides' phones ----------------------------------------------------------------------
  /** @type {Map<string, any>} */
  const guidesToday = new Map();
  for (const d of departures) {
    if (d.guide && !guidesToday.has(d.guide.id)) guidesToday.set(d.guide.id, { guide: d.guide, d });
  }
  const phones = [...guidesToday.values()].map(({ guide, d }) => {
    const last = guide.lastSyncedAt;
    const behind = !last || now.getTime() - last.getTime() > PHONE_BEHIND;
    const fresh = last && now.getTime() - last.getTime() <= 15 * 60_000;
    const waitingText =
      guide.outboxWaiting !== null && last ? ` · ${guide.outboxWaiting} waiting` : '';
    return {
      name: firstName(guide.name),
      trip: `${d.product.shortTitle || d.product.title}, ${localTime(d.startsAt, tz)}`,
      status: !last
        ? 'Not seen yet'
        : behind
          ? `Not seen since ${stamp(last)}`
          : `Synced ${stamp(last)}${waitingText}`,
      tone: behind ? 'warning' : fresh ? 'ok' : 'muted',
    };
  });

  // --- The badges on the menu ----------------------------------------------------------------
  const requests = await prisma.guestRequest.count({ where: { operatorId, status: 'open' } });
  const guests = departures.reduce((n, d) => n + d.seatsSold, 0);

  return {
    date: formatAt(now.getTime(), tz).split(',')[0],
    summary: `${departures.length} ${departures.length === 1 ? 'departure' : 'departures'} · ${guests} ${guests === 1 ? 'guest' : 'guests'} · ${guidesToday.size} ${guidesToday.size === 1 ? 'guide' : 'guides'} out`,
    needs,
    departures: rows,
    phones,
    badges: {
      schedule: soon.length,
      inbox: waiting.length + requests + alerts.length,
    },
  };
}

/** "Kemi Adeyemi" → "Kemi". @param {string} name */
const firstName = (name) => name.trim().split(/\s+/)[0] ?? name;

/** A chat message's words (text, or a button's or list row's title). @param {any} body */
function textOf(body) {
  if (!body) return '';
  return String(body.text ?? body.title ?? body.caption ?? '');
}

/** @param {string} s @param {number} n */
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
