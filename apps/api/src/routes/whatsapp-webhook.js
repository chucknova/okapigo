// @ts-check
/**
 * The WhatsApp Cloud API's webhook (stage 13c-3): where Meta tells us a guest wrote, and what
 * happened to the messages we sent.
 *
 *   GET  /webhooks/whatsapp   Meta checks the address is ours, once, when you connect it:
 *                             ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
 *   POST /webhooks/whatsapp   signed with the app secret (X-Hub-Signature-256)
 *        messages  → receive(): the SAME conversation code as the simulator
 *        statuses  → the message's delivery: sent → delivered → read, or failed (and why)
 *
 * Answered AFTER the work, unlike Paystack's (stored, then queued): a chat turn takes well
 * under a second, and if it fails we answer 500 so Meta sends it again. Each guest message is
 * handled once however often it comes (receive() checks Meta's id under the chat's lock).
 *
 * Mounted BEFORE express.json() in app.js: the signature is over the exact bytes Meta sent.
 */
import express, { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { verifySignature, readWebhook } from '../whatsapp/cloud-api.js';
import { receive } from '../whatsapp/conversations.js';

/** A receipt moves forwards only: "read" never goes back to "delivered". */
const ORDER = ['sent', 'delivered', 'read'];

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   quotes: any,
 *   jobs: any,
 *   webPublicUrl: string,
 *   channels: Record<string, import('../whatsapp/channels.js').Channel>,
 *   appSecret: string,
 *   verifyToken: string,
 * }} deps
 */
export function whatsappWebhookRouter({
  prisma,
  quotes,
  jobs,
  webPublicUrl,
  channels,
  appSecret,
  verifyToken,
}) {
  const router = Router();

  router.get('/webhooks/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = String(req.query['hub.verify_token'] ?? '');
    const challenge = String(req.query['hub.challenge'] ?? '');
    const a = Buffer.from(token);
    const b = Buffer.from(verifyToken);
    if (
      mode === 'subscribe' &&
      a.length === b.length &&
      timingSafeEqual(a, b) &&
      /^\d{1,40}$/.test(challenge)
    ) {
      res.type('text/plain').send(challenge);
      return;
    }
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Verification failed.' } });
  });

  router.post(
    '/webhooks/whatsapp',
    express.raw({ type: '*/*', limit: '1mb' }),
    async (req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!verifySignature(appSecret, raw, req.get('x-hub-signature-256'))) {
        req.log.warn('whatsapp webhook rejected: bad signature');
        res
          .status(401)
          .json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature.' } });
        return;
      }
      let body;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        res.status(400).json({ error: { code: 'BAD_WEBHOOK', message: 'Unreadable webhook.' } });
        return;
      }
      const { messages, receipts } = readWebhook(body);

      for (const m of messages) {
        const operator = await prisma.operator.findUnique({
          where: { whatsappPhoneNumberId: m.phoneNumberId },
        });
        // A number no business here uses: nothing to do (and nothing for Meta to retry).
        if (!operator) {
          req.log.warn(
            { phoneNumberId: m.phoneNumberId },
            'whatsapp message for an unknown number',
          );
          continue;
        }
        await receive(
          { prisma, quotes, jobs, log: req.log, webPublicUrl, channels },
          {
            operator,
            channel: 'whatsapp',
            phone: m.from,
            name: m.name,
            input: m.input,
            providerMessageId: m.id,
          },
        );
      }

      for (const r of receipts) {
        if (r.status === 'failed') {
          await prisma.chatMessage.updateMany({
            where: { providerMessageId: r.id, direction: 'out' },
            data: { delivery: 'failed', deliveryError: (r.error ?? 'failed').slice(0, 300) },
          });
        } else if (ORDER.includes(r.status)) {
          const earlier = ORDER.slice(0, ORDER.indexOf(r.status));
          await prisma.chatMessage.updateMany({
            where: {
              providerMessageId: r.id,
              direction: 'out',
              OR: [{ delivery: null }, { delivery: { in: earlier } }],
            },
            data: { delivery: r.status },
          });
        }
      }
      res.status(200).json({ received: true });
    },
  );

  return router;
}
