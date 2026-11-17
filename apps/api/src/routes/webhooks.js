// @ts-check
/**
 * POST /webhooks/paystack: where the payment provider tells us what happened (stage 10c).
 *
 * This route does as LITTLE as possible, as fast as possible:
 *   1. read the RAW body (bytes exactly as sent, needed for the signature)
 *   2. check the signature → 401 if it doesn't match (nothing stored)
 *   3. store the event once (a retried delivery is recognised and not stored again)
 *   4. queue it for the workers, and answer 200
 *
 * Why so little? Paystack waits for our answer and retries if it's slow or not 200. All the
 * real work (verify with Paystack, update payment, booking, seats and ledger) happens in
 * a background job with its own retries. If queueing fails, the event is still stored and
 * the once-a-minute webhook sweeper picks it up.
 *
 * Mounted BEFORE express.json() in app.js: once the JSON parser has read the body, the raw
 * bytes are gone and the signature can't be checked.
 */
import express, { Router } from 'express';
import { recordWebhookEvent } from '@okapigo/db';
import { parseWebhook, SIGNATURE_HEADER } from '@okapigo/payments';

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   provider: import('@okapigo/payments').PaymentProvider,
 *   jobs: { enqueueWebhook: (eventId: string) => Promise<void> },
 * }} deps
 */
export function webhooksRouter({ prisma, provider, jobs }) {
  const router = Router();

  router.post(
    '/webhooks/paystack',
    // Keep the body as raw bytes (a Buffer). 1 MB is far more than any Paystack event.
    express.raw({ type: '*/*', limit: '1mb' }),
    async (req, res) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const signature = req.get(SIGNATURE_HEADER);

      if (!provider.verifyWebhookSignature(rawBody, signature)) {
        // Not from our provider (or tampered with). Log it, store nothing, say nothing useful.
        req.log.warn({ hasSignature: Boolean(signature) }, 'webhook rejected: bad signature');
        res
          .status(401)
          .json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature.' } });
        return;
      }

      const event = parseWebhook(rawBody);
      if (!event) {
        res.status(400).json({ error: { code: 'BAD_WEBHOOK', message: 'Unreadable webhook.' } });
        return;
      }

      const { id, duplicate } = await recordWebhookEvent(prisma, {
        provider: provider.name,
        eventType: event.eventType,
        dedupKey: event.dedupKey,
        payload: event.payload,
      });

      if (!duplicate) {
        try {
          await jobs.enqueueWebhook(id);
        } catch (err) {
          req.log.warn(
            { err, eventId: id },
            'could not queue webhook; the sweeper will process it',
          );
        }
      }
      req.log.info({ eventId: id, type: event.eventType, duplicate }, 'webhook received');
      // 200 for duplicates too: "we have it", so Paystack stops retrying.
      res.status(200).json({ received: true, duplicate });
    },
  );

  return router;
}
