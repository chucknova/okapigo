/**
 * Tests that every error leaves the API in the same JSON shape:
 *   { error: { code, message } }
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { silentLogger, healthyDb, healthyRedis } from './helpers.js';

const app = createApp({ logger: silentLogger, db: healthyDb, redis: healthyRedis });

describe('error handling', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns a JSON 400 for a malformed JSON body', async () => {
    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{not valid json');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('does not reveal that the server runs Express', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
