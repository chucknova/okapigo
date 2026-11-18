// @ts-check
/**
 * The operator's website (MKT-08, stage 12g).
 *
 *   GET   /api/website   marketing: view   the style and mode, and the choices
 *   PATCH /api/website   marketing: edit   { style?, mode? }: change the look
 *
 * Only the LOOK changes: content, tour links and booking links stay the same, so links
 * already shared never break (MKT-09). The business details (tagline, about, contact…) join
 * this route in stage 12g-2. The screen for it is part of the operator app (designed later).
 */
import { Router } from 'express';
import { z } from 'zod';
import { STYLE_NAMES, MODES } from '@okapigo/shared/tokens';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const LookSchema = z
  .object({
    style: z.enum(/** @type {[string, ...string[]]} */ (STYLE_NAMES)).optional(),
    mode: z.enum(/** @type {[string, ...string[]]} */ ([...MODES])).optional(),
  })
  .refine((v) => v.style !== undefined || v.mode !== undefined, 'Send a style, a mode, or both.');

/** @param {{ id: string, websiteStyle: string, websiteMode: string }} o */
const view = (o) => ({
  style: o.websiteStyle,
  mode: o.websiteMode,
  styles: STYLE_NAMES,
  modes: MODES,
});

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function websiteRouter({ prisma }) {
  const router = Router();
  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;

  router.get('/website', requirePermission('marketing', 'view'), async (req, res) => {
    const operator = await prisma.operator.findUniqueOrThrow({
      where: { id: authOf(req).operatorId },
    });
    res.json({ website: view(operator) });
  });

  router.patch(
    '/website',
    requirePermission('marketing', 'edit'),
    validate({ body: LookSchema }),
    async (req, res) => {
      const operator = await prisma.operator.update({
        where: { id: authOf(req).operatorId },
        data: {
          ...(req.body.style !== undefined && { websiteStyle: req.body.style }),
          ...(req.body.mode !== undefined && { websiteMode: req.body.mode }),
        },
      });
      res.json({ website: view(operator) });
    },
  );

  return router;
}
