// @ts-check
/**
 * The guest messages' wording, for staff (OPS-11 "from editable templates", stage 14a). The
 * screen comes with the operator app; the API is here now.
 *
 *   GET    /api/message-templates                 settings: view   all six, default and own
 *   PUT    /api/message-templates/:kind           settings: edit   { subject, body }
 *   DELETE /api/message-templates/:kind           settings: edit   back to OkapiGo's wording
 *   POST   /api/message-templates/:kind/preview   settings: view   { subject?, body? }
 *                                                 → the words as a guest would get them, with
 *                                                   one of the business's own bookings (16e-2)
 *   POST   /api/message-templates/:kind/test      settings: edit   { subject?, body? }: the
 *                                                 preview, to the signed-in person's WhatsApp
 *                                                 (422 TEST_NOT_SENT with why, if it can't go)
 *
 * The list also gives each message's WhatsApp-approved version (what a guest who hasn't
 * written in 24 hours gets) and the one message that has ONLY an approved version: "Can we
 * help you finish booking?" (16d-1).
 *
 * An edit is checked before it's saved (message-templates.js → checkTemplate): only the
 * placeholders that message has, and the ones it must keep (the link, the amount).
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  MESSAGES,
  MESSAGE_KINDS,
  PLACEHOLDERS,
  checkTemplate,
  renderTemplate,
} from '@okapigo/shared/message-templates';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { templateFor, messageValues } from '../messages/compose.js';
import { sendToPhone, testProblem } from '../messages/send.js';
import { WHATSAPP_TEMPLATES } from '../whatsapp/templates.js';
import { formatPhoneForDisplay } from '@okapigo/shared/contact';

const KindParams = z.object({ kind: z.enum(/** @type {[string, ...string[]]} */ (MESSAGE_KINDS)) });
const TemplateBody = z.object({ subject: z.string().max(500), body: z.string().max(5000) });
const PreviewBody = z.object({
  subject: z.string().max(500).optional(),
  body: z.string().max(5000).optional(),
});

/**
 * A made-up booking to show a template with (fictional, like all demo data): the operator's
 * own name and first tour, so the preview looks like theirs.
 * @param {string} operatorName @param {{ title: string, shortTitle: string | null } | null} tour
 */
const sample = (operatorName, tour) => ({
  first_name: 'Adaeze',
  operator: operatorName,
  reference: 'ILT-7K4Q2M',
  tour: tour?.title ?? 'Lagos Island Heritage Walk',
  tour_short: tour?.shortTitle ?? tour?.title ?? 'Heritage Walk',
  date: 'Sat 5 Dec',
  time: '09:00',
  meeting_point: 'Tinubu Square, Broad Street, Lagos Island',
  travellers: '3 travellers',
  trip_url: 'https://okapigo.example/trip/…',
  deposit: '₦19,500',
  balance: '₦45,500',
  due_date: 'Sat 28 Nov',
  pay_url: 'https://okapigo.example/trip/…/pay',
  amount: '₦45,500',
  link_for: `Balance for ${tour?.title ?? 'Lagos Island Heritage Walk'}, Sat 5 Dec`,
  expiry: 'Tue 24 Nov',
  link_url: 'https://okapigo.example/pay/…',
  refund_line:
    'Refund: ₦31,250 (50%, cancelled 30 hours before).\nIt goes back to the card or account you paid with. We’ll message you when it’s sent.',
  refund: '₦31,250',
  from_date: 'Sat 28 Nov',
});

/**
 * An approved text with its numbered gaps named, like the editable wording ("{{2}}" → "{balance}").
 * @param {{ text: string, params: string[] }} t
 */
const named = (t) =>
  t.text.replace(/\{\{(\d+)\}\}/g, (m, n) => (t.params[n - 1] ? `{${t.params[n - 1]}}` : m));

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   authSecret?: string,
 *   webPublicUrl?: string,
 *   channels?: Record<string, any>,
 * }} deps
 */
