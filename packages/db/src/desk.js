// @ts-check
/**
 * desk.js — the office's bookings desk (stage 16c; designs O8 Bookings, desktop, phone and
 * "every status").
 *
 *   deskList()      find a booking: search (reference, name or phone) and filters (Today ·
 *                   Upcoming · Owes money · Cash to confirm · Cancelled · All), each row with
 *                   its status chip ("Owes ₦45,500", "Cash to confirm", "Refund failed"…)
 *   deskBooking()   one booking's page: who, what, its status and the banner that says what
 *                   needs doing, the money, the travellers, the messages sent (and whether they
 *                   arrived), its timeline, and which actions make sense now (and why not)
 *   addNote()       a note on the timeline; "show on the guide's manifest" puts it there too
 *
 * The words are worked out here, once, so the phone and the desktop say the same thing.
 * Changing a booking goes through the rules already there (bookings.js, cancellations.js,
 * refunds.js, payment-links.js, cash.js, operations.js).
 */
import { percentOf } from '@okapigo/shared/pricing';
import { formatNaira } from '@okapigo/shared/money';
import { formatPhoneForDisplay } from '@okapigo/shared/contact';
import { localDate, localTime, addDays, zonedTimeToUtc } from '@okapigo/shared/time';
import { formatAt } from '@okapigo/shared/tour-facts';
import { balanceDueDate } from '@okapigo/shared/deposits';
import { MESSAGES } from '@okapigo/shared/message-templates';
import { BookingError } from './booking-lifecycle.js';
import { firstName, peopleLine, shortOf } from './board.js';
import { previewCancellation } from './cancellations.js';
import { owedFor } from './channel-money.js';

/** Seats sold: the booking is on (from booking-status.js). */
const LIVE = ['confirmed', 'part_paid', 'paid', 'amended'];
const ENDED = ['cancelled', 'refunded'];
const PENDING_CASH = ['reported', 'possible_double'];
const MAX_ROWS = 100;

export const DESK_FILTERS = /** @type {const} */ ([
  'today',
  'upcoming',
  'owes',
  'cash',
  'cancelled',
  'all',
]);
/** @typedef {typeof DESK_FILTERS[number]} DeskFilter */

const CHANNEL = /** @type {Record<string, string>} */ ({
  web: 'WEB',
  whatsapp: 'WHATSAPP',
  staff: 'OFFICE',
  ota: 'PARTNER',
});
const BOOKED_ON = /** @type {Record<string, string>} */ ({
  web: 'booked on the website',
  whatsapp: 'booked on WhatsApp',
  staff: 'booked by the office',
  ota: 'booked through a partner',
});
const METHOD = /** @type {Record<string, string>} */ ({
  card: 'card',
  bank_transfer: 'bank transfer',
  transfer: 'bank transfer',
  ussd: 'USSD',
  cash: 'cash',
});

/** "Tue 17 Nov" @param {Date} at @param {string} tz */
const dayOf = (at, tz) => formatAt(at.getTime(), tz).split(', ')[0];
/** "17 Nov" @param {Date} at @param {string} tz */
const shortDay = (at, tz) => dayOf(at, tz).split(' ').slice(1).join(' ');
/** "Tue 17 Nov 12:11" @param {Date} at @param {string} tz */
const stamp = (at, tz) => formatAt(at.getTime(), tz).replace(', ', ' ');
/** "Sat 28 Nov" from "2026-11-28" @param {string} date */
const dateWords = (date) => formatAt(Date.parse(`${date}T12:00:00Z`), 'UTC').split(', ')[0];

/**
 * A search box's words, as the database can match them: "0805 987" → the digits after the
 * leading 0 (phones are stored +234805…), "ilt-3mz" → "ILT-3MZ".
 * @param {string} q
 */
export function searchTerms(q) {
  const text = q.trim();
  const digits = text.replace(/[\s()+-]/g, '');
  const phone = /^\d{3,}$/.test(digits) ? digits.replace(/^(234|0)/, '') : null;
  return { text, reference: text.toUpperCase(), phone };
}

/**
 * What's owed back to the guest and not on its way: the refund due, less every refund that
 * hasn't failed (requested, sending or sent). @param {any} b
 */
export function notStartedKobo(b) {
  const underWay = (b.refunds ?? [])
    .filter((/** @type {any} */ r) => r.status !== 'failed')
    .reduce((/** @type {number} */ n, /** @type {any} */ r) => n + r.amountKobo, 0);
  return Math.max(0, (b.refundDueKobo ?? 0) - underWay);
}

/**
 * The status chip on a row and at the top of a booking's page. One per booking, the thing
 * that needs doing first: a failed refund, cash to confirm, money owed.
 * @param {any} b  a booking with refunds, cashReports and hold
 * @returns {{ key: string, text: string, tone: 'ok' | 'warning' | 'urgent' | 'info' | 'held' | 'muted', expiresAt?: Date }}
 */
