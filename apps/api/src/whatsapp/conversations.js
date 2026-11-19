// @ts-check
/**
 * conversations.js — a guest's message arriving, on any channel (session 13).
 *
 *   receive(deps, { operator, channel, phone, name, input })
 *     1. find or start the guest's conversation (one per number, per operator, per channel)
 *     2. LOCK it, so two quick taps from the same guest are handled one after the other and
 *        the remembered state can't split
 *     3. store the guest's message
 *     4. if staff have taken over, stop here: a person answers (the bot stays quiet)
 *     5. otherwise run the engine, store its replies, remember the new state
 *     6. hand the replies to the channel to deliver
 *
 * The engine (engine.js) knows nothing about channels; the channel (channels.js) knows nothing
 * about booking.
 */
import { normalizePhone } from '@okapigo/shared/contact';
import { HttpError } from '../middleware/errors.js';
import { converse, giveBack } from './engine.js';
import { readState } from './state.js';

/** A turn can book (seats, a payment record…): give it room, but not forever. */
const TURN_TX = { maxWait: 15_000, timeout: 30_000 };

/**
 * @param {import('./engine.js').Deps & { channels: Record<string, { send: Function }> }} deps
 * @param {{
 *   operator: import('@prisma/client').Operator,
 *   channel: 'simulator' | 'whatsapp',
 *   phone: string,
 *   name?: string,
 *   input: import('./engine.js').Input & { title?: string },
 * }} message
 * @returns {Promise<{ conversationId: string, handledBy: string, replies: any[] }>}
 */
export async function receive(deps, { operator, channel, phone, name = '', input }) {
  const guestPhone = normalizePhone(phone);
  if (!guestPhone) throw new HttpError(400, 'VALIDATION_ERROR', 'That isn’t a phone number.');
  const { prisma } = deps;

  // 1. Find or start (the unique index makes two "first messages" at once safe).
  const conversation = await prisma.conversation.upsert({
    where: { operatorId_channel_guestPhone: { operatorId: operator.id, channel, guestPhone } },
    create: { operatorId: operator.id, channel, guestPhone, guestName: name.slice(0, 80) },
    update: {},
  });

  const result = await prisma.$transaction(async (tx) => {
    // 2. One message at a time per guest.
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversation.id}::uuid FOR UPDATE`;
    const current = await tx.conversation.findUniqueOrThrow({ where: { id: conversation.id } });

    // 3. The guest's message, as it arrived.
    await tx.chatMessage.create({
      data: {
        operatorId: operator.id,
        conversationId: current.id,
        direction: 'in',
        author: 'guest',
        body: input.choice
          ? { kind: 'reply', id: input.choice, title: input.title ?? input.choice }
          : { kind: 'text', text: (input.text ?? '').slice(0, 4096) },
      },
    });

    // 4. A person is answering: the bot stays out of it.
    if (current.handledBy === 'staff') {
      await tx.conversation.update({
        where: { id: current.id },
        data: { lastMessageAt: new Date() },
      });
      return { handledBy: 'staff', replies: [] };
    }

    // 5. The bot's turn. (It books with its own connections; this transaction only holds the
    //    conversation's lock and writes the messages.)
    const turn = await converse(deps, {
      operator,
      conversation: current,
      state: readState(current.state),
      input,
    });
    for (const body of turn.replies) {
      await tx.chatMessage.create({
        data: {
          operatorId: operator.id,
          conversationId: current.id,
          direction: 'out',
          author: 'bot',
          body,
        },
      });
    }
    await tx.conversation.update({
      where: { id: current.id },
      data: {
        state: turn.state,
        lastMessageAt: new Date(),
        ...(turn.bookingId !== undefined && { bookingId: turn.bookingId }),
        ...(turn.needsPerson && !current.needsPersonSince && { needsPersonSince: new Date() }),
        ...(!current.guestName && name && { guestName: name.slice(0, 80) }),
      },
    });
    return { handledBy: 'bot', replies: turn.replies };
  }, TURN_TX);

  // 6. Deliver (the simulator's channel shows them from the database; WhatsApp sends, 13c).
  if (result.replies.length > 0) {
    await deps.channels[channel].send({ operator, guestPhone, replies: result.replies });
  }
  return { conversationId: conversation.id, ...result };
}

/**
 * "New chat" in the simulator (stage 13c-2): the same guest starts over with an empty chat.
 * Any seats the old chat was holding are given back and its payment links stopped, as for
 * "start again"; paid bookings are untouched (they're the guest's, not the chat's).
 * @param {import('./engine.js').Deps} deps
 * @param {string} conversationId
 */
export async function resetConversation(deps, conversationId) {
  const { prisma } = deps;
  const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  await giveBack(deps, readState(c.state), { cancelLinks: true });
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE`;
    await tx.chatMessage.deleteMany({ where: { conversationId } });
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        state: { step: 'hello' },
        handledBy: 'bot',
        needsPersonSince: null,
        bookingId: null,
        lastMessageAt: new Date(),
      },
    });
  });
}
