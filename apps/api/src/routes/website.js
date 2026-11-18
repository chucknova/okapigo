// @ts-check
/**
 * The operator's website (MKT-08, stage 12g).
 *
 *   GET   /api/website   marketing: view   the look, the business details, and the choices
 *   PATCH /api/website   marketing: edit   { style?, mode?, phone?, whatsapp?, site?, embedDomains? }
 *
 * Changing the style or mode changes only the LOOK: content, tour links and booking links
 * stay the same, so links already shared never break (MKT-09). `site` holds the one-page
 * website's words (stage 12g-2, SiteSchema): what's sent is MERGED over what's stored, so a
 * form can save one section at a time; send null (or '') to clear a field. The screen for
 * this is part of the operator app (designed later).
 *
 * `embedDomains` (stage 12h) is the whole list of websites allowed to show the booking widget;
 * it REPLACES the stored list (send [] to allow none).
 */
import { Router } from 'express';
import { z } from 'zod';
import { STYLE_NAMES, MODES } from '@okapigo/shared/tokens';
import {
  SiteSchema,
  SitePhoneSchema,
  EmbedDomainsSchema,
  readSite,
} from '@okapigo/shared/schemas/website';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const WebsiteSchema = z
  .object({
    style: z.enum(/** @type {[string, ...string[]]} */ (STYLE_NAMES)).optional(),
    mode: z.enum(/** @type {[string, ...string[]]} */ ([...MODES])).optional(),
    phone: SitePhoneSchema.optional(),
    whatsapp: SitePhoneSchema.optional(),
    site: SiteSchema.optional(),
    embedDomains: EmbedDomainsSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Send something to change.');

/** @param {import('@prisma/client').Operator} o */
const view = (o) => ({
  style: o.websiteStyle,
  mode: o.websiteMode,
  phone: o.phone,
  whatsapp: o.whatsapp,
  site: readSite(o.site),
  embedDomains: o.embedDomains,
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
    validate({ body: WebsiteSchema }),
    async (req, res) => {
      const { operatorId } = authOf(req);
      const b = req.body;
      // Merge the site's fields over what's stored (null clears one). In a transaction with a
      // row lock, so two people saving different sections at once don't undo each other.
      const operator = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM operators WHERE id = ${operatorId}::uuid FOR UPDATE`;
        const current = await tx.operator.findUniqueOrThrow({ where: { id: operatorId } });
        const site = b.site
          ? Object.fromEntries(
              Object.entries({ ...readSite(current.site), ...b.site }).filter(
                ([, v]) => v !== null,
              ),
            )
          : undefined;
        return tx.operator.update({
          where: { id: operatorId },
          data: {
            ...(b.style !== undefined && { websiteStyle: b.style }),
            ...(b.mode !== undefined && { websiteMode: b.mode }),
            ...(b.phone !== undefined && { phone: b.phone }),
            ...(b.whatsapp !== undefined && { whatsapp: b.whatsapp }),
            ...(site && { site }),
            ...(b.embedDomains !== undefined && { embedDomains: b.embedDomains }),
          },
        });
      });
      res.json({ website: view(operator) });
    },
  );

  return router;
}
