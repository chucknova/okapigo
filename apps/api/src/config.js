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

// The "shape" of a valid environment. Zod checks types and fills in defaults.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // `z.coerce.number()` turns the string "4000" (env vars are always strings) into 4000.
  API_PORT: z.coerce.number().int().positive().default(4000),

  // No defaults here on purpose: the app must be told where its data lives.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
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
