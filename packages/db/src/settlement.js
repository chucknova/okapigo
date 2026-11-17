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
import { canTransitionPayment, generatePaymentReference } from '@okapigo/shared/payment-status';
import { postTransaction } from './ledger.js';
import { transitionBookingInTx } from './booking-lifecycle.js';
import { secureBookingInTx } from './bookings.js';
import { releaseHoldInTx } from './holds.js';
import { BookingError } from './booking-lifecycle.js';
import { payableBalance } from './payments.js';

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
  if (event.eventType !== 'charge.success') {
    return { status: 'ignored', outcome: 'UNHANDLED_EVENT_TYPE' };
  }

  const data = /** @type {any} */ (event.payload)?.data ?? {};
  const reference = data.reference;
  const payment =
    typeof reference === 'string'
      ? await prisma.payment.findUnique({ where: { reference } })
      : null;

  // --- Money with a reference we never issued (stage 10d) ------------------------------
  // e.g. a transfer straight to the operator's account. If the event says which operator
  // it's for, record it as an UNMATCHED RECEIPT for staff to match; otherwise it isn't
  // ours (e.g. a smoke-test charge) and is ignored.
  if (!payment) {
    const operatorId =
      typeof data.metadata?.operatorId === 'string' ? data.metadata.operatorId : null;
    const operator =
      operatorId && /^[0-9a-f-]{36}$/.test(operatorId)
        ? await prisma.operator.findUnique({ where: { id: operatorId }, select: { id: true } })
        : null;
    if (!operator || typeof reference !== 'string')
      return { status: 'ignored', outcome: 'UNKNOWN_REFERENCE' };

    const verified = await provider.verifyTransaction(reference);
    if (verified.status !== 'succeeded') {
      return { status: 'needs_review', outcome: `PROVIDER_SAYS_${verified.status.toUpperCase()}` };
    }
    if (verified.currency !== 'NGN')
      return { status: 'needs_review', outcome: 'UNSUPPORTED_CURRENCY' };
    return prisma.$transaction(async (tx) => {
      const recorded = await recordUnmatchedReceiptInTx(tx, provider, {
        operatorId: operator.id,
        verified,
        suggestedBookingId: null,
        reviewReason: 'UNMATCHED_RECEIPT',
        now,
      });
      return {
        status: 'needs_review',
        outcome: recorded ? 'UNMATCHED_RECEIPT' : 'ALREADY_RECORDED',
      };
    }, TX_OPTIONS);
  }

  if (payment.status === 'succeeded') return { status: 'processed', outcome: 'ALREADY_SETTLED' };

  // Ask the source of truth (outside any DB transaction: this is a network call).
  const verified = await provider.verifyTransaction(reference);
  if (verified.status !== 'succeeded') {
    // A signed charge.success that Paystack itself doesn't confirm: don't guess. A human looks.
    return { status: 'needs_review', outcome: `PROVIDER_SAYS_${verified.status.toUpperCase()}` };
  }
  if (verified.currency !== payment.currency) {
    // Another currency can't go into a naira ledger. Nothing is recorded; a human decides.
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        reviewReason: `CURRENCY_MISMATCH: expected ${payment.currency}, got ${verified.currency}`,
      },
    });
    return { status: 'needs_review', outcome: 'CURRENCY_MISMATCH' };
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

    // --- The wrong amount arrived (stage 10d) --------------------------------------------
    // Common with transfers (a typo, bank charges taken off). The money is real, so record it,
    // but as an UNMATCHED RECEIPT "probably for" this booking. Staff decide: apply it (the
    // booking becomes part-paid or paid) or refund it. This attempt is closed as failed.
    if (verified.amountKobo !== payment.amountKobo) {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'failed',
          failureReason: `AMOUNT_MISMATCH: expected ${payment.amountKobo}, received ${verified.amountKobo}`,
          providerTransactionId: verified.providerTransactionId,
        },
      });
      const recorded = await recordUnmatchedReceiptInTx(tx, provider, {
        operatorId: payment.operatorId,
        verified,
        suggestedBookingId: payment.bookingId,
        reviewReason: 'AMOUNT_MISMATCH',
        now,
      });
      return {
        status: 'needs_review',
        outcome: recorded ? 'AMOUNT_MISMATCH_UNMATCHED' : 'ALREADY_RECORDED',
      };
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
    if (payment.paymentLinkId) {
      // The link has done its job (PAY-05).
      await tx.paymentLink.updateMany({
        where: { id: payment.paymentLinkId, status: 'active' },
        data: { status: 'paid' },
      });
    }

    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: /** @type {string} */ (payment.bookingId) },
    });

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
    await postFee(
      tx,
      provider,
      payment.operatorId,
      payment.id,
      payment.reference,
      verified,
      booking.id,
      now,
    );

    const review = await settleBooking(tx, booking, payment, now);
    if (review) {
      await tx.payment.update({ where: { id: payment.id }, data: { reviewReason: review } });
      return { status: 'needs_review', outcome: review };
    }
    return { status: 'processed', outcome: 'SETTLED' };
  }, TX_OPTIONS);
}

