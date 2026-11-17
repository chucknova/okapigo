// @ts-check
/**
 * deposits.js — "pay a deposit now and the balance by a date" (BKG-06, stage 11c).
 *
 * The rules (decided 2026-11-17):
 *   - a tour may allow a deposit, as a percentage of the total (Badagry: 30%)
 *   - the BALANCE is due 7 days before the trip (by the end of that day, Lagos time)
 *   - a guest booking LATER than that isn't offered a deposit: they pay in full
 *   - an unpaid balance alerts staff; nothing is cancelled automatically (stage 11d)
 *
 * Pure functions, like pricing.js: the checkout, the trip hub, the reminders and the staff
 * app all get the same answer for the same booking.
 *
 * Dates are LOCAL calendar dates ('YYYY-MM-DD' in the operator's time zone), because "due by
 * Sat 28 Nov" is a date to a person, not an instant.
 */
import { addDays } from './time.js';
import { divideRoundToNaira } from './pricing.js';

/** The balance is due this many days before the departure's date. */
export const BALANCE_DUE_DAYS_BEFORE = 7;

/**
 * The date a deposit booking's balance is due: 7 days before the trip.
 *   balanceDueDate('2026-12-05') → '2026-11-28'
 * @param {string} departureLocalDate
 */
export function balanceDueDate(departureLocalDate) {
  return addDays(departureLocalDate, -BALANCE_DUE_DAYS_BEFORE);
}

/**
 * What a guest may pay as a deposit right now, or null if a deposit isn't on offer.
 *
 *   depositOffer({ totalKobo: 6_500_000, depositBasisPoints: 3000,
 *                  departureLocalDate: '2026-12-05', todayLocalDate: '2026-11-17' })
 *   → { depositKobo: 1_950_000, balanceKobo: 4_550_000, balanceDueDate: '2026-11-28' }
 *
 * No deposit when:
 *   - the tour doesn't allow one (depositBasisPoints null)
 *   - something has already been paid (the deposit, if any, is behind us)
 *   - it's the due date or later: the balance would be due immediately, so pay in full
 *   - rounding leaves nothing to split (a tiny total)
 * The deposit is rounded to whole naira (half up), like every percentage in pricing.js.
 *
 * @param {{
 *   totalKobo: number,
 *   amountPaidKobo?: number,
 *   depositBasisPoints: number | null,
 *   departureLocalDate: string,
 *   todayLocalDate: string,
 * }} input
 * @returns {{ depositKobo: number, balanceKobo: number, balanceDueDate: string } | null}
 */
export function depositOffer({
  totalKobo,
  amountPaidKobo = 0,
  depositBasisPoints,
  departureLocalDate,
  todayLocalDate,
}) {
  if (depositBasisPoints === null || amountPaidKobo > 0) return null;
  const dueDate = balanceDueDate(departureLocalDate);
  // 'YYYY-MM-DD' strings compare correctly as text.
  if (todayLocalDate >= dueDate) return null;
  const depositKobo = divideRoundToNaira(totalKobo * depositBasisPoints, 10_000);
  if (depositKobo <= 0 || depositKobo >= totalKobo) return null;
  return { depositKobo, balanceKobo: totalKobo - depositKobo, balanceDueDate: dueDate };
}