export function deskStatus(b) {
  if (b.status === 'held')
    return { key: 'held', text: 'Held', tone: 'held', expiresAt: b.hold?.expiresAt };
  if (ENDED.includes(b.status) || b.status === 'no_show') {
    const refunds = b.refunds ?? [];
    const sending = refunds.some(
      (/** @type {any} */ r) => r.status === 'requested' || r.status === 'pending',
    );
    // Owed back and not under way: never started, or started and failed.
    if (notStartedKobo(b) > 0 && !sending)
      return refunds.some((/** @type {any} */ r) => r.status === 'failed')
        ? { key: 'refund_failed', text: 'Refund failed', tone: 'urgent' }
        : { key: 'refund_due', text: 'Refund to send', tone: 'urgent' };
    if (b.status === 'no_show') return { key: 'no_show', text: 'No-show', tone: 'muted' };
    if (sending) return { key: 'cancelled', text: 'Cancelled · refund sending', tone: 'muted' };
    if (refunds.some((/** @type {any} */ r) => r.status === 'processed'))
      return { key: 'cancelled', text: 'Cancelled · refunded', tone: 'muted' };
    return { key: 'cancelled', text: 'Cancelled', tone: 'muted' };
  }
  if ((b.cashReports ?? []).some((/** @type {any} */ c) => PENDING_CASH.includes(c.status)))
    return { key: 'cash', text: 'Cash to confirm', tone: 'info' };
  const owed = b.totalKobo - b.amountPaidKobo;
  if (owed > 0) return { key: 'owes', text: `Owes ${formatNaira(owed)}`, tone: 'warning' };
  // An OTA's booking (17c-3): its guest paid the OTA.
  const ota = b.channelBooking?.channel?.name;
  return { key: 'paid', text: ota ? `Paid by ${ota}` : 'Paid', tone: 'ok' };
}

const ROW_INCLUDE = /** @type {const} */ ({
  departure: true,
  product: true,
  hold: true,
  refunds: { select: { status: true, amountKobo: true } },
  cashReports: { select: { status: true } },
  // Sold by an OTA (17c): its name, for "via Sojourna".
  channelBooking: { select: { channel: { select: { name: true } } } },
});

/** Where a booking came from, for the list's channel filter (an OTA is its channel's id). */
export const BOOKING_CHANNELS = /** @type {const} */ (['web', 'whatsapp', 'staff']);

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, filter?: DeskFilter, q?: string, channel?: string, now?: Date }} o
 *   channel: '' (all), 'web', 'whatsapp', 'staff', or an OTA channel's id (17c-3)
 */
