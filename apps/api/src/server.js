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
import { createDbPool, createRedis } from './lib/connections.js';
import { createApp } from './app.js';

const config = loadConfig();
const logger = createLogger({
  level: config.LOG_LEVEL,
  pretty: config.NODE_ENV === 'development',
});

const db = createDbPool(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);

// Without an 'error' listener, a lost Redis connection would crash the whole process.
// We log it instead; the health check reports Redis as down and ioredis reconnects.
redis.on('error', (err) => logger.warn({ err: err.message }, 'redis connection error'));
db.on('error', (err) => logger.warn({ err: err.message }, 'postgres pool error'));

const app = createApp({ logger, db, redis });

const server = app.listen(config.API_PORT, () => {
  logger.info(`API listening on http://localhost:${config.API_PORT}`);
});

/** @param {string} signal */
async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  // Stop accepting new connections. The callback runs once existing requests finish.
  server.close(async () => {
    await Promise.allSettled([db.end(), redis.quit()]);
    logger.info('shutdown complete');
    process.exit(0);
  });
  // Safety net: if something hangs, force-exit after 10s instead of never stopping.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
