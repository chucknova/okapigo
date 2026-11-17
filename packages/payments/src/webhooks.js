// @ts-check
/**
 * webhooks.js — checking and reading webhook requests (stage 10c).
 *
 * A WEBHOOK is the provider calling US: "transaction OKG-… succeeded". Anyone on the
 * internet can POST to our webhook URL, so before believing a word of it we check the
 * SIGNATURE:
 *
 *   Paystack computes  HMAC-SHA512(key = our secret key, message = the exact request body)
 *   and sends it in the  x-paystack-signature  header. We compute the same thing and compare.
 *
 * Only someone holding the secret key can produce a matching signature, and changing even
 * one byte of the body changes it completely. Two details matter:
 *   - it's computed over the RAW BYTES as sent. Parse the JSON and re-serialise it, and
 *     spacing or key order can change, and the signature no longer matches. So the webhook
 *     route reads the raw body before any JSON parser touches it.
 *   - the comparison is constant-time (timingSafeEqual), as for one-time codes (session 3).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** The header Paystack (and our simulator, imitating it) puts the signature in. */
export const SIGNATURE_HEADER = 'x-paystack-signature';

/**
 * @param {string} secret
 * @param {Buffer | string} rawBody
 */
export function computeSignature(secret, rawBody) {
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

/**
 * @param {string} secret
 * @param {Buffer | string} rawBody
 * @param {string | undefined} signature  the header's value
 */
export function signatureMatches(secret, rawBody, signature) {
  if (typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = Buffer.from(computeSignature(secret, rawBody), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Reads a (verified) webhook body into the few things OkapiGo needs.
 *
 * `dedupKey` decides when two deliveries are "the same event". Paystack events have no
 * event id of their own, so it's the event type + the provider's transaction id: a
 * retried delivery has the same key; a different transaction has a different one.
 *
 * @param {Buffer | string} rawBody
 * @returns {{ eventType: string, dedupKey: string, reference: string | null, payload: any } | null}
 *   null if the body isn't a webhook we can read at all
 */
export function parseWebhook(rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody.toString());
  } catch {
    return null;
  }
  const eventType = payload?.event;
  const data = payload?.data;
  if (typeof eventType !== 'string' || !data || typeof data !== 'object') return null;
  // Charges are identified by transaction id; refunds by their own refund id.
  const id = data.id ?? data.refund_reference ?? data.reference ?? data.transaction_reference;
  if (id === undefined || id === null) return null;
  return {
    eventType,
    // The STATUS is part of a refund event's identity: "refund.pending" then
    // "refund.processed" for the same refund are two different events, not duplicates.
    dedupKey: `${eventType}:${id}`,
    reference: typeof data.reference === 'string' ? data.reference : null,
    payload,
  };
}
