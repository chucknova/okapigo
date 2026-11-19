// @ts-check
/**
 * cash.js — money on tour day (stage 15c-4; decided 2026-11-19 with the designs, "Money owed
 * on the day").
 *
 *   tourDayLink()    the booking's balance as a payment link, for the guide to show as a QR.
 *                    Saved on the phone, so it shows with no signal; the GUEST pays on their
 *                    own data. Made without messaging the guest.
 *   reportCash()     "she paid me cash": saved as cash REPORTED by the guide. Not a payment:
 *                    the booking still owes until the office confirms it was handed in
 *                    (session 16). If they'd paid by link meanwhile: a possible double payment.
 *   cashReturned()   "I gave the cash back"
 */
import { createHash, createHmac } from 'node:crypto';
import { localTime } from '@okapigo/shared/time';
import { formatNaira } from '@okapigo/shared/money';
import { BookingError } from './booking-lifecycle.js';

/** Bookings that can take a balance on the day (the check-in statuses that owe). */
const CAN_OWE = ['confirmed', 'part_paid', 'amended'];

/**
 * The tour-day link's token: made from the server's secret, the booking and the amount, so
 * the same balance always gives the same link (the offline package stays the same, its ETag
 * too, and no new link piles up on every refresh). A different balance gives a new one.
 * 24 bytes, the shape of every payment link's token (payment-links.js).
 * @param {string} secret @param {string} bookingId @param {number} amountKobo
 */
const tokenFor = (secret, bookingId, amountKobo) =>
  createHmac('sha256', secret)
    .update(`tour-day-link:${bookingId}:${amountKobo}`)
    .digest()
    .subarray(0, 24)
    .toString('base64url');

/**
 * The URL of a payment link for what this booking still owes, made once (then found again).
 * Null if it owes nothing, or staff cancelled that link.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, booking: any, endsAt: Date, secret: string, webPublicUrl: string }} o
 */
export async function tourDayLink(prisma, { operatorId, booking, endsAt, secret, webPublicUrl }) {
  const owed = booking.totalKobo - booking.amountPaidKobo;
  if (owed <= 0 || !CAN_OWE.includes(booking.status)) return null;
  const token = tokenFor(secret, booking.id, owed);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const existing = await prisma.paymentLink.findUnique({ where: { tokenHash } });
  if (existing) return existing.status === 'active' ? `${webPublicUrl}/pay/${token}` : null;
  try {
    const link = await prisma.paymentLink.create({
      data: {
        operatorId,
        bookingId: booking.id,
        tokenHash,
        amountKobo: owed,
        purpose: booking.amountPaidKobo === 0 ? 'full' : 'balance',
        // Good until the day after the tour: long enough for a guest who pays on the bus home.
        expiresAt: new Date(endsAt.getTime() + 24 * 3_600_000),
      },
    });
    await prisma.bookingEvent.create({
      data: {
        operatorId,
        bookingId: booking.id,
        type: 'payment_link_created',
        actorType: 'system',
        data: { paymentLinkId: link.id, amountKobo: owed, purpose: link.purpose, tourDay: true },
      },
    });
  } catch (err) {
    // Two refreshes at once both tried to make it: the other one did. Same link either way.
    if (/** @type {any} */ (err).code !== 'P2002') throw err;
  }
  return `${webPublicUrl}/pay/${token}`;
}

/**
 * "She paid me cash" (the outbox, kind 'cash'). The amount can't be more than is owed (the
 * phone checks too). If the booking is already paid, or paid more since the guide's phone
 * last knew: kept as a POSSIBLE DOUBLE PAYMENT, and a conflict (PAID_MEANWHILE) says so.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, departureId: string, bookingId: string, amountKobo: number,
 *   userId: string, at: Date, tz: string }} c
 */
export async function reportCash(
  prisma,
  { operatorId, departureId, bookingId, amountKobo, userId, at, tz },
) {
  const r = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
    const b = await tx.booking.findFirst({ where: { id: bookingId, operatorId, departureId } });
    if (!b) throw new BookingError('NOT_FOUND', 'That booking isn’t on this departure.');
    if (b.status === 'cancelled' || b.status === 'refunded') {
      throw new BookingError('BOOKING_CANCELLED', 'This booking was cancelled.');
    }
    const owed = b.totalKobo - b.amountPaidKobo;
    const meanwhile = amountKobo > owed;
    const report = await tx.cashReport.create({
      data: {
        operatorId,
        bookingId,
        reportedById: userId,
        amountKobo,
        reportedAt: at,
        status: meanwhile ? 'possible_double' : 'reported',
      },
    });
    await tx.bookingEvent.create({
      data: {
        operatorId,
        bookingId,
        type: 'cash_reported',
        actorType: 'user',
        actorUserId: userId,
        data: { cashReportId: report.id, amountKobo, possibleDouble: meanwhile },
      },
    });
    const last = meanwhile
      ? await tx.payment.findFirst({
          where: { bookingId, status: 'succeeded' },
          orderBy: { paidAt: 'desc' },
        })
      : null;
    return { report, owed, last };
  });
  // The report is KEPT either way (committed above); a possible double is then a conflict.
  if (r.report.status === 'possible_double') {
    throw new BookingError('PAID_MEANWHILE', 'They paid before this phone synced.', {
      cashReportId: r.report.id,
      amountKobo,
      owedKobo: Math.max(0, r.owed),
      paid: r.last
        ? {
            amountKobo: r.last.amountKobo,
            at: r.last.paidAt,
            time: r.last.paidAt ? localTime(r.last.paidAt, tz) : null,
          }
        : null,
    });
  }
  return {
    cashReportId: r.report.id,
    amountKobo,
    label: `Cash ${formatNaira(amountKobo)} reported · office to confirm`,
  };
}

/**
 * "I gave the cash back" on a possible double payment: the report is closed.
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, cashReportId: string, userId: string, now?: Date }} r
 */
export async function cashReturned(prisma, { operatorId, cashReportId, userId, now = new Date() }) {
  const { count } = await prisma.cashReport.updateMany({
    where: { id: cashReportId, operatorId, status: 'possible_double' },
    data: { status: 'returned', resolvedAt: now, resolvedById: userId },
  });
  return count > 0;
}
