// @ts-check
/**
 * simulator.js — a pretend payment provider. No network to Paystack, no account, no money.
 *
 * Used by every test, by CI, and for offline demos (the PRD: "the simulator is free,
 * reliable in demos and testable in CI"). It behaves like Paystack where OkapiGo can see:
 * the same method shapes, the same statuses, a fee on success, and (stage 10c) SIGNED
 * webhooks in Paystack's exact format, sent to our own webhook URL.
 *
 * WHERE ITS STATE LIVES. The API process starts payments; the workers process re-checks
 * them when a webhook arrives. Two processes don't share memory, so the simulator's
 * "transactions" live in a STORE both can reach:
 *   - redisStore(redis)  for the running apps (api + workers share Redis)
 *   - mapStore()         an in-memory Map, for tests in a single process
 *
 * Playing "the guest" (tests and the checkout page):
 *   await sim.complete(reference)          the guest paid
 *   await sim.fail(reference, 'Declined')  the card was declined
 *   await sim.sendWebhook(reference, url)  deliver charge.success, signed, like Paystack
 */
import { ProviderError } from './provider.js';
import { computeSignature, signatureMatches, SIGNATURE_HEADER } from './webhooks.js';

/**
 * Where simulated transactions are kept. Async, so it can be Redis.
 * @typedef {{ get: (ref: string) => Promise<any>, set: (ref: string, value: any) => Promise<void> }} SimulatorStore
 */

/** An in-memory store (tests). `map` is exposed so tests can peek inside. */
export function mapStore(map = new Map()) {
  return {
    map,
    get: async (ref) => map.get(ref),
    set: async (ref, value) => {
      map.set(ref, value);
    },
  };
}

/**
 * A Redis store, so the API and the workers see the same simulated transactions.
 * Kept for 7 days, then Redis forgets them (simulated data needn't live forever).
 * @param {{ get: (k: string) => Promise<string | null>, set: (...args: any[]) => Promise<unknown> }} redis an ioredis client
 */
export function redisStore(redis) {
  const key = (ref) => `simulator:tx:${ref}`;
  return {
    get: async (ref) => {
      const raw = await redis.get(key(ref));
      return raw ? JSON.parse(raw) : undefined;
    },
    set: async (ref, value) => {
      await redis.set(key(ref), JSON.stringify(value), 'EX', 7 * 24 * 60 * 60);
    },
  };
}

/** A Paystack-like card fee: 1.5% (+ ₦100 from ₦2,500), capped at ₦2,000. */
export function simulatedFeeKobo(amountKobo) {
  const percent = Math.round((amountKobo * 150) / 10_000);
  const flat = amountKobo >= 250_000 ? 10_000 : 0;
  return Math.min(percent + flat, 200_000);
}

/**
 * The simulator's signing secret. Only meaningful in simulator mode, where no real money
 * exists, but it still makes our webhook endpoint check signatures the same way as for
 * Paystack, so that code path is exercised in every demo and test.
 */
export const DEFAULT_SIMULATOR_SECRET = 'simulator-webhook-secret-not-for-real-money';

/**
 * @param {{ baseUrl: string, store?: SimulatorStore, webhookSecret?: string, now?: () => Date, fetch?: typeof globalThis.fetch }} options
 */
