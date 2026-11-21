// @ts-check
/**
 * refunds.js — sending money back (PAY-08, stage 10e).
 *
 *   requestBookingRefund   pay out what a booking is owed (or a staff-chosen amount)
 *   requestReceiptRefund   send an unmatched receipt back to whoever sent it
 *   markRefundProcessed    the provider confirms the money LEFT: write the ledger
 *   markRefundFailed       the provider couldn't do it: free the amount to try again
 *
 * "Refunds to the original method": a provider refund is tied to ONE transaction. A booking
 * paid in parts (deposit + balance) has several, so a refund is SPLIT across them, newest
 * first, never taking more from a payment than it brought in (payments.refunded_kobo, with a
 * CHECK constraint as the backstop).
 *
 * Same shape as startPayment (10b):
 *   1. a short transaction, booking/receipt row LOCKED: decide, and RECORD the refund rows
 *   2. no transaction: ask the provider
 *   3. short updates: save the provider's refund id, or mark failed
 * The ledger is written only when the money actually leaves (markRefundProcessed), because
 * "we asked Paystack" is not "the guest has their money".
 */
import { percentOf } from '@okapigo/shared/pricing';
import { planGuestMessage } from './guest-messages.js';
import { POSTINGS } from '@okapigo/shared/ledger';
import { formatNaira } from '@okapigo/shared/money';
import { BookingError, transitionBookingInTx } from './booking-lifecycle.js';
import { postTransaction } from './ledger.js';

const TX_OPTIONS = { maxWait: 15_000, timeout: 15_000 };
/** Bookings that become "refunded" once everything owed has been paid back. */
const REFUNDABLE_END_STATES = ['cancelled', 'no_show'];

/**
 * @typedef {import('./booking-lifecycle.js').Actor} Actor
 * @typedef {{ name: string, refund: Function, fetchRefund: Function }} Provider
 */

/**
 * Sends recorded refunds to the provider (step 2), then saves the outcome (step 3).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Provider} provider
 * @param {Array<import('@prisma/client').Refund & { payment: import('@prisma/client').Payment }>} refunds
 * @param {string} note
 */
async function sendToProvider(prisma, provider, refunds, note) {
  const results = [];
  for (const refund of refunds) {
    try {
      const sent = await provider.refund({
        transaction: /** @type {string} */ (refund.payment.providerTransactionId),
        amountKobo: refund.amountKobo,
        note,
      });
      await prisma.refund.update({
        where: { id: refund.id },
        data: { status: 'pending', providerRefundId: sent.providerRefundId },
      });
      if (sent.status === 'processed') await markRefundProcessed(prisma, refund.id);
      if (sent.status === 'failed')
        await markRefundFailed(prisma, refund.id, 'Refused by the provider');
    } catch (err) {
      await markRefundFailed(
        prisma,
        refund.id,
        String(/** @type {any} */ (err)?.message ?? err).slice(0, 300),
      );
    }
    results.push(await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } }));
  }
  return results;
}

/**
 * Refunds a booking: by default exactly what it's still owed (refundDueKobo minus refunds
 * already under way). Staff may choose a different amount (PAY-08 "set by the policy or by
 * staff"); anything ABOVE what's owed is first recorded as owed, so the books stay consistent:
 *   extra owed:  Dr Sales refunds / Cr Refunds payable
 *   (later) paid: Dr Refunds payable / Cr Paystack clearing
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Provider} provider
 * @param {{ operatorId: string, bookingId: string, amountKobo?: number, reason: string, actor: Actor, now?: Date }} input
 */
