// @ts-check
/**
 * move-booking.js — moving a booking to another date (stage 16d-2; designs: O9 requests,
 * "Move to Sun 6 Dec, 09:00"; decided 2026-11-21: build it).
 *
 *   moveOptions()   the tour's other dates the booking could move to: each with its seats free
 *   moveBooking()   move it: the same tour, before the trip, the seats must fit; the price stays
 *                   what was booked; the seats move with it; the guest is told ("Date changed")
 *
 * The ticket stays the same (it's the booking's), so a guest's QR still works.
 */
import { localDate, localTime } from '@okapigo/shared/time';
import { formatAt } from '@okapigo/shared/tour-facts';
import { BookingError } from './booking-lifecycle.js';
import { planGuestMessage } from './guest-messages.js';
import { seatsLeft } from './seats.js';

const LIVE = ['confirmed', 'part_paid', 'paid', 'amended'];
const LOOK_AHEAD_DAYS = 90;
const TX = { maxWait: 15_000, timeout: 15_000 };

/** "Sun 6 Dec, 09:00" @param {Date} at @param {string} tz */
const when = (at, tz) => formatAt(at.getTime(), tz);

/**
 * Why a booking can't move at all, or null.
 * @param {any} b  with departure @param {Date} now
 */
function cannotMove(b, now) {
  if (b.status === 'held') return 'This booking isn’t booked yet.';
  if (!LIVE.includes(b.status)) return 'This booking can’t be moved now.';
  if (b.departure.startsAt <= now) return 'The trip has started: it can’t be moved now.';
  return null;
}

/**
 * The dates it could move to: the same tour's departures from now on (90 days), not its own.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, bookingId: string, now?: Date }} q
 */
export async function moveOptions(prisma, { operatorId, bookingId, now = new Date() }) {
  const b = await prisma.booking.findFirst({
    where: { id: bookingId, operatorId },
    include: {
      departure: true,
      product: { include: { operator: true } },
      _count: { select: { travellers: true } },
    },
  });
  if (!b) throw new BookingError('NOT_FOUND', 'Booking not found.');
  const tz = b.product.operator.timeZone;
  const why = cannotMove(b, now);
  if (why) throw new BookingError('CANNOT_MOVE', why);
  const n = b._count.travellers;
  const departures = await prisma.departure.findMany({
    where: {
      productId: b.productId,
      id: { not: b.departureId },
      status: 'scheduled',
      startsAt: { gt: now, lt: new Date(now.getTime() + LOOK_AHEAD_DAYS * 86_400_000) },
    },
    include: { resource: true },
    orderBy: { startsAt: 'asc' },
  });
  return {
    from: when(b.departure.startsAt, tz),
    travellers: n,
    dates: departures.map((d) => {
      const free = seatsLeft(d);
      return {
        id: d.id,
        when: when(d.startsAt, tz),
        date: localDate(d.startsAt, tz),
        free,
        fits: free >= n,
        text:
          free >= n
            ? `${free} ${free === 1 ? 'seat' : 'seats'} free`
            : free === 0
              ? 'Full'
              : `Only ${free} free`,
      };
    }),
  };
}

/**
 * Moves the booking. Both departures are locked (in id order, so two moves can't deadlock), and
 * the seats are counted under the lock.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, bookingId: string, departureId: string, userId: string, requestId?: string, now?: Date }} m
 *   requestId: the guest's request this answers ("moved to Sun 6 Dec" is kept on it)
 */
export function moveBooking(
  prisma,
  { operatorId, bookingId, departureId, userId, requestId, now = new Date() },
) {
  return prisma.$transaction(async (tx) => {
    /** @type {Array<{ id: string }>} */
    const locked = await tx.$queryRaw`
      SELECT id FROM bookings WHERE id = ${bookingId}::uuid AND operator_id = ${operatorId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new BookingError('NOT_FOUND', 'Booking not found.');
    const pre = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (departureId === pre.departureId)
      throw new BookingError('SAME_DATE', 'The booking is already on that date.');
    const [a, z] = [pre.departureId, departureId].sort();
    await tx.$queryRaw`SELECT id FROM departures WHERE id = ${a}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM departures WHERE id = ${z}::uuid FOR UPDATE`;

    const b = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: {
        departure: true,
        product: { include: { operator: true } },
        travellers: true,
      },
    });
    const why = cannotMove(b, now);
    if (why) throw new BookingError('CANNOT_MOVE', why);
    const to = await tx.departure.findFirst({
      where: { id: departureId, operatorId },
      include: { resource: true },
    });
    if (!to || to.productId !== b.productId)
      throw new BookingError('NOT_FOUND', 'That date isn’t one of this tour’s.');
    if (to.status !== 'scheduled')
      throw new BookingError('DEPARTURE_CANCELLED', 'That date is cancelled.');
    if (to.startsAt <= now) throw new BookingError('DEPARTURE_STARTED', 'That date has passed.');
    const n = b.travellers.length;
    const free = seatsLeft(to);
    if (free < n) {
      throw new BookingError(
        'SEATS',
        `${when(to.startsAt, b.product.operator.timeZone)} has ${free} ${free === 1 ? 'seat' : 'seats'} free; this booking needs ${n}.`,
        { free, needed: n },
      );
    }

    const tz = b.product.operator.timeZone;
    await tx.departure.update({
      where: { id: b.departureId },
      data: { seatsSold: { decrement: n } },
    });
    await tx.departure.update({ where: { id: to.id }, data: { seatsSold: { increment: n } } });
    await tx.booking.update({ where: { id: bookingId }, data: { departureId: to.id } });
    // Nobody's checked in on the new day yet.
    await tx.traveller.updateMany({
      where: { bookingId },
      data: { checkInStatus: 'pending', checkedInAt: null, checkedInById: null },
    });
    const fromWhen = when(b.departure.startsAt, tz);
    const toWhen = when(to.startsAt, tz);
    await tx.bookingEvent.create({
      data: {
        operatorId,
        bookingId,
        type: 'moved',
        actorType: 'user',
        actorUserId: userId,
        data: { fromDepartureId: b.departureId, toDepartureId: to.id, from: fromWhen, to: toWhen },
      },
    });
    // The guest hears of it ("Date changed", WhatsApp and email).
    const moved = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { product: true, departure: true },
    });
    await planGuestMessage(tx, {
      booking: moved,
      kind: 'booking_moved',
      key: `booking_moved:${bookingId}:${to.id}:${now.getTime()}`,
      data: { fromDate: localDate(b.departure.startsAt, tz) },
    });
    // Answering a request: say what was done on it (shown under Done).
    if (requestId) {
      await tx.guestRequest.updateMany({
        where: { id: requestId, operatorId, bookingId },
        data: { staffNote: `Moved to ${toWhen}` },
      });
    }
    return {
      from: fromWhen,
      to: toWhen,
      toDate: localDate(to.startsAt, tz),
      time: localTime(to.startsAt, tz),
    };
  }, TX);
}
