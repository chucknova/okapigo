// @ts-check
/**
 * manifest.js — what the manifest (O3) shows, and the change each tap records.
 *
 * The screen asks this file everything: the header's lines, each booking's chips, each
 * traveller's pill and what a tap changes it to, search, and the change to put in the outbox.
 * Nothing here talks to the network or the screen.
 *
 * Traveller states (designs: tokens v1, O3):
 *   Not yet → ✓ Present → Late 07:04 → ✕ No-show → Not yet …   (a tap moves to the next)
 *   Late and No-show unlock at the start time; before it, a tap goes Not yet ↔ Present.
 *
 * Two kinds of no-show (decided with the server, 15c-2):
 *   - ONE traveller isn't here (the others came): just that traveller, no policy.
 *   - NOBODY on the booking came: the whole booking is a no-show, and the business's
 *     no-show policy applies (session 9). "Mark the rest of this booking no-show" picks the
 *     right one: the rest, if anyone came; the booking, if nobody did.
 */
import { localDate, localTime } from '@okapigo/shared/time';
import { formatNaira } from '@okapigo/shared/money';
import { formatAt } from '@okapigo/shared/tour-facts';
import { CAN_CHECK_IN } from './outbox.js';

/** @typedef {'pending' | 'present' | 'late' | 'no_show'} TravellerState */

const CYCLE = /** @type {TravellerState[]} */ (['pending', 'present', 'late', 'no_show']);
/** Where the booking came from, as the manifest says it. */
const VIA = /** @type {Record<string, string>} */ ({
  web: 'web',
  whatsapp: 'WhatsApp',
  staff: 'office',
  ota: 'partner',
});

/** The tour has started: late and no-show are allowed. @param {any} m @param {Date} now */
export const hasStarted = (m, now) => now.getTime() >= Date.parse(m.departure.startsAt);

/**
 * What a tap on a traveller's pill changes it to.
 * @param {TravellerState} state @param {boolean} started
 * @returns {TravellerState}
 */
export function nextState(state, started) {
  if (!started) return state === 'pending' ? 'present' : 'pending';
  return CYCLE[(CYCLE.indexOf(state) + 1) % CYCLE.length];
}

/**
 * A traveller's pill: its words and its look ("Late 07:04" keeps the arrival time).
 * @param {any} t @param {string} tz
 * @returns {{ label: string, tone: TravellerState }}
 */
export function pillOf(t, tz) {
  const state = /** @type {TravellerState} */ (t.checkInStatus);
  if (state === 'present') return { label: '✓ Present', tone: state };
  if (state === 'late') {
    return {
      label: t.checkedInAt ? `Late ${localTime(new Date(t.checkedInAt), tz)}` : 'Late',
      tone: state,
    };
  }
  if (state === 'no_show') return { label: '✕ No-show', tone: state };
  return { label: 'Not yet', tone: 'pending' };
}

/** "Adult", "Child · 8". @param {any} t */
const metaOf = (t) =>
  [t.category?.name ?? 'Guest', t.age ?? null].filter((x) => x !== null).join(' · ');

/** "Funmi Adeyemi" → "Funmi" (the owe dialog's title). @param {string} name */
export const firstName = (name) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Everything the manifest screen shows, from one departure's manifest (with the outbox on top).
 * @param {any} m @param {{ now: Date, tz: string, query?: string, guide?: string | null }} o
 */
