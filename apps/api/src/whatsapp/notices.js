// @ts-check
/**
 * notices.js — what the WhatsApp assistant says ON ITS OWN, not as a reply (stage 13b):
 *
 *   chat_ticket     the money settled   → "✓ Booking confirmed", the QR ticket (an image) and
 *                                          the trip link (decided 2026-11-18)
 *   chat_hold_over  the 30 minutes ran  → "Your 30 minutes are up" [Hold them again] [See tours]
 *                   out before paying
 *
 * Nobody is waiting on a reply here, so nothing in the payment code has to know about chats:
 * the dispatcher LOOKS for WhatsApp bookings in those states that haven't had their message,
 * and sends it. That's the "outbox" idea from session 11 (balance reminders): each message is
 * a row in `notifications`, unique per booking and key, written in the SAME transaction as the
 * chat messages. So however often the dispatcher runs, and on however many API processes, a
 * guest gets each message once.
 *
 * The API runs it every few seconds (server.js); tests call sendChatNotices() directly.
 */
import { guestToken } from '@okapigo/db';
import { formatNaira } from '@okapigo/shared/money';
import { formatLocalDay } from '@okapigo/shared/preview';
import { localDate } from '@okapigo/shared/time';
import { balanceDueDate } from '@okapigo/shared/deposits';
import { say } from './messages.js';

/** Booking statuses with a trip to go on (the trip hub's own list), so a ticket. */
const TICKET_STATUSES = ['confirmed', 'part_paid', 'paid', 'amended', 'completed'];
/** Only recent changes: an old booking never suddenly gets a message. */
const LOOK_BACK_MS = 2 * 24 * 60 * 60 * 1000;
/** Per run: plenty for a busy minute; the next run takes the rest. */
const BATCH = 50;

/**
 * @typedef {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   authSecret: string,
 *   apiPublicUrl: string,
 *   webPublicUrl: string,
 *   channels: Record<string, { send: Function }>,
 *   log?: { warn: Function },
 *   now?: () => Date,
 * }} NoticeDeps
 */

/**
 * One pass: find what's due, send it. Returns how many messages went out.
 * @param {NoticeDeps} deps
 * @returns {Promise<{ tickets: number, holdsOver: number }>}
 */
export async function sendChatNotices(deps) {
  const { prisma } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const due = await prisma.booking.findMany({
    where: {
      channel: 'whatsapp',
      updatedAt: { gte: new Date(now.getTime() - LOOK_BACK_MS) },
      OR: [
        { status: { in: TICKET_STATUSES } },
        { status: 'cancelled', hold: { status: 'expired' } },
      ],
      notifications: { none: { key: { in: ['chat_ticket', 'chat_hold_over'] } } },
    },
    include: { product: { include: { operator: true } }, departure: true, travellers: true },
    orderBy: { updatedAt: 'asc' },
    take: BATCH,
  });

  const sent = { tickets: 0, holdsOver: 0 };
  for (const booking of due) {
    const kind = booking.status === 'cancelled' ? 'chat_hold_over' : 'chat_ticket';
    try {
      if (await notify(deps, booking, kind, now)) {
        if (kind === 'chat_ticket') sent.tickets++;
        else sent.holdsOver++;
      }
    } catch (err) {
      // One bad booking mustn't stop the others; it's tried again on the next run.
      deps.log?.warn({ err, bookingId: booking.id, kind }, 'chat notice failed');
    }
  }
  return sent;
}

/**
 * @param {NoticeDeps} deps @param {any} booking
 * @param {'chat_ticket' | 'chat_hold_over'} kind @param {Date} now
 * @returns {Promise<boolean>} sent?
 */
