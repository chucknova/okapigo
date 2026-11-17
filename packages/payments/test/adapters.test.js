/**
 * The payment adapters. The Paystack adapter is tested with a FAKE fetch that records what
 * we would send and returns realistic Paystack replies, so no network and no keys needed.
 */
import { describe, it, expect } from 'vitest';
import {
  createPaystackProvider,
  createSimulatorProvider,
  createPaymentProvider,
  simulatedFeeKobo,
  ProviderError,
  LiveKeyError,
} from '../src/index.js';

const TEST_KEY = 'sk_test_abc123DEF456';

/** A fake fetch: records each call and answers with `reply(url, init)`. */
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const { status = 200, json } = await reply(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
}

describe('key safety (PRD: refuse live keys)', () => {
  it('refuses a live secret key', () => {
    expect(() => createPaystackProvider({ secretKey: 'sk_live_realmoney123' })).toThrow(
      LiveKeyError,
    );
  });

  it('refuses anything that is not a test secret key', () => {
    for (const bad of ['', 'pk_test_abc', 'sk_test_', 'hello']) {
      expect(() => createPaystackProvider({ secretKey: bad })).toThrow(/TEST secret key/);
    }
  });

  it('accepts a test key', () => {
    expect(createPaystackProvider({ secretKey: TEST_KEY }).name).toBe('paystack');
  });
});

describe('Paystack: initializeTransaction', () => {
  it('sends the right request, with the amount in kobo, and maps the reply', async () => {
    const fetch = fakeFetch(() => ({
      json: {
        status: true,
        message: 'Authorization URL created',
        data: {
          authorization_url: 'https://checkout.paystack.com/abc',
          access_code: 'abc',
          reference: 'OKG-1',
        },
      },
    }));
    const paystack = createPaystackProvider({ secretKey: TEST_KEY, fetch });

    const result = await paystack.initializeTransaction({
      reference: 'OKG-1',
      amountKobo: 5_000_000,
      email: 'amara@guest.example',
      callbackUrl: 'http://localhost:4000/payments/callback',
      channels: ['card'],
      metadata: { bookingReference: 'ILT-7K4Q2M' },
    });

    expect(result).toEqual({
      authorizationUrl: 'https://checkout.paystack.com/abc',
      accessCode: 'abc',
      reference: 'OKG-1',
    });
    const [call] = fetch.calls;
    expect(call.url).toBe('https://api.paystack.co/transaction/initialize');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers.Authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(call.body).toEqual({
      email: 'amara@guest.example',
      amount: 5_000_000, // kobo, unchanged
      currency: 'NGN',
      reference: 'OKG-1',
      callback_url: 'http://localhost:4000/payments/callback',
      channels: ['card'],
      metadata: { bookingReference: 'ILT-7K4Q2M' },
    });
  });

  it('turns a Paystack refusal into PROVIDER_REJECTED with its message', async () => {
    const fetch = fakeFetch(() => ({
      status: 400,
      json: { status: false, message: 'Duplicate Transaction Reference' },
    }));
    const paystack = createPaystackProvider({ secretKey: TEST_KEY, fetch });

    await expect(
      paystack.initializeTransaction({
        reference: 'OKG-1',
        amountKobo: 100,
        email: 'a@b.co',
        callbackUrl: 'x',
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED',
      message: 'Duplicate Transaction Reference',
      httpStatus: 400,
    });
  });

  it('treats 5xx and 429 as "unavailable" (safe to retry later)', async () => {
    for (const status of [500, 503, 429]) {
      const paystack = createPaystackProvider({
        secretKey: TEST_KEY,
        fetch: fakeFetch(() => ({ status, json: {} })),
      });
      await expect(paystack.verifyTransaction('OKG-1')).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
      });
    }
  });

  it('times out instead of hanging, without leaking the key in the error', async () => {
    const neverAnswers = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(init.signal.reason)),
      );
    const paystack = createPaystackProvider({
      secretKey: TEST_KEY,
      fetch: neverAnswers,
      timeoutMs: 50,
    });

    const err = await paystack.verifyTransaction('OKG-1').catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe('PROVIDER_UNAVAILABLE');
    expect(err.message).toMatch(/did not respond in time/);
    expect(JSON.stringify(err)).not.toContain(TEST_KEY);
  });

  it('survives an HTML error page instead of JSON', async () => {
    const fetch = async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    const paystack = createPaystackProvider({ secretKey: TEST_KEY, fetch });
    await expect(paystack.verifyTransaction('OKG-1')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });
});

