// @ts-check
/**
 * paystack.js — the Paystack adapter, TEST MODE ONLY.
 *
 * Paystack's API in two calls (https://paystack.com/docs/api/transaction/):
 *   POST /transaction/initialize   { email, amount (kobo!), reference, callback_url, … }
 *        → { status: true, data: { authorization_url, access_code, reference } }
 *   GET  /transaction/verify/:ref
 *        → { status: true, data: { status: "success" | "failed" | "abandoned" | …, amount, fees, … } }
 *
 * Every request carries "Authorization: Bearer <secret key>". The secret key can move
 * money, so:
 *   - it's refused unless it's a TEST key (sk_test_…): a live key throws at creation time
 *   - it's never logged, and never included in error messages
 *   - requests time out after 10 s, so a slow Paystack can't hang a guest's checkout
 *
 * `fetch` is passed in (dependency injection again), so unit tests can check exactly what
 * we send and how we read replies, without calling Paystack.
 */
import { ProviderError, LiveKeyError } from './provider.js';
import { signatureMatches } from './webhooks.js';

const BASE_URL = 'https://api.paystack.co';

/** Paystack's transaction statuses → ours. Anything still in progress is "pending". */
const STATUS_MAP = {
  success: 'succeeded',
  failed: 'failed',
  abandoned: 'abandoned',
  reversed: 'failed',
};

/** Paystack's refund statuses → ours. Anything not finished yet is "pending". */
const REFUND_STATUS_MAP = { processed: 'processed', failed: 'failed' };

/** @param {any} data */
function toRefundResult(data) {
  return {
    providerRefundId: String(data.id),
    status: REFUND_STATUS_MAP[data.status] ?? 'pending',
    amountKobo: data.amount,
    transaction: data.transaction != null ? String(data.transaction?.id ?? data.transaction) : null,
  };
}

/**
 * @param {{ secretKey: string, fetch?: typeof globalThis.fetch, baseUrl?: string, timeoutMs?: number }} options
 * @returns {import('./provider.js').PaymentProvider}
 */
export function createPaystackProvider({
  secretKey,
  fetch = globalThis.fetch,
  baseUrl = BASE_URL,
  timeoutMs = 10_000,
}) {
  // Defence in depth: config validation refuses live keys at startup too (apps/api/src/config.js),
  // but the adapter checks again, so no other code path can create a live client.
  if (/^sk_live_/.test(secretKey ?? '')) throw new LiveKeyError();
  if (!/^sk_test_[A-Za-z0-9]+$/.test(secretKey ?? '')) {
    throw new Error('PAYSTACK_SECRET_KEY must be a Paystack TEST secret key (sk_test_…).');
  }

  /**
   * Calls Paystack and unwraps its { status, message, data } envelope.
   * @param {'GET' | 'POST'} method
   * @param {string} path
   * @param {unknown} [body]
   */
  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // Give up after timeoutMs instead of waiting forever.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Network failure or timeout. Note: the message never includes the key or headers.
      const timedOut = /** @type {any} */ (err)?.name === 'TimeoutError';
      throw new ProviderError(
        'PROVIDER_UNAVAILABLE',
        timedOut ? 'Paystack did not respond in time' : 'Could not reach Paystack',
      );
    }

    /** @type {{ status?: boolean, message?: string, data?: any }} */
    let json = {};
    try {
      json = await res.json();
    } catch {
      // Paystack occasionally returns an HTML error page during outages.
    }

    if (res.status === 404)
      throw new ProviderError('NOT_FOUND', json.message ?? 'Transaction not found', {
        httpStatus: 404,
      });
    if (res.status >= 500 || res.status === 429) {
      throw new ProviderError('PROVIDER_UNAVAILABLE', `Paystack is unavailable (${res.status})`, {
        httpStatus: res.status,
      });
    }
    if (!res.ok || json.status !== true) {
      throw new ProviderError(
        'PROVIDER_REJECTED',
        json.message ?? `Paystack refused the request (${res.status})`,
        {
          httpStatus: res.status,
        },
      );
    }
    return json.data;
  }

  return {
    name: 'paystack',

    /** Paystack signs webhooks with the same secret key we call its API with. */
    verifyWebhookSignature(rawBody, signature) {
      return signatureMatches(secretKey, rawBody, signature);
    },

    async initializeTransaction({ reference, amountKobo, email, callbackUrl, channels, metadata }) {
      const data = await call('POST', '/transaction/initialize', {
        email,
        amount: amountKobo, // Paystack's "amount" is ALSO in kobo for NGN: no conversion
        currency: 'NGN',
        reference,
        callback_url: callbackUrl,
        channels,
        metadata,
      });
      return {
        authorizationUrl: data.authorization_url,
        accessCode: data.access_code ?? null,
        reference: data.reference,
      };
    },

    async verifyTransaction(reference) {
      const data = await call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
      return {
        status: STATUS_MAP[data.status] ?? 'pending',
        amountKobo: data.amount,
        currency: data.currency,
        feeKobo: typeof data.fees === 'number' ? data.fees : null,
        paidAt: data.paid_at ? new Date(data.paid_at) : null,
        channel: data.channel ?? null,
        providerTransactionId: data.id != null ? String(data.id) : null,
        message: data.gateway_response ?? null,
      };
    },

    /** POST /refund: Paystack refunds to the card or account the money came from. */
    async refund({ transaction, amountKobo, note }) {
      const data = await call('POST', '/refund', {
        transaction,
        amount: amountKobo, // kobo, like everywhere else
        currency: 'NGN',
        merchant_note: note,
      });
      return toRefundResult(data);
    },

    /** GET /refund/:id: what happened to a refund (reconciliation, and re-checking webhooks). */
    async fetchRefund(providerRefundId) {
      return toRefundResult(await call('GET', `/refund/${encodeURIComponent(providerRefundId)}`));
    },
  };
}
