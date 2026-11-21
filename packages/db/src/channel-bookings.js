// @ts-check
/**
 * channel-bookings.js — bookings an OTA makes through OCTO (session 17b), on top of the same
 * bookings, holds and ledger as every other channel.
 *
 *   reserveChannelBooking   OCTO "reserve": our booking, held (with its seat hold), and its
 *                           OCTO side (the OTA's uuid, unit items, the commission frozen)
 *   confirmChannelBooking   OCTO "confirm": the OTA's guest as the lead; the OTA's payment;
 *                           the sale in the ledger (it owes us the price less commission)
 *   cancelChannelBooking    OCTO "cancel": held → seats back; sold → the business's policy
 *                           (the guest cancelled), and the refund settled with the OTA at once
 *   extendChannelBooking    OCTO "extend": more time on the hold (up to the most allowed)
 *   octoStatusOf()          the OCTO status, worked out from our booking and its hold
 *
 * Decided 2026-11-21: the OTA takes the guest's money and owes us the price less its
 * commission; Ìrìn sends OTA guests nothing automatic; an OTA's cancellation follows Ìrìn's
 * policy until the start.
 */
import { percentOf } from '@okapigo/shared/pricing';
import { POSTINGS } from '@okapigo/shared/ledger';
import { generatePaymentReference } from '@okapigo/shared/payment-status';
import { createBooking } from './bookings.js';
import { BookingError } from './booking-lifecycle.js';
import { cancelBookingInTx } from './cancellations.js';
import { postTransaction } from './ledger.js';
import { settleBooking } from './settlement.js';

const TX = { maxWait: 15_000, timeout: 15_000 };

/** The longest an OTA may hold seats: the WhatsApp hold (decided 2026-11-18). */
export const OTA_MAX_HOLD_MINUTES = 30;

/**
 * How long a hold an OTA asked for: its minutes, from 1 to 30; 30 when it didn't say.
 * @param {number | undefined} minutes
 */
export const holdMinutesFor = (minutes) =>
  minutes === undefined
    ? OTA_MAX_HOLD_MINUTES
    : Math.min(OTA_MAX_HOLD_MINUTES, Math.max(1, minutes));

/**
 * The OCTO status of one of our bookings.
 *   held, hold running        → ON_HOLD
 *   cancelled by its hold's expiry (or held, time up) → EXPIRED
 *   cancelled, refunded       → CANCELLED
 *   completed                 → REDEEMED (they came)
 *   everything else sold      → CONFIRMED
 * @param {{ status: string }} booking @param {{ status: string, expiresAt: Date }} hold @param {Date} [now]
 */
export function octoStatusOf(booking, hold, now = new Date()) {
  if (booking.status === 'held')
    return hold.status === 'active' && hold.expiresAt > now ? 'ON_HOLD' : 'EXPIRED';
  if (booking.status === 'cancelled' || booking.status === 'refunded') {
    return hold.status === 'expired' ? 'EXPIRED' : 'CANCELLED';
  }
  if (booking.status === 'completed') return 'REDEEMED';
  return 'CONFIRMED';
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{
 *   channel: { id: string, name: string, operatorId: string, commissionBasisPoints: number },
 *   operatorSlug: string,
 *   productId: string,
 *   departureId: string,
 *   uuid: string,
 *   unitItems: Array<{ uuid: string, unitId: string }>,
 *   quote: unknown,
 *   totalKobo: number,
 *   holdMinutes: number,
 *   notes?: string | null,
 *   pickupPointName?: string | null,
 *   now?: Date,
 * }} r
 * @returns {Promise<{ channelBooking: import('@prisma/client').ChannelBooking, created: boolean }>}
 */
export async function reserveChannelBooking(prisma, r) {
  // The same uuid again: the same booking (OCTO's idempotency key).
  const existing = await prisma.channelBooking.findUnique({
    where: { channelId_uuid: { channelId: r.channel.id, uuid: r.uuid } },
  });
  if (existing) return { channelBooking: existing, created: false };

  const { booking, hold } = await createBooking(prisma, {
    operatorId: r.channel.operatorId,
    operatorSlug: r.operatorSlug,
    departureId: r.departureId,
    productId: r.productId,
    channel: 'ota',
    // Who's coming arrives when the OTA confirms; until then, the OTA's own name.
    lead: { name: `${r.channel.name} guest`, email: null, phone: null, marketingConsent: false },
    travellers: r.unitItems.map((u) => ({
      name: '',
      age: /** @type {any} */ (null),
      categoryKey: u.unitId,
    })),
    addOns: [],
    quote: r.quote,
    totalKobo: r.totalKobo,
    holdMinutes: r.holdMinutes,
    notes: r.notes ?? '',
    pickupPointName: r.pickupPointName ?? null,
    actor: { type: 'guest' },
    now: r.now,
  });
  try {
    const channelBooking = await prisma.channelBooking.create({
      data: {
        operatorId: r.channel.operatorId,
        channelId: r.channel.id,
        bookingId: booking.id,
        uuid: r.uuid,
        unitItems: r.unitItems,
        commissionBasisPoints: r.channel.commissionBasisPoints,
      },
    });
    return { channelBooking, created: true, holdId: hold.id, expiresAt: hold.expiresAt };
  } catch (err) {
    // Two requests with the same uuid at once: the other won. Give these seats back.
    if (/** @type {any} */ (err)?.code === 'P2002') {
      await prisma.$transaction((tx) =>
        cancelBookingInTx(tx, booking, {
          initiatedBy: 'guest',
          reason: 'duplicate OTA request',
          actor: { type: 'system' },
          now: r.now ?? new Date(),
        }),
      );
      const winner = await prisma.channelBooking.findUniqueOrThrow({
        where: { channelId_uuid: { channelId: r.channel.id, uuid: r.uuid } },
      });
      return { channelBooking: winner, created: false };
    }
    throw err;
  }
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{
 *   channelBooking: import('@prisma/client').ChannelBooking,
 *   channelName: string,
 *   lead: { name: string, email: string | null, phone: string | null },
 *   resellerReference?: string | null,
 *   now?: Date,
 * }} c
 */
