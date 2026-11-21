// @ts-check
/**
 * The business's WhatsApp number (stage 13c-3). The screen comes with the operator app.
 *
 *   GET   /api/whatsapp   channels: view   { phoneNumberId, connected, webhookUrl, state, … }
 *   PATCH /api/whatsapp   channels: edit   { phoneNumberId }  (null disconnects the number)
 *   POST  /api/whatsapp/test  channels: edit   a test message to the signed-in person (16e-2);
 *                                              422 TEST_NOT_SENT with why, when it can't go
 *
 * The access token and the webhook's verify token are OkapiGo-wide and live only in the
 * server's settings (.env), never on a screen (decided with the project: keys stay in .env).
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
import { formatPhoneForDisplay } from '@okapigo/shared/contact';
import { localDate, localTime } from '@okapigo/shared/time';
import { formatAt } from '@okapigo/shared/tour-facts';
import { sendToPhone, testProblem } from '../messages/send.js';

const Body = z.object({
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^[0-9]{5,30}$/, 'Paste the Phone number ID: digits only, from Meta’s API Setup page.')
    .nullable(),
});

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient, connected: boolean, apiPublicUrl: string, channels?: Record<string, any> }} deps
 */
export function whatsappSettingsRouter({ prisma, connected, apiPublicUrl, channels = {} }) {
  const router = Router();
  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;
  /**
   * How it stands, in words (designs: "Connected · last message 10:51"; "Not connected · using
   * the simulator"; "Waiting for Meta to call the webhook").
   * @param {any} o
   */
  const view = async (o) => {
    const last = await prisma.chatMessage.findFirst({
      where: { operatorId: o.id, direction: 'in', conversation: { channel: 'whatsapp' } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const tz = o.timeZone;
    const now = new Date();
    const when = last
      ? localDate(last.createdAt, tz) === localDate(now, tz)
        ? localTime(last.createdAt, tz)
        : formatAt(last.createdAt.getTime(), tz)
      : null;
    const state =
      !connected || !o.whatsappPhoneNumberId ? 'simulator' : last ? 'connected' : 'waiting';
    return {
      phoneNumberId: o.whatsappPhoneNumberId,
      connected,
      state,
      stateText: {
        simulator: 'Not connected · using the simulator',
        waiting: 'Waiting for Meta to call the webhook',
        connected: `Connected · last message ${when}`,
      }[state],
      // Why not, when it isn't: this server, or this business.
      why: !connected
        ? 'WhatsApp isn’t set up on this OkapiGo server yet (its access token is in the server’s settings).'
        : !o.whatsappPhoneNumberId
          ? 'Add your Phone number ID from Meta to connect your number.'
          : null,
      businessNumber: o.whatsapp ? formatPhoneForDisplay(o.whatsapp) : null,
      displayName: o.name,
      // What to paste into Meta's webhook settings ("Callback URL").
      webhookUrl: `${apiPublicUrl.replace(/\/+$/, '')}/webhooks/whatsapp`,
    };
  };

  router.get('/whatsapp', requirePermission('channels', 'view'), async (req, res) => {
    const o = await prisma.operator.findUniqueOrThrow({ where: { id: authOf(req).operatorId } });
    res.json({ whatsapp: await view(o) });
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
        res.json({ whatsapp: await view(o) });
      } catch (err) {
        // The unique index: another business already uses that number.
        if (/** @type {any} */ (err).code === 'P2002') {
          throw new HttpError(409, 'NUMBER_TAKEN', 'Another business already uses that number.');
        }
        throw err;
      }
    },
  );

  // "Send a test message": to the signed-in person's own phone, as the business.
  router.post('/whatsapp/test', requirePermission('channels', 'edit'), async (req, res) => {
    const { operatorId, userId } = authOf(req);
    const [operator, user] = await Promise.all([
      prisma.operator.findUniqueOrThrow({ where: { id: operatorId } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    if (!user.phone) {
      throw new HttpError(409, 'NO_PHONE', 'Your account has no phone number to send a test to.');
    }
    const sent = await sendToPhone(
      { prisma, channels },
      {
        operator,
        phone: user.phone,
        name: user.name,
        body: {
          kind: 'text',
          text: `This is a test from ${operator.name} on OkapiGo. Your WhatsApp is working.`,
        },
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
  });

  return router;
}
