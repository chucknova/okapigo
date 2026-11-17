// @ts-check
/**
 * settlement.js — turning a "charge.success" webhook into money in the books (stage 10c).
 *
 * processWebhookEvent(eventId) is what the workers run for each stored event:
 *
 *   1. charge.success? Otherwise mark the event "ignored" (we only act on what we need).
 *   2. Find OUR payment by its reference. Unknown → "ignored" (e.g. a smoke-test charge).
 *   3. Ask the provider directly (verifyTransaction). The signature proved the webhook is
 *      from Paystack; asking again confirms the CURRENT state, amount and currency from the
 *      source, as Paystack recommends. Done OUTSIDE any database transaction (network call).
 *   4. ONE database transaction, with the payment row LOCKED (FOR UPDATE):
 *        - already succeeded? Stop: a duplicate or racing delivery. Nothing happens twice.
 *        - payment → succeeded (paid at, fee, channel, provider id)
 *        - ledger: payment received (+ Paystack fee), idempotent keys per payment
 *        - booking: amount paid goes up, and the booking moves on (see settleBooking)
 *   5. Event → processed / needs_review.
 *
 * Any error is thrown after recording it on the event: the BullMQ job retries with
 * backoff, and when every retry is used up the sweeper and staff can still see it.
 */
import { POSTINGS } from '@okapigo/shared/ledger';
import { canTransitionPayment } from '@okapigo/shared/payment-status';
import { postTransaction } from './ledger.js';
import { transitionBookingInTx } from './booking-lifecycle.js';
import { secureBookingInTx } from './bookings.js';
import { releaseHoldInTx } from './holds.js';

const TX_OPTIONS = { maxWait: 15_000, timeout: 15_000 };
const SYSTEM = /** @type {const} */ ({ type: 'system' });

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ name: string, verifyTransaction: (ref: string) => Promise<any> }} provider
 * @param {string} eventId
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ status: string, outcome: string }>}
 */
export async function processWebhookEvent(prisma, provider, eventId, { now = new Date() } = {}) {
  const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (event.status !== 'received' && event.status !== 'failed') {
    return { status: event.status, outcome: event.outcome ?? '' }; // already handled
  }

  try {
    const result = await handle(prisma, provider, event, now);
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: result.status,
        outcome: result.outcome,
        processedAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    return result;
  } catch (err) {
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        attempts: { increment: 1 },
        lastError: String(/** @type {any} */ (err)?.message ?? err).slice(0, 500),
      },
    });
    throw err; // let the job retry
  }
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ name: string, verifyTransaction: (ref: string) => Promise<any> }} provider
 * @param {import('@prisma/client').WebhookEvent} event
 * @param {Date} now
 */