export function createSimulatorProvider({
  baseUrl,
  store = mapStore(),
  webhookSecret = DEFAULT_SIMULATOR_SECRET,
  now = () => new Date(),
  fetch = globalThis.fetch,
  autoProcessRefundsMs = 0,
  refundWebhookUrl = null,
}) {
  /** @param {string} reference */
  async function get(reference) {
    const tx = await store.get(reference);
    if (!tx) throw new ProviderError('NOT_FOUND', `No simulated transaction ${reference}`);
    return tx;
  }

  /** @param {string} reference @param {Record<string, unknown>} changes */
  async function update(reference, changes) {
    await store.set(reference, { ...(await get(reference)), ...changes });
  }

  /**
   * A charge.success event shaped exactly like Paystack's (the fields OkapiGo reads, plus a
   * few others for realism). See packages/payments/test/fixtures/ for a recorded-style example.
   * @param {string} reference
   */
  async function chargeSuccessEvent(reference) {
    const tx = await get(reference);
    // What actually arrived can differ from what was asked (a wrong-amount transfer).
    const paid = tx.paidAmountKobo ?? tx.amountKobo;
    return {
      event: 'charge.success',
      data: {
        id: tx.id,
        domain: 'test',
        status: 'success',
        reference,
        amount: paid,
        currency: 'NGN',
        fees: simulatedFeeKobo(paid),
        paid_at: tx.paidAt,
        channel: tx.channel ?? 'card',
        gateway_response: 'Approved',
        customer: { email: tx.email },
        metadata: tx.metadata ?? {},
      },
    };
  }

  const sim = {
    name: /** @type {const} */ ('simulator'),
    store,

    async initializeTransaction({ reference, amountKobo, email, metadata, callbackUrl }) {
      if (await store.get(reference)) {
        // Paystack refuses a reused reference ("Duplicate Transaction Reference"); so do we.
        throw new ProviderError('PROVIDER_REJECTED', 'Duplicate Transaction Reference');
      }
      if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
        throw new ProviderError('PROVIDER_REJECTED', 'Invalid amount');
      }
      await store.set(reference, {
        reference,
        amountKobo,
        email,
        metadata,
        // Where to send the guest afterwards, like Paystack's callback_url (stage 12e).
        callbackUrl: callbackUrl ?? null,
        status: 'pending',
        // Paystack transaction ids are numbers; random keeps them unique across processes.
        id: 900_000_000 + Math.floor(Math.random() * 99_999_999),
      });
      return {
        reference,
        accessCode: null,
        authorizationUrl: `${baseUrl}/simulator/checkout/${encodeURIComponent(reference)}`,
      };
    },

    async verifyTransaction(reference) {
      const tx = await get(reference);
      const paid = tx.paidAmountKobo ?? tx.amountKobo;
      return {
        status: tx.status,
        amountKobo: paid,
        currency: 'NGN',
        feeKobo: tx.status === 'succeeded' ? simulatedFeeKobo(paid) : null,
        paidAt: tx.paidAt ? new Date(tx.paidAt) : null,
        channel: tx.status === 'pending' ? null : (tx.channel ?? 'card'),
        providerTransactionId: String(tx.id),
        message: tx.message ?? null,
      };
    },

    verifyWebhookSignature(rawBody, signature) {
      return signatureMatches(webhookSecret, rawBody, signature);
    },

    /** Signs a body the way Paystack does (tests use this to forge-or-not). */
    sign(rawBody) {
      return computeSignature(webhookSecret, rawBody);
    },

    /**
     * The guest paid. Options: how (card or bank_transfer) and, for transfers, how much
     * ACTUALLY arrived (a typo or bank charges can make it differ from what was asked).
     * @param {string} reference
     * @param {{ channel?: 'card' | 'bank_transfer', paidAmountKobo?: number }} [options]
     */
    async complete(reference, { channel = 'card', paidAmountKobo } = {}) {
      await update(reference, {
        status: 'succeeded',
        paidAt: now().toISOString(),
        message: 'Approved',
        channel,
        paidAmountKobo,
      });
    },

    /**
     * Money sent straight to an operator's account, with NO reference we issued (stage 10d):
     * the case the manual-match screen exists for. Returns the provider's own reference.
     * @param {string} operatorId
     * @param {number} amountKobo
     */
    async createUnmatchedTransfer(operatorId, amountKobo) {
      const reference = `TRF${Date.now()}${Math.floor(Math.random() * 1e6)}`;
      await store.set(reference, {
        reference,
        amountKobo,
        email: 'unknown-sender@example.com',
        metadata: { operatorId },
        status: 'succeeded',
        channel: 'bank_transfer',
        paidAt: now().toISOString(),
        id: 900_000_000 + Math.floor(Math.random() * 99_999_999),
      });
      return reference;
    },
    async fail(reference, message = 'Declined') {
      await update(reference, { status: 'failed', message });
    },
    async abandon(reference) {
      await update(reference, { status: 'abandoned' });
    },

    chargeSuccessEvent,

    // --- Refunds (stage 10e) -----------------------------------------------------------
    // Stored under "refund:<id>". They start pending and become processed or failed later,
    // and a refund webhook says so (like Paystack). With autoProcessRefundsMs set (the
    // running apps), each refund processes itself that long after being requested.

    async refund({ transaction, amountKobo, note }) {
      const id = 800_000_000 + Math.floor(Math.random() * 99_999_999);
      await store.set(`refund:${id}`, { id, transaction, amountKobo, note, status: 'pending' });
      if (autoProcessRefundsMs > 0 && refundWebhookUrl) {
        setTimeout(() => {
          sim
            .processRefund(String(id))
            .then(() => sim.sendRefundWebhook(String(id), /** @type {string} */ (refundWebhookUrl)))
            .catch(() => {}); // a demo nicety; reconciliation catches anything missed
        }, autoProcessRefundsMs).unref();
      }
      return {
        providerRefundId: String(id),
        status: 'pending',
        amountKobo,
        transaction: String(transaction),
      };
    },

    /** @param {string} providerRefundId */
    async fetchRefund(providerRefundId) {
      const r = await store.get(`refund:${providerRefundId}`);
      if (!r) throw new ProviderError('NOT_FOUND', `No simulated refund ${providerRefundId}`);
      return {
        providerRefundId: String(r.id),
        status: r.status,
        amountKobo: r.amountKobo,
        transaction: String(r.transaction),
      };
    },

    /** @param {string} providerRefundId */
    async processRefund(providerRefundId) {
      const r = await store.get(`refund:${providerRefundId}`);
      await store.set(`refund:${providerRefundId}`, { ...r, status: 'processed' });
    },

    /** @param {string} providerRefundId */
    async failRefund(providerRefundId) {
      const r = await store.get(`refund:${providerRefundId}`);
      await store.set(`refund:${providerRefundId}`, { ...r, status: 'failed' });
    },

    /** A refund.processed / refund.failed / refund.pending event, in Paystack's shape. */
    async refundEvent(providerRefundId) {
      const r = await store.get(`refund:${providerRefundId}`);
      const event =
        r.status === 'failed'
          ? 'refund.failed'
          : r.status === 'processed'
            ? 'refund.processed'
            : 'refund.pending';
      return {
        event,
        data: {
          id: r.id,
          status: r.status,
          amount: r.amountKobo,
          currency: 'NGN',
          transaction: r.transaction,
        },
      };
    },

    /** @param {string} providerRefundId @param {string} url */
    async sendRefundWebhook(providerRefundId, url) {
      const body = JSON.stringify(await sim.refundEvent(providerRefundId));
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [SIGNATURE_HEADER]: computeSignature(webhookSecret, body),
        },
        body,
      });
      return res.status;
    },

    /**
     * Delivers charge.success to a webhook URL, signed, as Paystack would.
     * @param {string} reference
     * @param {string} url
     */
    async sendWebhook(reference, url) {
      const body = JSON.stringify(await chargeSuccessEvent(reference));
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [SIGNATURE_HEADER]: computeSignature(webhookSecret, body),
        },
        body,
      });
      return res.status;
    },
  };
  return sim;
}
