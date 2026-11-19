// @ts-check
/**
 * cancellations.js — cancelling bookings, marking no-shows and calling off whole
 * departures (BKG-26).
 *
 *   previewCancellation  what WOULD happen (the API shows this before staff confirm)
 *   cancelBooking        one booking, by guest request or the operator
 *   markNoShow           the guest didn't turn up
 *   cancelDeparture      call off a whole departure (weather): every booking, operator-initiated
 *
 * The refund amount comes from the pure engine (packages/shared/src/cancellation.js), fed
 * with the policy VERSION the booking was sold under. Here we only record it as
 * `refundDueKobo`. Actually paying it back is session 10 (Paystack), which then moves the
 * booking from "cancelled" to "refunded".
 *
 * Seats: a cancelled booking gives its seats back (sold → available). A no-show doesn't:
 * the tour ran, and the seat went empty.
 */
import { computeRefund } from '@okapigo/shared/cancellation';
import { localDate } from '@okapigo/shared/time';
import { BookingError, transitionBookingInTx } from './booking-lifecycle.js';
import { releaseHoldInTx } from './holds.js';
import { findOwnBooking } from './bookings.js';
import { postTransaction } from './ledger.js';
import { POSTINGS } from '@okapigo/shared/ledger';

const TX_OPTIONS = { maxWait: 15_000, timeout: 15_000 };

/**
 * Ledger (session 10a): records a refund we now OWE, in the same database transaction as the
 * cancellation (Dr Sales refunds / Cr Refunds payable). The books show the debt to the guest
 * from the moment it arises until it's paid out (stage 10e). The idempotency key is per
 * booking: a booking is cancelled or marked no-show at most once, so its debt is recorded once.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {import('@prisma/client').Booking} booking
 * @param {number} refundKobo
 * @param {string} why
 * @param {Actor} actor
 */
async function postRefundOwed(tx, booking, refundKobo, why, actor) {
  if (refundKobo <= 0) return; // nothing owed, nothing to post
  await postTransaction(tx, {
    operatorId: booking.operatorId,
    type: 'refund_owed',
    idempotencyKey: `refund-owed:${booking.id}`,
    description: `Refund owed for ${booking.reference} (${why})`,
    lines: POSTINGS.refundOwed(refundKobo),
    bookingId: booking.id,
    createdById: actor.type === 'user' ? actor.userId : null,
  });
}

/** Statuses whose seats are sold and which can still be cancelled. */
const CANCELLABLE_SOLD = ['confirmed', 'part_paid', 'paid', 'amended'];

/**
 * @typedef {import('./booking-lifecycle.js').Actor} Actor
 * @typedef {{ initiatedBy: 'guest' | 'operator', reason: string, refundOverrideKobo?: number, now?: Date }} CancelOptions
 */

/**
 * Works out the refund for a booking, without changing anything.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {import('@prisma/client').Booking} booking
 * @param {{ kind: 'cancel' | 'no_show', initiatedBy: 'guest' | 'operator', refundOverrideKobo?: number, now: Date }} opts
 */
async function refundFor(tx, booking, { kind, initiatedBy, refundOverrideKobo, now }) {
  const departure = await tx.departure.findUniqueOrThrow({ where: { id: booking.departureId } });
  const version = booking.policyVersionId
    ? await tx.cancellationPolicyVersion.findUniqueOrThrow({
        where: { id: booking.policyVersionId },
      })
    : null;

  // A booking sold with no policy (older data) can't be decided automatically by guests'
  // rules; the operator path (always a full refund) and a staff override still work.
  if (!version && initiatedBy === 'guest' && refundOverrideKobo === undefined) {
    throw new BookingError(
      'NO_POLICY',
      'This booking has no cancellation policy. Set the refund amount yourself.',
    );
  }

  // The deposit actually PAID (BKG-06): a policy that keeps deposits keeps this much. Until
  // stage 12f this was always 0, so a cancelled Badagry booking would have given its
  // "non-refundable" deposit back. Found while building the trip hub's "you'd get back" line.
  const deposits = await tx.payment.aggregate({
    where: { bookingId: booking.id, purpose: 'deposit', status: 'succeeded' },
    _sum: { amountKobo: true },
  });

  const result = computeRefund({
    policy: version
      ? {
          rules: /** @type {any} */ (version.rules),
          noShowRefundBasisPoints: version.noShowRefundBasisPoints,
          depositRefundable: version.depositRefundable,
        }
      : { rules: [], noShowRefundBasisPoints: 0, depositRefundable: false },
    amountPaidKobo: booking.amountPaidKobo,
    depositKobo: deposits._sum.amountKobo ?? 0,
    departureStartsAt: departure.startsAt,
    at: now,
    kind,
    initiatedBy,
  });

  if (refundOverrideKobo !== undefined) {
    if (refundOverrideKobo > booking.amountPaidKobo) {
      throw new BookingError('REFUND_TOO_HIGH', 'A refund can’t be more than what was paid.', {
        amountPaidKobo: booking.amountPaidKobo,
      });
    }
    return {
      ...result,
      policyRefundKobo: result.refundKobo, // kept, so the timeline shows what the policy said
      refundKobo: refundOverrideKobo,
      forfeitedKobo: booking.amountPaidKobo - refundOverrideKobo,
      overridden: true,
    };
  }
  return { ...result, overridden: false, policyVersion: version?.version ?? null };
}

