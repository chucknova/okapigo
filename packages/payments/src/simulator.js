// @ts-check
/**
 * simulator.js — a pretend payment provider. No network, no account, no money.
 *
 * Used by every test, by CI, and for offline demos (the PRD: "the simulator is free,
 * reliable in demos and testable in CI"). It behaves like Paystack where OkapiGo can see:
 * the same method shapes, the same statuses, a fee on success.
 *
 * Its state lives in a Map you can pass in, so a test can create a simulator, start a
 * payment through the API, then decide what "the guest" does:
 *
 *   const sim = createSimulatorProvider({ baseUrl: 'http://localhost:4000' });
 *   … start a payment …
 *   sim.complete(reference)            // the guest paid
 *   sim.fail(reference, 'Declined')    // the card was declined
 *
 * Stage 10c gives it a checkout page and makes it send webhooks, like the real thing.
 */
import { ProviderError } from './provider.js';

/** Paystack's local-card fee for the simulator: 1.5% (+ ₦100 above ₦2,500), capped at ₦2,000. */
export function simulatedFeeKobo(amountKobo) {
  const percent = Math.round((amountKobo * 150) / 10_000);
  const flat = amountKobo >= 250_000 ? 10_000 : 0;
  return Math.min(percent + flat, 200_000);
}

/**
 * @param {{ baseUrl: string, store?: Map<string, any>, now?: () => Date }} options
 * @returns {import('./provider.js').PaymentProvider & {
 *   complete: (reference: string) => void,
 *   fail: (reference: string, message?: string) => void,
 *   abandon: (reference: string) => void,
 *   store: Map<string, any>,
 * }}
 */
export function createSimulatorProvider({ baseUrl, store = new Map(), now = () => new Date() }) {
  /** @param {string} reference */
  function get(reference) {
    const tx = store.get(reference);
    if (!tx) throw new ProviderError('NOT_FOUND', `No simulated transaction ${reference}`);
    return tx;
  }

  return {
    name: 'simulator',
    store,

    async initializeTransaction({ reference, amountKobo, email }) {
      if (store.has(reference)) {
        // Paystack refuses a reused reference ("Duplicate Transaction Reference"); so do we.
        throw new ProviderError('PROVIDER_REJECTED', 'Duplicate Transaction Reference');
      }
      if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
        throw new ProviderError('PROVIDER_REJECTED', 'Invalid amount');
      }
      store.set(reference, {
        reference,
        amountKobo,
        email,
        status: 'pending',
        id: `sim_${store.size + 1}`,
      });
      return {
        reference,
        accessCode: null,
        // Stage 10c serves a page here with "Pay" / "Decline" buttons.
        authorizationUrl: `${baseUrl}/simulator/checkout/${encodeURIComponent(reference)}`,
      };
    },

    async verifyTransaction(reference) {
      const tx = get(reference);
      return {
        status: tx.status,
        amountKobo: tx.amountKobo,
        currency: 'NGN',
        feeKobo: tx.status === 'succeeded' ? simulatedFeeKobo(tx.amountKobo) : null,
        paidAt: tx.paidAt ?? null,
        channel: tx.status === 'pending' ? null : 'card',
        providerTransactionId: tx.id,
        message: tx.message ?? null,
      };
    },

    complete(reference) {
      Object.assign(get(reference), { status: 'succeeded', paidAt: now(), message: 'Approved' });
    },
    fail(reference, message = 'Declined') {
      Object.assign(get(reference), { status: 'failed', message });
    },
    abandon(reference) {
      Object.assign(get(reference), { status: 'abandoned' });
    },
  };
}
