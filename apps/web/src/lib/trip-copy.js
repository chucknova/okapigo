// @ts-check
/**
 * trip-copy.js — the trip hub's copy saved on THIS phone, and the "what to bring" ticks.
 *
 * The page is opened on the day, outdoors, maybe with no signal (flow 05: "the page should
 * still show what it last loaded"). So every time it loads, it saves what the server said, and
 * next time it shows that copy at once, then swaps in fresh data if the network answers.
 * The QR ticket is part of the copy (an SVG path), so the ticket works offline.
 *
 * localStorage, wrapped: it can be full or blocked (private browsing), and the page must
 * still work, just without the saved copy. Old trips are cleared two weeks after they end,
 * so a shared phone doesn't keep everyone's bookings forever.
 */
import { ASK_COPY } from './ask.js';

const COPY = 'okg-trip:';
const TICKS = 'okg-trip-ticks:';
const KEEP_AFTER_TRIP_MS = 14 * 86_400_000;

/**
 * @typedef {{ savedAt: number, booking: any }} SavedTrip
 */

/** @param {string} token @returns {SavedTrip | null} */
export function savedTrip(token) {
  try {
    const raw = localStorage.getItem(COPY + token);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} token
 * @param {any} booking  the guest view, as GET /public/bookings/:token returned it
 * @param {number} [now]
 */
export function saveTrip(token, booking, now = Date.now()) {
  try {
    localStorage.setItem(COPY + token, JSON.stringify({ savedAt: now, booking }));
    forgetOldTrips(now);
  } catch {
    // Full or blocked: the page works, just without a saved copy.
  }
}

/** @param {number} now */
function forgetOldTrips(now) {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key?.startsWith(COPY)) continue;
    const copy = savedTrip(key.slice(COPY.length));
    const ended = Date.parse(copy?.booking?.departure?.endsAt ?? '');
    if (!copy || (Number.isFinite(ended) && now - ended > KEEP_AFTER_TRIP_MS)) {
      localStorage.removeItem(key);
      if (copy?.booking?.reference) localStorage.removeItem(TICKS + copy.booking.reference);
      // The companion's conversation (ask.js), saved under the same link.
      localStorage.removeItem(ASK_COPY + key.slice(COPY.length));
    }
  }
}

/** The "what to bring" items ticked on this phone. @param {string} reference */
export function tickedItems(reference) {
  try {
    return /** @type {string[]} */ (JSON.parse(localStorage.getItem(TICKS + reference) ?? '[]'));
  } catch {
    return [];
  }
}

/**
 * @param {string} reference
 * @param {string[]} items  stored by their WORDS, so a reordered list keeps the right ticks
 */
export function saveTicks(reference, items) {
  try {
    localStorage.setItem(TICKS + reference, JSON.stringify(items));
  } catch {
    // Blocked: ticks simply don't survive a reload.
  }
}
