// @ts-check
/**
 * reconciliation.js — catching what webhooks missed (stage 10e).
 *
 * Webhooks are reliable, not perfect: Paystack can fail to deliver, our tunnel can be down,
 * an event can be lost. Every 10 minutes the workers ask the provider directly about
 * anything still unfinished:
 *
 *   payments "initiated" for over 30 minutes   → verifyTransaction
 *       succeeded  → handled EXACTLY like a webhook (below)
 *       failed     → payment marked failed
 *       abandoned / still pending after 24 h → marked abandoned (the checkout is dead)
 *
 *   refunds "pending" for over 1 hour           → fetchRefund
 *       processed / failed → handled exactly like a refund webhook
 *
 * "Exactly like a webhook" is the key design choice: reconciliation doesn't settle anything
 * itself. It RECORDS a webhook event with the same dedup key Paystack's own event would
 * have ("charge.success:<transaction id>") and runs the normal processing. If the real
 * webhook arrives later, it's recognised as a duplicate. One path for money, never two.
 */
import { canTransitionPayment } from '@okapigo/shared/payment-status';
import { recordWebhookEvent } from './webhooks.js';
import { processWebhookEvent } from './settlement.js';

const MINUTE = 60_000;

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {any} provider  a PaymentProvider (@okapigo/payments)
 * @param {{ now?: Date, paymentsAfterMs?: number, abandonAfterMs?: number, refundsAfterMs?: number, limit?: number }} [options]
 */
export async function reconcile(
  prisma,
  provider,
  {
    now = new Date(),
    paymentsAfterMs = 30 * MINUTE,
    abandonAfterMs = 24 * 60 * MINUTE,
    refundsAfterMs = 60 * MINUTE,
    limit = 100,
  } = {},
) {
  const summary = {
    paymentsChecked: 0,
    settled: 0,
    failed: 0,
    abandoned: 0,
    refundsChecked: 0,
    refundsResolved: 0,
    errors: 0,
  };

  // --- Payments stuck in "initiated" --------------------------------------------------------
  const stuck = await prisma.payment.findMany({
    where: {
      provider: provider.name,
      status: 'initiated',
      createdAt: { lt: new Date(now.getTime() - paymentsAfterMs) },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  for (const payment of stuck) {
    summary.paymentsChecked += 1;
    try {
      const verified = await provider.verifyTransaction(payment.reference);
      if (verified.status === 'succeeded') {
        const { id, duplicate } = await recordWebhookEvent(prisma, {
          provider: provider.name,
          eventType: 'charge.success',
          dedupKey: `charge.success:${verified.providerTransactionId}`,
          payload: {
            event: 'charge.success',
            data: {
              id: verified.providerTransactionId,
              reference: payment.reference,
              source: 'reconciliation',
            },
          },
        });
        if (!duplicate) await processWebhookEvent(prisma, provider, id, { now });
        summary.settled += 1;
      } else if (verified.status === 'failed' && canTransitionPayment(payment.status, 'failed')) {
        await prisma.payment.updateMany({
          where: { id: payment.id, status: 'initiated' },
          data: { status: 'failed', failureReason: verified.message ?? 'Failed at the provider' },
        });
        summary.failed += 1;
      } else if (now.getTime() - payment.createdAt.getTime() > abandonAfterMs) {
        await prisma.payment.updateMany({
          where: { id: payment.id, status: 'initiated' },
          data: { status: 'abandoned' },
        });
        summary.abandoned += 1;
      }
    } catch {
      summary.errors += 1; // e.g. Paystack briefly unavailable: next run tries again
    }
  }

  // --- Refunds stuck in "pending" -----------------------------------------------------------
  const pending = await prisma.refund.findMany({
    where: {
      provider: provider.name,
      status: 'pending',
      providerRefundId: { not: null },
      updatedAt: { lt: new Date(now.getTime() - refundsAfterMs) },
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });
  for (const refund of pending) {
    summary.refundsChecked += 1;
    try {
      const confirmed = await provider.fetchRefund(/** @type {string} */ (refund.providerRefundId));
      if (confirmed.status === 'pending') continue;
      const eventType = confirmed.status === 'processed' ? 'refund.processed' : 'refund.failed';
      const { id, duplicate } = await recordWebhookEvent(prisma, {
        provider: provider.name,
        eventType,
        dedupKey: `${eventType}:${refund.providerRefundId}`,
        payload: {
          event: eventType,
          data: { id: refund.providerRefundId, status: confirmed.status, source: 'reconciliation' },
        },
      });
      if (!duplicate) await processWebhookEvent(prisma, provider, id, { now });
      summary.refundsResolved += 1;
    } catch {
      summary.errors += 1;
    }
  }

  // Refunds recorded but never sent (a crash between recording and calling the provider)
  // have no provider id to ask about. Counted, so a human sees them; never guessed.
  const neverSent = await prisma.refund.count({
    where: {
      provider: provider.name,
      status: 'requested',
      createdAt: { lt: new Date(now.getTime() - refundsAfterMs) },
    },
  });
  return { ...summary, refundsNeverSent: neverSent };
}
