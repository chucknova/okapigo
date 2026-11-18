// @ts-check
/**
 * trip-hub.js — what the trip hub should say RIGHT NOW about a booking (GST-04, stage 12f).
 *
 * The page is opened on the day, outdoors, often from a copy saved on the phone the night
 * before. So the "which banner?" decision can't be made once by the server: it has to be
 * re-made from the saved data and the phone's clock ("upcoming" last night is "today" this
 * morning). That's why it's a PURE function here, shared, rather than a field in the API:
 *
 *   tripSituation(booking, now) → {
 *     phase:      not_booked · upcoming · today · after · no_show · cancelled
 *     daysToGo:   whole calendar days until the trip, in the OPERATOR's time zone
 *     balance:    { amountKobo, dueDate, overdue } while a deposit's balance is owed
 *     cancelNow:  what cancelling now would give back (upcoming only: on the day, guests
 *                 contact the operator instead, as the design says)
 *     cancelled:  { by, on, reason, refundKobo, refunded } once cancelled
 *   }
 *
 * The page turns this into words; the rules (policy tiers, deposits, the 7-day balance) stay
 * in cancellation.js and deposits.js, so every channel gets the same answer.
 */
import { computeRefund } from './cancellation.js';
import { localDate, stringToDate } from './time.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * @typedef {{
 *   status: string,
 *   operator: { timeZone: string },
 *   departure: { startsAt: string, endsAt: string, localDate: string },
 *   amountPaidKobo: number,
 *   depositPaidKobo: number,
 *   balanceKobo: number,
 *   balanceDueDate: string | null,
 *   cancellationPolicy: import('./cancellation.js').Policy | null,
 *   cancellation: { at: string, by: 'guest' | 'operator', reason: string | null, refundKobo: number } | null,
 *   refunds: Array<{ amountKobo: number, processedAt: string }>,
 * }} TripBooking
 */

/** Calendar days from one local date to another ("2026-12-05" − "2026-11-17" = 18). */
const daysBetween = (/** @type {string} */ from, /** @type {string} */ to) =>
  Math.round((stringToDate(to).getTime() - stringToDate(from).getTime()) / DAY_MS);

/**
 * @param {TripBooking} b
 * @param {Date} now
 */
export function tripSituation(b, now) {
  const tz = b.operator.timeZone;
  const today = localDate(now, tz);
  const daysToGo = daysBetween(today, b.departure.localDate);
  const startsAt = new Date(b.departure.startsAt);
  const endsAt = new Date(b.departure.endsAt);

  /** @type {'not_booked' | 'upcoming' | 'today' | 'after' | 'no_show' | 'cancelled'} */
  let phase;
  if (b.status === 'cancelled' || b.status === 'refunded') phase = 'cancelled';
  else if (b.status === 'held') phase = 'not_booked';
  else if (b.status === 'no_show') phase = 'no_show';
  else if (b.status === 'completed' || now >= endsAt) phase = 'after';
  else if (daysToGo <= 0) phase = 'today';
  else phase = 'upcoming';

  // The balance of a deposit booking. Overdue the day AFTER its due date (due "by" that day).
  const owing = phase === 'upcoming' || phase === 'today';
  const balance =
    owing && b.balanceKobo > 0 && b.balanceDueDate
      ? { amountKobo: b.balanceKobo, dueDate: b.balanceDueDate, overdue: today > b.balanceDueDate }
      : null;

  return {
    phase,
    daysToGo,
    balance,
    cancelNow: phase === 'upcoming' ? cancelNow(b, startsAt, now) : null,
    cancelled: phase === 'cancelled' ? cancelledFacts(b, tz) : null,
  };
}

/**
 * What a guest cancelling now would get back, and until when that holds.
 * @param {TripBooking} b
 * @param {Date} startsAt
 * @param {Date} now
 */
function cancelNow(b, startsAt, now) {
  if (!b.cancellationPolicy || b.amountPaidKobo <= 0) return null;
  const refund = computeRefund({
    policy: b.cancellationPolicy,
    amountPaidKobo: b.amountPaidKobo,
    depositKobo: b.depositPaidKobo,
    departureStartsAt: startsAt,
    at: now,
    kind: 'cancel',
    initiatedBy: 'guest',
  });
  // The current tier ends `hoursBefore` hours before the start ("full refund until Thu 3 Dec,
  // 09:00"). The last tier (0 hours) has no end before the trip.
  const tierEndsMs =
    refund.rule && refund.rule.hoursBefore > 0
      ? startsAt.getTime() - refund.rule.hoursBefore * HOUR_MS
      : null;
  return {
    refundKobo: refund.refundKobo,
    basisPoints: refund.refundBasisPoints,
    keptDepositKobo: refund.keptDepositKobo,
    until: tierEndsMs === null ? null : new Date(tierEndsMs).toISOString(),
  };
}

/**
 * @param {TripBooking} b
 * @param {string} tz
 */
function cancelledFacts(b, tz) {
  const c = b.cancellation;
  const refundedKobo = b.refunds.reduce((sum, r) => sum + r.amountKobo, 0);
  const lastRefund = b.refunds
    .map((r) => r.processedAt)
    .sort()
    .at(-1);
  return {
    by: c?.by ?? 'operator',
    on: c ? localDate(new Date(c.at), tz) : null,
    reason: c?.reason ?? null,
    refundKobo: c?.refundKobo ?? 0,
    // Money actually back with the guest (the provider confirmed it left).
    refunded:
      refundedKobo > 0 && lastRefund
        ? {
            amountKobo: refundedKobo,
            on: localDate(new Date(lastRefund), tz),
            // "(50%)" when it's part of what was paid; null for everything back.
            percent:
              refundedKobo < b.amountPaidKobo
                ? Math.round((refundedKobo / b.amountPaidKobo) * 100)
                : null,
          }
        : null,
  };
}
