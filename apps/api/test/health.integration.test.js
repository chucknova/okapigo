/**
 * Integration test: GET /health against the REAL PostgreSQL and Redis.
 *
 * Unit tests prove our logic with fakes; this proves the real wiring works (the
 * connection strings, the drivers, the SQL). It needs the services running:
 *   locally: `pnpm services:up`
 *   in CI:   GitHub Actions starts them as "service containers"
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDbPool, createRedis } from '../src/lib/connections.js';
import { silentLogger } from './helpers.js';

describe('GET /health (real PostgreSQL + Redis)', () => {
  /** @type {ReturnType<typeof createDbPool>} */ let db;
  /** @type {ReturnType<typeof createRedis>} */ let redis;

  beforeAll(() => {
    const config = loadConfig();
    db = createDbPool(config.DATABASE_URL);
    redis = createRedis(config.REDIS_URL);
  });

  // Always close connections, or Vitest waits for them and the run never finishes.
  afterAll(async () => {
    await db?.end();
    await redis?.quit();
  });

  it('reports both services as ok', async () => {
    const app = createApp({ logger: silentLogger, db, redis });

    const res = await request(app).get('/health');

    expect(res.body).toEqual({ status: 'ok', checks: { db: 'ok', redis: 'ok' } });
  });
});
