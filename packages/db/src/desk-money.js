// @ts-check
/**
 * desk-money.js — money the office handles itself, at the bookings desk (stage 16c-2;
 * designs: O8 "every status", "phone and states").
 *
 *   confirmCash()        "Confirm ₦45,500 received" (or "Received a different amount"): the
 *                        cash a guide reported (15c-4) becomes a real payment, in the ledger
 *                        as Cash, and the booking's balance closes. If the guest had paid by
 *                        link too, the cash is owed back (settleBooking says so).
 *   cashNotReceived()    "Not received": the guest still owes, and the owner is alerted.
 *   recordBankRefund()   "I refunded by bank transfer": the date and the transfer's reference;
 *                        in the ledger from the Bank; the guest is told "Refund sent".
 *
 * Retrying a failed refund is requestBookingRefund (10e); cancelling, cancelBooking (9).
 */
import { POSTINGS } from '@okapigo/shared/ledger';
import { formatNaira } from '@okapigo/shared/money';
import { generatePaymentReference } from '@okapigo/shared/payment-status';
import { BookingError } from './booking-lifecycle.js';
import { postTransaction } from './ledger.js';
import { settleBooking } from './settlement.js';
import { processRefundInTx } from './refunds.js';

const TX = { maxWait: 15_000, timeout: 15_000 };
const OPEN_CASH = ['reported', 'possible_double'];

/**
 * Finds an open cash report of this business, locking its booking first (the same order as
 * every other change to a booking, so two people can't confirm the same cash twice).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} operatorId @param {string} cashReportId
 */