/**
 * Cancels one booking inside the caller's transaction.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {import('@prisma/client').Booking} booking
 * @param {CancelOptions & { actor: Actor, now: Date }} opts
 */
async function cancelBookingInTx(
  tx,
  booking,
  { initiatedBy, reason, refundOverrideKobo, actor, now },
) {
  // Not paid or confirmed yet: just give the held seats back. Nothing to refund.
  if (booking.status === 'held') {
    const released = await releaseHoldInTx(tx, booking.holdId, {
      reason: 'released',
      now,
      actor,
      bookingEventData: { reason, initiatedBy, refundKobo: 0 },
    });
    if (!released) {
      throw new BookingError(
        'INVALID_TRANSITION',
        'This booking is no longer held. Refresh and try again.',
      );
    }
    return { refundKobo: 0, outcome: 'none', reason: 'NOTHING_PAID' };
  }

  if (!CANCELLABLE_SOLD.includes(booking.status)) {
    // Let the state machine produce the standard error (e.g. "completed" can't be cancelled).
    await transitionBookingInTx(tx, { bookingId: booking.id, to: 'cancelled', actor });
  }

  const refund = await refundFor(tx, booking, {
    kind: 'cancel',
    initiatedBy,
    refundOverrideKobo,
    now,
  });

  // Seats go back on sale. (Add-on stock frees itself: "cancelled" isn't a seat-consuming status.)
  const seats = await tx.traveller.count({ where: { bookingId: booking.id } });
  await tx.$executeRaw`
    UPDATE departures SET seats_sold = seats_sold - ${seats}, updated_at = now()
     WHERE id = ${booking.departureId}::uuid`;

  await tx.booking.update({
    where: { id: booking.id },
    data: { refundDueKobo: refund.refundKobo },
  });
  await postRefundOwed(tx, booking, refund.refundKobo, `${initiatedBy} cancellation`, actor);
  await transitionBookingInTx(tx, {
    bookingId: booking.id,
    to: 'cancelled',
    actor,
    data: { reason, initiatedBy, refund },
  });
  return refund;
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, bookingId: string, initiatedBy: 'guest' | 'operator', now?: Date }} input
 */
