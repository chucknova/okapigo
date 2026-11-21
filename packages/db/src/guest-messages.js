// @ts-check
/**
 * guest-messages.js — DECIDING which messages a guest gets (OPS-11, stage 14a). Sending is
 * the API's job (apps/api/src/messages/); this only writes them to the outbox, in the SAME
 * transaction as what caused them. So a confirmation exists exactly when the payment does:
 * if the payment's transaction rolls back, so does its message, and nothing is ever planned
 * twice (the unique booking + key index).
 *
 *   held → paid / confirmed        booking_confirmed           (transitionBookingInTx)
 *                                  an OTA's sale: trip_link, by email (17c-3)
 *   held → part_paid               deposit_received            (transitionBookingInTx)
 *   a sold booking → cancelled     booking_cancelled           (transitionBookingInTx)
 *   a refund has left              refund_sent:<refund id>     (markRefundProcessed)
 *   staff send a payment link      payment_link:<link id>      (the staff route)
 *   7 / 3 / 1 days before due      balance_reminder:<days>     (queueBalanceNotices)
 *
 * A travel website's guest (an OTA's booking) hears from the website about the booking and the
 * money (decided 2026-11-21, 17b and 17c-3): from us only the trip page (trip_link), a date we
 * moved (booking_moved), and what staff send on purpose (a message, a payment link).
 *
 * One row per CHANNEL ("…:whatsapp", "…:email"), so each can be sent, or fail, on its own:
 *   WhatsApp  when the guest gave a phone, except the confirmation and deposit messages for
 *             a booking MADE on WhatsApp: the chat already has its ticket (13b)
 *   email     when the guest gave an email (decided 2026-11-19: WhatsApp guests too)
 */

/** Statuses a booking has once its seats are sold (cancelling one tells the guest). */
const SOLD = ['confirmed', 'part_paid', 'paid', 'amended'];

/** What an OTA's guest gets from us (the rest comes from the OTA). */
const FOR_OTA_GUESTS = ['trip_link', 'booking_moved', 'staff_message', 'payment_link'];

/**
 * Writes a guest message to the outbox, once per channel. Returns how many rows were new.
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} tx
 * @param {{
 *   booking: { id: string, operatorId: string, channel: string, leadPhone: string | null, leadEmail: string | null },
 *   kind: import('@okapigo/shared/message-templates').MessageKind | 'staff_message',
 *   key: string,
 *   data?: Record<string, unknown>,
 *   only?: string[],
 * }} m   only: just these channels (a staff message by email, 16d-1)
 */
export async function planGuestMessage(tx, { booking, kind, key, data = {}, only }) {
  if (booking.channel === 'ota' && !FOR_OTA_GUESTS.includes(kind)) return 0;
  const chatHasIt =
    booking.channel === 'whatsapp' && (kind === 'booking_confirmed' || kind === 'deposit_received');
  const channels = [
    ...(booking.leadPhone && !chatHasIt ? ['whatsapp'] : []),
    ...(booking.leadEmail ? ['email'] : []),
  ].filter((c) => !only || only.includes(c)); // e.g. a staff message by email only (16d-1)
  if (channels.length === 0) return 0;
  const { count } = await tx.notification.createMany({
    data: channels.map((channel) => ({
      operatorId: booking.operatorId,
      bookingId: booking.id,
      audience: 'guest',
      kind,
      channel,
      key: `${key}:${channel}`,
      data: /** @type {any} */ (data),
    })),
    skipDuplicates: true, // decided before (a retried webhook, a re-run job): not again
  });
  return count;
}

/**
 * The messages a status change brings (called by transitionBookingInTx, the ONE place a
 * booking's status changes).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {import('@prisma/client').Booking} booking  as it is AFTER the change
 * @param {{ from: string, to: string, data: any }} change
 */
export async function planForTransition(tx, booking, { from, to, data }) {
  if (from === 'held' && (to === 'paid' || to === 'confirmed') && booking.channel === 'ota') {
    // The OTA confirmed it to its guest: we send the trip page (by email: OCTO always has one).
    const cb = await tx.channelBooking.findUnique({
      where: { bookingId: booking.id },
      include: { channel: { select: { name: true } } },
    });
    await planGuestMessage(tx, {
      booking,
      kind: 'trip_link',
      key: 'trip_link',
      data: { channelName: cb?.channel.name ?? 'a travel website' },
      only: ['email'],
    });
  } else if (from === 'held' && (to === 'paid' || to === 'confirmed')) {
    await planGuestMessage(tx, { booking, kind: 'booking_confirmed', key: 'booking_confirmed' });
  } else if (from === 'held' && to === 'part_paid') {
    await planGuestMessage(tx, {
      booking,
      kind: 'deposit_received',
      key: 'deposit_received',
      data: {
        depositKobo: booking.amountPaidKobo,
        balanceKobo: booking.totalKobo - booking.amountPaidKobo,
      },
    });
  } else if (to === 'cancelled' && SOLD.includes(from)) {
    // A hold that ran out or was given back isn't a booking the guest has: no message.
    const r = data?.refund;
    await planGuestMessage(tx, {
      booking,
      kind: 'booking_cancelled',
      key: 'booking_cancelled',
      data: {
        refund: r
          ? {
              refundKobo: r.refundKobo,
              refundBasisPoints: r.refundBasisPoints ?? null,
              hoursBefore: r.hoursBefore ?? null,
              overridden: Boolean(r.overridden),
            }
          : null,
        initiatedBy: data?.initiatedBy ?? null,
        // Why, when the business called it off ("bad weather at sea"): told to the guest.
        reason: data?.initiatedBy === 'operator' ? (data?.reason ?? null) : null,
      },
    });
  }
}
