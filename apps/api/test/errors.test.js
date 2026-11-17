/**
 * Tests that every error leaves the API in the same JSON shape:
 *   { error: { code, message } }
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from './helpers.js';

const app = buildApp();

describe('error handling', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    // Three segments: can't be a booking link. (Since stage 11e, one- and two-segment paths
    // like /irin-lagos-tours/heritage-walk are booking links with an HTML "not found" page;
    // see share-pages.test.js.)
    const res = await request(app).get('/does/not/exist');

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
