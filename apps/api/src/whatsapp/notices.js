// @ts-check
/**
 * notices.js — what the WhatsApp assistant says ON ITS OWN, not as a reply (stages 13b, 13c):
 *
 *   chat_ticket     the money settled    → "✓ Booking confirmed", the QR ticket (an image), the
 *                                           trip link, "Tell us about allergies…" (catalogue:
 *                                           confirmed, ticket, trip_link, after)
 *   chat_hold_over  the 30 minutes ran   → "Your 30 minutes are up…" [Hold them again] (or
 *                   out before paying       "Choose another date" if the seats have gone)
 *   chat_declined   a payment failed     → "Your payment didn't go through…" [Try again]
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
import { clock, day, pickupWhere } from './engine.js';
import { plainName } from '../lib/guest-booking.js';

/** Booking statuses with a trip to go on (the trip hub's own list), so a ticket. */
const TICKET_STATUSES = ['confirmed', 'part_paid', 'paid', 'amended', 'completed'];
/** Only recent changes: an old booking never suddenly gets a message. */
const LOOK_BACK_MS = 2 * 24 * 60 * 60 * 1000;
/** Per run: plenty for a busy minute; the next run takes the rest. */
const BATCH = 50;

const BOOKING_INCLUDE = /** @type {const} */ ({
  product: { include: { operator: true, priceCategories: true } },
  departure: true,
  travellers: true,
  hold: true,
});

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
 * @typedef {'chat_ticket' | 'chat_hold_over' | 'chat_declined'} Kind
 */

/**
 * One pass: find what's due, send it. Returns how many went out of each kind.
 * @param {NoticeDeps} deps
 * @returns {Promise<{ tickets: number, holdsOver: number, declined: number }>}
 */
export async function sendChatNotices(deps) {
  const { prisma } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - LOOK_BACK_MS);

  /** @type {Array<{ booking: any, kind: Kind, key: string }>} */
  const due = [];
  // Paid (or confirmed), or out of time, with no message yet.
  const bookings = await prisma.booking.findMany({
    where: {
      channel: 'whatsapp',
      updatedAt: { gte: since },
      OR: [
        { status: { in: TICKET_STATUSES } },
        { status: 'cancelled', hold: { status: 'expired' } },
      ],
      notifications: { none: { key: { in: ['chat_ticket', 'chat_hold_over'] } } },
    },
    include: BOOKING_INCLUDE,
    orderBy: { updatedAt: 'asc' },
    take: BATCH,
  });
  for (const booking of bookings) {
    const kind = booking.status === 'cancelled' ? 'chat_hold_over' : 'chat_ticket';
    due.push({ booking, kind, key: kind });
  }
  // A payment that failed while the seats are still held: one message per failed payment.
  const failed = await prisma.payment.findMany({
    where: {
      status: 'failed',
      updatedAt: { gte: since },
      booking: { channel: 'whatsapp', status: 'held' },
    },
    include: { booking: { include: { ...BOOKING_INCLUDE, notifications: true } } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH,
  });
  for (const p of failed) {
    const key = `chat_declined:${p.id}`;
    if (p.booking.notifications.some((n) => n.key === key)) continue;
    due.push({ booking: p.booking, kind: 'chat_declined', key });
  }

  const sent = { tickets: 0, holdsOver: 0, declined: 0 };
  for (const { booking, kind, key } of due) {
    try {
      if (await notify(deps, booking, kind, key, now)) {
        if (kind === 'chat_ticket') sent.tickets++;
        else if (kind === 'chat_hold_over') sent.holdsOver++;
        else sent.declined++;
      }
    } catch (err) {
      // One bad booking mustn't stop the others; it's tried again on the next run.
      deps.log?.warn({ err, bookingId: booking.id, kind }, 'chat notice failed');
    }
  }
  return sent;
}

/**
 * @param {NoticeDeps} deps @param {any} booking @param {Kind} kind @param {string} key @param {Date} now
 * @returns {Promise<boolean>} sent?
 */
