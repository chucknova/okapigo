// @ts-check
/**
 * desk.js — what the bookings desk (O8) shows, around the server's own words
 * (packages/db/src/desk.js): the filters, the address to ask for, the held countdown, the
 * "no bookings match" line, and which of a booking's actions are built yet.
 */

import { formatNaira } from '@okapigo/shared/money';
import { localTime } from '@okapigo/shared/time';
import { formatAt } from '@okapigo/shared/tour-facts';
import { cashAmount } from './money.js';

export const FILTERS = /** @type {const} */ ([
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'owes', label: 'Owes money' },
  { key: 'cash', label: 'Cash to confirm' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
]);

/** The list's address. @param {string} filter @param {string} q */
export function listPath(filter, q) {
  const params = new URLSearchParams({ filter });
  if (q.trim()) params.set('q', q.trim());
  return `/api/desk/bookings?${params}`;
}

/** "12:40" left on a hold; "0:00" once it's up. @param {string | null | undefined} expiresAt @param {number} now */
export function heldLeft(expiresAt, now) {
  if (!expiresAt) return '';
  const s = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A chip's words: a held one counts down ("Held · 12:40"). @param {any} chip @param {number} now */
export const chipText = (chip, now) =>
  chip.key === 'held' && chip.expiresAt ? `Held · ${heldLeft(chip.expiresAt, now)}` : chip.text;

/**
 * Above the results: "3 results for “0805”"; nothing without a search.
 * @param {number} n @param {string} q
 */
export const resultsLine = (n, q) =>
  q.trim() ? `${n} ${n === 1 ? 'result' : 'results'} for “${q.trim()}”` : '';

/**
 * Nothing found (designs: "No bookings match"): "No upcoming bookings match “Okonkwo”".
 * @param {string} filter @param {string} q
 */
export function noMatch(filter, q) {
  const kind = /** @type {Record<string, string>} */ ({
    today: 'bookings today',
    upcoming: 'upcoming bookings',
    owes: 'bookings owing money',
    cash: 'bookings with cash to confirm',
    cancelled: 'cancelled bookings',
    all: 'bookings',
  })[filter];
  return q.trim() ? `No ${kind} match “${q.trim()}”` : `No ${kind}.`;
}

/**
 * The buttons under a booking, in the designs' order. `built: false` ones aren't shown yet
 * (changing travellers: 16c-3).
 * @param {Record<string, { enabled: boolean, why: string }>} a
 */
export function actionButtons(a) {
  return [
    { key: 'paymentLink', label: 'Send payment link', built: true, ...a.paymentLink },
    { key: 'changeTravellers', label: 'Change travellers', built: false, ...a.changeTravellers },
    { key: 'addNote', label: 'Add note', built: true, ...a.addNote },
    { key: 'noShow', label: 'Mark no-show', built: true, ...a.noShow },
    { key: 'cancel', label: 'Cancel booking', built: true, danger: true, ...a.cancel },
  ].filter((b) => b.built);
}

/**
 * Who can be marked a no-show from the desk: the travellers not checked in. "Mark 1 no-show".
 * @param {any[]} travellers @param {string[]} picked
 */
export function noShowLabel(travellers, picked) {
  const n = picked.filter((id) =>
    travellers.some((t) => t.id === id && t.checkInStatus === 'pending'),
  ).length;
  return n === 0 ? 'Choose who didn’t come' : `Mark ${n} no-show${n === 1 ? '' : 's'}`;
}

/**
 * An amount typed in naira, up to `maxKobo`: "45,500" → 4_550_000.
 * @param {string} typed @param {number} maxKobo @param {string} tooMuch  what to say if it's over
 * @returns {{ ok: true, kobo: number } | { ok: false, error: string }}
 */
export function amountIn(typed, maxKobo, tooMuch) {
  const r = cashAmount(typed, maxKobo);
  return r.ok || r.error !== 'That’s more than they owe.' ? r : { ok: false, error: tooMuch };
}

/** How long a payment link lasts (designs: "Expires: 7 days · 2 days · 24 hours"). */
export const LINK_EXPIRY = /** @type {const} */ ([
  { days: 7, label: '7 days' },
  { days: 2, label: '2 days' },
  { days: 1, label: '24 hours' },
]);

/**
 * After sending: "Payment link for ₦45,500 sent at 17:42 · expires Sat 12 Dec."
 * @param {{ amountKobo: number, expiresAt: string }} link @param {Date} at @param {string} tz
 */
export const linkSentText = (link, at, tz) =>
  `Payment link for ${formatNaira(link.amountKobo)} sent at ${localTime(at, tz)} · expires ${
    formatAt(Date.parse(link.expiresAt), tz).split(', ')[0]
  }. It shows under Messages with its delivery status.`;

/**
 * The cancel button's words: "Cancel and refund ₦31,250", or "Cancel booking" when nothing
 * goes back. @param {number} refundKobo
 */
export const cancelLabel = (refundKobo) =>
  refundKobo > 0 ? `Cancel and refund ${formatNaira(refundKobo)}` : 'Cancel booking';

/**
 * After cancelling: what happened to the money.
 * @param {number} refundKobo @param {{ started: boolean, problem?: string } | null} start
 */
export function cancelledNote(refundKobo, start) {
  if (refundKobo === 0)
    return 'Cancelled. Nothing to refund. The guest is told by WhatsApp and email.';
  if (start?.started)
    return `Cancelled. Refund of ${formatNaira(refundKobo)} started; the guest is told by WhatsApp and email.`;
  return `Cancelled, but the refund of ${formatNaira(refundKobo)} didn’t start${start?.problem ? `: ${start.problem.replace(/\.$/, '')}` : ''}. Send it from this page.`;
}

/**
 * A failed or never-started refund: can it go back by card (Paystack), or only by transfer?
 * @param {{ owedBackKobo: number, byCardKobo: number }} sums
 */
export const canRetryByCard = (sums) =>
  sums.owedBackKobo > 0 && sums.byCardKobo >= sums.owedBackKobo;