/**
 * Posts the provider's fee for a payment (if any) to the ledger.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ name: string }} provider
 * @param {string} operatorId
 * @param {string} paymentId
 * @param {string} reference
 * @param {{ feeKobo: number | null, paidAt: Date | null }} verified
 * @param {string | null} bookingId
 * @param {Date} now
 */
async function postFee(tx, provider, operatorId, paymentId, reference, verified, bookingId, now) {
  if (!verified.feeKobo || verified.feeKobo <= 0) return;
  await postTransaction(tx, {
    operatorId,
    type: 'payment_fee',
    idempotencyKey: `payment-fee:${paymentId}`,
    description: `${provider.name === 'paystack' ? 'Paystack' : 'Simulator'} fee on ${reference}`,
    lines: POSTINGS.paymentFee(verified.feeKobo),
    bookingId,
    paymentId,
    occurredAt: verified.paidAt ?? now,
  });
}

/**
 * Records money that arrived but isn't (yet) matched to a booking: a Payment with no
 * booking, and in the ledger Dr Paystack clearing / Cr Unallocated receipts (+ the fee).
 * Returns false if this provider transaction was already recorded (a duplicate run).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ name: string }} provider
 * @param {{ operatorId: string, verified: any, suggestedBookingId: string | null, reviewReason: string, now: Date }} input
 */