async function openReport(tx, operatorId, cashReportId) {
  const found = await tx.cashReport.findFirst({ where: { id: cashReportId, operatorId } });
  if (!found) throw new BookingError('NOT_FOUND', 'That cash report wasn’t found.');
  await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${found.bookingId}::uuid FOR UPDATE`;
  const report = await tx.cashReport.findUniqueOrThrow({
    where: { id: cashReportId },
    include: { reportedBy: true },
  });
  if (!OPEN_CASH.includes(report.status)) {
    throw new BookingError(
      'CASH_ALREADY_SETTLED',
      report.status === 'confirmed'
        ? 'This cash was already confirmed.'
        : report.status === 'not_received'
          ? 'This cash was already marked not received.'
          : 'This cash was already given back.',
    );
  }
  return report;
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, cashReportId: string, userId: string, amountKobo?: number, now?: Date }} c
 *   amountKobo: what was really handed in, if not what the guide reported
 */
export function confirmCash(
  prisma,
  { operatorId, cashReportId, userId, amountKobo, now = new Date() },
) {
  return prisma.$transaction(async (tx) => {
    const report = await openReport(tx, operatorId, cashReportId);
    const amount = amountKobo ?? report.amountKobo;
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new BookingError('INVALID_AMOUNT', 'Enter the amount handed in.');
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: report.bookingId } });
    const owed = booking.totalKobo - booking.amountPaidKobo;

    // A real payment now: cash, paid to the guide when they reported it.
    const payment = await tx.payment.create({
      data: {
        operatorId,
        bookingId: booking.id,
        provider: 'cash',
        method: 'cash',
        purpose: amount >= owed ? (booking.amountPaidKobo === 0 ? 'full' : 'balance') : 'custom',
        amountKobo: amount,
        status: 'succeeded',
        reference: generatePaymentReference(),
        paidAt: report.reportedAt,
        channel: 'cash',
      },
    });
    await postTransaction(tx, {
      operatorId,
      type: 'cash_received',
      idempotencyKey: `cash-received:${report.id}`,
      description: `Cash for ${booking.reference}, from ${report.reportedBy.name}`,
      lines: POSTINGS.cashReceived(amount),
      bookingId: booking.id,
      paymentId: payment.id,
      occurredAt: now,
      createdById: userId,
    });
    // The balance closes (or part of it); more than owed → the extra is owed back.
    const review = await settleBooking(tx, booking, payment, now);
    await tx.cashReport.update({
      where: { id: report.id },
      data: { status: 'confirmed', resolvedAt: now, resolvedById: userId },
    });
    await tx.bookingEvent.create({
      data: {
        operatorId,
        bookingId: booking.id,
        type: 'cash_confirmed',
        actorType: 'user',
        actorUserId: userId,
        data: {
          cashReportId: report.id,
          amountKobo: amount,
          reportedKobo: report.amountKobo,
          guide: report.reportedBy.name,
        },
      },
    });
    return { paymentId: payment.id, amountKobo: amount, owedBack: review };
  }, TX);
}

/**
 * "Not received": the guide didn't hand it in. The booking keeps owing; the owner is alerted
 * (a staff alert: on Today, and in the inbox, 16d).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, cashReportId: string, userId: string, now?: Date }} c
 */
export function cashNotReceived(prisma, { operatorId, cashReportId, userId, now = new Date() }) {
  return prisma.$transaction(async (tx) => {
    const report = await openReport(tx, operatorId, cashReportId);
    await tx.cashReport.update({
      where: { id: report.id },
      data: { status: 'not_received', resolvedAt: now, resolvedById: userId },
    });
    const data = {
      cashReportId: report.id,
      amountKobo: report.amountKobo,
      guide: report.reportedBy.name,
    };
    await tx.bookingEvent.create({
      data: {
        operatorId,
        bookingId: report.bookingId,
        type: 'cash_not_received',
        actorType: 'user',
        actorUserId: userId,
        data,
      },
    });
    await tx.notification.create({
      data: {
        operatorId,
        bookingId: report.bookingId,
        audience: 'staff',
        kind: 'cash_not_received',
        key: `cash_not_received:${report.id}`,
        data,
      },
    });
    return { amountKobo: report.amountKobo };
  }, TX);
}

/**
 * "I refunded by bank transfer": money the business sent from its own account. Recorded as a
 * processed refund (split across the payments, like any refund), in the ledger from the Bank.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, bookingId: string, userId: string, amountKobo: number, sentOn: Date, reference: string, now?: Date }} r
 */
export function recordBankRefund(
  prisma,
  { operatorId, bookingId, userId, amountKobo, sentOn, reference, now = new Date() },
) {
  return prisma.$transaction(async (tx) => {
    /** @type {Array<{ id: string }>} */
    const locked = await tx.$queryRaw`
      SELECT id FROM bookings WHERE id = ${bookingId}::uuid AND operator_id = ${operatorId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new BookingError('NOT_FOUND', 'Booking not found.');
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const ref = reference.trim();
    if (!ref) throw new BookingError('REFERENCE_NEEDED', 'Enter the transfer’s reference.');
    if (sentOn > now)
      throw new BookingError('DATE_IN_FUTURE', 'The date sent can’t be in the future.');

    // What's owed back and not on its way already (a failed refund isn't on its way).
    const underWay =
      (
        await tx.refund.aggregate({
          where: { bookingId, status: { not: 'failed' } },
          _sum: { amountKobo: true },
        })
      )._sum.amountKobo ?? 0;
    const owedBack = Math.max(0, booking.refundDueKobo - underWay);
    if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0)
      throw new BookingError('INVALID_AMOUNT', 'Enter the amount sent.');
    if (amountKobo > owedBack) {
      throw new BookingError(
        'REFUND_TOO_HIGH',
        owedBack === 0
          ? 'Nothing is owed back on this booking.'
          : `Only ${formatNaira(owedBack)} is owed back.`,
        { owedBackKobo: owedBack },
      );
    }

    // Split across the payments, newest first (each refund belongs to one payment).
    const payments = await tx.payment.findMany({
      where: { bookingId, status: 'succeeded' },
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
    });
    /** @type {string[]} */
    const ids = [];
    let remaining = amountKobo;
    for (const p of payments) {
      if (remaining === 0) break;
      const take = Math.min(remaining, p.amountKobo - p.refundedKobo);
      if (take <= 0) continue;
      await tx.payment.update({ where: { id: p.id }, data: { refundedKobo: { increment: take } } });
      const refund = await tx.refund.create({
        data: {
          operatorId,
          bookingId,
          paymentId: p.id,
          provider: 'bank_transfer',
          // Unique per provider: the reference, numbered if the transfer covers two payments.
          providerRefundId: ids.length === 0 ? ref : `${ref}#${ids.length + 1}`,
          amountKobo: take,
          reason: `Refunded by bank transfer (${ref})`,
          createdById: userId,
        },
      });
      ids.push(refund.id);
      remaining -= take;
    }
    if (remaining > 0) {
      throw new BookingError('REFUND_TOO_HIGH', 'More than was paid on this booking.');
    }
    await tx.bookingEvent.create({
      data: {
        operatorId,
        bookingId,
        type: 'refund_by_transfer',
        actorType: 'user',
        actorUserId: userId,
        data: { amountKobo, reference: ref, sentOn: sentOn.toISOString() },
      },
    });
    for (const id of ids) await processRefundInTx(tx, id, { processedAt: sentOn });
    return { refundIds: ids, amountKobo };
  }, TX);
}