export function previewCancellation(
  prisma,
  { operatorId, bookingId, initiatedBy, now = new Date() },
) {
  return prisma.$transaction(async (tx) => {
    const booking = await findOwnBooking(tx, operatorId, bookingId);
    if (booking.status === 'held')
      return { refundKobo: 0, forfeitedKobo: 0, outcome: 'none', reason: 'NOTHING_PAID' };
    return refundFor(tx, booking, { kind: 'cancel', initiatedBy, now });
  });
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {CancelOptions & { operatorId: string, bookingId: string, actor: Actor }} input
 */
export function cancelBooking(prisma, { operatorId, bookingId, actor, now = new Date(), ...opts }) {
  return prisma.$transaction(async (tx) => {
    const booking = await findOwnBooking(tx, operatorId, bookingId);
    return cancelBookingInTx(tx, booking, { ...opts, actor, now });
  }, TX_OPTIONS);
}

/**
 * The guest didn't turn up. The no-show rate applies; seats stay sold.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, bookingId: string, actor: Actor, now?: Date }} input
 */
export function markNoShow(prisma, { operatorId, bookingId, actor, now = new Date() }) {
  return prisma.$transaction(
    (tx) => markNoShowInTx(tx, { operatorId, bookingId, actor, now }),
    TX_OPTIONS,
  );
}

/**
 * The same, inside the caller's transaction (the guide's no-show, stage 15b, checks the
 * manifest and marks it under one lock).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ operatorId: string, bookingId: string, actor: Actor, now: Date }} input
 */
export async function markNoShowInTx(tx, { operatorId, bookingId, actor, now }) {
  const booking = await findOwnBooking(tx, operatorId, bookingId);
  const refund =
    booking.status === 'held'
      ? null // the state machine refuses held → no_show just below
      : await refundFor(tx, booking, { kind: 'no_show', initiatedBy: 'guest', now });
  await transitionBookingInTx(tx, {
    bookingId: booking.id,
    to: 'no_show',
    actor,
    data: { refund },
  });
  if (refund) {
    await tx.booking.update({
      where: { id: booking.id },
      data: { refundDueKobo: refund.refundKobo },
    });
    await postRefundOwed(tx, booking, refund.refundKobo, 'no-show', actor);
  }
  return refund;
}

/**
 * Calls off a whole departure (e.g. Tarkwa Bay in bad weather): every booking on it is
 * cancelled as OPERATOR-initiated (full refund of whatever was paid), loose holds are
 * released, and the departure is marked cancelled. All in one transaction, holding the
 * departure's row lock, so no new hold can sneak in halfway through.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, departureId: string, reason: string, actor: Actor, now?: Date }} input
 */
export function cancelDeparture(
  prisma,
  { operatorId, departureId, reason, actor, now = new Date() },
) {
  return prisma.$transaction(async (tx) => {
    /** @type {Array<{ status: string }>} */
    const locked = await tx.$queryRaw`
      SELECT status FROM departures
       WHERE id = ${departureId}::uuid AND operator_id = ${operatorId}::uuid
         FOR UPDATE`;
    if (locked.length === 0) throw new BookingError('NOT_FOUND', 'Departure not found.');
    if (locked[0].status === 'cancelled') {
      throw new BookingError('ALREADY_CANCELLED', 'This departure is already cancelled.');
    }

    const bookings = await tx.booking.findMany({
      where: { departureId, status: { in: ['held', ...CANCELLABLE_SOLD] } },
    });
    let refundsDueKobo = 0;
    for (const booking of bookings) {
      const refund = await cancelBookingInTx(tx, booking, {
        initiatedBy: 'operator',
        reason,
        actor,
        now,
      });
      refundsDueKobo += refund.refundKobo;
    }

    // Holds that never became bookings (e.g. a quote-and-hold from the OTA, session 16).
    const looseHolds = await tx.hold.findMany({ where: { departureId, status: 'active' } });
    for (const hold of looseHolds) await releaseHoldInTx(tx, hold.id, { reason: 'released', now });

    await tx.departure.update({ where: { id: departureId }, data: { status: 'cancelled' } });
    // Telling every guest (WhatsApp/email) arrives with automated messages (OPS-11, session 14).
    return { bookingsCancelled: bookings.length, holdsReleased: looseHolds.length, refundsDueKobo };
  }, TX_OPTIONS);
}

/**
 * A GUEST cancels from the trip hub (journey 4, stage 12f-2). The same cancellation as staff
 * use, with the guest's rules on top:
 *   - not on the day of the trip or after it: then they contact the operator (designs: "Cancel
 *     is hidden on the day"). Decided in the OPERATOR's time zone, like the page.
 *   - the refund must still be what the guest was SHOWN (`expectRefundKobo`). The policy tier
 *     can change between reading the screen and tapping (48 h passes at 09:00): then nothing
 *     is cancelled and the guest sees the new amount first (REFUND_CHANGED).
 * Paying the refund out is the caller's next step (requestBookingRefund, outside this
 * transaction, because it calls the provider).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ bookingId: string, expectRefundKobo: number, now?: Date }} input
 */
export function guestCancelBooking(prisma, { bookingId, expectRefundKobo, now = new Date() }) {
  return prisma.$transaction(async (tx) => {
    // Lock the booking: two taps (or two tabs) can't both cancel it.
    /** @type {Array<{ id: string }>} */
    const locked =
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new BookingError('NOT_FOUND', 'Booking not found.');
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { departure: true, product: { include: { operator: true } } },
    });
    if (!CANCELLABLE_SOLD.includes(booking.status)) {
      throw new BookingError('NOT_CANCELLABLE', 'This booking can’t be cancelled any more.');
    }
    const tz = booking.product.operator.timeZone;
    if (localDate(now, tz) >= localDate(booking.departure.startsAt, tz)) {
      throw new BookingError(
        'TOO_LATE_TO_CANCEL',
        `On the day of the trip, please contact ${booking.product.operator.name}.`,
      );
    }
    const preview = await refundFor(tx, booking, { kind: 'cancel', initiatedBy: 'guest', now });
    if (preview.refundKobo !== expectRefundKobo) {
      throw new BookingError('REFUND_CHANGED', 'The refund has changed. Please check it again.', {
        refundKobo: preview.refundKobo,
      });
    }
    return cancelBookingInTx(tx, booking, {
      initiatedBy: 'guest',
      reason: 'Cancelled by the guest on the trip page',
      actor: { type: 'guest' },
      now,
    });
  }, TX_OPTIONS);
}