export function messageTemplatesRouter({
  prisma,
  authSecret = '',
  webPublicUrl = '',
  channels = {},
}) {
  /**
   * The words a message would have: the business's latest real booking where there is one
   * ("With a real booking: Funmi Adeyemi, ILT-3MZ8RB"), the made-up one otherwise; a value the
   * booking can't give (a link's amount, a refund) comes from the made-up one. A message about
   * money still owed (a deposit received, a balance reminder) uses a booking that still owes
   * some, or the made-up one: never "₦0 is due".
   * @param {string} operatorId @param {string} kind
   */
  async function exampleValues(operatorId, kind) {
    const owing = kind === 'deposit_received' || kind === 'balance_reminder';
    const [operator, tour, booking] = await Promise.all([
      prisma.operator.findUniqueOrThrow({ where: { id: operatorId } }),
      prisma.product.findFirst({
        where: { operatorId, status: 'published' },
        orderBy: { title: 'asc' },
        select: { title: true, shortTitle: true },
      }),
      prisma.booking.findFirst({
        where: {
          operatorId,
          status: { in: owing ? ['part_paid'] : ['part_paid', 'paid', 'confirmed'] },
        },
        orderBy: { createdAt: 'desc' },
        // What the sender reads (messages/send.js), so the words come out the same.
        include: {
          product: { include: { operator: true, priceCategories: true } },
          departure: true,
          travellers: true,
          policyVersion: true,
        },
      }),
    ]);
    const made = sample(operator.name, tour);
    if (!booking) return { operator, values: made, example: null };
    const real = messageValues({ authSecret, webPublicUrl }, booking, {
      kind: 'payment_link',
      data: {},
    });
    const values = { ...made, ...Object.fromEntries(Object.entries(real).filter(([, v]) => v)) };
    return { operator, values, example: `${booking.leadName}, ${booking.reference}` };
  }

  const router = Router();
  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;

  router.get('/message-templates', requirePermission('settings', 'view'), async (req, res) => {
    const own = new Map(
      (
        await prisma.messageTemplate.findMany({ where: { operatorId: authOf(req).operatorId } })
      ).map((t) => [t.kind, t]),
    );
    res.json({
      templates: MESSAGE_KINDS.map((kind) => {
        const m = MESSAGES[kind];
        const t = own.get(kind);
        return {
          kind,
          name: m.name,
          when: m.when,
          placeholders: m.placeholders.map((name) => ({
            name,
            description: PLACEHOLDERS[name],
            required: m.required.includes(name),
          })),
          default: { subject: m.subject, body: m.body },
          custom: t ? { subject: t.subject, body: t.body, updatedAt: t.updatedAt } : null,
          // What a guest who hasn't written in 24 hours gets on WhatsApp: Meta's approved text.
          approved: WHATSAPP_TEMPLATES[kind] ? named(WHATSAPP_TEMPLATES[kind]) : null,
        };
      }),
      // Messages that only exist as an approved WhatsApp text (no editable wording).
      approvedOnly: [
        {
          key: 'chat_followup',
          name: 'Can we help you finish booking?',
          when: 'when staff send it from a chat, to a guest who last wrote over 24 hours ago',
          text: named(WHATSAPP_TEMPLATES.chat_followup),
        },
      ],
    });
  });

  router.put(
    '/message-templates/:kind',
    requirePermission('settings', 'edit'),
    validate({ params: KindParams, body: TemplateBody }),
    async (req, res) => {
      const kind = /** @type {import('@okapigo/shared/message-templates').MessageKind} */ (
        req.params.kind
      );
      const { operatorId, userId } = authOf(req);
      const problems = checkTemplate(kind, req.body);
      if (problems.length > 0) {
        throw new HttpError(400, 'TEMPLATE_INVALID', problems[0], { problems });
      }
      const t = await prisma.messageTemplate.upsert({
        where: { operatorId_kind: { operatorId, kind } },
        create: { operatorId, kind, ...req.body, updatedById: userId },
        update: { ...req.body, updatedById: userId },
      });
      res.json({ template: { kind, subject: t.subject, body: t.body, updatedAt: t.updatedAt } });
    },
  );

  router.delete(
    '/message-templates/:kind',
    requirePermission('settings', 'edit'),
    validate({ params: KindParams }),
    async (req, res) => {
      await prisma.messageTemplate.deleteMany({
        where: { operatorId: authOf(req).operatorId, kind: req.params.kind },
      });
      res.status(204).end();
    },
  );

  router.post(
    '/message-templates/:kind/preview',
    requirePermission('settings', 'view'),
    validate({ params: KindParams, body: PreviewBody }),
    async (req, res) => {
      const kind = /** @type {import('@okapigo/shared/message-templates').MessageKind} */ (
        req.params.kind
      );
      const { operatorId } = authOf(req);
      const current = await templateFor(prisma, operatorId, kind);
      const t = {
        subject: req.body.subject ?? current.subject,
        body: req.body.body ?? current.body,
      };
      const { values, example } = await exampleValues(operatorId, kind);
      res.json({
        preview: {
          subject: renderTemplate(t.subject, values),
          body: renderTemplate(t.body, values),
        },
        example,
        problems: checkTemplate(kind, t),
      });
    },
  );

  // "Send a test to my WhatsApp": the preview, to the signed-in person's own phone, as the
  // business (a guest's chat with it, or the simulator's).
  router.post(
    '/message-templates/:kind/test',
    requirePermission('settings', 'edit'),
    validate({ params: KindParams, body: PreviewBody }),
    async (req, res) => {
      const kind = /** @type {import('@okapigo/shared/message-templates').MessageKind} */ (
        req.params.kind
      );
      const { operatorId, userId } = authOf(req);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.phone) {
        throw new HttpError(409, 'NO_PHONE', 'Your account has no phone number to send a test to.');
      }
      const current = await templateFor(prisma, operatorId, kind);
      const t = {
        subject: req.body.subject ?? current.subject,
        body: req.body.body ?? current.body,
      };
      const problems = checkTemplate(kind, t);
      if (problems.length) throw new HttpError(400, 'TEMPLATE_INVALID', problems[0], { problems });
      const { operator, values } = await exampleValues(operatorId, kind);
      const sent = await sendToPhone(
        { prisma, channels },
        {
          operator,
          phone: user.phone,
          name: user.name,
          body: { kind: 'text', text: `[Test] ${renderTemplate(t.body, values)}` },
        },
      );
      const to = formatPhoneForDisplay(user.phone);
      // Not sent (WhatsApp's 24 hours, Meta said no): a refusal in words, not a server fault.
      if (sent.error) {
        throw new HttpError(422, 'TEST_NOT_SENT', /** @type {string} */ (testProblem(sent.error)), {
          to,
        });
      }
      res.status(201).json({ test: { to } });
    },
  );

  return router;
}