describe('Paystack: verifyTransaction', () => {
  it('maps a successful charge, including Paystack’s fee', async () => {
    const fetch = fakeFetch(() => ({
      json: {
        status: true,
        data: {
          id: 4099260516,
          status: 'success',
          amount: 5_000_000,
          currency: 'NGN',
          fees: 85_000,
          paid_at: '2026-11-17T09:15:00.000Z',
          channel: 'card',
          gateway_response: 'Successful',
        },
      },
    }));
    const paystack = createPaystackProvider({ secretKey: TEST_KEY, fetch });

    expect(await paystack.verifyTransaction('OKG-1')).toEqual({
      status: 'succeeded',
      amountKobo: 5_000_000,
      currency: 'NGN',
      feeKobo: 85_000,
      paidAt: new Date('2026-11-17T09:15:00.000Z'),
      channel: 'card',
      providerTransactionId: '4099260516',
      message: 'Successful',
    });
    expect(fetch.calls[0].url).toBe('https://api.paystack.co/transaction/verify/OKG-1');
  });

  it.each([
    ['failed', 'failed'],
    ['abandoned', 'abandoned'],
    ['ongoing', 'pending'],
    ['pending', 'pending'],
    ['queued', 'pending'],
  ])('Paystack status "%s" → "%s"', async (theirs, ours) => {
    const fetch = fakeFetch(() => ({
      json: { status: true, data: { status: theirs, amount: 100, currency: 'NGN' } },
    }));
    const paystack = createPaystackProvider({ secretKey: TEST_KEY, fetch });
    expect((await paystack.verifyTransaction('OKG-1')).status).toBe(ours);
  });

  it('a 404 means the reference is unknown', async () => {
    const fetch = fakeFetch(() => ({
      status: 404,
      json: { status: false, message: 'Transaction reference not found' },
    }));
    const paystack = createPaystackProvider({ secretKey: TEST_KEY, fetch });
    await expect(paystack.verifyTransaction('OKG-NOPE')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('encodes the reference in the URL', async () => {
    const fetch = fakeFetch(() => ({
      json: { status: true, data: { status: 'success', amount: 1, currency: 'NGN' } },
    }));
    await createPaystackProvider({ secretKey: TEST_KEY, fetch }).verifyTransaction('OKG/../x');
    expect(fetch.calls[0].url).toBe('https://api.paystack.co/transaction/verify/OKG%2F..%2Fx');
  });
});

describe('the simulator behaves like Paystack where it matters', () => {
  const start = (sim, reference = 'OKG-SIM1', amountKobo = 5_000_000) =>
    sim.initializeTransaction({ reference, amountKobo, email: 'a@b.co', callbackUrl: 'x' });

  it('starts pending, then succeeds with a fee', async () => {
    const sim = createSimulatorProvider({ baseUrl: 'http://localhost:4000' });
    const { authorizationUrl } = await start(sim);

    expect(authorizationUrl).toBe('http://localhost:4000/simulator/checkout/OKG-SIM1');
    expect((await sim.verifyTransaction('OKG-SIM1')).status).toBe('pending');

    await sim.complete('OKG-SIM1');
    expect(await sim.verifyTransaction('OKG-SIM1')).toMatchObject({
      status: 'succeeded',
      feeKobo: simulatedFeeKobo(5_000_000),
    });
  });

  it('refuses a duplicate reference, like Paystack', async () => {
    const sim = createSimulatorProvider({ baseUrl: 'x' });
    await start(sim);
    await expect(start(sim)).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED',
      message: 'Duplicate Transaction Reference',
    });
  });

  it('can fail and abandon', async () => {
    const sim = createSimulatorProvider({ baseUrl: 'x' });
    await start(sim, 'A');
    await start(sim, 'B');
    await sim.fail('A', 'Insufficient funds');
    await sim.abandon('B');
    expect(await sim.verifyTransaction('A')).toMatchObject({
      status: 'failed',
      message: 'Insufficient funds',
    });
    expect((await sim.verifyTransaction('B')).status).toBe('abandoned');
  });

  it('fees: 1.5%, plus ₦100 from ₦2,500, capped at ₦2,000', () => {
    expect(simulatedFeeKobo(200_000)).toBe(3_000); // ₦2,000 → ₦30
    expect(simulatedFeeKobo(5_000_000)).toBe(85_000); // ₦50,000 → ₦750 + ₦100
    expect(simulatedFeeKobo(50_000_000)).toBe(200_000); // capped at ₦2,000
  });
});

describe('createPaymentProvider', () => {
  it('picks the adapter from config', () => {
    expect(createPaymentProvider({ provider: 'simulator', baseUrl: 'x' }).name).toBe('simulator');
    expect(
      createPaymentProvider({ provider: 'paystack', paystackSecretKey: TEST_KEY, baseUrl: 'x' })
        .name,
    ).toBe('paystack');
    expect(() =>
      createPaymentProvider({ provider: 'paystack', paystackSecretKey: 'sk_live_x', baseUrl: 'x' }),
    ).toThrow(LiveKeyError);
  });
});
