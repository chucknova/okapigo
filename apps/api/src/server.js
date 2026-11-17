// @ts-check
/**
 * server.js — the API's entry point: `pnpm dev` (or `pnpm start`) runs this file.
 *
 * Order of events:
 *  1. Load and validate config (crash early if it's wrong).
 *  2. Open connections to PostgreSQL and Redis.
 *  3. Build the Express app with those connections and start listening.
 *  4. On Ctrl+C (SIGINT) or a platform shutdown (SIGTERM), stop taking new requests,
 *     let in-flight ones finish, close connections, then exit. This is "graceful shutdown",
 *     and it means a deploy never cuts a guest off halfway through paying.
 */
import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { createPrismaClient } from '@okapigo/db';
import { createRedis } from './lib/connections.js';
import { redisRateLimitStore } from './middleware/rate-limit.js';
import { createLogOtpSender } from './auth/otp-sender.js';
import { createJobClient } from '@okapigo/jobs';
import { createPaymentProvider, redisStore } from '@okapigo/payments';
import { createApp } from './app.js';

const config = loadConfig();
const logger = createLogger({
  level: config.LOG_LEVEL,
  pretty: config.NODE_ENV === 'development',
});

const prisma = createPrismaClient(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
// Development only: sign-in codes appear in this terminal. Real senders arrive in session 13.
const otpSender = createLogOtpSender(logger, { nodeEnv: config.NODE_ENV });
// Enqueues background jobs (e.g. hold expiry) for the workers app to run.
const jobs = createJobClient(config.REDIS_URL);
// The payment provider: the simulator, or Paystack TEST mode (a live key never gets this far:
// loadConfig() above refuses it, and so does the Paystack adapter itself).
const provider = createPaymentProvider({
  provider: config.PAYMENT_PROVIDER,
  paystackSecretKey: config.PAYSTACK_SECRET_KEY,
  baseUrl: config.API_PUBLIC_URL,
  // The simulator's "transactions" live in Redis, so the workers can re-check them.
  simulatorStore: redisStore(redis),
  simulatorSecret: config.SIMULATOR_WEBHOOK_SECRET,
  // Simulated refunds "process" by themselves 1.5 s later and send their webhook, like Paystack.
  simulatorAutoRefundMs: 1500,
});
logger.info({ provider: provider.name }, 'payment provider ready');

// Without an 'error' listener, a lost Redis connection would crash the whole process.
// We log it instead; the health check reports Redis as down and ioredis reconnects.
redis.on('error', (err) => logger.warn({ err: err.message }, 'redis connection error'));

const app = createApp({
  logger,
  prisma,
  redis,
  otpSender,
  authSecret: config.AUTH_SECRET,
  jobs,
  provider,
  apiPublicUrl: config.API_PUBLIC_URL,
  // Rate-limit counters in Redis, shared by every API process (see middleware/rate-limit.js).
  rateLimitStore: redisRateLimitStore(redis),
  webPublicUrl: config.WEB_PUBLIC_URL ?? config.API_PUBLIC_URL,
});

const server = app.listen(config.API_PORT, () => {
  logger.info(`API listening on http://localhost:${config.API_PORT}`);
});

/** @param {string} signal */
async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  // Stop accepting new connections. The callback runs once existing requests finish.
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), redis.quit(), jobs.close()]);
    logger.info('shutdown complete');
    process.exit(0);
  });
  // Safety net: if something hangs, force-exit after 10s instead of never stopping.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