export function manifestView(m, { now, tz, query = '' }) {
  const started = hasStarted(m, now);
  const startsAt = new Date(m.departure.startsAt);
  const ended = now.getTime() >= Date.parse(m.departure.endsAt);
  const day = formatAt(startsAt.getTime(), tz).split(',')[0];
  const when = ended
    ? `ended ${localTime(new Date(m.departure.endsAt), tz)}`
    : started
      ? `started ${localTime(startsAt, tz)}`
      : `starts ${localTime(startsAt, tz)}`;
  const r = m.resource;
  const sub = [
    m.tour.meetingPoint?.name,
    m.guide?.name,
    r ? `${r.name} (${r.seats} seats)` : null,
    m.departure.notes || null,
  ]
    .filter(Boolean)
    .join(' · ');
  const c = m.counts;
  const checkedIn = c.present + c.late;

  const live = m.bookings.filter(
    (/** @type {any} */ b) => b.status !== 'cancelled' && b.status !== 'refunded',
  );
  const gone = m.bookings.filter(
    (/** @type {any} */ b) => b.status === 'cancelled' || b.status === 'refunded',
  );
  const match = matcher(query);

  return {
    started,
    startTime: localTime(startsAt, tz),
    dateLine: `${day} · ${when}`,
    title: m.tour.title,
    sub,
    checkedIn,
    total: c.travellers,
    pct: c.travellers ? Math.round((checkedIn / c.travellers) * 100) : 0,
    bookings: live.filter(match).map((/** @type {any} */ b) => bookingView(b, { started, tz })),
    cancelled: gone.filter(match).map((/** @type {any} */ b) => ({
      id: b.id,
      line: `${b.lead.name} · ${b.travellers.length} ${b.travellers.length === 1 ? 'guest' : 'guests'}`,
      sub: `${b.reference} · ${endedWhen(b.endedAt, now, tz)} · don’t check in`,
    })),
    matches: query.trim() ? live.filter(match).length + gone.filter(match).length : null,
  };
}

/** @param {any} b @param {{ started: boolean, tz: string }} o */
function bookingView(b, { started, tz }) {
  const active = CAN_CHECK_IN.includes(b.status);
  const owes = active && b.money.owedKobo > 0;
  const anyoneIn = b.travellers.some(
    (/** @type {any} */ t) => t.checkInStatus === 'present' || t.checkInStatus === 'late',
  );
  const pending = b.travellers.filter((/** @type {any} */ t) => t.checkInStatus === 'pending');
  return {
    id: b.id,
    lead: b.lead.name,
    phone: b.lead.phone,
    ref: b.reference,
    via: VIA[b.channel] ?? b.channel ?? '',
    // A whole-booking no-show is decided: its pills don't change here (the office can).
    locked: !active,
    pay:
      b.status === 'no_show'
        ? { text: 'No-show', tone: 'no_show' }
        : owes
          ? { text: b.money.label, tone: 'owes' }
          : { text: 'Paid', tone: 'paid' },
    owesKobo: owes ? b.money.owedKobo : 0,
    extras: (b.addOns ?? [])
      .map((/** @type {any} */ a) => `${a.quantity} × ${a.name.toLowerCase()}`)
      .join(' · '),
    people: b.travellers.map((/** @type {any} */ t) => ({
      id: t.id,
      name: t.displayName,
      unnamed: !t.name,
      meta: metaOf(t),
      diet: t.dietaryNeeds || null,
      state: t.checkInStatus,
      pill: pillOf(t, tz),
      next: nextState(t.checkInStatus, started),
      unsent: t.unsent ? `Not sent yet · ${localTime(new Date(t.unsent), tz)}` : null,
    })),
    // "Mark the rest of this booking no-show": after the start, while someone's still "Not yet".
    canMarkRest: active && started && pending.length > 0,
    // …which is the whole booking (with the policy) only if nobody on it came.
    restIsWholeBooking: !anyoneIn && pending.length === b.travellers.length,
    pendingCount: pending.length,
    noShowRefundPercent: b.noShowRefundPercent ?? null,
  };
}

/** "Cancelled yesterday", "Cancelled at 06:55", "Cancelled Fri 4 Dec". @param {string | null} at @param {Date} now @param {string} tz */
function endedWhen(at, now, tz) {
  if (!at) return 'Cancelled';
  const d = new Date(at);
  const today = localDate(now, tz);
  const day = localDate(d, tz);
  if (day === today) return `Cancelled at ${localTime(d, tz)}`;
  const yesterday = localDate(new Date(now.getTime() - 86_400_000), tz);
  if (day === yesterday) return 'Cancelled yesterday';
  return `Cancelled ${formatAt(d.getTime(), tz).split(',')[0]}`;
}

/**
 * Search by name, phone or reference (designs: "e.g. Okafor"; "the last 4 digits of their
 * phone"; "the reference on their ticket (ILT-…)"). Accents and case don't matter.
 * @param {string} query
 */
export function matcher(query) {
  const q = fold(query.trim());
  const digits = query.replace(/\D/g, '');
  if (!q) return () => true;
  return (/** @type {any} */ b) =>
    fold(b.lead.name).includes(q) ||
    b.travellers.some((/** @type {any} */ t) => fold(t.displayName ?? t.name ?? '').includes(q)) ||
    fold(b.reference).includes(q) ||
    (digits.length >= 3 && (b.lead.phone ?? '').replace(/\D/g, '').endsWith(digits));
}

