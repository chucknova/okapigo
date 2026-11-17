// @ts-check
/**
 * config.js — reads and validates environment variables ONCE, at startup.
 *
 * Why validate? If DATABASE_URL is missing or misspelled, we want the API to crash
 * immediately with a clear message ("DATABASE_URL: Required"), not to start up and fail
 * later on the first request with a confusing connection error.
 *
 * Everything else in the API imports `config` from here instead of reading
 * `process.env` directly, so there is one place to see every setting the app uses.
 */
import { z } from 'zod';

/**
 * An optional setting where an EMPTY value ("PAYSTACK_SECRET_KEY=" in .env) counts as
 * "not set", rather than as an empty, invalid key.
 * @param {z.ZodType} schema
 */
const optional = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

// The "shape" of a valid environment. Zod checks types and fills in defaults.
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    // `z.coerce.number()` turns the string "4000" (env vars are always strings) into 4000.
    API_PORT: z.coerce.number().int().positive().default(4000),

    // No defaults here on purpose: the app must be told where its data lives.
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),

    // Server-side secret mixed into one-time-code hashes (see lib/secrets.js). Long and random;
    // generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),

    // --- Payments (stage 10b) ---------------------------------------------------------
    PAYMENT_PROVIDER: z.enum(['simulator', 'paystack']).default('simulator'),
    // KEY SAFETY (PRD): OkapiGo never handles real money, so a LIVE key stops the app from
    // starting at all, with a message saying why. Test keys only.
    PAYSTACK_SECRET_KEY: optional(
      z
        .string()
        .refine(
          (k) => !k.startsWith('sk_live_'),
          'LIVE key refused: OkapiGo runs in Paystack test mode only',
        )
        .refine(
          (k) => /^sk_test_[A-Za-z0-9]+$/.test(k),
          'must be a Paystack test secret key (sk_test_…)',
        ),
    ),
    PAYSTACK_PUBLIC_KEY: optional(
      z
        .string()
        .refine(
          (k) => !k.startsWith('pk_live_'),
          'LIVE key refused: OkapiGo runs in Paystack test mode only',
        )
        .refine(
          (k) => /^pk_test_[A-Za-z0-9]+$/.test(k),
          'must be a Paystack test public key (pk_test_…)',
        ),
    ),
    // The API's public address: where Paystack sends the guest back, and simulator pages live.
    API_PUBLIC_URL: z.url().default('http://localhost:4000'),
  })
  // Choosing Paystack without a key would only fail later, on a guest's first payment.
  .refine((env) => env.PAYMENT_PROVIDER !== 'paystack' || env.PAYSTACK_SECRET_KEY, {
    message: 'PAYMENT_PROVIDER=paystack needs PAYSTACK_SECRET_KEY (a test key)',
    path: ['PAYSTACK_SECRET_KEY'],
  });

/**
 * Parses an env object (defaults to process.env). Exported so tests can try bad input.
 * @param {Record<string, string | undefined>} env
 */
export function loadConfig(env = process.env) {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    // z.prettifyError turns Zod's error object into readable lines, one per problem.
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** @typedef {z.infer<typeof EnvSchema>} Config */
