// @ts-check
/**
 * booking-lifecycle.js — the ONE place a booking's status changes (BKG-23).
 *
 * The PRD says: "allowed transitions enforced in one place and a timeline on every booking".
 * transitionBookingInTx() is that place. Every status change in the codebase (confirming,
 * paying, expiring, cancelling, completing…) calls it, and it:
 *
 *   1. checks the move is allowed by the state machine (packages/shared/src/booking-status.js)
 *   2. changes the status with  UPDATE … WHERE id = $1 AND status = <what we just read>
 *      If another request changed the booking in between (two staff clicking at once),
 *      that UPDATE matches no row and we stop with CONCURRENT_CHANGE instead of
 *      overwriting their change. This is "optimistic concurrency".
 *   3. appends a BookingEvent to the timeline: who, when, from → to, and why
 *
 * It takes a transaction (`tx`), so the status change, the event, and whatever else the
 * caller is doing (moving seats, recording a payment) commit together or not at all.
 */
import { canTransition } from '@okapigo/shared/booking-status';

/** A booking action that isn't allowed right now, with a code (the API sends 409). */
export class BookingError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/**
 * @typedef {{ type: 'user', userId: string } | { type: 'guest' } | { type: 'system' }} Actor
 */

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ bookingId: string, to: string, actor: Actor, data?: Record<string, unknown> }} input
 */
export async function transitionBookingInTx(tx, { bookingId, to, actor, data = {} }) {
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const from = booking.status;

  if (!canTransition(from, to)) {
    throw new BookingError(
      'INVALID_TRANSITION',
      `A booking that is "${from}" can't become "${to}".`,
      { from, to },
    );
  }

  const { count } = await tx.booking.updateMany({
    where: { id: bookingId, status: from },
    data: { status: to },
  });
  if (count === 0) {
    throw new BookingError(
      'CONCURRENT_CHANGE',
      'This booking was changed by someone else just now. Refresh and try again.',
    );
  }

  await tx.bookingEvent.create({
    data: {
      operatorId: booking.operatorId,
      bookingId,
      type: 'status_changed',
      fromStatus: from,
      toStatus: to,
      actorType: actor.type,
      actorUserId: actor.type === 'user' ? actor.userId : null,
      data: /** @type {any} */ (data),
    },
  });

  return { ...booking, status: to };
}
