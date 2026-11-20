// @ts-check
/**
 * desk.js — what the bookings desk (O8) shows, around the server's own words
 * (packages/db/src/desk.js): the filters, the address to ask for, the held countdown, the
 * "no bookings match" line, and which of a booking's actions are built yet.
 */

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
 * The buttons under a booking, in the designs' order. `built: false` ones arrive in 16c-2
 * and 16c-3 and aren't shown yet.
 * @param {Record<string, { enabled: boolean, why: string }>} a
 */
export function actionButtons(a) {
  return [
    { key: 'paymentLink', label: 'Send payment link', built: false, ...a.paymentLink },
    { key: 'changeTravellers', label: 'Change travellers', built: false, ...a.changeTravellers },
    { key: 'addNote', label: 'Add note', built: true, ...a.addNote },
    { key: 'noShow', label: 'Mark no-show', built: true, ...a.noShow },
    { key: 'cancel', label: 'Cancel booking', built: false, danger: true, ...a.cancel },
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
