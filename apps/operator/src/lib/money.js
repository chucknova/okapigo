// @ts-check
/**
 * money.js — money on tour day (designs: "Money owed on the day"; decided 2026-11-19).
 *
 * When a booking still owes, the guide can:
 *   Show payment QR        the booking's balance link (in the saved package), drawn as a QR
 *                          code: the guest pays on THEIR phone and data; works with no signal
 *   They paid me cash      saved as cash REPORTED by the guide. Not a payment: the booking
 *                          keeps showing as owing until the office confirms it was handed in
 *   Check in, still owing  as before (15c-2)
 *
 * The changes go into the outbox like check-ins: `{ kind: 'cash', bookingId, amountKobo }`.
 */
import { encode } from 'uqr';
import { formatNaira } from '@okapigo/shared/money';

/**
 * The amount typed for cash: "45,500" → 4_550_000 kobo. Up to what's owed; less is fine.
 * @param {string} typed @param {number} owedKobo
 * @returns {{ ok: true, kobo: number } | { ok: false, error: string }}
 */
export function cashAmount(typed, owedKobo) {
  const clean = typed.replace(/[₦,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean))
    return { ok: false, error: 'Type the amount in naira, like 45,500.' };
  const kobo = Math.round(Number(clean) * 100);
  if (kobo <= 0) return { ok: false, error: 'Type the amount in naira, like 45,500.' };
  if (kobo > owedKobo) return { ok: false, error: 'That’s more than they owe.' };
  return { ok: true, kobo };
}

/** "45,500" for the cash field: the naira, with commas. @param {number} kobo */
export const nairaField = (kobo) =>
  (kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 });

/**
 * The cash a guide took, as a change for the outbox.
 * @param {any} m  the departure's manifest @param {any} b  the booking @param {number} amountKobo
 */
export const cashChange = (m, b, amountKobo) => ({
  kind: /** @type {const} */ ('cash'),
  departureId: m.departure.id,
  bookingId: b.id,
  amountKobo,
});

/**
 * The booking's payment chip, with tour-day money on top (designs: "On the manifest
 * afterwards"): cash reported, or paid by link and waiting for the server to confirm.
 * @param {any} b  a booking (with the outbox applied: outbox.js)
 * @returns {{ text: string, tone: 'paid' | 'owes' | 'cash' | 'no_show' }}
 */
export function payChip(b) {
  if (b.status === 'no_show') return { text: 'No-show', tone: 'no_show' };
  if (b.money.owedKobo <= 0) return { text: 'Paid', tone: 'paid' };
  if (b.paidByLink) return { text: 'Paid by link · confirming', tone: 'paid' };
  if (b.cashReportedKobo > 0) {
    return {
      text: `Cash ${formatNaira(b.cashReportedKobo)} reported · office to confirm`,
      tone: 'cash',
    };
  }
  return { text: b.money.label, tone: 'owes' };
}

/**
 * "Femi’s cash today: ₦45,500 from 1 booking · hand in to the office" (on Today), from the
 * package's cash not yet confirmed and this phone's unsent cash.
 * @param {any} pkg  (with the outbox applied) @param {any[]} outbox
 */
export function cashToday(pkg, outbox) {
  /** @type {Map<string, number>} */
  const byBooking = new Map();
  for (const c of pkg?.myCash ?? []) {
    if (c.status === 'reported')
      byBooking.set(c.bookingId, (byBooking.get(c.bookingId) ?? 0) + c.amountKobo);
  }
  for (const c of outbox) {
    if (c.kind === 'cash')
      byBooking.set(c.bookingId, (byBooking.get(c.bookingId) ?? 0) + c.amountKobo);
  }
  const total = [...byBooking.values()].reduce((n, k) => n + k, 0);
  if (total === 0) return null;
  const n = byBooking.size;
  return `${formatNaira(total)} from ${n} ${n === 1 ? 'booking' : 'bookings'} · hand in to the office`;
}

/**
 * A QR code for a URL, as the squares to draw: true = dark. With a quiet border around it, so
 * a phone camera finds it easily.
 * @param {string} url
 * @returns {boolean[][]}
 */
export function qrSquares(url) {
  return encode(url, { border: 2, ecc: 'M' }).data;
}
