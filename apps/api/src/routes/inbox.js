// @ts-check
/**
 * The inbox's chats, in words (stage 16d-1; designs: O9 Inbox — chats, phone and states, gaps).
 *
 *   GET /api/inbox/chats       bookings: edit   NEEDS A PERSON (waiting, or taken over) first,
 *                                               then WITH THE BOT
 *   GET /api/inbox/chats/:id   bookings: edit   one chat: who has it, the messages as the guest
 *                                               saw them (and whether they arrived), WhatsApp's
 *                                               24-hour window, the booking beside it
 *
 * Changing a chat is in conversations.js (take over, reply, hand back, follow up, retry, email).
 *
 * Guest requests (16d-2; designs: O9 requests, Inbox gaps):
 *   GET  /api/inbox/requests?tab=open|done   bookings: edit   open oldest first; Done newest first,
 *                                                              each saying who dealt with it and how
 *   POST /api/guest-requests/:id/reply        bookings: edit   { text, markAnswered }: by WhatsApp
 *                                                              and email, shown on the trip page
 * ("Mark answered without replying" is POST /api/guest-requests/:id/answer { note }, 12f-2.)
 *
 * Alerts (16d-3):
 *   GET  /api/inbox/alerts   bookings: edit   what needs dealing with (clearing by itself when
 *                                              fixed), and "Done this week"
 */
import { Router } from 'express';
import { z } from 'zod';
import { deskStatus, replyGuestRequest, inboxAlerts } from '@okapigo/db';
import { formatPhoneForDisplay } from '@okapigo/shared/contact';
import { localDate, localTime } from '@okapigo/shared/time';
import { formatAt } from '@okapigo/shared/tour-facts';
import { formatNaira } from '@okapigo/shared/money';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { fillTemplate } from '../whatsapp/templates.js';
import { bookingOfChat } from './conversations.js';
import { toHttp } from './bookings.js';

const KIND = /** @type {Record<string, string>} */ ({
  change_date: 'Change the date',
  cancel: 'Cancel',
  other: 'A question',
});
const RequestsQuery = z.object({ tab: z.enum(['open', 'done']).default('open') });
const ReplyBody = z.object({
  text: z.string().trim().min(1).max(2000),
  markAnswered: z.boolean().default(true),
});

const DAY = 24 * 3_600_000;
const BOT_DAYS = 7; // "with the bot": the last week's chats

/** "Adaeze" @param {string} name */
const first = (name) => name.trim().split(/\s+/)[0] ?? name;
/** The guest's name, or their number. @param {any} c */
const guestOf = (c) => c.guestName?.trim() || formatPhoneForDisplay(c.guestPhone);

/** "3 min", "2 h", "1 day" @param {number} ms */
export function waited(ms) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

/** "10:49" today, "Thu 3 Dec" before. @param {Date} at @param {Date} now @param {string} tz */
const whenShort = (at, now, tz) =>
  localDate(at, tz) === localDate(now, tz)
    ? localTime(at, tz)
    : formatAt(at.getTime(), tz).split(', ')[0];

/**
 * A message as one line of text (the list's preview, a buttons message's words).
 * @param {any} body
 */
export function textOf(body) {
  if (!body) return '';
  if (body.kind === 'image') return body.caption ? `Photo: ${body.caption}` : 'Photo';
  return String(body.text ?? body.title ?? body.body ?? '');
}

/**
 * Who has the chat, from where the viewer sits.
 * @param {any} c @param {string} me @param {string | null} holderName
 * @returns {{ mode: 'bot' | 'mine' | 'theirs', holder: string | null }}
 */
