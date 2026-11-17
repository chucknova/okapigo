// @ts-check
/**
 * rate-limit.js — "at most N requests per window, per IP address" for public routes.
 *
 * Why: from stage 11b a stranger's browser can HOLD SEATS. Without a limit, one script could
 * hold every seat on a departure, let the holds expire, and hold them again, forever. The
 * hold expiry stops seats being lost for good; this stops one visitor blocking everyone.
 *
 * How (a "fixed window" counter):
 *   key = rl:<name>:<ip>:<window number>      window number = floor(now / window length)
 *   each request INCRements the key; the first one also sets it to EXPIRE with the window
 *   count > limit → 429 Too Many Requests, with a Retry-After header (seconds)
 * Counters live in REDIS, so every API process shares them (a limit kept in one process's
 * memory would multiply with every extra server). Tests use the in-memory store below.
 *
 * Trade-offs to know:
 *   - Many Nigerian mobile users share ONE public IP (carrier-grade NAT), so limits must be
 *     generous: a busy IP is often hundreds of real people, not one attacker.
 *   - If Redis is down we let requests through (fail OPEN) and log it. Blocking every
 *     checkout because the limiter's storage hiccupped would hurt more than a short window
 *     without limits; holds still never oversell (row locks), and they still expire.
 *   - Behind a proxy or load balancer, req.ip is the PROXY's address unless Express is told
 *     to trust it ('trust proxy'). That's a deployment setting (session 18, parking lot).
 */
import { HttpError } from './errors.js';

/**
 * @typedef {{ hit: (key: string, windowSeconds: number) => Promise<number> }} RateLimitStore
 *   hit() adds one to the key's counter and returns the new count.
 */

/**
 * Counters in Redis (production). MULTI runs INCR and EXPIRE together in one round trip.
 * EXPIRE … NX sets the expiry only if the key has none yet, i.e. on the window's first hit.
 * @param {import('ioredis').Redis} redis
 * @returns {RateLimitStore}
 */
export function redisRateLimitStore(redis) {
  return {
    async hit(key, windowSeconds) {
      const results = await redis.multi().incr(key).expire(key, windowSeconds, 'NX').exec();
      const [err, count] = /** @type {[Error | null, number]} */ (results?.[0] ?? [null, 0]);
      if (err) throw err;
      return count;
    },
  };
}

/**
 * Counters in this process's memory (tests, and anywhere Redis isn't wanted).
 * @returns {RateLimitStore}
 */
export function memoryRateLimitStore() {
  /** @type {Map<string, { count: number, expiresAt: number }>} */
  const counters = new Map();
  return {
    async hit(key, windowSeconds) {
      const now = Date.now();
      const entry = counters.get(key);
      if (!entry || entry.expiresAt <= now) {
        counters.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
        return 1;
      }
      entry.count += 1;
      return entry.count;
    },
  };
}

/**
 * @param {{
 *   store: RateLimitStore,
 *   name: string,             // separates the counters of different limits
 *   limit: number,            // requests allowed per window
 *   windowSeconds: number,
 *   now?: () => number,       // for tests
 * }} options
 * @returns {import('express').RequestHandler}
 */
export function rateLimit({ store, name, limit, windowSeconds, now = Date.now }) {
  return async (req, res, next) => {
    const nowMs = now();
    const windowMs = windowSeconds * 1000;
    const windowNumber = Math.floor(nowMs / windowMs);
    const key = `rl:${name}:${req.ip}:${windowNumber}`;

    let count;
    try {
      count = await store.hit(key, windowSeconds);
    } catch (err) {
      req.log?.warn({ err, limiter: name }, 'rate limiter unavailable; letting request through');
      return next();
    }

    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - count)));
    if (count > limit) {
      const secondsLeft = Math.ceil(((windowNumber + 1) * windowMs - nowMs) / 1000);
      res.setHeader('Retry-After', String(secondsLeft));
      return next(
        new HttpError(
          429,
          'RATE_LIMITED',
          `Too many requests. Please wait ${secondsLeft} seconds and try again.`,
        ),
      );
    }
    next();
  };
}
