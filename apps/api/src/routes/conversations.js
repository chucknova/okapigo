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
 * The inbox (16d-1) adds:
 *   - who has a chat: only they reply ("Only Ngozi can reply while she has this chat");
 *     another takes over with { fromColleague: true } ("Take over from Ngozi?")
 *   POST /api/conversations/:id/follow-up              "Can we help you finish booking?" (the
 *                                                       approved message, outside 24 hours)
 *   POST /api/conversations/:id/messages/:messageId/retry   send a failed message again
 *   POST /api/conversations/:id/messages/:messageId/email   send it by email instead
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
import { fillTemplate } from '../whatsapp/templates.js';
import { planGuestMessage } from '@okapigo/db';

const ReplyBody = z.object({ text: z.string().trim().min(1).max(4096) });
const TakeOverBody = z.object({ fromColleague: z.boolean().default(false) });
const MessageParams = z.object({ id: z.uuid(), messageId: z.uuid() });
/** "Adaeze" from "Adaeze Okafor". @param {string} name */
const first = (name) => name.trim().split(/\s+/)[0] ?? name;

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
    validate({ params: IdParamsSchema, body: TakeOverBody }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const result = await change(req.params.id, operatorId, async (tx, c, operator) => {
        const mine = c.handledBy === 'staff' && c.handledById === userId;
        if (mine) return { conversation: c, out: [] }; // already: no repeat
        // A colleague has it: only on purpose ("Take over from Ngozi?").
        if (c.handledBy === 'staff' && c.handledById && !req.body.fromColleague) {
          const holder = await tx.user.findUnique({ where: { id: c.handledById } });
          throw new HttpError(
            409,
            'TAKEN_BY_COLLEAGUE',
            `${first(holder?.name ?? 'Someone')} has this chat. Take it over from them?`,
            { holder: holder?.name ?? null },
          );
        }
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        // The guest heard "X joined" already when a colleague took it: no second notice.
        const out =
          c.handledBy === 'staff'
            ? []
            : await store(tx, c, [say.staffJoined(user.name, operator.name)], 'bot');
        const now = new Date();
        const conversation = await tx.conversation.update({
          where: { id: c.id },
          data: {
            handledBy: 'staff',
            handledById: userId,
            handledSince: now,
            needsPersonSince: null,
            lastMessageAt: now,
          },
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
        // One person at a time, too (16d-1). (A chat taken over before 16d has no holder.)
        if (c.handledById && c.handledById !== userId) {
          throw new HttpError(409, 'NOT_YOURS', 'A colleague has this chat. Take it over first.');
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
            handledById: null,
            handledSince: null,
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

  // "Can we help you finish booking?": the approved message, for a guest who last wrote over
  // 24 hours ago (designs: WhatsApp's 24-hour rule). Delivered as the template outside the
  // window (channels.js), as plain words inside it.
  router.post(
    '/conversations/:id/follow-up',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const result = await change(req.params.id, operatorId, async (tx, c, operator) => {
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const template = fillTemplate('chat_followup', {
          first_name: first(c.guestName) || 'there',
          operator: operator.name,
        });
        const out = await store(
          tx,
          c,
          [{ kind: 'text', text: template.text, template }],
          'staff',
          userId,
          user.name,
        );
        await tx.conversation.update({ where: { id: c.id }, data: { lastMessageAt: new Date() } });
        return { conversation: c, out, message: out[0] };
      });
      res.status(201).json({ message: messageOf(result.message) });
    },
  );

  // A message WhatsApp couldn't deliver, sent again: a new attempt below it (the failed one
  // stays, so the chat shows what happened).
  router.post(
    '/conversations/:id/messages/:messageId/retry',
    requirePermission('bookings', 'edit'),
    validate({ params: MessageParams }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const result = await change(req.params.id, operatorId, async (tx, c) => {
        const failed = await failedMessage(tx, c.id, req.params.messageId);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const out = await store(tx, c, [failed.body], 'staff', userId, user.name);
        await tx.conversation.update({ where: { id: c.id }, data: { lastMessageAt: new Date() } });
        return { conversation: c, out, message: out[0] };
      });
      res.status(201).json({ message: messageOf(result.message) });
    },
  );

  // …or by email, to the booking's lead (through the guest-message queue, in the business's
  // email layout: kind "staff_message").
  router.post(
    '/conversations/:id/messages/:messageId/email',
    requirePermission('bookings', 'edit'),
    validate({ params: MessageParams }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const c = await prisma.conversation.findFirst({ where: { id: req.params.id, operatorId } });
      if (!c) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found.');
      const failed = await failedMessage(prisma, c.id, req.params.messageId);
      const booking = await bookingOfChat(prisma, c);
      if (!booking?.leadEmail) {
        throw new HttpError(409, 'NO_EMAIL', 'There’s no email for this guest. Call them instead.');
      }
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const words = /** @type {any} */ (failed.body).text ?? '';
      await planGuestMessage(prisma, {
        booking,
        kind: 'staff_message',
        key: `staff_message:${failed.id}`,
        data: { text: words, staffName: user.name },
        only: ['email'],
      });
      res.status(202).json({ queued: true, to: booking.leadEmail });
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

/**
 * A message of ours that WhatsApp couldn't deliver (only those can be retried or emailed).
 * @param {any} db @param {string} conversationId @param {string} messageId
 */
async function failedMessage(db, conversationId, messageId) {
  const m = await db.chatMessage.findFirst({ where: { id: messageId, conversationId } });
  if (!m) throw new HttpError(404, 'NOT_FOUND', 'Message not found.');
  if (m.direction !== 'out' || m.delivery !== 'failed') {
    throw new HttpError(409, 'NOT_FAILED', 'Only a message that failed to send can be sent again.');
  }
  return m;
}

/**
 * The booking a chat is about: the one it made, else the guest's latest by phone.
 * @param {any} db @param {any} c
 */
export async function bookingOfChat(db, c) {
  const include = { product: { include: { operator: true } }, departure: true };
  if (c.bookingId) return db.booking.findUnique({ where: { id: c.bookingId }, include });
  return db.booking.findFirst({
    where: { operatorId: c.operatorId, leadPhone: c.guestPhone },
    orderBy: { createdAt: 'desc' },
    include,
  });
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
