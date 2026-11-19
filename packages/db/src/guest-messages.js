// @ts-check
/**
 * guest-messages.js — DECIDING which messages a guest gets (OPS-11, stage 14a). Sending is
 * the API's job (apps/api/src/messages/); this only writes them to the outbox, in the SAME
 * transaction as what caused them. So a confirmation exists exactly when the payment does:
 * if the payment's transaction rolls back, so does its message, and nothing is ever planned
 * twice (the unique booking + key index).
 *
 *   held → paid / confirmed        booking_confirmed           (transitionBookingInTx)
 *   held → part_paid               deposit_received            (transitionBookingInTx)
 *   a sold booking → cancelled     booking_cancelled           (transitionBookingInTx)
 *   a refund has left              refund_sent:<refund id>     (markRefundProcessed)
 *   staff send a payment link      payment_link:<link id>      (the staff route)
 *   7 / 3 / 1 days before due      balance_reminder:<days>     (queueBalanceNotices)
 *
 * One row per CHANNEL ("…:whatsapp", "…:email"), so each can be sent, or fail, on its own:
 *   WhatsApp  when the guest gave a phone, except the confirmation and deposit messages for
 *             a booking MADE on WhatsApp: the chat already has its ticket (13b)
 *   email     when the guest gave an email (decided 2026-11-19: WhatsApp guests too)
 */

/** Statuses a booking has once its seats are sold (cancelling one tells the guest). */
const SOLD = ['confirmed', 'part_paid', 'paid', 'amended'];

/**
 * Writes a guest message to the outbox, once per channel. Returns how many rows were new.
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} tx
 * @param {{
 *   booking: { id: string, operatorId: string, channel: string, leadPhone: string | null, leadEmail: string | null },
 *   kind: import('@okapigo/shared/message-templates').MessageKind,
 *   key: string,
 *   data?: Record<string, unknown>,
 * }} m
 */
export async function planGuestMessage(tx, { booking, kind, key, data = {} }) {
  const chatHasIt =
    booking.channel === 'whatsapp' && (kind === 'booking_confirmed' || kind === 'deposit_received');
  const channels = [
    ...(booking.leadPhone && !chatHasIt ? ['whatsapp'] : []),
    ...(booking.leadEmail ? ['email'] : []),
  ];
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
  if (from === 'held' && (to === 'paid' || to === 'confirmed')) {
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
      },
    });
  }
}
