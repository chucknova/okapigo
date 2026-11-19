// @ts-check
/**
 * WhatsApp conversations, for staff (stage 13b; flow brief screen H). The API now; the
 * screen is designed later with the operator app (decided 2026-11-18).
 *
 *   GET  /api/conversations                  bookings: view   who needs a person first
 *   GET  /api/conversations/:id              bookings: view   the chat, oldest first
 *   POST /api/conversations/:id/take-over    bookings: edit   staff answer; the bot goes quiet
 *   POST /api/conversations/:id/messages     bookings: edit   a staff reply { text }
 *   POST /api/conversations/:id/hand-back    bookings: edit   the bot answers again
 *
 * Every change takes the SAME lock as a guest's message (whatsapp/conversations.js), so a
 * take-over can't land in the middle of the bot's turn, and the two never answer at once.
 * The guest sees what happened: "Tunde from the Ìrìn team has joined the chat."
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { say, text } from '../whatsapp/messages.js';

const ReplyBody = z.object({ text: z.string().trim().min(1).max(4096) });

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   channels: Record<string, { send: Function }>,
 * }} deps
 */
export function conversationsRouter({ prisma, channels }) {
  const router = Router();
  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;

  router.get('/conversations', requirePermission('bookings', 'view'), async (req, res) => {
    const { operatorId } = authOf(req);
    // Waiting for a person first (longest wait at the top), then the most recent chats.
    const rows = await prisma.conversation.findMany({
      where: { operatorId },
      orderBy: [{ needsPersonSince: { sort: 'asc', nulls: 'last' } }, { lastMessageAt: 'desc' }],
      take: 100,
      include: {
        booking: { select: { id: true, reference: true, status: true } },
        messages: { orderBy: { seq: 'desc' }, take: 1 },
      },
    });
    res.json({
      conversations: rows.map((c) => ({
        ...summaryOf(c),
        lastMessage: c.messages[0] ? messageOf(c.messages[0]) : null,
      })),
    });
  });

  router.get(
    '/conversations/:id',
    requirePermission('bookings', 'view'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const c = await prisma.conversation.findFirst({
        where: { id: req.params.id, operatorId: authOf(req).operatorId },
        include: {
          booking: { select: { id: true, reference: true, status: true } },
          // The LATEST 500, shown oldest first.
          messages: { orderBy: { seq: 'desc' }, take: 500 },
        },
      });
      if (!c) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found.');
      res.json({
        conversation: { ...summaryOf(c), messages: c.messages.reverse().map(messageOf) },
      });
    },
  );

  router.post(
    '/conversations/:id/take-over',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const result = await change(req.params.id, operatorId, async (tx, c, operator) => {
        if (c.handledBy === 'staff') return { conversation: c, out: [] }; // already: no repeat
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const out = [say.staffJoined(user.name, operator.name)];
        await store(tx, c, out, 'bot');
        const conversation = await tx.conversation.update({
          where: { id: c.id },
          data: { handledBy: 'staff', needsPersonSince: null, lastMessageAt: new Date() },
        });
        return { conversation, out };
      });
      res.json({ conversation: summaryOf(result.conversation) });
    },
  );

  router.post(
    '/conversations/:id/messages',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema, body: ReplyBody }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const result = await change(req.params.id, operatorId, async (tx, c) => {
        // One voice at a time: while the bot answers, staff take over first.
        if (c.handledBy !== 'staff') {
          throw new HttpError(409, 'NOT_TAKEN_OVER', 'Take over the chat before replying.');
        }
        const out = [text(req.body.text)];
        const [message] = await store(tx, c, out, 'staff', userId);
        const conversation = await tx.conversation.update({
          where: { id: c.id },
          data: { lastMessageAt: new Date() },
        });
        return { conversation, out, message };
      });
      res.status(201).json({ message: messageOf(result.message) });
    },
  );

  router.post(
    '/conversations/:id/hand-back',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const { operatorId } = authOf(req);
      const result = await change(req.params.id, operatorId, async (tx, c) => {
        if (c.handledBy === 'bot') return { conversation: c, out: [] };
        const out = [say.handBack()];
        await store(tx, c, out, 'bot');
        // The bot starts from the top (staff may have changed anything meanwhile), but keeps
        // the booking it was holding, so "menu" still gives those seats back as before.
        const held = /** @type {any} */ (c.state)?.bookingId;
        const conversation = await tx.conversation.update({
          where: { id: c.id },
          data: {
            handledBy: 'bot',
            state: { step: 'hello', ...(held && { bookingId: held }) },
            lastMessageAt: new Date(),
          },
        });
        return { conversation, out };
      });
      res.json({ conversation: summaryOf(result.conversation) });
    },
  );

  /**
   * Locks the conversation (the guest's lock), runs `fn`, then delivers what it said.
   * @template {{ conversation: any, out: any[] }} T
   * @param {string} id @param {string} operatorId
   * @param {(tx: any, c: any, operator: any) => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function change(id, operatorId, fn) {
    let operator;
    let guestPhone = '';
    let channel = '';
    const result = await prisma.$transaction(async (tx) => {
      const found = await tx.conversation.findFirst({ where: { id, operatorId } });
      if (!found) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found.');
      await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${id}::uuid FOR UPDATE`;
      const c = await tx.conversation.findUniqueOrThrow({ where: { id } });
      operator = await tx.operator.findUniqueOrThrow({ where: { id: operatorId } });
      guestPhone = c.guestPhone;
      channel = c.channel;
      return fn(tx, c, operator);
    });
    if (result.out.length > 0) {
      await channels[channel]?.send({ operator, guestPhone, replies: result.out });
    }
    return result;
  }

  return router;
}

/**
 * @param {any} tx @param {any} c @param {any[]} bodies
 * @param {'bot' | 'staff'} author @param {string} [userId]
 */
async function store(tx, c, bodies, author, userId) {
  const created = [];
  for (const body of bodies) {
    created.push(
      await tx.chatMessage.create({
        data: {
          operatorId: c.operatorId,
          conversationId: c.id,
          direction: 'out',
          author,
          authorUserId: userId ?? null,
          body,
        },
      }),
    );
  }
  return created;
}

/** @param {any} c */
const summaryOf = (c) => ({
  id: c.id,
  channel: c.channel,
  guest: { name: c.guestName, phone: c.guestPhone },
  handledBy: c.handledBy,
  needsPersonSince: c.needsPersonSince,
  lastMessageAt: c.lastMessageAt,
  booking: c.booking ?? null,
});

/** @param {any} m */
const messageOf = (m) => ({
  id: m.id,
  direction: m.direction,
  author: m.author,
  authorUserId: m.authorUserId,
  body: m.body,
  createdAt: m.createdAt,
});
