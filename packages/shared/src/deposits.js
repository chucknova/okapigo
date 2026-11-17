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

/** Balance reminders go out this many days before the due date (decided 2026-11-17). */
export const BALANCE_REMINDER_DAYS = /** @type {const} */ ([7, 3, 1]);

/**
 * Which balance notice a booking that still owes money should have by today, if any.
 * The daily job (stage 11d) asks this for every such booking.
 *
 *   due Sat 28 Nov (trip Sat 5 Dec), booked 10 Nov:
 *     today 21 Nov → { kind: 'reminder', daysBefore: 7 }
 *     today 25 Nov → { kind: 'reminder', daysBefore: 3 }
 *     today 27 Nov → { kind: 'reminder', daysBefore: 1 }
 *     today 29 Nov → { kind: 'overdue' }       (staff are alerted; nothing is cancelled)
 *     today  5 Dec → null                      (trip day: too late for notices to help)
 *
 * It answers with the TIGHTEST milestone reached, not "exactly 7, 3 or 1 days to go". So a
 * day the job didn't run (worker down) is caught up the next day, and the caller's
 * "at most once per milestone" rule (a unique key) stops repeats. Milestones that had
 * already passed when the guest BOOKED are skipped: someone who books 2 days before the due
 * date shouldn't get a "7 days left" reminder.
 *
 * @param {{ departureLocalDate: string, bookedLocalDate: string, todayLocalDate: string }} input
 * @returns {{ kind: 'reminder', daysBefore: number } | { kind: 'overdue' } | null}
 */
export function balanceNotice({ departureLocalDate, bookedLocalDate, todayLocalDate }) {
  if (todayLocalDate >= departureLocalDate) return null;
  const dueDate = balanceDueDate(departureLocalDate);
  if (todayLocalDate > dueDate) return { kind: 'overdue' };

  // Tightest first: 1 day, then 3, then 7.
  for (const days of [...BALANCE_REMINDER_DAYS].sort((a, b) => a - b)) {
    const milestone = addDays(dueDate, -days);
    if (todayLocalDate < milestone) continue; // not reached yet; try a wider one
    // Reached. If the booking is newer than this milestone, it's newer than the wider ones
    // too (they're earlier), so there's nothing to send.
    return bookedLocalDate < milestone ? { kind: 'reminder', daysBefore: days } : null;
  }
  return null; // more than 7 days to go
}
