// @ts-check
/**
 * api.js — the pages ask Sojourna's own server (never the supplier: its key stays on the
 * server). A failed answer becomes an ApiError with the designs' state to show:
 * 'offline', 'taken', 'expired', 'not_confirmed', or 'refused' (with the server's words).
 */

export class ApiError extends Error {
  /** @param {string} problem @param {string} message @param {any} [body] */
  constructor(problem, message, body = {}) {
    super(message);
    this.problem = problem;
    this.body = body;
  }
}

/** @param {string} path @param {{ method?: string, body?: unknown }} [o] */
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('offline', 'No connection.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(json.problem ?? 'refused', json.message ?? 'Something went wrong.', json);
  return json;
}