async function notify(deps, booking, kind, key, now) {
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
  const replies =
    kind === 'chat_ticket'
      ? ticket(deps, booking)
      : kind === 'chat_hold_over'
        ? [say.holdExpired(await stillFree(prisma, booking, now))]
        : booking.hold.status === 'active' && booking.hold.expiresAt > now
          ? [say.declined(clock(booking.hold.expiresAt, operator.timeZone))]
          : null; // the hold ran out too: "30 minutes are up" says it

  const result = await prisma.$transaction(async (tx) => {
    if (conversation) {
      // The same lock as a guest's message (conversations.js): never in the middle of a turn.
      await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversation.id}::uuid FOR UPDATE`;
    }
    const current = conversation
      ? await tx.conversation.findUniqueOrThrow({ where: { id: conversation.id } })
      : null;
    // "Hold them again" and "Try again" only make sense while the chat is on THIS booking.
    const onIt = current?.bookingId === booking.id;
    const relevant = current && replies && (kind === 'chat_ticket' || onIt) ? current : null;

    // Claim it: the unique (booking, key) index lets exactly one run through. A notice with
    // nobody to tell is recorded as cancelled, so it isn't looked at again.
    const { count } = await tx.notification.createMany({
      data: [
        {
          operatorId: booking.operatorId,
          bookingId: booking.id,
          audience: 'guest',
          kind,
          key,
          data: { conversationId: relevant?.id ?? null },
          status: relevant ? 'sent' : 'cancelled',
          sentAt: relevant ? now : null,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0 || !relevant || !replies) return null;

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
    const state = /** @type {any} */ (relevant.state ?? {});
    await tx.conversation.update({
      where: { id: relevant.id },
      data: {
        lastMessageAt: now,
        // Out of time: the chat remembers what was chosen, so "Hold them again" can redo it.
        ...(kind === 'chat_hold_over' && {
          bookingId: null,
          state: { ...state, step: 'hold_over', bookingId: undefined },
        }),
        // Paid: from now on, anything the guest types goes to the team (decided 2026-11-19).
        ...(kind === 'chat_ticket' && onIt && { state: { step: 'booked', bookingId: booking.id } }),
      },
    });
    return { channel: relevant.channel, guestPhone: relevant.guestPhone };
  });

  if (!result) return false;
  await deps.channels[result.channel]?.send({
    operator,
    guestPhone: result.guestPhone,
    replies,
  });
  return true;
}

/** Are there still enough seats on that date for the same people? @param {any} prisma @param {any} booking @param {Date} now */
async function stillFree(prisma, booking, now) {
  const d = await prisma.departure.findUnique({ where: { id: booking.departureId } });
  if (!d || d.status !== 'scheduled' || d.startsAt <= now) return false;
  return d.capacity - d.seatsSold - d.seatsHeld >= booking.travellers.length;
}

/**
 * The ticket, in four messages (catalogue: confirmed, ticket, trip_link, after).
 * @param {NoticeDeps} deps @param {any} booking
 */
function ticket(deps, booking) {
  const operator = booking.product.operator;
  const tz = operator.timeZone;
  const token = guestToken(deps.authSecret, booking.id);
  const when = `${day(booking.departure.startsAt, tz)} · ${clock(booking.departure.startsAt, tz)}`;
  // The pickup point as COPIED onto the booking (name, address, time): renaming it later
  // can't change where this guest waits.
  const point = /** @type {any} */ (booking.pickupPoint);
  const meet = booking.product.meetingPoint?.name ?? null;
  const where = point ? `Pickup: ${pickupWhere(point)}` : meet ? `Meet at ${meet}` : null;

  const owed = booking.totalKobo - booking.amountPaidKobo;
  const money =
    owed > 0 && booking.amountPaidKobo > 0
      ? `Deposit paid ${formatNaira(booking.amountPaidKobo)} · balance ${formatNaira(owed)} due by ${formatLocalDay(balanceDueDate(localDate(booking.departure.startsAt, tz)))}`
      : booking.amountPaidKobo > 0
        ? `Paid ${formatNaira(booking.amountPaidKobo)}`
        : null;

  const api = deps.apiPublicUrl.replace(/\/+$/, '');
  const web = deps.webPublicUrl.replace(/\/+$/, '');
  return [
    say.confirmed(
      [
        `Booking ${booking.reference}`,
        booking.product.title,
        when,
        where,
        whoIsComing(booking),
        money,
      ].filter((l) => l !== null),
    ),
    say.ticketImage(`${api}/public/bookings/${token}/ticket.png`),
    say.tripLink(`${web}/trip/${token}`, {
      title: `Your trip · ${booking.product.title}`,
      description: [when, point?.name ?? meet].filter(Boolean).join(' · '),
    }),
    say.after(),
  ];
}

/**
 * "2 adults · 1 palm wine sampler", from the price the guest agreed to (booking.quote).
 * @param {any} booking
 */
export function whoIsComing(booking) {
  const lines = /** @type {any[]} */ (booking.quote?.lines ?? []);
  return lines
    .map((l) => {
      if (l.type === 'addOn') {
        const name = `${l.label.charAt(0).toLowerCase()}${l.label.slice(1)}`;
        return `${l.quantity} ${name}${l.quantity === 1 ? '' : 's'}`;
      }
      if (l.type !== 'ticket') return null;
      const cat = booking.product.priceCategories?.find(
        (/** @type {any} */ c) => c.key === l.categoryKey,
      ) ?? { name: l.label };
      const word = plainName(cat).toLowerCase();
      const many = word === 'child' ? 'children' : word.endsWith('s') ? word : `${word}s`;
      return `${l.quantity} ${l.quantity === 1 ? word : many}`;
    })
    .filter(Boolean)
    .join(' · ');
}
