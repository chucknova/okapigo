// @ts-check
/**
 * api.js — the ONE way the operator app talks to the API.
 *
 * Every request ends in exactly one of these, because the connection strip (designs: tokens
 * v1, "Sync edge cases") shows a different line for each:
 *
 *   ok             → { status, body, etag }
 *   'offline'      → the phone says it has no connection        → "Offline · saved 06:40"
 *   'unreachable'  → it has one, but nothing gets through (hotel Wi-Fi asking for a login
 *                    page, a weak signal, no answer in time)     → "Can't reach OkapiGo"
 *   'server'       → we answered, broken (5xx)                  → "OkapiGo is having trouble"
 *   'signed-out'   → the 30-day sign-in ran out (401)           → "Sign in again to send"
 *   'api'          → a normal "no" with a code (INVALID_CODE, TOO_MANY_REQUESTS…)
 */

export class ApiError extends Error {
  /**
   * @param {'offline' | 'unreachable' | 'server' | 'signed-out' | 'api'} kind
   * @param {string} message
   * @param {{ status?: number, code?: string, details?: Record<string, unknown> }} [extra]
   */
  constructor(kind, message, { status, code, details } = {}) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.details = details ?? {};
  }
}

/** Generous: a slow 3G phone on a bus can take seconds. */
export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * @typedef {{
 *   method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
 *   body?: unknown,
 *   token?: string | null,
 *   etag?: string | null,          // If-None-Match: "I have this version"
 *   timeoutMs?: number,
 *   fetchImpl?: typeof fetch,      // tests pass a fake
 *   online?: () => boolean,        // tests pass a fake; default navigator.onLine
 * }} RequestOptions
 */

/**
 * @param {string} path  e.g. '/api/sync/package'
 * @param {RequestOptions} [options]
 * @returns {Promise<{ status: number, body: any, etag: string | null }>}
 */
export async function request(path, options = {}) {
  const {
    method = 'GET',
    body,
    token,
    etag,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch.bind(globalThis),
    online = () => globalThis.navigator?.onLine ?? true,
  } = options;

  // The phone KNOWS it's offline: don't try (and don't wait 20 s to find out).
  if (!online()) throw new ApiError('offline', 'Offline');

  /** @type {Record<string, string>} */
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (etag) headers['If-None-Match'] = etag;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      // Our own ETag handling, never the browser's cache (it could hand back a stale package).
      cache: 'no-store',
    });
  } catch {
    // No answer at all, though the phone thinks it's connected (or our timeout fired).
    throw new ApiError('unreachable', 'Can’t reach OkapiGo');
  } finally {
    clearTimeout(timer);
  }

  const tag = res.headers.get('ETag');
  if (res.status === 304) return { status: 304, body: null, etag: tag ?? etag ?? null };
  if (res.status === 204) return { status: 204, body: null, etag: tag };
  const json = await res.json().catch(() => undefined);
  // A Wi-Fi login page answers with its own HTML, not our JSON: it isn't us.
  if (json === undefined && res.status < 500) {
    throw new ApiError('unreachable', 'Can’t reach OkapiGo', { status: res.status });
  }
  if (res.ok) return { status: res.status, body: json, etag: tag };
  if (res.status === 401) {
    throw new ApiError('signed-out', 'Sign in again', { status: 401 });
  }
  if (res.status >= 500 || !json?.error) {
    throw new ApiError('server', 'OkapiGo is having trouble', { status: res.status });
  }
  // The API's error shape: { error: { code, message, ...details } } (middleware/errors.js).
  const { code, message, ...details } = json.error;
  throw new ApiError('api', message, { status: res.status, code, details });
}