async function notify(deps, booking, kind, now) {
  const { prisma } = deps;
  const operator = booking.product.operator;
  // The guest's chat: their number, on this business. (Not conversations.bookingId alone: a
  // guest who typed "menu" after paying has moved on, and should still get the ticket.)
  const conversation = booking.leadPhone
    ? await prisma.conversation.findFirst({
        where: { operatorId: booking.operatorId, guestPhone: booking.leadPhone },
        orderBy: { lastMessageAt: 'desc' },
      })
    : null;

  const result = await prisma.$transaction(async (tx) => {
    if (conversation) {
      // The same lock as a guest's message (conversations.js): never in the middle of a turn.
      await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversation.id}::uuid FOR UPDATE`;
    }
    const current = conversation
      ? await tx.conversation.findUniqueOrThrow({ where: { id: conversation.id } })
      : null;
    // "Hold them again" only makes sense if the chat is still on THIS booking.
    const relevant =
      current && (kind === 'chat_ticket' || current.bookingId === booking.id) ? current : null;

    // Claim it: the unique (booking, key) index lets exactly one run through. A notice with
    // nobody to tell is recorded as cancelled, so it isn't looked at again.
    const { count } = await tx.notification.createMany({
      data: [
        {
          operatorId: booking.operatorId,
          bookingId: booking.id,
          audience: 'guest',
          kind,
          key: kind,
          data: { conversationId: relevant?.id ?? null },
          status: relevant ? 'sent' : 'cancelled',
          sentAt: relevant ? now : null,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0 || !relevant) return null;

    const replies = kind === 'chat_ticket' ? ticket(deps, booking) : [say.holdExpired()];
    for (const body of replies) {
      await tx.chatMessage.create({
        data: {
          operatorId: booking.operatorId,
          conversationId: relevant.id,
          direction: 'out',
          author: 'bot',
          body,
        },
      });
    }
    await tx.conversation.update({
      where: { id: relevant.id },
      data: {
        lastMessageAt: now,
        // Out of time: the chat remembers what was chosen, so "Hold them again" can redo it.
        ...(kind === 'chat_hold_over' && {
          bookingId: null,
          state: { .../** @type {object} */ (relevant.state ?? {}), step: 'hold_over' },
        }),
      },
    });
    return { channel: relevant.channel, guestPhone: relevant.guestPhone, replies };
  });

  if (!result) return false;
  await deps.channels[result.channel]?.send({
    operator,
    guestPhone: result.guestPhone,
    replies: result.replies,
  });
  return true;
}

/**
 * The ticket, in three messages: the booking, the QR image, the trip link.
 * @param {NoticeDeps} deps @param {any} booking
 */
function ticket(deps, booking) {
  const operator = booking.product.operator;
  const tz = operator.timeZone;
  const token = guestToken(deps.authSecret, booking.id);
  const day = formatLocalDay(localDate(booking.departure.startsAt, tz));
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: tz,
  }).format(booking.departure.startsAt);
  const n = booking.travellers.length;
  const where = booking.pickupPoint
    ? `Pickup: ${booking.pickupPoint.name}`
    : booking.product.meetingPoint?.name
      ? `Meet at: ${booking.product.meetingPoint.name}`
      : null;
  const owed = booking.totalKobo - booking.amountPaidKobo;
  const money =
    owed > 0
      ? `Paid ${formatNaira(booking.amountPaidKobo)} · ${formatNaira(owed)} to pay by ${formatLocalDay(balanceDueDate(localDate(booking.departure.startsAt, tz)))}`
      : booking.amountPaidKobo > 0
        ? `Paid ${formatNaira(booking.amountPaidKobo)}`
        : null;
  const api = deps.apiPublicUrl.replace(/\/+$/, '');
  const web = deps.webPublicUrl.replace(/\/+$/, '');
  return [
    say.ticket(
      [
        `✓ Booking confirmed · ${booking.reference}`,
        '',
        `*${booking.product.title}*`,
        `${day} · ${time}`,
        `${n} ${n === 1 ? 'traveller' : 'travellers'}`,
        where,
        money,
      ].filter((l) => l !== null),
    ),
    say.ticketImage(`${api}/public/bookings/${token}/ticket.png`, booking.reference),
    say.tripLink(`${web}/trip/${token}`),
  ];
}