export async function requestBookingRefund(
  prisma,
  provider,
  { operatorId, bookingId, amountKobo, reason, actor, now = new Date() },
) {
  const { refunds, booking } = await prisma.$transaction(async (tx) => {
    /** @type {Array<{ id: string }>} */
    const locked = await tx.$queryRaw`
      SELECT id FROM bookings WHERE id = ${bookingId}::uuid AND operator_id = ${operatorId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new BookingError('NOT_FOUND', 'Booking not found.');
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });

    // What can still go back: each succeeded payment, minus what's already being refunded.
    const payments = await tx.payment.findMany({
      where: { bookingId, status: 'succeeded', providerTransactionId: { not: null } },
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
    });
    const refundable = payments.reduce((sum, p) => sum + (p.amountKobo - p.refundedKobo), 0);
    const underWay =
      (
        await tx.refund.aggregate({
          where: { bookingId, status: { not: 'failed' } },
          _sum: { amountKobo: true },
        })
      )._sum.amountKobo ?? 0;
    const stillOwed = Math.max(booking.refundDueKobo - underWay, 0);

    const amount = amountKobo ?? stillOwed;
    if (amount <= 0)
      throw new BookingError('NOTHING_TO_REFUND', 'Nothing is owed back on this booking.');
    if (amount > refundable) {
      throw new BookingError(
        'REFUND_TOO_HIGH',
        `At most ${formatNaira(refundable)} can be refunded.`,
        { refundableKobo: refundable },
      );
    }

    // A staff refund beyond what the policy owes: record the extra debt first.
    const extra = amount - stillOwed;
    if (extra > 0) {
      await tx.booking.update({
        where: { id: bookingId },
        data: { refundDueKobo: { increment: extra } },
      });
      await postTransaction(tx, {
        operatorId,
        type: 'refund_owed',
        idempotencyKey: `refund-owed:staff:${bookingId}:${now.getTime()}`,
        description: `Extra refund agreed for ${booking.reference}: ${reason}`,
        lines: POSTINGS.refundOwed(extra),
        bookingId,
        createdById: actor.type === 'user' ? actor.userId : null,
      });
    }

    // Split across the payments, newest first.
    const created = [];
    let remaining = amount;
    for (const payment of payments) {
      if (remaining === 0) break;
      const take = Math.min(remaining, payment.amountKobo - payment.refundedKobo);
      if (take <= 0) continue;
      await tx.payment.update({
        where: { id: payment.id },
        data: { refundedKobo: { increment: take } },
      });
      created.push(
        await tx.refund.create({
          data: {
            operatorId,
            bookingId,
            paymentId: payment.id,
            provider: provider.name,
            amountKobo: take,
            reason,
            createdById: actor.type === 'user' ? actor.userId : null,
          },
          include: { payment: true },
        }),
      );
      remaining -= take;
    }

    await tx.bookingEvent.create({
      data: {
        operatorId,
        bookingId,
        type: 'refund_requested',
        actorType: actor.type,
        actorUserId: actor.type === 'user' ? actor.userId : null,
        data: { amountKobo: amount, extraKobo: Math.max(extra, 0), reason, parts: created.length },
      },
    });
    return { refunds: created, booking };
  }, TX_OPTIONS);

  return sendToProvider(prisma, provider, refunds, `${booking.reference}: ${reason}`);
}

/**
 * Sends an unmatched receipt (money never applied to a booking) back. No "refund owed" is
 * posted: the money was already a liability, in Unallocated receipts.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Provider} provider
 * @param {{ operatorId: string, paymentId: string, amountKobo?: number, reason: string, actor: Actor }} input
 */
export async function requestReceiptRefund(
  prisma,
  provider,
  { operatorId, paymentId, amountKobo, reason, actor },
) {
  const refund = await prisma.$transaction(async (tx) => {
    /** @type {Array<{ booking_id: string | null, status: string, amount_kobo: number, refunded_kobo: number, provider_transaction_id: string | null }>} */
    const [locked] = await tx.$queryRaw`
      SELECT booking_id, status, amount_kobo, refunded_kobo, provider_transaction_id FROM payments
       WHERE id = ${paymentId}::uuid AND operator_id = ${operatorId}::uuid FOR UPDATE`;
    if (!locked) throw new BookingError('NOT_FOUND', 'Receipt not found.');
    if (locked.booking_id !== null) {
      throw new BookingError(
        'NOT_UNMATCHED',
        'This payment belongs to a booking: refund the booking instead.',
      );
    }
    const left = locked.amount_kobo - locked.refunded_kobo;
    const amount = amountKobo ?? left;
    if (amount <= 0 || amount > left) {
      throw new BookingError(
        'REFUND_TOO_HIGH',
        `At most ${formatNaira(Math.max(left, 0))} can be refunded.`,
        { refundableKobo: left },
      );
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: { refundedKobo: { increment: amount } },
    });
    return tx.refund.create({
      data: {
        operatorId,
        bookingId: null,
        paymentId,
        provider: provider.name,
        amountKobo: amount,
        reason,
        createdById: actor.type === 'user' ? actor.userId : null,
      },
      include: { payment: true },
    });
  }, TX_OPTIONS);

  return sendToProvider(prisma, provider, [refund], `Unmatched receipt: ${reason}`);
}

/**
 * The provider confirms the money LEFT. Exactly once (refund row locked):
 *   - refund → processed
 *   - ledger: Dr Refunds payable / Cr Paystack clearing   (booking refunds)
 *             Dr Unallocated receipts / Cr Paystack clearing  (receipt refunds)
 *   - a cancelled / no-show booking whose refund due is now fully paid → "refunded"
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} refundId
 * @returns {Promise<'PROCESSED' | 'ALREADY_PROCESSED' | 'WAS_FAILED'>}
 */
export function markRefundProcessed(prisma, refundId) {
  return prisma.$transaction((tx) => processRefundInTx(tx, refundId), TX_OPTIONS);
}

/**
 * The money left: the refund is processed, the ledger says from where (Paystack's balance, or
 * the business's bank for a refund sent by bank transfer, 16c-2), the guest is told, and the
 * booking becomes "refunded" once everything owed is back. Inside the caller's transaction.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} refundId
 * @param {{ processedAt?: Date }} [o]
 * @returns {Promise<'PROCESSED' | 'ALREADY_PROCESSED' | 'WAS_FAILED'>}
 */
export async function processRefundInTx(tx, refundId, { processedAt = new Date() } = {}) {
  /** @type {Array<{ status: string }>} */
  const [locked] =
    await tx.$queryRaw`SELECT status FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
  if (locked.status === 'processed') return 'ALREADY_PROCESSED';
  if (locked.status === 'failed') return 'WAS_FAILED'; // a human looks: we'd given up on it

  const refund = await tx.refund.update({
    where: { id: refundId },
    data: { status: 'processed', processedAt },
    include: { payment: true },
  });
  await postTransaction(tx, {
    operatorId: refund.operatorId,
    type: 'refund_paid',
    idempotencyKey: `refund-paid:${refund.id}`,
    description: refund.bookingId
      ? `Refund paid out on ${refund.payment.reference}`
      : `Unmatched receipt ${refund.payment.reference} sent back`,
    lines: !refund.bookingId
      ? POSTINGS.receiptRefunded(refund.amountKobo)
      : refund.provider === 'bank_transfer'
        ? POSTINGS.refundPaidByTransfer(refund.amountKobo)
        : refund.provider === 'ota'
          ? // The OTA refunded its guest: it owes that much less, and hands back its
            // commission on it, at the share frozen at the sale (17b).
            POSTINGS.otaRefund(
              refund.amountKobo,
              percentOf(
                refund.amountKobo,
                (
                  await tx.channelBooking.findUniqueOrThrow({
                    where: { bookingId: refund.bookingId },
                  })
                ).commissionBasisPoints,
              ),
            )
          : POSTINGS.refundPaid(refund.amountKobo),
    bookingId: refund.bookingId,
    paymentId: refund.paymentId,
  });

  if (refund.bookingId) {
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: refund.bookingId } });
    const paidOut =
      (
        await tx.refund.aggregate({
          where: { bookingId: booking.id, status: 'processed' },
          _sum: { amountKobo: true },
        })
      )._sum.amountKobo ?? 0;
    // "Your refund of ₦31,250 has been sent" (stage 14a), decided with the ledger entry.
    await planGuestMessage(tx, {
      booking,
      kind: 'refund_sent',
      key: `refund_sent:${refund.id}`,
      data: { refundKobo: refund.amountKobo },
    });
    await tx.bookingEvent.create({
      data: {
        operatorId: booking.operatorId,
        bookingId: booking.id,
        type: 'refund_processed',
        actorType: 'system',
        data: {
          refundId,
          amountKobo: refund.amountKobo,
          paidOutKobo: paidOut,
          refundDueKobo: booking.refundDueKobo,
        },
      },
    });
    if (REFUNDABLE_END_STATES.includes(booking.status) && paidOut >= booking.refundDueKobo) {
      await transitionBookingInTx(tx, {
        bookingId: booking.id,
        to: 'refunded',
        actor: { type: 'system' },
        data: { paidOutKobo: paidOut },
      });
    }
  }
  return 'PROCESSED';
}

