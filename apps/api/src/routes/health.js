// @ts-check
/**
 * health.js — GET /health
 *
 * Answers "is the API up, and can it reach everything it depends on?". Used by:
 *  - you, while developing (`curl localhost:4000/health`)
 *  - the hosting platform (Render/Railway/Fly), which restarts the API if this fails
 *  - the uptime monitor that the PRD asks for
 *
 * Returns 200 when everything is reachable and 503 ("Service Unavailable") when not,
 * so machines can tell from the status code alone.
 */
import { Router } from 'express';

const CHECK_TIMEOUT_MS = 2000;

/**
 * Runs one check (an async function) and reports "ok" or "error". It never throws, and
 * it gives up after CHECK_TIMEOUT_MS so one hung dependency can't freeze the endpoint.
 * @param {() => Promise<unknown>} check
 * @returns {Promise<'ok' | 'error'>}
 */
async function probe(check) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), CHECK_TIMEOUT_MS);
  });
  try {
    // Promise.race settles with whichever finishes first: the check or the timeout.
    await Promise.race([check(), timeout]);
    return 'ok';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{
 *   db: { query: (sql: string) => Promise<unknown> },
 *   redis: { ping: () => Promise<unknown> },
 * }} deps
 */
export function healthRouter({ db, redis }) {
  const router = Router();

  router.get('/health', async (_req, res) => {
    // Run both checks at the same time rather than one after the other.
    const [dbStatus, redisStatus] = await Promise.all([
      probe(() => db.query('SELECT 1')),
      probe(() => redis.ping()),
    ]);

    const healthy = dbStatus === 'ok' && redisStatus === 'ok';
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      checks: { db: dbStatus, redis: redisStatus },
    });
  });

  return router;
}
