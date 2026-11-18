// @ts-check
/**
 * trips.js — the trips this phone has opened (booking reference → guest link token).
 *
 * The payment link page shows "Open your trip page" only when THIS device has opened the trip
 * page before (designs: "The trip page button shows only when this device has opened the trip
 * page before"). A payment link alone must never reveal the trip page (anyone can be sent a
 * link). localStorage, because it should survive closing the browser; wrapped, because it can
 * be blocked, and the page then simply doesn't offer the button.
 */
const KEY = 'okg-trips';

/** @returns {Record<string, string>} */
function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * @param {string} reference  "ILT-7K4Q2M"
 * @param {string} token      the guest link token
 */
export function rememberTrip(reference, token) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [reference]: token }));
  } catch {
    // Storage blocked: nothing to do.
  }
}

/** @param {string} reference @returns {string | null} */
export function tripTokenFor(reference) {
  return read()[reference] ?? null;
}
