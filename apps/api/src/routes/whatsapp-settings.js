// @ts-check
/**
 * The business's WhatsApp number (stage 13c-3). The screen comes with the operator app.
 *
 *   GET   /api/whatsapp   channels: view   { phoneNumberId, connected, webhookUrl }
 *   PATCH /api/whatsapp   channels: edit   { phoneNumberId }  (null disconnects the number)
 *
 * `phoneNumberId` is Meta's "Phone number ID" (Meta app → WhatsApp → API Setup), not the
 * phone number itself: it's what Meta puts on every message, so it says which business a
 * guest wrote to. `connected` says whether this server has a WhatsApp token at all.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';

const Body = z.object({
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^[0-9]{5,30}$/, 'Paste the Phone number ID: digits only, from Meta’s API Setup page.')
    .nullable(),
});

/** @param {{ prisma: import('@prisma/client').PrismaClient, connected: boolean, apiPublicUrl: string }} deps */
export function whatsappSettingsRouter({ prisma, connected, apiPublicUrl }) {
  const router = Router();
  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;
  const view = (/** @type {{ whatsappPhoneNumberId: string | null }} */ o) => ({
    phoneNumberId: o.whatsappPhoneNumberId,
    connected,
    // What to paste into Meta's webhook settings ("Callback URL").
    webhookUrl: `${apiPublicUrl.replace(/\/+$/, '')}/webhooks/whatsapp`,
  });

  router.get('/whatsapp', requirePermission('channels', 'view'), async (req, res) => {
    const o = await prisma.operator.findUniqueOrThrow({ where: { id: authOf(req).operatorId } });
    res.json({ whatsapp: view(o) });
  });

  router.patch(
    '/whatsapp',
    requirePermission('channels', 'edit'),
    validate({ body: Body }),
    async (req, res) => {
      try {
        const o = await prisma.operator.update({
          where: { id: authOf(req).operatorId },
          data: { whatsappPhoneNumberId: req.body.phoneNumberId },
        });
        res.json({ whatsapp: view(o) });
      } catch (err) {
        // The unique index: another business already uses that number.
        if (/** @type {any} */ (err).code === 'P2002') {
          throw new HttpError(409, 'NUMBER_TAKEN', 'Another business already uses that number.');
        }
        throw err;
      }
    },
  );

  return router;
}
