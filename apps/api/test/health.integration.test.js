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
import { createPrismaClient } from '@okapigo/db';
import { createRedis } from '../src/lib/connections.js';
import { buildApp } from './helpers.js';

describe('GET /health (real PostgreSQL + Redis)', () => {
  let prisma;
  let redis;

  beforeAll(() => {
    prisma = createPrismaClient(process.env.DATABASE_URL);
    redis = createRedis(process.env.REDIS_URL);
  });

  // Always close connections, or Vitest waits for them and the run never finishes.
  afterAll(async () => {
    await prisma?.$disconnect();
    await redis?.quit();
  });

  it('reports both services as ok', async () => {
    const res = await request(buildApp({ prisma, redis })).get('/health');

    expect(res.body).toEqual({ status: 'ok', checks: { db: 'ok', redis: 'ok' } });
  });
});
