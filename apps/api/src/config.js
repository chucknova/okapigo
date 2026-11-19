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
    // Redis key prefix for job queues; the e2e tests set a private one (see workers/index.js).
    JOBS_PREFIX: optional(z.string().regex(/^[a-z0-9-]{1,40}$/)),

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
    // Signing secret for the SIMULATOR's webhooks (no real money in simulator mode; a default
    // is used if unset). Paystack's webhooks are signed with PAYSTACK_SECRET_KEY instead.
    SIMULATOR_WEBHOOK_SECRET: optional(z.string().min(16)),
    // --- WhatsApp Cloud API (stage 13c-3): optional; without it, only the simulator chats ---
    // Meta app → WhatsApp → API Setup: the access token. Kept secret like a payment key.
    WHATSAPP_ACCESS_TOKEN: optional(z.string().min(20)),
    // Meta app → App settings → Basic → App secret: signs every webhook Meta sends us.
    WHATSAPP_APP_SECRET: optional(z.string().min(16)),
    // Any long random string YOU choose, typed into Meta's webhook settings too: Meta sends it
    // back once, when you connect the webhook, to prove the address is yours.
    WHATSAPP_VERIFY_TOKEN: optional(z.string().min(16)),
    // The language the message templates were approved in (stage 14c), as Meta writes it.
    WHATSAPP_TEMPLATE_LANGUAGE: z
      .string()
      .regex(/^[a-z]{2}(_[A-Z]{2})?$/)
      .default('en'),
    // The Graph API version the calls are made to.
    WHATSAPP_GRAPH_VERSION: z
      .string()
      .regex(/^v\d+\.\d$/)
      .default('v23.0'),

    // --- Email (stage 14b) -------------------------------------------------------------
    // none: no email (tests, CI). mailpit: a local mailbox in Docker, http://localhost:8025:
    // nothing leaves your laptop. resend: real email, through Resend.
    EMAIL_PROVIDER: z.enum(['none', 'mailpit', 'resend']).default('none'),
    MAILPIT_URL: z.url().default('http://localhost:8025'),
    // Resend → API Keys. Kept secret like a payment key.
    RESEND_API_KEY: optional(
      z.string().regex(/^re_[A-Za-z0-9_]+$/, 'must be a Resend API key (re_…)'),
    ),
    // The address emails come from (the business's name is shown as the sender). Without a
    // domain of your own, Resend allows only onboarding@resend.dev, which delivers ONLY to
    // your own Resend account's email: a safe way to try it.
    EMAIL_FROM: z.email().default('onboarding@resend.dev'),

    // The API's public address: where Paystack sends the guest back, and simulator pages live.
    API_PUBLIC_URL: z.url().default('http://localhost:4000'),
    // Where GUESTS see booking links (okapigo.app/irin-lagos-tours). Used in link previews.
    // Unset = the same as API_PUBLIC_URL (today the API serves those pages itself).
    WEB_PUBLIC_URL: optional(z.url()),
  })
  .refine((env) => env.EMAIL_PROVIDER !== 'resend' || env.RESEND_API_KEY, {
    message: 'EMAIL_PROVIDER=resend needs RESEND_API_KEY',
    path: ['RESEND_API_KEY'],
  })
  // Half a WhatsApp set-up would only fail later, on a guest's first message.
  .refine(
    (env) => !env.WHATSAPP_ACCESS_TOKEN || (env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN),
    {
      message: 'WHATSAPP_ACCESS_TOKEN needs WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN too',
      path: ['WHATSAPP_APP_SECRET'],
    },
  )
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
