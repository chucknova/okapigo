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
import { welcomeBack } from '../whatsapp/engine.js';
import { readState } from '../whatsapp/state.js';
import { deliver, withinServiceWindow } from '../whatsapp/channels.js';

const ReplyBody = z.object({ text: z.string().trim().min(1).max(4096) });

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   quotes: any,
 *   jobs: any,
 *   webPublicUrl: string,
 *   channels: Record<string, import('../whatsapp/channels.js').Channel>,
 * }} deps
 */
export function conversationsRouter({ prisma, quotes, jobs, webPublicUrl, channels }) {
  const router = Router();
  const engineDeps = { prisma, quotes, jobs, webPublicUrl };
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
      const ids = [...new Set(c.messages.map((m) => m.authorUserId).filter(Boolean))];
      const names = new Map(
        (
          await prisma.user.findMany({
            where: {
              id: { in: /** @type {string[]} */ (ids) },
              operatorId: authOf(req).operatorId,
            },
            select: { id: true, name: true },
          })
        ).map((u) => [u.id, u.name]),
      );
      res.json({
        conversation: {
          ...summaryOf(c),
          messages: c.messages.reverse().map((m) => ({
            ...messageOf(m),
            authorName: m.authorUserId ? (names.get(m.authorUserId) ?? null) : null,
          })),
        },
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
        const out = await store(tx, c, [say.staffJoined(user.name, operator.name)], 'bot');
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
        // WhatsApp's rule: a free-form message only within 24 hours of the guest's last one.
        if (!(await withinServiceWindow(tx, c))) {
          throw new HttpError(
            409,
            'OUTSIDE_24H',
            'The guest last wrote more than 24 hours ago, so WhatsApp won’t take a free message now. They need to write first.',
          );
        }
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const out = await store(tx, c, [text(req.body.text)], 'staff', userId, user.name);
        const [message] = out;
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
      const { operatorId, userId } = authOf(req);
      const result = await change(req.params.id, operatorId, async (tx, c, operator) => {
        if (c.handledBy === 'bot') return { conversation: c, out: [] };
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        // The bot picks up where the guest was (catalogue: handback). It reads with its own
        // connection; this transaction holds the conversation's lock and writes.
        const turn = await welcomeBack(
          { deps: { ...engineDeps, log: req.log }, operator, conversation: c },
          readState(c.state),
        );
        const out = await store(tx, c, [say.staffLeft(user.name), ...turn.replies], 'bot');
        const conversation = await tx.conversation.update({
          where: { id: c.id },
          data: {
            handledBy: 'bot',
            state: turn.state,
            ...(turn.bookingId !== undefined && { bookingId: turn.bookingId }),
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
    /** @type {any} */
    let operator;
    /** @type {any} */
    let conversation;
    const result = await prisma.$transaction(async (tx) => {
      const found = await tx.conversation.findFirst({ where: { id, operatorId } });
      if (!found) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found.');
      await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${id}::uuid FOR UPDATE`;
      const c = await tx.conversation.findUniqueOrThrow({ where: { id } });
      operator = await tx.operator.findUniqueOrThrow({ where: { id: operatorId } });
      conversation = c;
      return fn(tx, c, operator);
    });
    // After the lock is released. Staff and events aren't answers to the guest, so on
    // WhatsApp the 24-hour rule applies (a failure is recorded on the message, for staff).
    await deliver(
      { prisma, channels },
      { conversation, operator, messages: result.out, unprompted: true },
    );
    return result;
  }

  return router;
}

/**
 * Stores the messages; returns them as deliver() wants them (with the row, for the reply).
 * @param {any} tx @param {any} c @param {any[]} bodies
 * @param {'bot' | 'staff'} author @param {string} [userId] @param {string} [staffName]
 */
async function store(tx, c, bodies, author, userId, staffName) {
  const created = [];
  for (const body of bodies) {
    const row = await tx.chatMessage.create({
      data: {
        operatorId: c.operatorId,
        conversationId: c.id,
        direction: 'out',
        author,
        authorUserId: userId ?? null,
        body,
      },
    });
    created.push({ ...row, staffName: staffName ?? null });
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
  // WhatsApp only (13c-3): sent · delivered · read · failed, and why it failed.
  delivery: m.delivery ?? null,
  deliveryError: m.deliveryError ?? null,
  createdAt: m.createdAt,
});
