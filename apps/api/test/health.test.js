/**
 * Unit tests for GET /health, using FAKE dependencies.
 *
 * Supertest's `request(app)` sends HTTP requests straight to the Express app in memory,
 * with no port and no running server. Because createApp() takes its dependencies as
 * arguments (buildApp in helpers.js fills in fakes), we can hand it fakes and test what happens when PostgreSQL or Redis is down,
 * without actually breaking anything.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp, failing } from './helpers.js';

describe('GET /health', () => {
  it('returns 200 when the database and Redis are reachable', async () => {
    const app = buildApp();

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { db: 'ok', redis: 'ok' } });
  });

  it('returns 503 and names the failing dependency when the database is down', async () => {
    const app = buildApp({ prisma: failing });

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded', checks: { db: 'error', redis: 'ok' } });
  });

  it('returns 503 when Redis is down', async () => {
    const app = buildApp({ redis: failing });

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ db: 'ok', redis: 'error' });
  });

  it('sends back a request ID, reusing one the caller provides', async () => {
    const app = buildApp();

    const fresh = await request(app).get('/health');
    expect(fresh.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/); // a new UUID

    const reused = await request(app).get('/health').set('X-Request-Id', 'trace-123');
    expect(reused.headers['x-request-id']).toBe('trace-123');
  });
});
