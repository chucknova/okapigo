// @ts-check
/**
 * send.js — SENDING the guest messages the outbox holds (OPS-11, stage 14a).
 *
 * The API runs sendGuestMessages() every few seconds (server.js), next to the chat's own
 * notices; tests call it directly. For each waiting message:
 *
 *   1. claim it (pending → sent, one UPDATE): with several API processes, exactly one wins
 *   2. put it into words: the business's template, filled from the booking (compose.js)
 *   3. deliver it on its channel
 *        whatsapp  into the guest's chat (found by their number; a new chat if they've never
 *                  written), then delivered like any message (channels.js: the simulator
 *                  shows it; real WhatsApp gets it, inside its 24-hour rule: 14c adds the
 *                  templates WhatsApp allows outside it)
 *        email     stage 14b (until then, emails wait, and are dropped after 3 days)
 *   4. if the channel refused it: status "failed", with why, for staff
 *
 * Messages older than 3 days that never went are cancelled: "your booking is confirmed",
 * arriving a week late, would only confuse.
 */
import { compose } from './compose.js';
import { deliver } from '../whatsapp/channels.js';

const STALE_MS = 3 * 24 * 60 * 60 * 1000;
const BATCH = 50;

/**
 * @typedef {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   authSecret: string,
 *   webPublicUrl: string,
 *   channels: Record<string, import('../whatsapp/channels.js').Channel>,
 *   log?: { warn: Function },
 *   now?: () => Date,
 * }} SendDeps
 */

/**
 * @param {SendDeps} deps
 * @returns {Promise<{ sent: number, failed: number, stale: number }>}
 */
export async function sendGuestMessages(deps) {
  const { prisma } = deps;
  const now = (deps.now ?? (() => new Date()))();
  // The channels this server can send on right now (email joins in 14b).
  const channels = ['whatsapp'];

  const { count: stale } = await prisma.notification.updateMany({
    where: {
      audience: 'guest',
      status: 'pending',
      channel: { not: null },
      createdAt: { lt: new Date(now.getTime() - STALE_MS) },
    },
    data: { status: 'cancelled' },
  });

  const waiting = await prisma.notification.findMany({
    where: { audience: 'guest', status: 'pending', channel: { in: channels } },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
    include: {
      booking: {
        include: { product: { include: { operator: true } }, departure: true, travellers: true },
      },
    },
  });

  const result = { sent: 0, failed: 0, stale };
  for (const n of waiting) {
    // 1. Claim it: only one sender gets count 1.
    const { count } = await prisma.notification.updateMany({
      where: { id: n.id, status: 'pending' },
      data: { status: 'sent', sentAt: now },
    });
    if (count === 0) continue;
    let error = null;
    try {
      const words = await compose(deps, n.booking, n);
      if (n.channel === 'whatsapp') error = await toChat(deps, n.booking, words.body, now);
    } catch (err) {
      error = `ERROR: ${/** @type {Error} */ (err).message}`;
      deps.log?.warn({ err, notificationId: n.id }, 'guest message failed');
    }
    // 4. What happened; and a payment link's address isn't kept once it's been sent.
    const data = /** @type {any} */ ({ .../** @type {object} */ (n.data ?? {}) });
    if (n.kind === 'payment_link') delete data.url;
    await prisma.notification.update({
      where: { id: n.id },
      data: error
        ? { status: 'failed', sentAt: null, data: { ...data, error: error.slice(0, 300) } }
        : { data },
    });
    if (error) result.failed++;
    else result.sent++;
  }
  return result;
}

/**
 * Into the guest's chat: the one they last used with this business (simulator or WhatsApp),
 * or a new simulator chat if they never wrote. Returns why it failed, or null.
 * @param {SendDeps} deps @param {any} booking @param {string} body @param {Date} now
 */
async function toChat(deps, booking, body, now) {
  const { prisma } = deps;
  const operator = booking.product.operator;
  const guestPhone = booking.leadPhone;
  const existing = await prisma.conversation.findFirst({
    where: { operatorId: operator.id, guestPhone },
    orderBy: { lastMessageAt: 'desc' },
  });
  const conversation =
    existing ??
    (await prisma.conversation.upsert({
      where: {
        operatorId_channel_guestPhone: {
          operatorId: operator.id,
          channel: 'simulator',
          guestPhone,
        },
      },
      create: {
        operatorId: operator.id,
        channel: 'simulator',
        guestPhone,
        guestName: (booking.leadName ?? '').slice(0, 80),
      },
      update: {},
    }));

  // The chat's own lock (conversations.js): never in the middle of the guest's turn.
  const stored = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversation.id}::uuid FOR UPDATE`;
    const m = await tx.chatMessage.create({
      data: {
        operatorId: operator.id,
        conversationId: conversation.id,
        direction: 'out',
        author: 'bot',
        body: { kind: 'text', text: body },
      },
    });
    await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now } });
    return m;
  });

  await deliver(deps, {
    conversation,
    operator,
    messages: [{ id: stored.id, body: stored.body }],
    unprompted: true,
  });
  const after = await prisma.chatMessage.findUniqueOrThrow({ where: { id: stored.id } });
  return after.delivery === 'failed' ? (after.deliveryError ?? 'failed') : null;
}
