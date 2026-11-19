// @ts-check
/**
 * The WhatsApp simulator's API (BKG-09, session 13): the in-app stand-in for WhatsApp. The
 * simulator app (13c) sends what the guest types or taps, and shows the conversation.
 *
 *   POST /simulator/whatsapp/:operatorSlug/messages
 *        { phone, name?, text } or { phone, name?, choice, title? }
 *        → { conversation: { token, handledBy }, replies: [...] }
 *   GET  /simulator/whatsapp/conversations/:token/messages
 *        → { conversation: { handledBy }, messages: [{ id, author, body, createdAt }] }
 *
 * Anyone can be any guest here (that's what a simulator is for: "choose which guest you are").
 * So READING a conversation needs its token, returned by the first POST: a signature of the
 * conversation's id (like a guest link), so nobody can read another guest's chat by guessing
 * a phone number. Sending is rate-limited per IP, like the website's booking.
 */
import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { receive } from '../whatsapp/conversations.js';

const LABEL = 'okapigo:simulator-chat:v1';

const MessageSchema = z.union([
  z.object({
    phone: z.string().trim().min(7).max(30),
    name: z.string().trim().max(80).optional(),
    text: z.string().trim().min(1).max(4096),
  }),
  z.object({
    phone: z.string().trim().min(7).max(30),
    name: z.string().trim().max(80).optional(),
    choice: z.string().trim().min(1).max(100),
    title: z.string().trim().max(100).optional(),
  }),
]);

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   quotes: any,
 *   jobs: any,
 *   authSecret: string,
 *   webPublicUrl: string,
 *   rateLimitStore: any,
 *   channels: Record<string, { send: Function }>,
 *   limit?: number,
 * }} deps
 */
export function whatsappSimulatorRouter({
  prisma,
  quotes,
  jobs,
  authSecret,
  webPublicUrl,
  rateLimitStore,
  channels,
  limit = 120,
}) {
  const router = Router();
  const key = createHmac('sha256', authSecret).update(LABEL).digest();
  /** @param {string} id */
  const tokenFor = (id) =>
    `${id}.${createHmac('sha256', key).update(id).digest().subarray(0, 16).toString('base64url')}`;
  /** @param {string} token @returns {string | null} */
  const idFrom = (token) => {
    const id = token.split('.')[0];
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const a = Buffer.from(token);
    const b = Buffer.from(tokenFor(id));
    return a.length === b.length && timingSafeEqual(a, b) ? id : null;
  };

  // Generous, like the website's booking limit: a chat is many small messages.
  const limiter = rateLimit({
    store: rateLimitStore,
    name: 'wa-sim',
    limit,
    windowSeconds: 60,
  });

  router.post(
    '/simulator/whatsapp/:operatorSlug/messages',
    limiter,
    validate({ body: MessageSchema }),
    async (req, res) => {
      const operator = await prisma.operator.findUnique({
        where: { slug: req.params.operatorSlug },
      });
      if (!operator) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
      const b = req.body;
      const result = await receive(
        { prisma, quotes, jobs, log: req.log, webPublicUrl, channels },
        {
          operator,
          channel: 'simulator',
          phone: b.phone,
          name: b.name,
          input: 'text' in b ? { text: b.text } : { choice: b.choice, title: b.title },
        },
      );
      res.status(201).json({
        conversation: { token: tokenFor(result.conversationId), handledBy: result.handledBy },
        replies: result.replies,
      });
    },
  );

  router.get('/simulator/whatsapp/conversations/:token/messages', async (req, res) => {
    const id = idFrom(req.params.token);
    if (!id) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      // The LATEST 500 (in the order written: see chat_messages.seq), shown oldest first.
      include: { messages: { orderBy: { seq: 'desc' }, take: 500 } },
    });
    if (!conversation) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
    // Staff sign their replies with a FIRST name only ("Tolu · Ìrìn team" in the designs).
    const ids = [...new Set(conversation.messages.map((m) => m.authorUserId).filter(Boolean))];
    const staff = new Map(
      (
        await prisma.user.findMany({
          where: { id: { in: /** @type {string[]} */ (ids) } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name.trim().split(/\s+/)[0]]),
    );
    res.set('Cache-Control', 'no-store').json({
      conversation: { handledBy: conversation.handledBy },
      messages: conversation.messages.reverse().map((m) => ({
        id: m.id,
        author: m.author,
        ...(m.authorUserId && { authorName: staff.get(m.authorUserId) ?? null }),
        body: m.body,
        createdAt: m.createdAt,
      })),
    });
  });

  return router;
}