export function holderOf(c, me, holderName) {
  if (c.handledBy !== 'staff') return { mode: 'bot', holder: null };
  if (!c.handledById || c.handledById === me) return { mode: 'mine', holder: holderName };
  return { mode: 'theirs', holder: holderName };
}

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function inboxRouter({ prisma }) {
  const router = Router();
  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;
  const fresh = (/** @type {any} */ res) => res.set('Cache-Control', 'private, no-store');

  router.get('/inbox/chats', requirePermission('bookings', 'edit'), async (req, res) => {
    const { operatorId, userId, timeZone: tz } = authOf(req);
    const now = new Date();
    const rows = await prisma.conversation.findMany({
      where: {
        operatorId,
        OR: [
          { handledBy: 'staff' },
          { needsPersonSince: { not: null } },
          { lastMessageAt: { gte: new Date(now.getTime() - BOT_DAYS * DAY) } },
        ],
      },
      orderBy: [{ needsPersonSince: { sort: 'asc', nulls: 'last' } }, { lastMessageAt: 'desc' }],
      take: 100,
      include: { handler: true, messages: { orderBy: { seq: 'desc' }, take: 1 } },
    });
    const row = (/** @type {any} */ c) => {
      const h = holderOf(c, userId, c.handler?.name ?? null);
      const last = c.messages[0];
      // A one-line preview: WhatsApp's *bold* marks dropped.
      const lastText = last ? textOf(last.body).replace(/\*([^*\n]+)\*/g, '$1') : '';
      const byMe = last?.author === 'staff' && last.authorUserId === userId;
      return {
        id: c.id,
        name: guestOf(c),
        last: byMe ? `You: ${lastText}` : lastText,
        // Waiting for a person: how long (red). Otherwise when it last moved.
        wait: c.needsPersonSince
          ? `waiting ${waited(now.getTime() - c.needsPersonSince.getTime())}`
          : whenShort(c.lastMessageAt, now, tz),
        waiting: Boolean(c.needsPersonSince) && h.mode === 'bot',
        state:
          h.mode === 'mine'
            ? 'Taken over by you'
            : h.mode === 'theirs'
              ? `${first(h.holder ?? 'Someone')} is replying`
              : c.needsPersonSince
                ? 'Waiting for a person'
                : null,
        mode: h.mode,
      };
    };
    const needs = rows.filter((c) => c.handledBy === 'staff' || c.needsPersonSince).map(row);
    const bot = rows.filter((c) => c.handledBy !== 'staff' && !c.needsPersonSince).map(row);
    fresh(res).json({ chats: { needs, bot, needsCount: needs.length } });
  });

  router.get(
    '/inbox/chats/:id',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const { operatorId, userId, timeZone: tz } = authOf(req);
      const now = new Date();
      const c = await prisma.conversation.findFirst({
        where: { id: req.params.id, operatorId },
        include: {
          handler: true,
          operator: true,
          messages: { orderBy: { seq: 'desc' }, take: 300 },
        },
      });
      if (!c) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found.');
      const messages = [...c.messages].reverse();
      const names = new Map(
        (
          await prisma.user.findMany({
            where: {
              operatorId,
              id: {
                in: /** @type {string[]} */ (messages.map((m) => m.authorUserId).filter(Boolean)),
              },
            },
          })
        ).map((u) => [u.id, u.name]),
      );
      const h = holderOf(c, userId, c.handler?.name ?? null);
      const guest = guestOf(c);
      const team = c.operator.name.split(/\s+/)[0]; // "Ìrìn team"

      // WhatsApp's 24-hour rule (13c-3): a free message only within a day of the guest's last.
      const lastIn = [...messages].reverse().find((m) => m.direction === 'in');
      const windowOpen =
        c.channel !== 'whatsapp' ||
        Boolean(lastIn && now.getTime() - lastIn.createdAt.getTime() < DAY);

      const booking = await bookingOfChat(prisma, c);
      const full = booking
        ? await prisma.booking.findUnique({
            where: { id: booking.id },
            include: {
              hold: true,
              refunds: { select: { status: true, amountKobo: true } },
              cashReports: { select: { status: true } },
              _count: { select: { travellers: true } },
            },
          })
        : null;

      fresh(res).json({
        chat: {
          id: c.id,
          name: guest,
          phone: formatPhoneForDisplay(c.guestPhone),
          sub: [
            formatPhoneForDisplay(c.guestPhone),
            c.channel === 'whatsapp' ? 'WhatsApp' : 'WhatsApp (simulator)',
            lastIn ? `last message ${whenShort(lastIn.createdAt, now, tz)}` : 'hasn’t written yet',
          ].join(' · '),
          mode: h.mode,
          holder: h.holder,
          // The line under the name (designs): who's answering.
          stateLine:
            h.mode === 'mine'
              ? 'You’re replying · bot paused'
              : h.mode === 'theirs'
                ? `${first(h.holder ?? 'Someone')} is replying · bot paused`
                : c.needsPersonSince
                  ? `Waiting for a person · ${waited(now.getTime() - c.needsPersonSince.getTime())}`
                  : 'The bot is answering',
          theirsNote:
            h.mode === 'theirs' && c.handledSince
              ? `Only ${first(h.holder ?? 'they')} can reply while they have this chat (since ${localTime(c.handledSince, tz)}).`
              : null,
          window: windowOpen
            ? { open: true }
            : {
                open: false,
                lastWrote: lastIn ? formatAt(lastIn.createdAt.getTime(), tz) : null,
                text: lastIn
                  ? `${first(guest)} last wrote ${waited(now.getTime() - lastIn.createdAt.getTime())} ago. WhatsApp only lets you send approved messages until they write again.`
                  : `${first(guest)} hasn’t written to you yet. WhatsApp only lets you send approved messages until they do.`,
                followUp: fillTemplate('chat_followup', {
                  first_name: first(c.guestName) || 'there',
                  operator: c.operator.name,
                }).text,
              },
          messages: messages.map((m) => {
            const body = /** @type {any} */ (m.body);
            const notice = body?.kind === 'notice';
            const who =
              m.direction === 'in'
                ? guest
                : m.author === 'staff'
                  ? `${first(names.get(m.authorUserId ?? '') ?? 'Staff')} · ${team} team`
                  : 'Bot';
            return {
              id: m.id,
              side: notice ? 'notice' : m.direction === 'in' ? 'in' : 'out',
              who,
              text: textOf(body),
              buttons: (body?.buttons ?? body?.rows ?? []).map(
                (/** @type {any} */ b) => b.title ?? b.label ?? String(b),
              ),
              time: localTime(m.createdAt, tz),
              delivery: m.delivery ?? null,
              failed: m.delivery === 'failed',
              failedWhy: m.delivery === 'failed' ? (m.deliveryError ?? 'not delivered') : null,
            };
          }),
          booking: full
            ? (() => {
                const chip = deskStatus(full);
                return {
                  id: full.id,
                  reference: full.reference,
                  chip: { ...chip, expiresAt: chip.expiresAt?.toISOString() ?? null },
                  tour: booking.product.shortTitle || booking.product.title,
                  when: formatAt(booking.departure.startsAt.getTime(), tz),
                  people: `${full._count.travellers} ${full._count.travellers === 1 ? 'traveller' : 'travellers'}`,
                  total: formatNaira(full.totalKobo),
                  hasEmail: Boolean(full.leadEmail),
                };
              })()
            : null,
        },
      });
    },
  );

  router.get(
    '/inbox/requests',
    requirePermission('bookings', 'edit'),
    validate({ query: RequestsQuery }),
    async (req, res) => {
      const { operatorId, timeZone: tz } = authOf(req);
      const tab = /** @type {any} */ (req.query).tab;
      const now = new Date();
      const rows = await prisma.guestRequest.findMany({
        where: { operatorId, status: tab === 'open' ? 'open' : 'answered' },
        orderBy: tab === 'open' ? { createdAt: 'asc' } : { answeredAt: 'desc' },
        take: 100,
        include: {
          booking: {
            include: {
              product: true,
              departure: true,
              hold: true,
              refunds: { select: { status: true, amountKobo: true } },
              cashReports: { select: { status: true } },
              _count: { select: { travellers: true } },
            },
          },
        },
      });
      const openCount = await prisma.guestRequest.count({ where: { operatorId, status: 'open' } });
      const ids = [
        ...new Set(rows.flatMap((r) => [r.answeredById, r.repliedById]).filter((x) => x !== null)),
      ];
      const names = new Map(
        (
          await prisma.user.findMany({
            where: { operatorId, id: { in: /** @type {string[]} */ (ids) } },
          })
        ).map((u) => [u.id, u.name]),
      );
      fresh(res).json({
        requests: {
          tab,
          openCount,
          rows: rows.map((r) => {
            const b = r.booking;
            const chip = deskStatus(b);
            const base = {
              id: r.id,
              kind: r.kind,
              kindLabel: KIND[r.kind] ?? 'A request',
              lead: b.leadName,
              message: r.message,
              booking: {
                id: b.id,
                reference: b.reference,
                tour: b.product.shortTitle || b.product.title,
                when: formatAt(b.departure.startsAt.getTime(), tz),
                people: `${b._count.travellers} ${b._count.travellers === 1 ? 'traveller' : 'travellers'}`,
                paid:
                  b.amountPaidKobo > 0 ? `Paid ${formatNaira(b.amountPaidKobo)}` : 'Nothing paid',
                chip: { ...chip, expiresAt: chip.expiresAt?.toISOString() ?? null },
                canMove:
                  ['confirmed', 'part_paid', 'paid', 'amended'].includes(b.status) &&
                  b.departure.startsAt > now,
              },
            };
            if (tab === 'open') {
              return {
                ...base,
                sent: [
                  `Sent ${formatAt(r.createdAt.getTime(), tz)} from their trip page`,
                  b.leadPhone ? formatPhoneForDisplay(b.leadPhone) : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
                waiting: `waiting ${waited(now.getTime() - r.createdAt.getTime())}`,
                reach: [b.leadPhone ? 'WhatsApp' : null, b.leadEmail ? 'email' : null]
                  .filter(Boolean)
                  .join(' and '),
                replied: r.reply
                  ? { text: r.reply, at: formatAt(/** @type {Date} */ (r.repliedAt).getTime(), tz) }
                  : null,
              };
            }
            const who = names.get(r.answeredById ?? '') ?? 'Someone';
            return {
              ...base,
              // "Kunle · Tue 1 Dec · moved to Sun 6 Dec · replied by WhatsApp and email"
              done: [
                first(who),
                r.answeredAt ? whenShort(r.answeredAt, now, tz) : null,
                r.staffNote && /^Moved to /.test(r.staffNote)
                  ? r.staffNote.replace(/^Moved/, 'moved')
                  : null,
                r.staffNote && !/^Moved to /.test(r.staffNote) ? `note: “${r.staffNote}”` : null,
                r.reply ? 'replied by WhatsApp and email' : null,
              ]
                .filter(Boolean)
                .join(' · '),
            };
          }),
        },
      });
    },
  );

  router.get('/inbox/alerts', requirePermission('bookings', 'edit'), async (req, res) => {
    fresh(res).json(await inboxAlerts(prisma, { operatorId: authOf(req).operatorId }));
  });

  router.post(
    '/guest-requests/:id/reply',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema, body: ReplyBody }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      let r;
      try {
        r = await replyGuestRequest(prisma, {
          operatorId,
          requestId: req.params.id,
          userId,
          text: req.body.text,
          markAnswered: req.body.markAnswered,
        });
      } catch (err) {
        throw toHttp(err);
      }
      res.status(201).json({ request: { id: r.id, status: r.status } });
    },
  );

  return router;
}
