// @ts-check
/**
 * live.js — the office's screens: data that must be fresh (designs: "Staff screens — states").
 *
 * Unlike the guide's saved package, the manager's screens are read live: "Bookings need a
 * connection, so you never act on old information." Each screen is in one of these:
 *
 *   loading     skeletons, for up to 10 s; then "Still loading… slow connection" · Try again
 *   offline     "You’re offline" · Try again (nothing was loaded yet)
 *   stale       offline, but loaded before: still shown, greyed, buttons off,
 *               "Offline · shown as of 11:02"
 *   error       "This booking didn’t load" · Try again · "quote 5F2A-07:41"
 *   denied      "This page is for managers" (the server said 403)
 *   ready
 *
 * One fetch per path at a time, shared by every screen showing it (the menu's badges and
 * Today read the same /api/today), refreshed every minute and when the signal returns.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { localTime } from '@okapigo/shared/time';
import { ApiError, request } from './api.js';
import { useEngine } from './engine.jsx';

/** After this long, loading says "Still loading… slow connection". */
export const SLOW_MS = 10_000;
/** How often an open screen refreshes itself. */
export const REFRESH_MS = 60_000;

/**
 * @typedef {{ data: any, at: string | null, error: ApiError | null, loading: boolean, startedAt: number | null }} Entry
 * @typedef {'loading' | 'slow' | 'offline' | 'stale' | 'error' | 'denied' | 'ready'} LiveState
 */

/**
 * Which state a screen is in.
 * @param {Entry} e @param {{ online: boolean, now: number }} o
 * @returns {LiveState}
 */
export function liveState(e, { online, now }) {
  if (e.error?.status === 403) return 'denied';
  if (!online || e.error?.kind === 'offline' || e.error?.kind === 'unreachable') {
    return e.data ? 'stale' : 'offline';
  }
  if (e.data && !e.error) return 'ready';
  if (e.error) return e.data ? 'stale' : 'error';
  if (e.loading && e.startedAt !== null && now - e.startedAt >= SLOW_MS) return 'slow';
  return 'loading';
}

/**
 * "Quote 5F2A-07:41": the start of the server's request id, and the time (designs).
 * @param {ApiError | null} err @param {Date} at @param {string} tz
 */
export function supportCode(err, at, tz) {
  const id = (err?.requestId ?? Math.random().toString(16).slice(2)).replace(/-/g, '');
  return `${id.slice(0, 4).toUpperCase()}-${localTime(at, tz)}`;
}

// --- The shared cache -------------------------------------------------------------------------

/** @type {Map<string, Entry>} */
const cache = new Map();
/** @type {Map<string, Set<() => void>>} */
const listeners = new Map();
/** @type {Map<string, Promise<void>>} */
const inFlight = new Map();
const EMPTY = /** @type {Entry} */ ({
  data: null,
  at: null,
  error: null,
  loading: false,
  startedAt: null,
});

/** @param {string} path @param {Partial<Entry>} patch */
function put(path, patch) {
  cache.set(path, { ...(cache.get(path) ?? EMPTY), ...patch });
  for (const fn of listeners.get(path) ?? []) fn();
}

/**
 * Fetches a path (once at a time; screens asking meanwhile share it).
 * @param {string} path @param {{ token: string | null, online: () => boolean, send?: typeof request }} o
 */
export function load(path, { token, online, send = request }) {
  const running = inFlight.get(path);
  if (running) return running;
  put(path, { loading: true, startedAt: Date.now() });
  const p = (async () => {
    try {
      const { body } = await send(path, { token, online });
      put(path, {
        data: body,
        at: new Date().toISOString(),
        error: null,
        loading: false,
        startedAt: null,
      });
    } catch (err) {
      put(path, {
        error: err instanceof ApiError ? err : new ApiError('server', String(err)),
        loading: false,
        startedAt: null,
      });
    } finally {
      inFlight.delete(path);
    }
  })();
  inFlight.set(path, p);
  return p;
}

/** Forget everything (signing out; tests). */
export function clearLive() {
  cache.clear();
  inFlight.clear();
}

/**
 * A screen's live data: `{ state, data, at, error, reload }`.
 * @param {string | null} path  null: nothing to load (e.g. not allowed)
 * @param {{ every?: number }} [o]  how often to look again (a chat: every few seconds, 16d)
 */
export function useLive(path, { every = REFRESH_MS } = {}) {
  const engine = useEngine();
  const key = path ?? '';
  const entry = useSyncExternalStore(
    (fn) => {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)?.add(fn);
      return () => listeners.get(key)?.delete(fn);
    },
    () => cache.get(key) ?? EMPTY,
  );
  const s = engine.getState();
  useEffect(() => {
    if (!path) return;
    const go = () =>
      void load(path, {
        token: engine.getState().session?.token ?? null,
        online: () => globalThis.navigator?.onLine ?? true,
      });
    go();
    const timer = setInterval(go, every);
    addEventListener('online', go);
    return () => {
      clearInterval(timer);
      removeEventListener('online', go);
    };
  }, [path, engine, every]);
  return {
    entry,
    online: s.connection !== 'offline',
    reload: () =>
      path
        ? load(path, {
            token: engine.getState().session?.token ?? null,
            online: () => globalThis.navigator?.onLine ?? true,
          })
        : Promise.resolve(),
  };
}

/**
 * After a change (assigning a guide, cancelling…): load again every path already loaded, so
 * the schedule, the departure and Today all agree. @param {{ token: string | null }} o
 */
export function reloadAll({ token }) {
  const online = () => globalThis.navigator?.onLine ?? true;
  return Promise.all(
    [...cache.keys()].filter(Boolean).map((path) => load(path, { token, online })),
  );
}