/**
 * The provider couldn't refund. The money is still OWED (refundDueKobo unchanged); the
 * amount is released from the payment so staff can try again.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} refundId
 * @param {string} reason
 * @returns {Promise<'FAILED' | 'ALREADY_FAILED' | 'WAS_PROCESSED'>}
 */
export function markRefundFailed(prisma, refundId, reason) {
  return prisma.$transaction(async (tx) => {
    /** @type {Array<{ status: string }>} */
    const [locked] =
      await tx.$queryRaw`SELECT status FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
    if (locked.status === 'failed') return 'ALREADY_FAILED';
    if (locked.status === 'processed') return 'WAS_PROCESSED'; // money already left: a human looks
    const refund = await tx.refund.update({
      where: { id: refundId },
      data: { status: 'failed', failureReason: reason },
    });
    await tx.payment.update({
      where: { id: refund.paymentId },
      data: { refundedKobo: { decrement: refund.amountKobo } },
    });
    if (refund.bookingId) {
      await tx.bookingEvent.create({
        data: {
          operatorId: refund.operatorId,
          bookingId: refund.bookingId,
          type: 'refund_failed',
          actorType: 'system',
          data: { refundId, amountKobo: refund.amountKobo, reason },
        },
      });
    }
    return 'FAILED';
  }, TX_OPTIONS);
}
