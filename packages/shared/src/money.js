// @ts-check
/**
 * money.js — the ONLY place naira ↔ kobo conversion and formatting happens.
 *
 * The rule across OkapiGo: money is stored, sent and calculated as an integer number of
 * KOBO (₦1 = 100 kobo). Formatting into "₦25,000" happens only at the very edge, when
 * showing it to a person. Why integers? Floating-point numbers can't represent most
 * decimals exactly:
 *     0.1 + 0.2            → 0.30000000000000004
 *     10 + 20              → 30   (kobo: always exact)
 * Do enough arithmetic on floats and a ledger stops balancing by a kobo.
 */

/**
 * Converts a naira amount to kobo, e.g. for seed data written in naira.
 *   nairaToKobo(25000)  → 2500000
 *   nairaToKobo(99.99)  → 9999
 * Math.round fixes float noise: 99.99 * 100 is 9998.999999999998 in JavaScript.
 * @param {number} naira
 */
export function nairaToKobo(naira) {
  const kobo = Math.round(naira * 100);
  if (!Number.isSafeInteger(kobo)) throw new RangeError(`Not a valid naira amount: ${naira}`);
  return kobo;
}

const formatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  // Tour prices are whole naira, so hide ".00"; show kobo only when there are some.
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/**
 * Formats kobo for people: formatNaira(2500000) → "₦25,000", formatNaira(9999) → "₦99.99"
 * @param {number} kobo
 */
export function formatNaira(kobo) {
  if (!Number.isInteger(kobo)) throw new TypeError(`Money must be integer kobo, got ${kobo}`);
  return formatter.format(kobo / 100);
}