async function handle(prisma, provider, event, now) {
  if (event.eventType !== 'charge.success')
    return { status: 'ignored', outcome: 'UNHANDLED_EVENT_TYPE' };

  const reference = /** @type {any} */ (event.payload)?.data?.reference;
  const payment =
    typeof reference === 'string'
      ? await prisma.payment.findUnique({ where: { reference } })
      : null;
  if (!payment) return { status: 'ignored', outcome: 'UNKNOWN_REFERENCE' };
  if (payment.status === 'succeeded') return { status: 'processed', outcome: 'ALREADY_SETTLED' };

  // Ask the source of truth (outside any DB transaction: this is a network call).
  const verified = await provider.verifyTransaction(reference);
  if (verified.status !== 'succeeded') {
    // A signed charge.success that Paystack itself doesn't confirm: don't guess. A human looks.
    return { status: 'needs_review', outcome: `PROVIDER_SAYS_${verified.status.toUpperCase()}` };
  }
  if (verified.amountKobo !== payment.amountKobo || verified.currency !== payment.currency) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        reviewReason: `AMOUNT_MISMATCH: expected ${payment.amountKobo} ${payment.currency}, got ${verified.amountKobo} ${verified.currency}`,
      },
    });
    return { status: 'needs_review', outcome: 'AMOUNT_MISMATCH' };
  }

  return prisma.$transaction(async (tx) => {
    // LOCK the payment. A duplicate delivery processed at the same moment waits here, then
    // sees "succeeded" and stops. (Same idea as the hold lock in session 7.)
    /** @type {Array<{ status: string }>} */
    const [locked] =
      await tx.$queryRaw`SELECT status FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
    if (locked.status === 'succeeded') return { status: 'processed', outcome: 'ALREADY_SETTLED' };
    if (!canTransitionPayment(locked.status, 'succeeded')) {
      return { status: 'needs_review', outcome: `PAYMENT_WAS_${locked.status.toUpperCase()}` };
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'succeeded',
        paidAt: verified.paidAt ?? now,
        feeKobo: verified.feeKobo,
        channel: verified.channel,
        providerTransactionId: verified.providerTransactionId,
      },
    });

    const booking = await tx.booking.findUniqueOrThrow({ where: { id: payment.bookingId } });

    // The books: the money arrived, and the provider kept its fee.
    await postTransaction(tx, {
      operatorId: payment.operatorId,
      type: 'payment_received',
      idempotencyKey: `payment-received:${payment.id}`,
      description: `Payment ${payment.reference} for ${booking.reference}`,
      lines: POSTINGS.paymentReceived(payment.amountKobo),
      bookingId: booking.id,
      paymentId: payment.id,
      occurredAt: verified.paidAt ?? now,
    });
    if (verified.feeKobo && verified.feeKobo > 0) {
      await postTransaction(tx, {
        operatorId: payment.operatorId,
        type: 'payment_fee',
        idempotencyKey: `payment-fee:${payment.id}`,
        description: `${provider.name === 'paystack' ? 'Paystack' : 'Simulator'} fee on ${payment.reference}`,
        lines: POSTINGS.paymentFee(verified.feeKobo),
        bookingId: booking.id,
        paymentId: payment.id,
        occurredAt: verified.paidAt ?? now,
      });
    }

    const review = await settleBooking(tx, booking, payment, now);
    if (review) {
      await tx.payment.update({ where: { id: payment.id }, data: { reviewReason: review } });
      return { status: 'needs_review', outcome: review };
    }
    return { status: 'processed', outcome: 'SETTLED' };
  }, TX_OPTIONS);
}

/**
 * Applies a successful payment to its booking. Returns a review reason when a person must
 * look at it, or null when everything settled normally.
 *
 *   held, hold still valid      → convert the hold (seats held → sold), paid / part_paid
 *   held, hold already expired  → LATE PAYMENT (below)
 *   confirmed / part_paid / amended → paid / part_paid (seats were already sold)
 *   cancelled, no-show, completed, refunded, or already paid → the money isn't needed:
 *                                  full refund owed, flagged
 *
 * LATE PAYMENT: the guest paid after their hold ran out. The seats may have been sold to
 * someone else since, so we must NOT take them back (that's how overselling happens).
 * Instead: record the money honestly, owe it all back (refund owed, paid out in 10e), and
 * flag it. Staff can rebook the guest by hand if seats are still free.
 *
 * Overpayment (more than the balance): settle what's owed; the excess is owed back.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {import('@prisma/client').Booking} booking
 * @param {import('@prisma/client').Payment} payment
 * @param {Date} now
 * @returns {Promise<string | null>}
 */
async function settleBooking(tx, booking, payment, now) {
  const amount = payment.amountKobo;
  const newPaid = booking.amountPaidKobo + amount;
  const owedBefore = booking.totalKobo - booking.amountPaidKobo;

  /** Money we must give back: raise refund due and post "refund owed" to the ledger. */
  async function oweBack(kobo, why) {
    await tx.booking.update({
      where: { id: booking.id },
      data: { amountPaidKobo: { increment: amount }, refundDueKobo: { increment: kobo } },
    });
    await postTransaction(tx, {
      operatorId: booking.operatorId,
      type: 'refund_owed',
      idempotencyKey: `refund-owed:${why}:${payment.id}`,
      description: `Refund owed for ${booking.reference}: ${why.replaceAll('_', ' ').toLowerCase()}`,
      lines: POSTINGS.refundOwed(kobo),
      bookingId: booking.id,
      paymentId: payment.id,
    });
    await tx.bookingEvent.create({
      data: {
        operatorId: booking.operatorId,
        bookingId: booking.id,
        type: 'payment_needs_review',
        actorType: 'system',
        data: {
          reason: why,
          paymentReference: payment.reference,
          amountKobo: amount,
          refundOwedKobo: kobo,
        },
      },
    });
  }

  // --- A held booking: secure it, unless the hold has run out --------------------------
  if (booking.status === 'held') {
    const hold = await tx.hold.findUniqueOrThrow({ where: { id: booking.holdId } });
    const holdValid = hold.status === 'active' && hold.expiresAt > now;
    if (holdValid) {
      await tx.booking.update({ where: { id: booking.id }, data: { amountPaidKobo: newPaid } });
      await secureBookingInTx(tx, {
        booking,
        to: newPaid >= booking.totalKobo ? 'paid' : 'part_paid',
        actor: SYSTEM,
        now,
        data: { paymentReference: payment.reference, amountKobo: amount },
      });
      return null;
    }
    // Hold expired, but the expiry job hasn't run yet: run it now, so seats and booking
    // agree (the booking becomes "cancelled", reason hold_expired), then treat as late.
    if (hold.status === 'active') await releaseHoldInTx(tx, hold.id, { reason: 'expired', now });
    await oweBack(amount, 'HOLD_EXPIRED_BEFORE_PAYMENT');
    return 'HOLD_EXPIRED_BEFORE_PAYMENT';
  }

  // --- Seats already sold, money still owed --------------------------------------------
  if (['confirmed', 'part_paid', 'amended'].includes(booking.status) && owedBefore > 0) {
    const applied = Math.min(amount, owedBefore);
    const to = booking.amountPaidKobo + applied >= booking.totalKobo ? 'paid' : 'part_paid';
    if (amount > owedBefore) {
      await oweBack(amount - owedBefore, 'OVERPAID');
    } else {
      await tx.booking.update({ where: { id: booking.id }, data: { amountPaidKobo: newPaid } });
    }
    if (to !== booking.status) {
      await transitionBookingInTx(tx, {
        bookingId: booking.id,
        to,
        actor: SYSTEM,
        data: { paymentReference: payment.reference },
      });
    }
    return amount > owedBefore ? 'OVERPAID' : null;
  }

  // --- Nothing owed, or the booking is over / cancelled: give it all back ---------------
  const why = booking.status === 'cancelled' ? 'BOOKING_CANCELLED_BEFORE_PAYMENT' : 'NOTHING_OWED';
  await oweBack(amount, why);
  return why;
}

/**
 * The webhook SWEEPER (every minute): processes stored events whose job never ran or kept
 * failing, e.g. Redis was down when the webhook arrived. After `maxAttempts` an event is
 * marked "failed" and left for a human: retrying forever would hide a real problem.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ name: string, verifyTransaction: (ref: string) => Promise<any> }} provider
 * @param {{ olderThanMs?: number, maxAttempts?: number, limit?: number }} [options]
 */
export async function sweepWebhookEvents(
  prisma,
  provider,
  { olderThanMs = 60_000, maxAttempts = 10, limit = 100 } = {},
) {
  const stale = await prisma.webhookEvent.findMany({
    where: { status: 'received', receivedAt: { lt: new Date(Date.now() - olderThanMs) } },
    orderBy: { receivedAt: 'asc' },
    take: limit,
  });
  let processed = 0;
  let gaveUp = 0;
  for (const event of stale) {
    if (event.attempts >= maxAttempts) {
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: 'failed' } });
      gaveUp += 1;
      continue;
    }
    try {
      await processWebhookEvent(prisma, provider, event.id);
      processed += 1;
    } catch {
      // recorded on the event (attempts, lastError); the next sweep tries again
    }
  }
  return { found: stale.length, processed, gaveUp };
}
