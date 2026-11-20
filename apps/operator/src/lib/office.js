// @ts-check
/**
 * office.js — the office's changes (assign, notes, cancel): sent straight to the server, never
 * queued. Unlike a guide's check-ins, these need a connection: "you never act on old
 * information" (designs: Staff screens — states). After each, every screen reloads.
 */
import { ApiError, request } from './api.js';
import { reloadAll } from './live.js';

/**
 * @param {import('./sync.js').SyncEngine} engine
 * @param {string} path
 * @param {{ method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown }} o
 * @returns {Promise<{ ok: true, body: any } | { ok: false, error: ApiError }>}
 */
export async function act(engine, path, { method, body }) {
  const token = engine.getState().session?.token ?? null;
  try {
    const res = await request(path, { method, body: body ?? {}, token });
    await reloadAll({ token });
    return { ok: true, body: res.body };
  } catch (err) {
    const error = err instanceof ApiError ? err : new ApiError('server', String(err));
    // A refusal (someone else just assigned that guide): what's on screen is out of date.
    if (error.kind === 'api') await reloadAll({ token });
    return { ok: false, error };
  }
}

/** The words for a failed change: the server's own for a refusal; ours otherwise. @param {ApiError} e */
export function actionError(e) {
  if (e.kind === 'offline' || e.kind === 'unreachable')
    return 'No connection: nothing was changed. Try again when you have signal.';
  if (e.kind === 'api') return e.message;
  return 'Didn’t save. Try again.';
}
