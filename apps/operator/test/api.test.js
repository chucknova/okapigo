/** The API client: each way a request can end, as the strip needs to tell them apart. */
import { describe, it, expect } from 'vitest';
import { request, ApiError } from '../src/lib/api.js';

/** @param {number} status @param {any} body @param {Record<string, string>} [headers] */
const answer =
  (status, body, headers = {}) =>
  async () =>
    new Response(
      body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body),
      {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
      },
    );

/** @param {any} p */
const kindOf = (p) =>
  p.then(
    () => 'ok',
    (/** @type {any} */ e) => (e instanceof ApiError ? e.kind : 'bug'),
  );

describe('request', () => {
  it('sends the token and the ETag; 304 keeps ours; returns the new ETag', async () => {
    /** @type {any} */
    let seen;
    const ok = await request('/api/sync/package', {
      token: 'tok',
      etag: 'W/"1"',
      fetchImpl: async (_url, init) => ((seen = init), new Response(null, { status: 304 })),
    });
    expect(seen.headers).toEqual({ Authorization: 'Bearer tok', 'If-None-Match': 'W/"1"' });
    expect(ok).toEqual({ status: 304, body: null, etag: 'W/"1"' });
    const fresh = await request('/x', { fetchImpl: answer(200, { a: 1 }, { ETag: 'W/"2"' }) });
    expect(fresh).toEqual({ status: 200, body: { a: 1 }, etag: 'W/"2"' });
  });

  it('offline, unreachable, a Wi-Fi login page, our server, signed out, a normal no', async () => {
    expect(await kindOf(request('/x', { online: () => false }))).toBe('offline');
    expect(
      await kindOf(
        request('/x', {
          fetchImpl: async () => {
            throw new TypeError('Failed to fetch');
          },
        }),
      ),
    ).toBe('unreachable');
    expect(
      await kindOf(request('/x', { fetchImpl: answer(200, '<html>Hotel Wi-Fi</html>') })),
    ).toBe('unreachable');
    expect(await kindOf(request('/x', { fetchImpl: answer(503, { error: { code: 'X' } }) }))).toBe(
      'server',
    );
    expect(
      await kindOf(
        request('/x', {
          fetchImpl: answer(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
        }),
      ),
    ).toBe('signed-out');
    const no = await request('/x', {
      fetchImpl: answer(400, { error: { code: 'INVALID_CODE', message: 'Wrong' } }),
    }).catch((e) => e);
    expect(no).toMatchObject({ kind: 'api', code: 'INVALID_CODE', message: 'Wrong', status: 400 });
  });
});