export function confirmChannelBooking(
  prisma,
  { channelBooking, channelName, lead, resellerReference, now = new Date() },
) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: channelBooking.bookingId } });
    // Confirmed already: the same answer again (a retry).
    if (channelBooking.confirmedAt) return booking;

    // The hold, locked: it can't run out (or be confirmed twice) while we confirm.
    /** @type {Array<{ status: string, expires_at: Date }>} */
    const [hold] = await tx.$queryRaw`
      SELECT status, expires_at FROM holds WHERE id = ${booking.holdId}::uuid FOR UPDATE`;
    if (booking.status !== 'held' || hold.status !== 'active' || hold.expires_at <= now) {
      throw new BookingError(
        'HOLD_EXPIRED',
        'The seats were released: the hold ran out or was cancelled.',
      );
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: { leadName: lead.name, leadEmail: lead.email, leadPhone: lead.phone },
    });
    // The lead is the first traveller (designs: the guide's manifest says "Hannah Weber", then
    // "Guest 2 of Hannah Weber's booking"). OCTO names only the contact (17c-3).
    await tx.traveller.updateMany({
      where: { bookingId: booking.id, position: 1, name: '' },
      data: { name: lead.name },
    });
    // The OTA took the guest's money: a payment from the OTA, for the whole price.
    const payment = await tx.payment.create({
      data: {
        operatorId: booking.operatorId,
        bookingId: booking.id,
        provider: 'ota',
        method: 'ota',
        purpose: 'full',
        amountKobo: booking.totalKobo,
        status: 'succeeded',
        reference: generatePaymentReference(),
        paidAt: now,
        channel: 'ota',
      },
    });
    if (booking.totalKobo > 0) {
      await postTransaction(tx, {
        operatorId: booking.operatorId,
        type: 'ota_sale',
        idempotencyKey: `ota-sale:${channelBooking.id}`,
        description: `${booking.reference} sold by ${channelName}`,
        lines: POSTINGS.otaSale(
          booking.totalKobo,
          percentOf(booking.totalKobo, channelBooking.commissionBasisPoints),
        ),
        bookingId: booking.id,
        paymentId: payment.id,
        occurredAt: now,
      });
    }
    // Held → paid, seats from held to sold: the same path as any payment.
    await settleBooking(tx, { ...booking, leadName: lead.name }, payment, now);
    await tx.channelBooking.update({
      where: { id: channelBooking.id },
      data: {
        confirmedAt: now,
        resellerReference: resellerReference ?? channelBooking.resellerReference,
      },
    });
    return tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
  }, TX);
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ channelBooking: import('@prisma/client').ChannelBooking, channelName: string, reason?: string | null, now?: Date }} c
 * @returns {Promise<{ refundKobo: number }>}
 */
export function cancelChannelBooking(
  prisma,
  { channelBooking, channelName, reason, now = new Date() },
) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: channelBooking.bookingId } });
    if (booking.status === 'cancelled' || booking.status === 'refunded') {
      return { refundKobo: booking.refundDueKobo }; // already: the same answer
    }
    const departure = await tx.departure.findUniqueOrThrow({ where: { id: booking.departureId } });
    if (departure.startsAt <= now) {
      throw new BookingError('TOO_LATE', 'The tour has started: it can’t be cancelled now.');
    }
    // The guest cancelled (through their OTA): the business's policy decides the refund.
    const refund = await cancelBookingInTx(tx, booking, {
      initiatedBy: 'guest',
      reason: reason?.trim() || `Cancelled by ${channelName}`,
      actor: { type: 'guest' },
      now,
    });
    // The OTA refunds its guest itself: settled at once inside cancelBookingInTx.
    return { refundKobo: refund.refundKobo };
  }, TX);
}

/**
 * More time on a held booking's hold: `minutes` from now, up to the most allowed.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ channelBooking: import('@prisma/client').ChannelBooking, minutes?: number, now?: Date }} c
 * @returns {Promise<Date>} when it now runs out
 */
export function extendChannelBooking(prisma, { channelBooking, minutes, now = new Date() }) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: channelBooking.bookingId } });
    const expiresAt = new Date(now.getTime() + holdMinutesFor(minutes) * 60_000);
    const updated = await tx.hold.updateMany({
      where: { id: booking.holdId, status: 'active', expiresAt: { gt: now } },
      data: { expiresAt },
    });
    if (booking.status !== 'held' || updated.count === 0) {
      throw new BookingError('HOLD_EXPIRED', 'Only seats still on hold can be held longer.');
    }
    return expiresAt;
  }, TX);
}
