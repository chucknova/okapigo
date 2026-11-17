// @ts-check
/* eslint-disable no-console -- a command-line script: printing is its job */
/**
 * smoke-paystack.js — ONE real round trip to Paystack's TEST API, to prove your keys and our
 * adapter work against the real thing. Not part of the test suite (CI has no keys).
 *
 *   pnpm --filter @okapigo/payments smoke
 *
 * It starts a ₦100 test transaction and verifies it (which says "abandoned": nobody paid).
 * No money moves: test keys can't touch real money. Your key is never printed.
 */
import { existsSync } from 'node:fs';
import { createPaystackProvider } from '../src/paystack.js';
import { generatePaymentReference } from '@okapigo/shared/payment-status';

const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const secretKey = process.env.PAYSTACK_SECRET_KEY ?? '';
if (!secretKey) {
  console.log(
    'PAYSTACK_SECRET_KEY is empty in .env. Add your Paystack TEST secret key, then run again.',
  );
  process.exit(1);
}

const paystack = createPaystackProvider({ secretKey }); // refuses a live key
const reference = generatePaymentReference();

let started;
try {
  started = await paystack.initializeTransaction({
    reference,
    amountKobo: 10_000, // ₦100
    email: 'okapigo-smoke-test@example.com', // reserved domain: valid, but receives no mail
    callbackUrl: 'http://localhost:4000/payments/callback',
    channels: ['card'],
    metadata: { purpose: 'OkapiGo smoke test' },
  });
} catch (err) {
  // Print what Paystack said, plainly, instead of a stack trace.
  console.log(`✗ Paystack refused: ${err.message} (${err.code}, HTTP ${err.httpStatus ?? '-'})`);
  process.exit(1);
}
console.log('1. initialize ✓ checkout page:', started.authorizationUrl);

const verified = await paystack.verifyTransaction(reference);
console.log(
  '2. verify     ✓ status:',
  verified.status,
  '| amount (kobo):',
  verified.amountKobo,
  '| reference:',
  reference,
);
console.log("\nOpen the checkout page above to see Paystack's real test checkout. Test card: see");
console.log('https://paystack.com/docs/payments/test-payments/ (no real money moves).');
