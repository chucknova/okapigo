// @ts-check
/**
 * provider.js — the INTERFACE every payment provider implements.
 *
 * The PRD: "Each outside service sits behind an adapter with one interface, so a simulator
 * and a real sandbox are interchangeable and the core code never knows which one is
 * running." This file is that interface. OkapiGo's code only ever calls these methods:
 *
 *   initializeTransaction(…)  start a payment; get back a hosted checkout URL for the guest
 *   verifyTransaction(ref)    ask the provider what happened to a payment
 *
 *   verifyWebhookSignature(…) is this webhook really from the provider? (stage 10c)
 *
 * Stage 10e adds refund().
 *
 * Two implementations:
 *   simulator.js  in memory, no network: tests, CI and offline demos
 *   paystack.js   Paystack's real API, in TEST mode only
 */

/**
 * @typedef {{
 *   reference: string,         // OUR reference (OKG-…), echoed back by the provider
 *   amountKobo: number,        // integer kobo; Paystack also counts in kobo
 *   email: string,             // the provider emails the receipt here
 *   callbackUrl: string,       // where the guest's browser returns afterwards
 *   channels?: string[],       // e.g. ['card'] or ['bank_transfer'] (10d)
 *   metadata?: Record<string, unknown>,
 * }} InitializeInput
 *
 * @typedef {{ authorizationUrl: string, accessCode: string | null, reference: string }} InitializeResult
 *
 * @typedef {{
 *   status: 'succeeded' | 'failed' | 'abandoned' | 'pending',
 *   amountKobo: number,
 *   currency: string,
 *   feeKobo: number | null,
 *   paidAt: Date | null,
 *   channel: string | null,
 *   providerTransactionId: string | null,
 *   message: string | null,     // e.g. "Declined" for a failed card
 * }} VerifyResult
 *
 * @typedef {{
 *   name: 'simulator' | 'paystack',
 *   initializeTransaction: (input: InitializeInput) => Promise<InitializeResult>,
 *   verifyTransaction: (reference: string) => Promise<VerifyResult>,
 *   verifyWebhookSignature: (rawBody: Buffer | string, signature: string | undefined) => boolean,
 * }} PaymentProvider
 */

/**
 * Something went wrong talking to the provider. `code` tells callers what to do:
 *   PROVIDER_UNAVAILABLE  network error or timeout: safe to retry later
 *   PROVIDER_REJECTED     the provider said no (bad amount, bad key…): retrying won't help
 *   NOT_FOUND             no transaction with that reference
 */
export class ProviderError extends Error {
  /**
   * @param {'PROVIDER_UNAVAILABLE' | 'PROVIDER_REJECTED' | 'NOT_FOUND'} code
   * @param {string} message
   * @param {{ httpStatus?: number }} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.httpStatus = details.httpStatus;
  }
}

/** The PRD's key-safety rule: OkapiGo must never run with real money. */
export class LiveKeyError extends Error {
  constructor() {
    super(
      'Refusing to start: a LIVE Paystack key is configured. OkapiGo runs in test mode only (sk_test_… / pk_test_…).',
    );
    this.code = 'LIVE_KEY_REFUSED';
  }
}
