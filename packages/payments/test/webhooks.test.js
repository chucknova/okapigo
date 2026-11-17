/**
 * Webhook signatures and parsing (stage 10c). The fixture follows Paystack's documented
 * charge.success shape, with fake data.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  computeSignature,
  signatureMatches,
  parseWebhook,
  createPaystackProvider,
  createSimulatorProvider,
} from '../src/index.js';

const FIXTURE = readFileSync(
  new URL('./fixtures/paystack-charge-success.json', import.meta.url),
  'utf8',
);
const SECRET = 'sk_test_abc123DEF456';

describe('signatures (HMAC-SHA512 over the raw body)', () => {
  const signature = computeSignature(SECRET, FIXTURE);

  it('matches what Paystack computes: an HMAC-SHA512 hex digest keyed with the secret key', () => {
    expect(signature).toBe(createHmac('sha512', SECRET).update(FIXTURE).digest('hex'));
    expect(signature).toMatch(/^[0-9a-f]{128}$/);
  });

  it('accepts the genuine signature', () => {
    expect(signatureMatches(SECRET, FIXTURE, signature)).toBe(true);
    expect(signatureMatches(SECRET, Buffer.from(FIXTURE), signature)).toBe(true); // raw bytes too
  });

  it('rejects a signature made with a different key (a forger)', () => {
    expect(signatureMatches(SECRET, FIXTURE, computeSignature('sk_test_attacker', FIXTURE))).toBe(
      false,
    );
  });

  it('rejects a body changed by even one character (₦50,000 → ₦90,000)', () => {
    const tampered = FIXTURE.replace('"amount": 5000000', '"amount": 9000000');
    expect(signatureMatches(SECRET, tampered, signature)).toBe(false);
  });

  it('rejects the same JSON re-serialised: that is why we keep the RAW body', () => {
    const reserialised = JSON.stringify(JSON.parse(FIXTURE)); // same data, different spacing
    expect(signatureMatches(SECRET, reserialised, signature)).toBe(false);
  });

  it('rejects missing or malformed signatures without throwing', () => {
    for (const bad of [undefined, '', 'abc', signature.slice(0, 64), `${signature}00`]) {
      expect(signatureMatches(SECRET, FIXTURE, bad)).toBe(false);
    }
  });

  it('both providers verify with their own secret', () => {
    const paystack = createPaystackProvider({ secretKey: SECRET });
    expect(paystack.verifyWebhookSignature(FIXTURE, signature)).toBe(true);
    const sim = createSimulatorProvider({ baseUrl: 'x' });
    expect(sim.verifyWebhookSignature(FIXTURE, signature)).toBe(false); // wrong secret for the sim
    expect(sim.verifyWebhookSignature(FIXTURE, sim.sign(FIXTURE))).toBe(true);
  });
});

describe('parseWebhook', () => {
  it('reads the event type, reference and a dedup key from the transaction id', () => {
    expect(parseWebhook(FIXTURE)).toMatchObject({
      eventType: 'charge.success',
      dedupKey: 'charge.success:4099260516',
      reference: 'OKG-REPLACED-IN-TESTS',
    });
  });

  it('a retried delivery has the same key; another transaction a different one', () => {
    const other = FIXTURE.replace('4099260516', '4099260517');
    expect(parseWebhook(FIXTURE).dedupKey).toBe(parseWebhook(FIXTURE).dedupKey);
    expect(parseWebhook(other).dedupKey).not.toBe(parseWebhook(FIXTURE).dedupKey);
  });

  it('returns null for things that are not webhooks', () => {
    for (const junk of ['not json', '{}', '{"event":"x"}', '{"event":"x","data":{}}', '[]']) {
      expect(parseWebhook(junk)).toBeNull();
    }
  });
});

describe('the simulator sends Paystack-shaped, signed webhooks', () => {
  it('posts charge.success with a valid signature', async () => {
    let received;
    const fakeFetch = async (url, init) => {
      received = { url, init };
      return { status: 200 };
    };
    const sim = createSimulatorProvider({ baseUrl: 'http://api', fetch: fakeFetch });
    await sim.initializeTransaction({
      reference: 'OKG-A',
      amountKobo: 5_000_000,
      email: 'a@b.co',
      callbackUrl: 'x',
    });
    await sim.complete('OKG-A');

    expect(await sim.sendWebhook('OKG-A', 'http://api/webhooks/paystack')).toBe(200);
    const body = received.init.body;
    expect(received.url).toBe('http://api/webhooks/paystack');
    expect(sim.verifyWebhookSignature(body, received.init.headers['x-paystack-signature'])).toBe(
      true,
    );
    expect(parseWebhook(body)).toMatchObject({ eventType: 'charge.success', reference: 'OKG-A' });
    expect(JSON.parse(body).data).toMatchObject({
      status: 'success',
      amount: 5_000_000,
      fees: 85_000,
    });
  });
});
