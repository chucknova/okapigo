// @ts-check
/**
 * payments.js — starting a payment for a booking (PAY-02, stage 10b).
 *
 * startPayment() runs in THREE steps, on purpose:
 *
 *   1. a short DB transaction: lock the booking, check what's owed, reuse or RECORD the
 *      payment (status "initiated", our reference OKG-…)
 *   2. NO transaction: call the provider (Paystack can take seconds; holding a database
 *      transaction open across a network call would keep the booking locked and a
 *      connection busy the whole time)
 *   3. a short update: save the checkout URL, or mark the attempt failed
 *
 * Recording the payment BEFORE calling Paystack means every Paystack transaction has a
 * local record, even if we crash right after Paystack answers, or its webhook beats us.
 *
 * Nothing here marks a payment "succeeded". Only a verified webhook does (stage 10c).
 */
import { generatePaymentReference, placeholderEmail } from '@okapigo/shared/payment-status';
import { BookingError } from './booking-lifecycle.js';

const TX_OPTIONS = { maxWait: 15_000, timeout: 15_000 };
/** Reuse an unfinished checkout for this long ("Pay" clicked twice, page reloaded). */
const REUSE_WINDOW_MS = 30 * 60 * 1000;

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ name: string, initializeTransaction: Function }} provider  a PaymentProvider (@okapigo/payments)
 * @param {{
 *   operatorId: string,
 *   bookingId: string,
 *   method: 'card' | 'bank_transfer',
 *   callbackUrl: string,
 *   actor: import('./booking-lifecycle.js').Actor,
 *   now?: Date,
 * }} input
 * @returns {Promise<{ payment: import('@prisma/client').Payment, reused: boolean }>}
 */
export async function startPayment(
  prisma,
  provider,
  { operatorId, bookingId, method, callbackUrl, actor, now = new Date() },
) {
  // --- Step 1: decide and record, under the booking's row lock --------------------------
  const { payment, reused, booking } = await prisma.$transaction(async (tx) => {
    // Lock THIS booking. A second "Pay" click waits here, then sees the first one's
    // payment and reuses it, instead of creating a second checkout the guest could also pay.
    /** @type {Array<{ id: string }>} */
    const locked = await tx.$queryRaw`
      SELECT id FROM bookings WHERE id = ${bookingId}::uuid AND operator_id = ${operatorId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new BookingError('NOT_FOUND', 'Booking not found.');

    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { hold: true },
    });

    // What can be paid right now. (Deposits and balances are stage 10d.)
    if (booking.status !== 'held') {
      throw new BookingError(
        'NOT_PAYABLE',
        `A "${booking.status}" booking can't be paid this way.`,
      );
    }
    if (booking.hold.status !== 'active' || booking.hold.expiresAt <= now) {
      throw new BookingError(
        'HOLD_EXPIRED',
        'The hold on these seats has expired. Start a new booking.',
      );
    }
    const amountKobo = booking.totalKobo - booking.amountPaidKobo;
    if (amountKobo <= 0) {
      // A ₦0 booking (e.g. a free infant-only booking) is confirmed, not paid.
      throw new BookingError(
        'NOTHING_TO_PAY',
        'Nothing is owed on this booking. Confirm it instead.',
      );
    }

    const recent = await tx.payment.findFirst({
      where: {
        bookingId,
        status: 'initiated',
        method,
        amountKobo,
        authorizationUrl: { not: null },
        createdAt: { gt: new Date(now.getTime() - REUSE_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) return { payment: recent, reused: true, booking };

    const created = await tx.payment.create({
      data: {
        operatorId,
        bookingId,
        provider: provider.name,
        method,
        purpose: 'full',
        amountKobo,
        reference: generatePaymentReference(),
        createdById: actor.type === 'user' ? actor.userId : null,
      },
    });
    return { payment: created, reused: false, booking };
  }, TX_OPTIONS);

  if (reused) return { payment, reused };

  // --- Step 2: talk to the provider, with NO database transaction open -------------------
  let checkout;
  try {
    checkout = await provider.initializeTransaction({
      reference: payment.reference,
      amountKobo: payment.amountKobo,
      // Paystack needs an email for the receipt. Guests who gave only a phone get a
      // placeholder that can never receive mail (see placeholderEmail for why example.com).
      email: booking.leadEmail ?? placeholderEmail(booking.reference),
      callbackUrl,
      channels: [method],
      metadata: { bookingId, bookingReference: booking.reference, paymentId: payment.id },
    });
  } catch (err) {
    // --- Step 3 (failure): keep the attempt, marked failed with the reason ---------------
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'failed',
        failureReason: String(/** @type {any} */ (err)?.message ?? err).slice(0, 300),
      },
    });
    throw err;
  }

  // --- Step 3 (success): save where to send the guest -----------------------------------
  const ready = await prisma.payment.update({
    where: { id: payment.id },
    data: { authorizationUrl: checkout.authorizationUrl },
  });
  return { payment: ready, reused: false };
}