export async function deskList(
  prisma,
  { operatorId, filter = 'today', q = '', channel = '', now = new Date() },
) {
  const [operator, otas] = await Promise.all([
    prisma.operator.findUniqueOrThrow({ where: { id: operatorId } }),
    prisma.channel.findMany({
      where: { operatorId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  const tz = operator.timeZone;
  const today = localDate(now, tz);
  const dayStart = zonedTimeToUtc(today, '00:00', tz);
  const dayEnd = zonedTimeToUtc(addDays(today, 1), '00:00', tz);
  const s = searchTerms(q);

  /** @type {any} */
  const where = { operatorId };
  if (s.text) {
    where.OR = [
      { reference: { contains: s.reference } },
      { leadName: { contains: s.text, mode: 'insensitive' } },
      ...(s.phone ? [{ leadPhone: { contains: s.phone } }] : []),
    ];
  }
  if (filter === 'today') where.departure = { startsAt: { gte: dayStart, lt: dayEnd } };
  if (filter === 'upcoming') {
    where.departure = { startsAt: { gte: dayStart } };
    where.status = { notIn: ENDED };
  }
  if (filter === 'owes') where.status = { in: LIVE };
  if (filter === 'cash') where.cashReports = { some: { status: { in: PENDING_CASH } } };
  if (filter === 'cancelled') where.status = { in: ENDED };
  // The channel (designs: "Channel: all ▾"): our own, or one OTA.
  if (/** @type {readonly string[]} */ (BOOKING_CHANNELS).includes(channel))
    where.channel = channel;
  else if (channel) where.channelBooking = { channelId: channel };

  const byTrip =
    filter === 'today' || filter === 'upcoming' || filter === 'owes' || filter === 'cash';
  const found = await prisma.booking.findMany({
    where,
    include: ROW_INCLUDE,
    orderBy: byTrip
      ? [{ departure: { startsAt: 'asc' } }, { createdAt: 'asc' }]
      : [{ createdAt: 'desc' }],
    // "Owes money" is worked out after reading (total − paid can't be asked of the database
    // here), so it reads more and keeps the first MAX_ROWS.
    take: filter === 'owes' ? MAX_ROWS * 5 : MAX_ROWS,
  });
  const rows = found
    .filter((b) => filter !== 'owes' || b.totalKobo > b.amountPaidKobo)
    .slice(0, MAX_ROWS)
    .map((b) => {
      const chip = deskStatus(b);
      return {
        id: b.id,
        lead: b.leadName,
        reference: b.reference,
        tour: `${shortOf(b.product)} · ${dayOf(b.departure.startsAt, tz)}`,
        phone: b.leadPhone ? formatPhoneForDisplay(b.leadPhone) : null,
        via: b.channelBooking ? `via ${b.channelBooking.channel.name}` : null,
        chip: { ...chip, expiresAt: chip.expiresAt?.toISOString() ?? null },
      };
    });
  return {
    filter,
    q: s.text,
    channel,
    // The filter's choices (designs: Website, WhatsApp, Sojourna, Staff).
    channels: [
      { value: 'web', label: 'Website' },
      { value: 'whatsapp', label: 'WhatsApp' },
      ...otas.map((o) => ({ value: o.id, label: o.name })),
      { value: 'staff', label: 'Staff' },
    ],
    rows,
    more: found.length > MAX_ROWS,
  };
}

/** "2 adults ₦130,000 · 1 child ₦35,000 · 3 × Lunch ₦24,000": the price, from the quote. @param {any} quote */
function priceLine(quote) {
  return (quote?.lines ?? [])
    .map((/** @type {any} */ l) => {
      if (l.type !== 'ticket') return `${l.quantity} × ${l.label} ${formatNaira(l.totalKobo)}`;
      const name = String(l.label)
        .replace(/\s*\(.*\)\s*$/, '')
        .toLowerCase();
      const word = l.quantity === 1 ? name : name === 'child' ? 'children' : `${name}s`;
      return `${l.quantity} ${word} ${formatNaira(l.totalKobo)}`;
    })
    .join(' · ');
}

/** "Present 07:12" / "Late 07:20" / "No-show" / "" @param {any} t @param {string} tz @param {boolean} ended */
function travellerState(t, tz, ended) {
  if (ended) return { text: 'Cancelled', tone: 'muted' };
  if (t.checkInStatus === 'present')
    return {
      text: `Present ${t.checkedInAt ? localTime(t.checkedInAt, tz) : ''}`.trim(),
      tone: 'ok',
    };
  if (t.checkInStatus === 'late')
    return {
      text: `Late ${t.checkedInAt ? localTime(t.checkedInAt, tz) : ''}`.trim(),
      tone: 'warning',
    };
  if (t.checkInStatus === 'no_show') return { text: 'No-show', tone: 'urgent' };
  return { text: '', tone: 'muted' };
}

/**
 * "WhatsApp · read" / "Email · failed: mailbox full" / "WhatsApp · waiting to send".
 * @param {any} n  a notification @param {Map<string, any>} chats  chat messages by id
 */
function deliveryOf(n, chats) {
  const channel = n.channel === 'email' ? 'Email' : 'WhatsApp';
  if (n.status === 'failed')
    return {
      text: `${channel} · failed${n.data?.error ? `: ${n.data.error}` : ''}`,
      tone: 'urgent',
    };
  if (n.status === 'pending') return { text: `${channel} · waiting to send`, tone: 'muted' };
  if (n.status === 'cancelled')
    return { text: `${channel} · not sent (no longer needed)`, tone: 'muted' };
  const chat = n.data?.chatMessageId ? chats.get(n.data.chatMessageId) : null;
  if (chat?.delivery === 'failed')
    return {
      text: `${channel} · failed${chat.deliveryError ? `: ${chat.deliveryError}` : ''}`,
      tone: 'urgent',
    };
  if (chat?.delivery === 'read') return { text: `${channel} · read`, tone: 'ok' };
  if (chat?.delivery === 'delivered') return { text: `${channel} · delivered`, tone: 'ink' };
  return { text: `${channel} · sent`, tone: 'ink' };
}

/** "Balance reminder (7 days)" @param {any} n */
function messageName(n) {
  if (n.kind === 'staff_message')
    return `Message from ${String(n.data?.staffName ?? 'the team').split(' ')[0]}`;
  const name = /** @type {any} */ (MESSAGES)[n.kind]?.name ?? n.kind.replace(/_/g, ' ');
  if (n.kind === 'balance_reminder' && n.data?.daysBefore)
    return `${name} (${n.data.daysBefore} ${n.data.daysBefore === 1 ? 'day' : 'days'})`;
  return name;
}

/**
 * One line of the timeline, in words. @param {any} e @param {Map<string, string>} names
 * @param {{ channelName?: string | null }} [o]  an OTA's name: "booked through Sojourna" (17c)
 */
export function eventText(e, names, o = {}) {
  const who = e.actorUserId ? (names.get(e.actorUserId) ?? 'someone in the office') : null;
  const d = e.data ?? {};
  const money = (/** @type {number} */ k) => formatNaira(k ?? 0);
  switch (e.type) {
    case 'created':
      if (d.channel === 'ota' && o.channelName) return `booked through ${o.channelName}`;
      return d.channel === 'staff' && who ? `booked by ${who}` : (BOOKED_ON[d.channel] ?? 'booked');
    case 'status_changed': {
      if (e.toStatus === 'cancelled') {
        if (d.reason === 'hold_expired') return 'seats released: checkout wasn’t finished in time';
        if (d.reason === 'hold_released') return `seats released${who ? ` by ${who}` : ''}`;
        const by = d.initiatedBy === 'guest' ? 'the guest' : (who ?? 'the office');
        const refund =
          d.refund?.refundKobo !== undefined
            ? ` · refund ${money(d.refund.refundKobo)}${d.refund.overridden ? '' : ' by policy'}`
            : '';
        const why = d.refund?.overridden && d.reason ? ` (reason: ${d.reason})` : '';
        return `cancelled by ${by}${refund}${why}`;
      }
      if (e.toStatus === 'refunded') return 'refund complete';
      if (e.toStatus === 'no_show') return `marked a no-show${who ? ` by ${who}` : ''}`;
      if (e.toStatus === 'completed') return 'trip completed';
      if (d.amountKobo && (e.toStatus === 'paid' || e.toStatus === 'part_paid'))
        return `${e.toStatus === 'paid' ? 'paid' : 'part paid'} ${money(d.amountKobo)}`;
      if (e.toStatus === 'confirmed') return `confirmed${who ? ` by ${who}` : ''}`;
      if (e.toStatus === 'amended') return 'changed: more to pay';
      return `now ${String(e.toStatus).replace(/_/g, ' ')}`;
    }
    case 'refund_requested':
      return `refund of ${money(d.amountKobo)} started${who ? ` by ${who}` : ''}`;
    case 'refund_processed':
      return `refund of ${money(d.amountKobo)} sent`;
    case 'refund_failed':
      return `refund of ${money(d.amountKobo)} failed${d.reason ? `: ${d.reason}` : ''}`;
    case 'payment_link_created':
      return `${d.tourDay ? 'tour-day ' : ''}payment link for ${money(d.amountKobo)}${who && !d.tourDay ? ` by ${who}` : ''}`;
    case 'cash_reported':
      return `cash ${money(d.amountKobo)} reported${who ? ` by ${firstName(who)}` : ''}${d.possibleDouble ? ' (they’d also paid by link)' : ''}`;
    case 'checked_in': {
      const n = (d.travellerIds ?? []).length || 1;
      const verb =
        /** @type {Record<string, string>} */ ({
          present: 'checked in',
          late: 'marked late',
          no_show: n === 1 ? 'marked a no-show' : 'marked no-shows',
          pending: 'check-in undone',
        })[d.status] ?? 'checked in';
      return `${d.status === 'pending' ? verb : `${n} ${verb}`}${who ? ` by ${firstName(who)}` : ''}`;
    }
    case 'cash_confirmed':
      return d.amountKobo === d.reportedKobo
        ? `cash ${money(d.amountKobo)} confirmed received${who ? ` by ${firstName(who)}` : ''}`
        : `cash ${money(d.amountKobo)} received of ${money(d.reportedKobo)} reported${who ? ` · confirmed by ${firstName(who)}` : ''}`;
    case 'cash_not_received':
      return `cash ${money(d.amountKobo)} not received from ${d.guide ? firstName(d.guide) : 'the guide'}${who ? ` · marked by ${firstName(who)}` : ''} · the owner was alerted`;
    case 'refund_by_transfer':
      return `refund of ${money(d.amountKobo)} paid by bank transfer (ref ${d.reference})${who ? ` · recorded by ${firstName(who)}` : ''}`;
    case 'moved':
      return `moved from ${d.from} to ${d.to}${who ? ` by ${firstName(who)}` : ''}`;
    case 'guest_request_replied':
      return `replied to the guest’s request${who ? ` (${firstName(who)})` : ''}`;
    case 'travellers_changed': {
      const parts = [
        d.added?.length ? `added ${d.added.join(', ')}` : '',
        d.removed?.length ? `removed ${d.removed.join(', ')}` : '',
      ].filter(Boolean);
      return `travellers changed${who ? ` by ${firstName(who)}` : ''}: ${parts.join('; ')} · ${money(d.fromKobo)} → ${money(d.toKobo)}${d.refundKobo ? ` · refund ${money(d.refundKobo)}` : ''}`;
    }
    case 'traveller_updated':
      return `traveller details changed${who ? ` by ${who}` : ''}`;
    case 'note':
      return `note${who ? ` by ${firstName(who)}` : ''}: “${d.text}”${d.onManifest ? ' · on the guide’s manifest' : ''}`;
    case 'guest_request':
      return `the guest asked: ${d.kind === 'change' ? 'a change' : 'a question'}`;
    case 'guest_request_answered':
      return `the guest’s request answered${who ? ` by ${who}` : ''}${d.note ? `: ${d.note}` : ''}`;
    case 'payment_needs_review':
      return `a payment of ${money(d.amountKobo)} needs a look`;
    case 'receipt_allocated':
      return `a bank transfer of ${money(d.amountKobo)} matched to this booking`;
    default:
      return String(e.type).replace(/_/g, ' ');
  }
}

/**
 * The policy's refund in words: "50%, because it’s 24–48 hours before".
 * @param {any} q  previewCancellation's answer @param {Array<{ hoursBefore: number, refundBasisPoints: number }>} rules
 */
export function policyWords(q, rules) {
  if (q.reason === 'NOTHING_PAID') return 'nothing was paid';
  if (q.reason === 'OPERATOR_CANCELLED') return 'full refund, because we called it off';
  // A deposit that isn't refundable comes off first: say so, or "full refund" of ₦0 confuses.
  const kept = q.keptDepositKobo > 0 ? formatNaira(q.keptDepositKobo) : null;
  if (kept && q.refundKobo === 0) return `nothing back: the ${kept} deposit isn’t refundable`;
  const tiers = [...rules].sort((x, y) => x.hoursBefore - y.hoursBefore);
  let words;
  if (!q.rule) {
    words =
      q.hoursBefore < 0
        ? 'nothing back: the trip has started'
        : `nothing back, because it’s under ${tiers[0]?.hoursBefore ?? 0} hours before`;
  } else {
    const next = tiers.find((t) => t.hoursBefore > q.rule.hoursBefore);
    const share =
      q.rule.refundBasisPoints === 10_000 ? 'full refund' : `${q.rule.refundBasisPoints / 100}%`;
    words = next
      ? `${share}, because it’s ${q.rule.hoursBefore}–${next.hoursBefore} hours before`
      : `${share}, because it’s ${q.rule.hoursBefore} hours or more before`;
  }
  return kept ? `${words}; the ${kept} deposit isn’t refundable` : words;
}

/** "trip is in 30 hours" / "trip is in 9 days" / "the trip has started" @param {Date} startsAt @param {Date} now */
export function tripIn(startsAt, now) {
  const hours = (startsAt.getTime() - now.getTime()) / 3_600_000;
  if (hours < 0) return 'the trip has started';
  if (hours < 48)
    return `trip is in ${Math.max(1, Math.round(hours))} ${Math.round(hours) === 1 ? 'hour' : 'hours'}`;
  return `trip is in ${Math.round(hours / 24)} days`;
}

/**
 * Which actions make sense now, and why not (designs: "every status": greyed, with a reason).
 * @param {any} b @param {{ started: boolean, owed: number, tripDay: string }} o
 */
export function deskActions(b, { started, owed, tripDay }) {
  // An OTA's booking (designs: "via Sojourna"): the OTA collects the money, and changes to who's
  // coming or when go through it, so those aren't offered here.
  const ota = b.channelBooking?.channel?.name ?? null;
  const viaOta = ota ? `Changes go through ${ota}` : null;
  const held = b.status === 'held';
  const ended = ENDED.includes(b.status);
  const why = (/** @type {string | null} */ reason) => ({
    enabled: reason === null,
    why: reason ?? '',
  });
  const notBooked = held ? 'Not booked yet' : null;
  const gone = ended ? 'Cancelled' : null;
  const pending = b.travellers.filter(
    (/** @type {any} */ t) => t.checkInStatus === 'pending',
  ).length;
  /** @type {Record<string, { enabled: boolean, why: string, hidden?: boolean }>} */
  const actions = {
    paymentLink: why(
      (ota ? `${ota} collects payment` : null) ??
        notBooked ??
        gone ??
        (owed <= 0 ? 'Nothing is owed' : null),
    ),
    changeTravellers: why(
      viaOta ??
        notBooked ??
        gone ??
        (b.status === 'no_show' || b.status === 'completed' || started
          ? 'The trip has started'
          : null),
    ),
    // Another date of the same tour (16d-2).
    move: why(
      viaOta ??
        notBooked ??
        gone ??
        (b.status === 'no_show' || b.status === 'completed' || started
          ? 'The trip has started'
          : null),
    ),
    addNote: why(null),
    noShow: why(
      notBooked ??
        gone ??
        (b.status === 'no_show'
          ? 'Already a no-show'
          : !started
            ? `Trip is on ${tripDay}`
            : pending === 0
              ? 'Everyone is checked in'
              : null),
    ),
    cancel: why(
      held
        ? 'Nothing to cancel yet'
        : ended
          ? 'Already cancelled'
          : b.status === 'no_show'
            ? 'A no-show'
            : b.status === 'completed'
              ? 'The trip is over'
              : null,
    ),
    release: why(held ? null : 'Only while seats are held'),
  };
  // Not offered at all for an OTA's booking (designs: "so it's not offered here").
  if (ota) {
    Object.assign(actions.changeTravellers, { hidden: true });
    Object.assign(actions.move, { hidden: true });
  }
  return actions;
}

/**
 * One booking's page (designs: O8, "every status").
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, bookingId: string, now?: Date }} o
 */
export async function deskBooking(prisma, { operatorId, bookingId, now = new Date() }) {
  const b = await prisma.booking.findFirst({
    where: { id: bookingId, operatorId },
    include: {
      departure: true,
      product: { include: { operator: true, priceCategories: true } },
      hold: true,
      policyVersion: true,
      travellers: { orderBy: { position: 'asc' } },
      payments: { where: { status: 'succeeded' }, orderBy: { createdAt: 'asc' } },
      refunds: { orderBy: { createdAt: 'asc' } },
      cashReports: { orderBy: { createdAt: 'asc' }, include: { reportedBy: true } },
      notifications: { where: { audience: 'guest' }, orderBy: { createdAt: 'asc' } },
      events: { orderBy: { createdAt: 'asc' } },
      channelBooking: {
        include: {
          channel: { select: { name: true } },
          allocations: { include: { payment: true } },
        },
      },
    },
  });
  if (!b) throw new BookingError('NOT_FOUND', 'Booking not found.');
  // Sold by an OTA (17c): its name, and its share frozen at the sale.
  const ota = b.channelBooking
    ? { name: b.channelBooking.channel.name, bp: b.channelBooking.commissionBasisPoints }
    : null;
  const tz = b.product.operator.timeZone;
  const cats = new Map(b.product.priceCategories.map((c) => [c.key, c]));
  const userIds = [
    ...new Set(
      [...b.events.map((e) => e.actorUserId), ...b.travellers.map((t) => t.checkedInById)].filter(
        (x) => x !== null,
      ),
    ),
  ];
  const users = await prisma.user.findMany({
    where: { id: { in: /** @type {string[]} */ (userIds) } },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const chatIds = b.notifications
    .map((n) => /** @type {any} */ (n.data)?.chatMessageId)
    .filter(Boolean);
  const chats = new Map(
    (await prisma.chatMessage.findMany({ where: { id: { in: chatIds } } })).map((m) => [m.id, m]),
  );

  const chip = deskStatus(b);
  const ended = ENDED.includes(b.status);
  const owed = Math.max(0, b.totalKobo - b.amountPaidKobo);
  const tripDate = localDate(b.departure.startsAt, tz);
  const today = localDate(now, tz);
  const started = b.departure.startsAt <= now;
  const due = balanceDueDate(tripDate);
  const people = peopleLine(b.travellers, cats);
  const paidSum = b.payments.reduce((n, p) => n + p.amountKobo, 0);
  const refunded = b.refunds
    .filter((r) => r.status !== 'failed')
    .reduce((n, r) => n + r.amountKobo, 0);
  const pendingCash = b.cashReports.filter((c) => PENDING_CASH.includes(c.status));
  const lastFailed = [...b.refunds].reverse().find((r) => r.status === 'failed');

  // The money, as a ledger: the price, what came in, cash waiting, refunds, and the bottom line.
  const money = [
    { label: priceLine(b.quote) || people, value: formatNaira(b.totalKobo), tone: 'ink' },
    ...b.payments.map((p) => ({
      label: [
        p.provider === 'ota' && ota
          ? `Paid by ${ota.name}`
          : p.purpose === 'deposit'
            ? 'Deposit'
            : p.purpose === 'balance'
              ? 'Balance'
              : 'Payment',
        // How it was actually paid (Paystack says: card, bank transfer…); checkout asks for "any".
        METHOD[p.channel ?? ''] ?? METHOD[p.method] ?? null,
        shortDay(p.paidAt ?? p.createdAt, tz),
      ]
        .filter(Boolean)
        .join(' · '),
      value: `${formatNaira(p.amountKobo)} paid`,
      tone: 'ok',
    })),
    // What the OTA owes for it: the price less its share ("₦64,000 (₦80,000 less 20%)").
    ...b.payments
      .filter((p) => p.provider === 'ota' && ota)
      .map((p) => {
        const kept = p.amountKobo - p.refundedKobo;
        const net = kept - percentOf(kept, /** @type {any} */ (ota).bp);
        return {
          label: `${/** @type {any} */ (ota).name} owes you`,
          value: `${formatNaira(net)} (${formatNaira(kept)} less ${/** @type {any} */ (ota).bp / 100}%)`,
          tone: 'muted',
        };
      }),
    ...pendingCash.map((c) => ({
      label: `Cash · reported by ${firstName(c.reportedBy.name)} · ${shortDay(c.reportedAt, tz)}`,
      value: `${formatNaira(c.amountKobo)} pending`,
      tone: 'info',
    })),
    ...b.refunds.map((r) => ({
      label: `Refund · ${shortDay(r.createdAt, tz)} · ${r.status === 'processed' ? 'sent' : r.status === 'failed' ? 'failed' : 'sending'}`,
      value: `− ${formatNaira(r.amountKobo)}`,
      tone: r.status === 'failed' ? 'urgent' : 'ink',
    })),
  ];
  // An OTA's booking (designs: "Price · guest paid Sojourna", "Sojourna's 20%", "Sojourna owes
  // Ìrìn"): what the guest paid the OTA, its share, what it still owes for this booking (less
  // refunds and what its payments paid off).
  if (ota && b.status !== 'held') {
    const cb = /** @type {any} */ (b.channelBooking);
    const paidToOta = b.payments.filter((p) => p.provider === 'ota');
    const kept = paidToOta.reduce((n, p) => n + p.amountKobo - p.refundedKobo, 0);
    const owedByOta = owedFor({ ...cb, booking: { payments: b.payments, refunds: b.refunds } });
    money.splice(
      0,
      money.length,
      {
        label: `Price · guest paid ${ota.name}`,
        value: formatNaira(paidToOta.reduce((n, p) => n + p.amountKobo, 0) || b.totalKobo),
        tone: 'ink',
      },
      ...b.refunds
        .filter((r) => r.provider === 'ota')
        .map((r) => ({
          label: `Refunded to the guest by ${ota.name} · ${shortDay(r.processedAt ?? r.createdAt, tz)}`,
          value: `− ${formatNaira(r.amountKobo)}`,
          tone: 'ink',
        })),
      {
        label: `${ota.name}’s ${ota.bp / 100}%`,
        value: `− ${formatNaira(percentOf(kept, ota.bp))}`,
        tone: 'muted',
      },
      ...cb.allocations.map((/** @type {any} */ a) => ({
        label: `${ota.name} paid it · ${dateWords(a.payment.receivedOn.toISOString().slice(0, 10))}`,
        value: `− ${formatNaira(a.amountKobo)}`,
        tone: 'ok',
      })),
    );
    const business = b.product.operator.name;
    money.push({
      label: owedByOta < 0 ? `${business} owes ${ota.name}` : `${ota.name} owes ${business}`,
      value: formatNaira(Math.abs(owedByOta)),
      tone: owedByOta > 0 ? 'warning' : 'ink',
      total: true,
    });
  }
  const bottom =
    b.status === 'held'
      ? { label: 'To pay at checkout', value: formatNaira(owed), tone: 'ink' }
      : chip.key === 'refund_failed' || chip.key === 'refund_due'
        ? { label: 'Owed back to the guest', value: formatNaira(notStartedKobo(b)), tone: 'urgent' }
        : ended
          ? { label: 'Kept', value: formatNaira(Math.max(0, paidSum - refunded)), tone: 'ink' }
          : {
              label:
                owed > 0 && b.status !== 'no_show'
                  ? `Still owed · due ${dateWords(due)}`
                  : 'Still owed',
              value: formatNaira(owed),
              tone: owed > 0 ? 'warning' : 'ink',
            };

  // The banner: what needs doing (or what happened), by status.
  /** @type {null | { kind: string, tone: string, title: string, text: string, expiresAt?: string, call?: string, cashReportId?: string, amountKobo?: number }} */
  let banner = null;
  if (b.status === 'held' && b.hold) {
    const n = b.travellers.length;
    banner = {
      kind: 'held',
      tone: 'held',
      title: `Seats held until ${localTime(b.hold.expiresAt, tz)}`,
      expiresAt: b.hold.expiresAt.toISOString(),
      text: `The guest is paying right now (${b.channel === 'whatsapp' ? 'on WhatsApp' : 'on the website'}). If they don’t pay in time, the ${n} ${n === 1 ? 'seat is' : 'seats are'} released by themselves and this booking leaves the list.`,
    };
  } else if (chip.key === 'refund_due') {
    banner = {
      kind: 'refund_due',
      tone: 'urgent',
      title: `${formatNaira(notStartedKobo(b))} to refund`,
      text: 'The booking was cancelled with money owed back, and the refund hasn’t been started yet.',
    };
  } else if (chip.key === 'refund_failed' && lastFailed) {
    banner = {
      kind: 'refund_failed',
      tone: 'urgent',
      title: `Refund of ${formatNaira(lastFailed.amountKobo)} failed`,
      text: `${lastFailed.failureReason ? `It couldn’t be sent back: ${lastFailed.failureReason}. ` : ''}The guest was told a refund is on its way, so please sort it soon.`,
    };
  } else if (pendingCash.length > 0) {
    const c = pendingCash[0];
    const who = firstName(c.reportedBy.name);
    banner = {
      kind: 'cash',
      tone: 'info',
      title: `Cash reported by ${who}: ${formatNaira(c.amountKobo)}`,
      // For "Confirm ₦45,500 received" / "Received a different amount" / "Not received".
      cashReportId: c.id,
      amountKobo: c.amountKobo,
      text:
        c.status === 'possible_double'
          ? `${formatAt(c.reportedAt.getTime(), tz)}, at check-in. The guest had also paid by link: one of the two may need giving back.`
          : `${formatAt(c.reportedAt.getTime(), tz)}, at check-in. Not counted as paid until you confirm ${who} handed it in.`,
    };
  } else if (ended) {
    const cancel = [...b.events].reverse().find((e) => e.toStatus === 'cancelled');
    const d = /** @type {any} */ (cancel?.data ?? {});
    const by =
      d.reason === 'hold_expired'
        ? 'Seats released: checkout wasn’t finished'
        : d.reason === 'hold_released'
          ? `Seats released${cancel?.actorUserId ? ` by ${names.get(cancel.actorUserId) ?? 'the office'}` : ''}`
          : d.initiatedBy === 'guest'
            ? 'Cancelled by the guest'
            : `Cancelled by ${cancel?.actorUserId ? (names.get(cancel.actorUserId) ?? 'the office') : 'the office'}`;
    const sent = b.refunds
      .filter((r) => r.status === 'processed')
      .reduce((n, r) => n + r.amountKobo, 0);
    const sending = b.refunds
      .filter((r) => r.status === 'requested' || r.status === 'pending')
      .reduce((n, r) => n + r.amountKobo, 0);
    banner = {
      kind: 'cancelled',
      tone: 'muted',
      title: `${by}${cancel ? ` on ${formatAt(cancel.createdAt.getTime(), tz)}` : ''}`,
      text: sending
        ? `Refund of ${formatNaira(sending)} is being sent.`
        : sent
          ? `Refund of ${formatNaira(sent)} sent; it can take 5–10 working days to arrive.`
          : paidSum > 0
            ? 'Nothing was refunded.'
            : 'Nothing had been paid.',
    };
  } else if (owed > 0 && b.status !== 'no_show' && due <= today) {
    const reminders = b.notifications.filter((n) => n.kind === 'balance_reminder');
    const last = reminders.at(-1);
    const lastWent = last ? deliveryOf(last, chats) : null;
    banner = {
      kind: 'owes',
      tone: 'warning',
      title: `Balance of ${formatNaira(owed)} ${due === today ? 'is due today' : `was due ${dateWords(due)}`}`,
      text: [
        b.payments[0]
          ? `${b.payments[0].purpose === 'deposit' ? 'Deposit' : 'Payment'} paid on ${shortDay(b.payments[0].paidAt ?? b.payments[0].createdAt, tz)}.`
          : 'Nothing paid yet.',
        lastWent?.tone === 'urgent'
          ? `The last reminder didn’t arrive (${lastWent.text.replace(/^[^:]*:\s*/, '')}).`
          : '',
        'Nothing is cancelled automatically: send a link, call them, or cancel.',
      ]
        .filter(Boolean)
        .join(' '),
      call: b.leadPhone ? formatPhoneForDisplay(b.leadPhone) : undefined,
    };
  }

  const checkers = [...new Set(b.travellers.map((t) => t.checkedInById).filter((x) => x !== null))];
  const actions = deskActions(b, { started, owed, tripDay: dayOf(b.departure.startsAt, tz) });

  // Cancelling (designs: "Cancel with the policy's refund, or another amount"): what the
  // policy gives back now, in words, and the most that can go back (what was paid).
  /** @type {any} */
  let cancel = null;
  let actNote = '';
  if (actions.cancel.enabled && ota) {
    // An OTA's booking (designs): cancelling here is the business calling it off, so the
    // guest gets everything back, from the OTA, which then owes nothing for it. Nothing to
    // choose; the OTA hears through OCTO (its BOOKING_UPDATE notification).
    const cb = /** @type {any} */ (b.channelBooking);
    const paidOff = cb.allocations.reduce(
      (/** @type {number} */ n, /** @type {any} */ a) => n + a.amountKobo,
      0,
    );
    const business = b.product.operator.name;
    cancel = {
      paidKobo: b.amountPaidKobo,
      policyKobo: b.amountPaidKobo,
      policyText: `${formatNaira(b.amountPaidKobo)} back to ${firstName(b.leadName)}, from ${ota.name} (you’re calling it off, so everything goes back)`,
      maxKobo: b.amountPaidKobo,
      initiatedBy: 'operator',
      fixed: true,
      doneNote: `Cancelled. ${ota.name} refunds ${firstName(b.leadName)} ${formatNaira(b.amountPaidKobo)} and is told through OCTO.`,
      title: `Cancel ${b.reference} · ${b.leadName}`,
      sub: [
        `${shortOf(b.product)}, ${dayOf(b.departure.startsAt, tz)} ${localTime(b.departure.startsAt, tz)}`,
        `paid ${formatNaira(b.amountPaidKobo)} to ${ota.name}`,
        tripIn(b.departure.startsAt, now),
      ].join(' · '),
    };
    actNote = [
      `Cancelling here (e.g. weather) tells ${ota.name} through OCTO; ${ota.name} refunds ${firstName(b.leadName)} and ${
        paidOff > 0
          ? `${business} owes ${ota.name} back the ${formatNaira(paidOff)} it already paid for it.`
          : `owes ${business} ₦0 for it.`
      }`,
      `Changing travellers on an OTA booking goes through ${ota.name}, so it’s not offered here.`,
    ].join(' ');
  } else if (actions.cancel.enabled) {
    const q = /** @type {any} */ (
      await previewCancellation(prisma, { operatorId, bookingId: b.id, initiatedBy: 'guest', now })
    );
    const words = policyWords(q, /** @type {any} */ (b.policyVersion?.rules) ?? []);
    cancel = {
      paidKobo: b.amountPaidKobo,
      policyKobo: q.refundKobo,
      policyText: `${formatNaira(q.refundKobo)} ${words}`,
      maxKobo: b.amountPaidKobo,
      initiatedBy: 'guest',
      fixed: false,
      doneNote: null,
      title: `Cancel ${b.reference} · ${b.leadName}`,
      sub: [
        `${shortOf(b.product)}, ${dayOf(b.departure.startsAt, tz)} ${localTime(b.departure.startsAt, tz)}`,
        `paid ${formatNaira(b.amountPaidKobo)}`,
        tripIn(b.departure.startsAt, now),
      ].join(' · '),
    };
    actNote =
      q.keptDepositKobo > 0
        ? `Cancelling now: the ${formatNaira(q.keptDepositKobo)} deposit isn’t refunded (deposits are non-refundable).`
        : q.refundKobo === 0 && started
          ? 'Cancelling now would refund ₦0: the trip has started (policy). A different amount is possible with a reason.'
          : b.amountPaidKobo > 0
            ? `Cancelling now refunds ${formatNaira(q.refundKobo)} (${words}).`
            : '';
  }
  // What can go back through Paystack (cash can't): a failed refund's "Try again".
  const byCardKobo = b.payments
    .filter((p) => p.providerTransactionId !== null)
    .reduce((n, p) => n + (p.amountKobo - p.refundedKobo), 0);

  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    departureId: b.departureId,
    holdId: b.holdId,
    refLine: [
      b.reference,
      ota
        ? `VIA ${ota.name.toUpperCase()}${b.channelBooking?.resellerReference ? ` (${b.channelBooking.resellerReference})` : ''}`
        : (CHANNEL[b.channel] ?? b.channel.toUpperCase()),
      b.status === 'held'
        ? `STARTED ${localTime(b.createdAt, tz)}`
        : `BOOKED ${dayOf(b.createdAt, tz).toUpperCase()}`,
    ].join(' · '),
    lead: b.leadName,
    phone: b.leadPhone ? formatPhoneForDisplay(b.leadPhone) : null,
    sub: [
      b.leadPhone ? formatPhoneForDisplay(b.leadPhone) : null,
      b.leadEmail ?? 'no email',
      b.product.title,
      `${dayOf(b.departure.startsAt, tz)}, ${localTime(b.departure.startsAt, tz)}`,
      people,
    ]
      .filter(Boolean)
      .join(' · '),
    chip: { ...chip, expiresAt: chip.expiresAt?.toISOString() ?? null },
    banner,
    money: ota && b.status !== 'held' ? money : [...money, { ...bottom, total: true }],
    travellers: b.travellers.map((t, i) => {
      const cat = cats.get(t.categoryKey);
      const kind = (cat?.name ?? t.categoryKey).replace(/\s*\(.*\)\s*$/, '');
      return {
        id: t.id,
        name: t.name || `Guest ${t.position}`,
        kind: [
          kind,
          t.age !== null && t.categoryKey !== 'adult' ? String(t.age) : null,
          t.dietaryNeeds || null,
          i === 0 && b.travellers.length > 1 ? 'lead' : null,
        ]
          .filter(Boolean)
          .join(' · '),
        checkInStatus: t.checkInStatus,
        // For "Change travellers" (16c-3): which − removes whom.
        categoryKey: t.categoryKey,
        position: t.position,
        state: travellerState(t, tz, ended),
      };
    }),
    checkedInBy: checkers.length
      ? `Checked in by ${checkers.map((id) => firstName(names.get(/** @type {string} */ (id)) ?? 'the guide')).join(' and ')}`
      : null,
    messages: [
      // An OTA's booking (designs): the confirmation is the OTA's to send.
      ...(ota && b.channelBooking?.confirmedAt
        ? [
            {
              id: 'ota-confirmation',
              date: shortDay(b.channelBooking.confirmedAt, tz),
              what: MESSAGES.booking_confirmed.name,
              text: `Not sent: ${ota.name} sends its own`,
              tone: 'muted',
            },
          ]
        : []),
      ...b.notifications.map((n) => ({
        id: n.id,
        date: shortDay(n.sentAt ?? n.createdAt, tz),
        what: messageName(n),
        ...deliveryOf(n, chats),
      })),
    ],
    timeline: b.events.map(
      (e) => `${stamp(e.createdAt, tz)} · ${eventText(e, names, { channelName: ota?.name })}`,
    ),
    actions,
    // For "Mark no-show": what the policy this booking was sold with gives back.
    cancel,
    actNote,
    // The sums the money sheets start from.
    sums: {
      owedKobo: owed,
      owedBackKobo: notStartedKobo(b),
      byCardKobo,
      timeZone: tz,
    },
    noShowLine: b.policyVersion
      ? b.policyVersion.noShowRefundBasisPoints === 0
        ? 'Policy: no refund for a no-show.'
        : `Policy: ${b.policyVersion.noShowRefundBasisPoints / 100}% back for a no-show.`
      : null,
    trip: { started, date: tripDate },
  };
}

/**
 * A note on the booking: on its timeline, with who and when; "show on the guide's manifest"
 * puts it under the booking on the manifest too. Guests never see notes.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, bookingId: string, userId: string, text: string, onManifest?: boolean }} n
 */
export async function addNote(prisma, { operatorId, bookingId, userId, text, onManifest = false }) {
  const b = await prisma.booking.findFirst({ where: { id: bookingId, operatorId } });
  if (!b) throw new BookingError('NOT_FOUND', 'Booking not found.');
  const clean = text.trim();
  if (!clean) throw new BookingError('EMPTY_NOTE', 'Write the note first.');
  return prisma.bookingEvent.create({
    data: {
      operatorId,
      bookingId,
      type: 'note',
      actorType: 'user',
      actorUserId: userId,
      data: { text: clean, onManifest },
    },
  });
}
