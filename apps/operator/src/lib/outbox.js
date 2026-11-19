// @ts-check
/**
 * outbox.js — the changes made on this phone that the server hasn't heard about yet.
 *
 * Every tap that changes something (a check-in, a name, a no-show) becomes a CHANGE, saved
 * here first and sent later (sync.js). The screens never wait for the network: they show
 * the saved package WITH the outbox applied on top (`withChanges`), so "8 of 12 checked in"
 * counts what the guide did offline, and those rows say "Not sent yet · 07:08".
 *
 * A change, as the server's outbox endpoint takes it (stage 15b):
 *   { id, at, kind: 'check_in', departureId, bookingId, travellerIds, status, confirmOwed, seen }
 *   { id, at, kind: 'no_show',  departureId, bookingId }
 *   { id, at, kind: 'name',     departureId, travellerId, name, seen }
 * `id` is made here, once: sending the same change again gets the same answer (15b).
 * `seen` is what this phone showed when the guide tapped, so the server can tell if someone
 * else changed it in between (a conflict, not a silent overwrite).
 */
import { localTime } from '@okapigo/shared/time';
import { formatNaira } from '@okapigo/shared/money';

/** Bookings whose guests can be checked in (the server's rule, packages/db operations.js). */
export const CAN_CHECK_IN = ['confirmed', 'part_paid', 'paid', 'amended', 'completed'];

/**
 * A new change, ready for the outbox.
 * @param {Record<string, any> & { kind: 'check_in' | 'no_show' | 'name', departureId: string }} what
 * @param {{ now?: Date, id?: string }} [o]
 */
export function makeChange(what, { now = new Date(), id = crypto.randomUUID() } = {}) {
  return { id, at: now.toISOString(), ...what };
}

/**
 * The package as this phone should show it: the saved copy, with every change in the outbox
 * applied, oldest first. Changed travellers get `unsent: '<when>'`. Counts are recomputed.
 * Never changes `pkg` itself.
 * @param {any} pkg     the offline package (15b), or null
 * @param {any[]} outbox
 */
export function withChanges(pkg, outbox) {
  if (!pkg) return pkg;
  /** @type {any} */
  const copy = structuredClone(pkg);
  const travellers = new Map();
  const bookings = new Map();
  for (const m of copy.departures) {
    for (const b of m.bookings) {
      bookings.set(b.id, b);
      for (const t of b.travellers) travellers.set(t.id, { t, b });
    }
  }
  for (const c of outbox) {
    if (c.kind === 'check_in') {
      const b = bookings.get(c.bookingId);
      if (!b || !CAN_CHECK_IN.includes(b.status)) continue; // the server will say why
      // "They've paid by link · check them in" (15c-4): confirming, until the server knows.
      if (c.paidBy === 'link') b.paidByLink = true;
      for (const t of b.travellers) {
        if (c.travellerIds?.length && !c.travellerIds.includes(t.id)) continue;
        t.checkInStatus = c.status;
        t.checkedInAt = c.status === 'pending' ? null : c.at;
        t.unsent = c.at;
      }
    } else if (c.kind === 'no_show') {
      const b = bookings.get(c.bookingId);
      if (!b || !CAN_CHECK_IN.includes(b.status)) continue;
      b.status = 'no_show'; // the whole booking: decided (the server applies the policy)
      for (const t of b.travellers) {
        if (t.checkInStatus !== 'pending') continue;
        t.checkInStatus = 'no_show';
        t.checkedInAt = c.at;
        t.unsent = c.at;
      }
    } else if (c.kind === 'cash') {
      // Cash reported (15c-4): shown on the booking at once; still owing until the office confirms.
      const b = bookings.get(c.bookingId);
      if (b) b.cashReportedKobo = (b.cashReportedKobo ?? 0) + c.amountKobo;
    } else if (c.kind === 'name') {
      const hit = travellers.get(c.travellerId);
      if (!hit) continue;
      hit.t.name = c.name.trim().replace(/\s+/g, ' ');
      hit.t.displayName = hit.t.name;
      hit.t.unsent = c.at;
    }
  }
  for (const m of copy.departures) m.counts = countsOf(m);
  return copy;
}

/**
 * "8 of 12 checked in": the same counting as the server's manifest (cancelled bookings
 * aren't counted; a no-show booking's travellers are).
 * @param {any} m  one departure's manifest
 */
export function countsOf(m) {
  const counts = { travellers: 0, pending: 0, present: 0, late: 0, noShow: 0, unsent: 0 };
  for (const b of m.bookings) {
    if (!CAN_CHECK_IN.includes(b.status) && b.status !== 'no_show') continue;
    for (const t of b.travellers) {
      counts.travellers++;
      if (t.unsent) counts.unsent++;
      if (t.checkInStatus === 'present') counts.present++;
      else if (t.checkInStatus === 'late') counts.late++;
      else if (t.checkInStatus === 'no_show') counts.noShow++;
      else counts.pending++;
    }
  }
  return counts;
}

/**
 * One row of Sync's list (O5): "Emeka Nwosu +2 · present · 07:05".
 * @param {any} c       a change
 * @param {any} pkg     the saved package (for names), or null
 * @param {string} timeZone
 * @returns {{ who: string, what: string, time: string }}
 */
export function describeChange(c, pkg, timeZone) {
  const time = localTime(new Date(c.at), timeZone);
  const booking = (pkg?.departures ?? [])
    .flatMap((/** @type {any} */ m) => m.bookings)
    .find(
      (/** @type {any} */ b) =>
        b.id === c.bookingId || b.travellers.some((/** @type {any} */ t) => t.id === c.travellerId),
    );
  if (c.kind === 'name') {
    const t = booking?.travellers.find((/** @type {any} */ x) => x.id === c.travellerId);
    const before = c.seen || (t ? `Guest ${t.position}` : 'A guest');
    return { who: `${before} → ${c.name.trim()}`, what: 'name added', time };
  }
  if (c.kind === 'no_show') {
    return { who: booking ? `${booking.lead.name}’s booking` : 'A booking', what: 'no-show', time };
  }
  if (c.kind === 'cash') {
    return {
      who: `${booking?.lead.name ?? 'A booking'} · cash ${formatNaira(c.amountKobo)}`,
      what: 'cash reported',
      time,
    };
  }
  const chosen = (booking?.travellers ?? []).filter(
    (/** @type {any} */ t) => !c.travellerIds?.length || c.travellerIds.includes(t.id),
  );
  const first = chosen[0]?.displayName ?? booking?.lead.name ?? 'A booking';
  const who = chosen.length > 1 ? `${first} +${chosen.length - 1}` : first;
  const what = c.status === 'pending' ? 'check-in undone' : c.status;
  return { who, what, time };
}
