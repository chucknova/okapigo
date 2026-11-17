// @ts-check
/**
 * payment-status.js — the lifecycle of ONE payment attempt (PAY-02).
 *
 *   initiated ──► succeeded            the money arrived (only a VERIFIED webhook says so, 10c)
 *       │
 *       ├──────► failed                card declined, etc.
 *       │
 *       └──────► abandoned ──► succeeded
 *                   the guest closed the page. Paystack can still complete it later
 *                   (e.g. a bank transfer that lands late), so this isn't final.
 *
 * A booking can have several payment attempts (a declined card, then a different card).
 * Only `succeeded` ones count towards the booking's amountPaidKobo.
 */

export const PAYMENT_STATUSES = /** @type {const} */ ([
  'initiated',
  'succeeded',
  'failed',
  'abandoned',
]);

/** @typedef {typeof PAYMENT_STATUSES[number]} PaymentStatus */

export const PAYMENT_TRANSITIONS = /** @type {Record<PaymentStatus, PaymentStatus[]>} */ ({
  initiated: ['succeeded', 'failed', 'abandoned'],
  abandoned: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
});

/**
 * @param {string} from
 * @param {string} to
 */
export function canTransitionPayment(from, to) {
  return /** @type {readonly string[]} */ (
    PAYMENT_TRANSITIONS[/** @type {PaymentStatus} */ (from)] ?? []
  ).includes(to);
}

/**
 * A payment reference for the provider: "OKG-" + 20 Crockford Base32 characters.
 * Ours, generated BEFORE calling the provider, globally unique, and safe for Paystack
 * (letters, digits and dashes only). Browser-safe randomness, like booking references.
 */
export function generatePaymentReference() {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(20));
  return `OKG-${Array.from(bytes, (b) => ALPHABET[b % 32]).join('')}`;
}
