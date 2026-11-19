// @ts-check
/**
 * The guest messages' wording, for staff (OPS-11 "from editable templates", stage 14a). The
 * screen comes with the operator app; the API is here now.
 *
 *   GET    /api/message-templates                 settings: view   all six, default and own
 *   PUT    /api/message-templates/:kind           settings: edit   { subject, body }
 *   DELETE /api/message-templates/:kind           settings: edit   back to OkapiGo's wording
 *   POST   /api/message-templates/:kind/preview   settings: view   { subject?, body? }
 *                                                 → the words as a guest would get them
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
import { templateFor } from '../messages/compose.js';

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
});

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function messageTemplatesRouter({ prisma }) {
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
        };
      }),
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
      const [operator, tour] = await Promise.all([
        prisma.operator.findUniqueOrThrow({ where: { id: operatorId } }),
        prisma.product.findFirst({
          where: { operatorId, status: 'published' },
          orderBy: { title: 'asc' },
          select: { title: true, shortTitle: true },
        }),
      ]);
      const values = sample(operator.name, tour);
      res.json({
        preview: {
          subject: renderTemplate(t.subject, values),
          body: renderTemplate(t.body, values),
        },
        problems: checkTemplate(kind, t),
      });
    },
  );

  return router;
}