/** "Ìrìn" → "irin": search ignores accents and case. @param {string} s */
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// --- The changes a tap records (into the outbox: sync.js record) ----------------------------

/**
 * A traveller's new state. `seen` is what this phone showed (15b: a conflict if someone
 * else changed it meanwhile). Money owed was already confirmed if someone on the booking is
 * in: then it doesn't ask again.
 * @param {any} m @param {any} b  the booking (from the manifest) @param {any} t @param {TravellerState} to
 * @param {{ confirmOwed?: boolean }} [o]
 */
export function stateChange(m, b, t, to, { confirmOwed = false } = {}) {
  return {
    kind: /** @type {const} */ ('check_in'),
    departureId: m.departure.id,
    bookingId: b.id,
    travellerIds: [t.id],
    status: to,
    seen: { [t.id]: t.checkInStatus },
    ...(confirmOwed || alreadyConfirmed(b) ? { confirmOwed: true } : {}),
  };
}

/** Someone on the booking is checked in: the money question was answered then. @param {any} b */
const alreadyConfirmed = (b) =>
  b.travellers.some(
    (/** @type {any} */ t) => t.checkInStatus === 'present' || t.checkInStatus === 'late',
  );

/**
 * Ask "They still owe ₦45,500" before this tap? Only when it checks someone in, money is
 * owed, and nobody on the booking is in yet (decided 2026-11-19: show it, ask first).
 * @param {any} b @param {any} t @param {TravellerState} to
 */
export function needsOweQuestion(b, t, to) {
  return (
    (to === 'present' || to === 'late') &&
    t.checkInStatus === 'pending' &&
    CAN_CHECK_IN.includes(b.status) &&
    b.money.owedKobo > 0 &&
    !alreadyConfirmed(b)
  );
}

/**
 * "Mark the rest of this booking no-show": the travellers still "Not yet" if anyone came,
 * or the whole booking (with the policy) if nobody did.
 * @param {any} m @param {any} b
 */
export function restNoShowChange(m, b) {
  const pending = b.travellers.filter((/** @type {any} */ t) => t.checkInStatus === 'pending');
  if (pending.length === b.travellers.length && !alreadyConfirmed(b)) {
    return { kind: /** @type {const} */ ('no_show'), departureId: m.departure.id, bookingId: b.id };
  }
  return {
    kind: /** @type {const} */ ('check_in'),
    departureId: m.departure.id,
    bookingId: b.id,
    travellerIds: pending.map((/** @type {any} */ t) => t.id),
    status: /** @type {const} */ ('no_show'),
    seen: Object.fromEntries(pending.map((/** @type {any} */ t) => [t.id, 'pending'])),
  };
}

/**
 * A name typed at check-in (optional). The same rule as the server: 2 to 80 characters.
 * @param {any} m @param {any} t @param {string} name
 * @returns {{ ok: true, change: any } | { ok: false, error: string }}
 */
export function nameChange(m, t, name) {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 2 || clean.length > 80)
    return { ok: false, error: 'A name of 2 to 80 characters, please.' };
  return {
    ok: true,
    change: {
      kind: /** @type {const} */ ('name'),
      departureId: m.departure.id,
      travellerId: t.id,
      name: clean,
      seen: t.name,
    },
  };
}

/**
 * "Mark Funmi Adeyemi’s booking no-show?" and why it matters (designs: O3 states).
 * @param {any} b  the booking view (bookingView) @param {string} business
 */
export function noShowQuestion(b, business) {
  const n = b.people.length;
  const pct = b.noShowRefundPercent;
  const refund =
    pct === null
      ? 'the no-show policy decides any refund'
      : pct === 0
        ? 'a no-show gets no refund'
        : `a no-show gets ${pct}% back`;
  const balance =
    b.owesKobo > 0 ? `, and the balance of ${formatNaira(b.owesKobo)} stays unpaid` : '';
  return {
    title: `Mark ${b.lead}’s booking no-show?`,
    body: `${n} ${n === 1 ? 'traveller' : 'travellers'}. Under ${business}’s policy ${refund}${balance}. The office can change this later.`,
  };
}
