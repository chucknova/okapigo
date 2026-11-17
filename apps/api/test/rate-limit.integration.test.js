/**
 * Integration test: the rate limiter's Redis store against the REAL Redis.
 * The checkout tests use the in-memory store; this proves the production one counts and
 * expires keys the way the middleware expects (INCR, then EXPIRE … NX on the first hit only).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRedis } from '../src/lib/connections.js';
import { redisRateLimitStore } from '../src/middleware/rate-limit.js';

describe('redisRateLimitStore (real Redis)', () => {
  let redis;
  const key = `rl:test:${randomUUID()}`;

  beforeAll(() => {
    redis = createRedis(process.env.REDIS_URL);
  });
  afterAll(async () => {
    await redis?.del(key);
    await redis?.quit();
  });

  it('counts hits and sets the expiry once, on the first hit', async () => {
    const store = redisRateLimitStore(redis);

    expect(await store.hit(key, 60)).toBe(1);
    const firstTtl = await redis.ttl(key);
    await redis.expire(key, 30); // pretend 30 s have passed
    expect(await store.hit(key, 60)).toBe(2);
    expect(await store.hit(key, 60)).toBe(3);

    expect(firstTtl).toBeGreaterThan(55);
    // NX: later hits did NOT push the expiry back to 60 s, so the window really ends.
    expect(await redis.ttl(key)).toBeLessThanOrEqual(30);
  });
});
