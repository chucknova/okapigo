/**
 * The API client: every way a request can end maps to one kind of error, so every screen
 * can show the right state. Uses a fake fetch: no server needed.
 */
import { describe, it, expect } from 'vitest';
import { api, ApiError, describeError } from '../src/lib/api.js';

/** A fake fetch that answers with a status and JSON body. */
const answer = (status, body) => async () =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('api()', () => {
  it('returns the JSON body', async () => {
    const data = await api('/public/x', { fetchImpl: answer(200, { ok: 1 }) });
    expect(data).toEqual({ ok: 1 });
  });

  it('returns null for 204 No Content', async () => {
    expect(await api('/x', { method: 'POST', fetchImpl: answer(204) })).toBeNull();
  });

  it('sends JSON bodies with the right header', async () => {
    let seen;
    const fetchImpl = async (_path, init) => {
      seen = init;
      return new Response('{}', { status: 201 });
    };
    await api('/x', { method: 'POST', body: { a: 1 }, fetchImpl });
    expect(seen).toMatchObject({ method: 'POST', body: '{"a":1}' });
    expect(seen.headers['Content-Type']).toBe('application/json');
  });

  it("doesn't even try when the phone knows it's offline", async () => {
    let called = false;
    const err = await api('/x', {
      online: () => false,
      fetchImpl: async () => ((called = true), new Response('{}')),
    }).catch((e) => e);
    expect(err).toMatchObject({ kind: 'offline' });
    expect(called).toBe(false);
  });

  it('a network failure is "offline"', async () => {
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await api('/x', { fetchImpl }).catch((e) => e.kind)).toBe('offline');
  });

  it('no answer in time is a "timeout"', async () => {
    // A fetch that only ends when it's aborted.
    const fetchImpl = (_path, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        ),
      );
    expect(await api('/x', { fetchImpl, timeoutMs: 10 }).catch((e) => e.kind)).toBe('timeout');
  });

  it('a 5xx (or a reply without our error shape) is "server"', async () => {
    expect(await api('/x', { fetchImpl: answer(503, {}) }).catch((e) => e.kind)).toBe('server');
    expect(await api('/x', { fetchImpl: answer(404) }).catch((e) => e.kind)).toBe('server');
  });

  it("our API's own 500 (which has an error body) is still 'server', not a normal 'no'", async () => {
    // middleware/errors.js answers bugs with { error: { code: 'INTERNAL_ERROR', … } }. The
    // status, not the body's shape, decides: a 5xx is always our problem.
    const fetchImpl = answer(500, {
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
    expect(await api('/x', { fetchImpl }).catch((e) => e.kind)).toBe('server');
  });

  it('a normal "no" keeps the code, message and details for the screen', async () => {
    const fetchImpl = answer(409, {
      error: { code: 'SOLD_OUT', message: 'Only 1 seats left.', seatsAvailable: 1 },
    });
    const err = await api('/public/x/bookings', { method: 'POST', fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      kind: 'api',
      status: 409,
      code: 'SOLD_OUT',
      message: 'Only 1 seats left.',
      details: { seatsAvailable: 1 },
    });
  });
});

describe('describeError', () => {
  it("uses the designs' words", () => {
    expect(describeError(new ApiError('offline', 'x')).title).toBe("You're offline");
    expect(describeError(new ApiError('timeout', 'x')).body).toContain(
      'Nothing you entered is lost',
    );
    expect(describeError(new Error('boom')).title).toBe('Something went wrong on our side.');
    expect(describeError(new ApiError('api', 'Only 1 seats left.')).title).toBe(
      'Only 1 seats left.',
    );
  });
});
