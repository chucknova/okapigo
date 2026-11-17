// @ts-check
/**
 * api.js — the ONE way the guest web talks to the API.
 *
 * Every request ends in exactly one of these, so every screen can show the right state from
 * the designs ("Any screen · Offline or request failed"):
 *
 *   ok        → the JSON body
 *   'offline' → no connection, or the request never reached us  → "You're offline"
 *   'timeout' → no answer in time (3G can be slow)              → "You're offline" too
 *   'server'  → we broke (5xx)                                  → "Something went wrong on our side"
 *   'api'     → a normal "no" with a code: SOLD_OUT, ADULT_REQUIRED, HOLD_EXPIRED…
 *               The screen decides what to show for each code.
 *
 * Screens never call fetch() directly, so this is also the one place to add things later
 * (a request id header, retries for safe GETs).
 */

export class ApiError extends Error {
  /**
   * @param {'offline' | 'timeout' | 'server' | 'api'} kind
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

/** How long to wait before giving up. Generous: a slow 3G phone can take seconds. */
export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * @param {string} path  e.g. '/public/irin-lagos-tours'
 * @param {{
 *   method?: 'GET' | 'POST' | 'PATCH' | 'DELETE',
 *   body?: unknown,
 *   timeoutMs?: number,
 *   fetchImpl?: typeof fetch,     // tests pass a fake
 *   online?: () => boolean,       // tests pass a fake; default navigator.onLine
 * }} [options]
 * @returns {Promise<any>}
 */
export async function api(path, options = {}) {
  const {
    method = 'GET',
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch.bind(globalThis),
    online = () => globalThis.navigator?.onLine ?? true,
  } = options;

  // The phone KNOWS it's offline: don't even try (and don't wait 20 s to find out).
  if (!online()) throw new ApiError('offline', "You're offline");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // fetch() only throws when no answer came back at all: no connection, DNS, or our abort.
    const timedOut = /** @type {any} */ (err)?.name === 'AbortError';
    throw new ApiError(timedOut ? 'timeout' : 'offline', "You're offline");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);

  if (res.ok) return json;
  if (res.status >= 500 || !json?.error) {
    throw new ApiError('server', 'Something went wrong on our side.', { status: res.status });
  }
  // The API's error shape: { error: { code, message, ...details } } (middleware/errors.js).
  const { code, message, ...details } = json.error;
  throw new ApiError('api', message, { status: res.status, code, details });
}

/**
 * The words for a failed request, from the designs ("Any screen · Offline or request failed").
 * `api` errors carry the server's own message, written for guests.
 * @param {unknown} error
 * @returns {{ title: string, body: string }}
 */
export function describeError(error) {
  const kind = error instanceof ApiError ? error.kind : 'server';
  if (kind === 'offline' || kind === 'timeout') {
    return {
      title: "You're offline",
      body: 'Check your connection and try again. Nothing you entered is lost.',
    };
  }
  if (kind === 'api') return { title: /** @type {ApiError} */ (error).message, body: '' };
  return { title: 'Something went wrong on our side.', body: 'Please try again in a moment.' };
}
