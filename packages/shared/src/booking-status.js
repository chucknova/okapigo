// @ts-check
/**
 * booking-status.js — THE booking lifecycle (BKG-23): every status, and every allowed move
 * between them. Defined once; the database code (packages/db/src/bookings.js) refuses any
 * change not listed here, and the apps use the same list to decide which buttons to show.
 *
 *            ┌──────────── payment (session 10) ─────────────┐
 *            │                                               ▼
 *   held ──► confirmed ──► part_paid ──► paid ──► completed
 *     │         │  ▲           │  ▲        │
 *     │         │  └─ amended ◄┴──┴────────┤        (a change after confirmation; settles
 *     │         │                          │         back to confirmed/part_paid/paid)
 *     │         ├──► no_show ──────────────┼──► refunded
 *     ▼         ▼                          ▼
 *  cancelled ◄──┴──────────────────────────┘ ──► refunded
 *
 * What each status means:
 *   held       created with a checkout hold; seats HELD, awaiting payment or confirmation
 *   confirmed  seats SOLD, nothing paid yet (staff "pay later", or a ₦0 booking)
 *   part_paid  seats sold, a deposit or part payment received
 *   paid       seats sold, paid in full
 *   amended    changed after confirmation (e.g. date); settles once any difference is paid
 *   cancelled  called off (by guest, operator, or because the hold expired); seats freed
 *   no_show    guest didn't turn up; seats stay sold (the tour ran)
 *   completed  the tour happened
 *   refunded   money returned after a cancellation or no-show (session 10)
 */

export const BOOKING_STATUSES = /** @type {const} */ ([
  'held',
  'confirmed',
  'part_paid',
  'paid',
  'amended',
  'cancelled',
  'no_show',
  'completed',
  'refunded',
]);

/** @typedef {typeof BOOKING_STATUSES[number]} BookingStatus */

/** from → the statuses it may move to. Anything not listed is forbidden. */
export const TRANSITIONS = /** @type {Record<BookingStatus, BookingStatus[]>} */ ({
  held: ['confirmed', 'part_paid', 'paid', 'cancelled'],
  confirmed: ['part_paid', 'paid', 'amended', 'cancelled', 'no_show', 'completed'],
  part_paid: ['paid', 'amended', 'cancelled', 'no_show', 'completed'],
  paid: ['amended', 'cancelled', 'no_show', 'completed'],
  amended: ['confirmed', 'part_paid', 'paid', 'cancelled'],
  cancelled: ['refunded'],
  no_show: ['refunded'],
  completed: [],
  refunded: [],
});

/**
 * Statuses in which the booking's seats are SOLD (counted in departures.seats_sold, and its
 * add-ons count against stock). In `held` the seats are only held (the hold counts them);
 * in `cancelled`/`refunded` they've been given back.
 */
export const SEAT_CONSUMING_STATUSES = /** @type {const} */ ([
  'confirmed',
  'part_paid',
  'paid',
  'amended',
  'no_show',
  'completed',
]);

/** Statuses that are final: nothing can happen afterwards. */
export const FINAL_STATUSES = BOOKING_STATUSES.filter((s) => TRANSITIONS[s].length === 0);

/**
 * @param {string} from
 * @param {string} to
 */
export function canTransition(from, to) {
  return /** @type {readonly string[]} */ (
    TRANSITIONS[/** @type {BookingStatus} */ (from)] ?? []
  ).includes(to);
}
