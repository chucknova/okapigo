// @ts-check
/**
 * guest-requests.js — "Ask Ìrìn" from the trip hub (stage 12f-2).
 *
 *   createGuestRequest   the guest asks: change the date · cancel · something else
 *   listGuestRequests    staff: the open ones, oldest first, with what's needed to reply
 *   answerGuestRequest   staff replied (by WhatsApp or email): mark it answered
 *
 * Asking changes NOTHING about the booking. Staff do whatever they agree with the guest with
 * the tools they already have (cancel with a chosen refund, payment links…), then mark the
 * request answered. Each step is on the booking's timeline.
 */
import { BookingError } from './booking-lifecycle.js';

/** At most this many open requests per booking: enough for "and one more thing", not spam. */
export const MAX_OPEN_REQUESTS = 3;

/** Bookings a guest can still ask about (not cancelled, refunded or finished). */
const ASKABLE = ['confirmed', 'part_paid', 'paid', 'amended'];

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ bookingId: string, kind: 'change_date' | 'cancel' | 'other', message: string }} input
 */
export function createGuestRequest(prisma, { bookingId, kind, message }) {
  return prisma.$transaction(async (tx) => {
    // Locked, so two quick taps can't both slip under the limit.
    /** @type {Array<{ id: string }>} */
    const locked =
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new BookingError('NOT_FOUND', 'Booking not found.');
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (!ASKABLE.includes(booking.status)) {
      throw new BookingError('NOT_ASKABLE', 'This booking can’t take requests any more.');
    }
    const open = await tx.guestRequest.count({ where: { bookingId, status: 'open' } });
    if (open >= MAX_OPEN_REQUESTS) {
      throw new BookingError(
        'TOO_MANY_REQUESTS',
        'You already have requests waiting for a reply. They’ll get back to you soon.',
      );
    }
    const request = await tx.guestRequest.create({
      data: { operatorId: booking.operatorId, bookingId, kind, message },
    });
    await tx.bookingEvent.create({
      data: {
        operatorId: booking.operatorId,
        bookingId,
        type: 'guest_request',
        actorType: 'guest',
        data: { requestId: request.id, kind },
      },
    });
    return request;
  });
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} operatorId
 * @param {{ status?: 'open' | 'answered' }} [filter]
 */
export function listGuestRequests(prisma, operatorId, { status = 'open' } = {}) {
  return prisma.guestRequest.findMany({
    where: { operatorId, status },
    orderBy: { createdAt: status === 'open' ? 'asc' : 'desc' },
    take: 200,
    include: { booking: { include: { product: true, departure: true } } },
  });
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, requestId: string, userId: string, note?: string, now?: Date }} input
 */
export async function answerGuestRequest(
  prisma,
  { operatorId, requestId, userId, note, now = new Date() },
) {
  return prisma.$transaction(async (tx) => {
    // Only an OPEN request of THIS operator: the where clause is the tenant check.
    const { count } = await tx.guestRequest.updateMany({
      where: { id: requestId, operatorId, status: 'open' },
      data: { status: 'answered', answeredAt: now, answeredById: userId, staffNote: note ?? null },
    });
    if (count === 0) {
      const exists = await tx.guestRequest.findFirst({ where: { id: requestId, operatorId } });
      throw exists
        ? new BookingError('ALREADY_ANSWERED', 'This request is already marked answered.')
        : new BookingError('NOT_FOUND', 'Request not found.');
    }
    const request = await tx.guestRequest.findUniqueOrThrow({ where: { id: requestId } });
    await tx.bookingEvent.create({
      data: {
        operatorId,
        bookingId: request.bookingId,
        type: 'guest_request_answered',
        actorType: 'user',
        actorUserId: userId,
        data: { requestId, note: note ?? null },
      },
    });
    return request;
  });
}
