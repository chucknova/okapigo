// @ts-check
/**
 * data.js — how screens get their data.
 *
 * 1. EMBEDDED FIRST. Share pages (apps/api/src/routes/share-pages.js) put the page's data in
 *    <script id="okg-data">. takeEmbedded() hands it to the screen that matches, ONCE, so the
 *    first screen draws immediately, with no extra request on a slow connection. After that
 *    (navigating inside the app), screens fetch from the API as normal.
 * 2. useApi() for everything else, with loading / error / retry, built on api.js.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/** @type {any} */
let embedded;
let read = false;

/**
 * The embedded data, if it's for THIS screen (same kind, same slugs). Returned only once:
 * coming back to a page later fetches fresh data.
 * @param {(data: any) => boolean} matches
 */
export function takeEmbedded(matches) {
  if (!read) {
    read = true;
    const el = typeof document === 'undefined' ? null : document.getElementById('okg-data');
    try {
      embedded = el ? JSON.parse(el.textContent ?? 'null') : null;
    } catch {
      embedded = null; // a broken embed is no worse than none: the screen fetches instead
    }
  }
  if (embedded && matches(embedded)) {
    const data = embedded;
    embedded = null;
    return data;
  }
  return null;
}

/** Tests only: forget what was read. */
export function resetEmbedded() {
  embedded = undefined;
  read = false;
}

/**
 * GET a path, with the states every screen needs. `initial` (e.g. embedded data) counts as
 * the first answer, so no request is made for it. `retry()` asks again ("Try again").
 *
 * Each answer is stored with the REQUEST it answers ("path#attempt"). So "loading" is simply
 * "no answer yet for the current request", and an answer for an old path (the guest moved
 * on) is never shown on the new page. Nothing has to be set to "loading" up front, which
 * would cost an extra render (React's rule: no setState directly inside an effect).
 *
 * @template T
 * @param {string | null} path  null = don't fetch (yet)
 * @param {T | null} [initial]
 * @returns {{ data: T | null, error: unknown, loading: boolean, retry: () => void }}
 */
export function useApi(path, initial = null) {
  const [attempt, setAttempt] = useState(0);
  const key = path === null ? null : `${path}#${attempt}`;
  const [result, setResult] = useState(
    /** @type {{ key: string | null, data: T | null, error: unknown }} */ ({
      key: initial !== null && path !== null ? `${path}#0` : null,
      data: initial,
      error: null,
    }),
  );

  useEffect(() => {
    if (key === null || path === null || result.key === key) return;
    let cancelled = false; // a newer request (or leaving the page) wins
    api(path).then(
      (data) => !cancelled && setResult({ key, data, error: null }),
      (error) => !cancelled && setResult((r) => ({ key, data: r.data, error })),
    );
    return () => {
      cancelled = true;
    };
  }, [key, path, result.key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // Only answers for THIS path count (a retry keeps showing the last good data meanwhile).
  const samePath = path !== null && result.key?.startsWith(`${path}#`);
  return {
    data: samePath ? result.data : null,
    error: samePath && result.key === key ? result.error : null,
    loading: key !== null && result.key !== key,
    retry,
  };
}
