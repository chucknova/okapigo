// @ts-check
/**
 * octo-client.js — how Sojourna talks to a supplier (an OkapiGo business) through OCTO, the
 * standard API for tours and activities. Sojourna is a pretend travel website, but it talks
 * exactly as a real one would: over HTTP, with its own API key, and nothing else. It never
 * reads OkapiGo's database.
 *
 *   createOctoClient({ baseUrl, apiKey })   get(path), post(path, body)
 *
 * It asks for every capability its pages use (prices, content, pickups) on every request, so
 * the supplier's answers always have the same shape.
 *
 * What can go wrong, as an OctoClientError's `kind`:
 *   offline   no answer (down, a network error, or nothing within 8 seconds), or a 5xx
 *   octo      the supplier answered with an OCTO error ({ error, errorMessage, … })
 */

export const CAPABILITIES = 'octo/pricing, octo/content, octo/pickups';
const TIMEOUT_MS = 8_000;

export class OctoClientError extends Error {
  /**
   * @param {'offline' | 'octo'} kind @param {string} message
   * @param {{ status?: number, code?: string, body?: any }} [more]
   */
  constructor(kind, message, more = {}) {
    super(message);
    this.name = 'OctoClientError';
    this.kind = kind;
    this.status = more.status ?? null;
    this.code = more.code ?? null;
    this.body = more.body ?? null;
  }
}

/**
 * @param {{ baseUrl: string, apiKey: string, fetch?: typeof fetch }} o
 */
export function createOctoClient({ baseUrl, apiKey, fetch: doFetch = fetch }) {
  const root = baseUrl.replace(/\/+$/, '');

  /** @param {string} method @param {string} path @param {unknown} [body] */
  async function call(method, path, body) {
    let res;
    try {
      res = await doFetch(`${root}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Octo-Capabilities': CAPABILITIES,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new OctoClientError('offline', 'The supplier didn’t answer.');
    }
    const text = await res.text();
    /** @type {any} */
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null; // not JSON (an HTML error page): treated as no answer below
    }
    if (res.status >= 500 || (!res.ok && !json?.error)) {
      throw new OctoClientError('offline', `The supplier answered ${res.status}.`, {
        status: res.status,
      });
    }
    if (!res.ok) {
      throw new OctoClientError('octo', json.errorMessage ?? json.error, {
        status: res.status,
        code: json.error,
        body: json,
      });
    }
    return json;
  }

  return {
    /** @param {string} path */
    get: (path) => call('GET', path),
    /** @param {string} path @param {unknown} body */
    post: (path, body) => call('POST', path, body ?? {}),
    /** @param {string} path */
    del: (path) => call('DELETE', path),
  };
}