async function recordUnmatchedReceiptInTx(
  tx,
  provider,
  { operatorId, verified, suggestedBookingId, reviewReason, now },
) {
  // Already recorded by an earlier or concurrent run? (The partial unique index on
  // (provider, provider_transaction_id) for unmatched receipts is the backstop.)
  const existing = await tx.payment.findFirst({
    where: {
      provider: provider.name,
      providerTransactionId: verified.providerTransactionId,
      bookingId: null,
    },
  });
  if (existing) return false;

  const receipt = await tx.payment.create({
    data: {
      operatorId,
      bookingId: null,
      provider: provider.name,
      method: verified.channel === 'card' ? 'card' : 'bank_transfer',
      purpose: 'custom',
      amountKobo: verified.amountKobo,
      status: 'succeeded',
      reference: generatePaymentReference(),
      providerTransactionId: verified.providerTransactionId,
      feeKobo: verified.feeKobo,
      paidAt: verified.paidAt ?? now,
      channel: verified.channel,
      reviewReason,
      suggestedBookingId,
    },
  });
  await postTransaction(tx, {
    operatorId,
    type: 'unallocated_receipt',
    idempotencyKey: `unallocated-receipt:${receipt.id}`,
    description: `Unmatched receipt ${receipt.reference} (${reviewReason.replaceAll('_', ' ').toLowerCase()})`,
    lines: POSTINGS.unallocatedReceipt(receipt.amountKobo),
    paymentId: receipt.id,
    occurredAt: receipt.paidAt ?? now,
  });
  await postFee(tx, provider, operatorId, receipt.id, receipt.reference, verified, null, now);
  return true;
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
      // More than owed (possible since stage 10d, when staff match a receipt): the booking is
      // paid, and the EXCESS is owed back. (A test caught this branch missing it.)
      const overpaid = amount > owedBefore;
      if (overpaid) {
        await oweBack(amount - owedBefore, 'OVERPAID'); // also adds `amount` to amount paid
      } else {
        await tx.booking.update({ where: { id: booking.id }, data: { amountPaidKobo: newPaid } });
      }
      await secureBookingInTx(tx, {
        booking,
        to: newPaid >= booking.totalKobo ? 'paid' : 'part_paid',
        actor: SYSTEM,
        now,
        data: { paymentReference: payment.reference, amountKobo: amount },
      });
      return overpaid ? 'OVERPAID' : null;
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

/**
 * MANUAL MATCH (stage 10d, the PRD's "manual match screen as fallback"): a member of staff
 * says "this unmatched receipt belongs to booking X". In one transaction, with the receipt
 * row locked:
 *   - the receipt gets its booking (allocatedAt set)
 *   - ledger: Dr Unallocated receipts / Cr Tour sales (the money becomes a sale)
 *   - the booking is settled with exactly the same rules as a normal payment (settleBooking):
 *     held → paid / part_paid, balances, and any EXCESS is owed back
 * Bookings that can't take money (cancelled, already paid…) are refused: staff refund the
 * receipt instead (stage 10e).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, paymentId: string, bookingId: string, actor: import('./booking-lifecycle.js').Actor, now?: Date }} input
 */
export function allocateReceipt(
  prisma,
  { operatorId, paymentId, bookingId, actor, now = new Date() },
) {
  return prisma.$transaction(async (tx) => {
    /** @type {Array<{ booking_id: string | null, status: string, operator_id: string }>} */
    const [locked] = await tx.$queryRaw`
      SELECT booking_id, status, operator_id FROM payments
       WHERE id = ${paymentId}::uuid AND operator_id = ${operatorId}::uuid FOR UPDATE`;
    if (!locked) throw new BookingError('NOT_FOUND', 'Receipt not found.');
    if (locked.booking_id !== null || locked.status !== 'succeeded') {
      throw new BookingError('ALREADY_ALLOCATED', 'This receipt is already matched to a booking.');
    }

    const booking = await tx.booking.findFirst({
      where: { id: bookingId, operatorId },
      include: { hold: true },
    });
    if (!booking) throw new BookingError('NOT_FOUND', 'Booking not found.');
    payableBalance(booking, now); // throws NOT_PAYABLE / HOLD_EXPIRED / NOTHING_TO_PAY

    const receipt = await tx.payment.update({
      where: { id: paymentId },
      data: { bookingId, allocatedAt: now, reviewReason: null },
    });
    await postTransaction(tx, {
      operatorId,
      type: 'receipt_allocated',
      idempotencyKey: `receipt-allocated:${paymentId}`,
      description: `Receipt ${receipt.reference} matched to ${booking.reference}`,
      lines: POSTINGS.receiptAllocated(receipt.amountKobo),
      bookingId,
      paymentId,
      createdById: actor.type === 'user' ? actor.userId : null,
    });
    await tx.bookingEvent.create({
      data: {
        operatorId,
        bookingId,
        type: 'receipt_allocated',
        actorType: actor.type,
        actorUserId: actor.type === 'user' ? actor.userId : null,
        data: { paymentReference: receipt.reference, amountKobo: receipt.amountKobo },
      },
    });

    const review = await settleBooking(tx, booking, receipt, now);
    return { receipt, review };
  }, TX_OPTIONS);
}
