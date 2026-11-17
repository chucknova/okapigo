// @ts-check
/**
 * webhooks.js — storing webhook events exactly once (stage 10c).
 *
 * The webhook ROUTE verifies the signature, then calls recordWebhookEvent() and answers
 * Paystack straight away. Processing happens later, in the workers (processWebhookEvent,
 * in settlement.js), so a slow step never makes Paystack wait or retry.
 */

/**
 * Stores an event unless an event with the same (provider, dedupKey) is already stored.
 * Same race-proof technique as the ledger (10a): INSERT … ON CONFLICT DO NOTHING, so two
 * deliveries arriving at the same instant can't both be stored, and neither errors.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ provider: string, eventType: string, dedupKey: string, payload: unknown }} input
 * @returns {Promise<{ id: string, duplicate: boolean }>}
 */
export async function recordWebhookEvent(prisma, { provider, eventType, dedupKey, payload }) {
  /** @type {Array<{ id: string }>} */
  const inserted = await prisma.$queryRaw`
    INSERT INTO webhook_events (id, provider, event_type, dedup_key, payload)
    VALUES (gen_random_uuid(), ${provider}, ${eventType}, ${dedupKey}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (provider, dedup_key) DO NOTHING
    RETURNING id`;
  if (inserted.length > 0) return { id: inserted[0].id, duplicate: false };

  const existing = await prisma.webhookEvent.findUniqueOrThrow({
    where: { provider_dedupKey: { provider, dedupKey } },
    select: { id: true },
  });
  return { id: existing.id, duplicate: true };
}
