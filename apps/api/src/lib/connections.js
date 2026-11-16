// @ts-check
/**
 * connections.js — opens the connections to PostgreSQL and Redis.
 *
 * These are created once in server.js and *passed into* the app (see app.js). The app
 * never creates its own connections. That is "dependency injection": tests can hand
 * the app fake connections, e.g. one that always fails, to test the "database is down"
 * path without actually stopping the database.
 *
 * Note: from session 2, Prisma will be our main way of talking to PostgreSQL. This
 * plain `pg` pool stays as a tiny, dependency-light way for the health check to ask
 * "is the database reachable?".
 */
import pg from 'pg';
import { Redis } from 'ioredis';

/** @param {string} databaseUrl */
export function createDbPool(databaseUrl) {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 5, // the health check needs very few connections
    // Give up connecting after 2s instead of hanging. A slow health check is a failed one.
    connectionTimeoutMillis: 2000,
  });
}

/** @param {string} redisUrl */
export function createRedis(redisUrl) {
  return new Redis(redisUrl, {
    // While disconnected, ioredis queues commands and sends them once it (re)connects.
    // We keep that queue: turning it off makes commands fail in the first milliseconds
    // after startup, before the connection is ready. (Our integration test caught exactly
    // that.) Instead we cap retries, and the health check adds its own 2s timeout, so a
    // dead Redis still gets a fast "error" rather than a hang.
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });
}
