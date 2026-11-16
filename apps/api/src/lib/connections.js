// @ts-check
/**
 * connections.js — opens the connection to Redis.
 *
 * Connections are created once in server.js and *passed into* the app (see app.js). The
 * app never creates its own. That is "dependency injection": tests can hand the app fake
 * connections, e.g. one that always fails, to test the "Redis is down" path.
 *
 * PostgreSQL connections come from Prisma: createPrismaClient() in @okapigo/db.
 * (Session 1 had a separate `pg` pool just for the health check; one pool is simpler.)
 */
import { Redis } from 'ioredis';

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
