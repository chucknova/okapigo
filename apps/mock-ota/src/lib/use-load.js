// @ts-check
/**
 * useLoad(path): `{ data, error, loading, reload }` for one of Sojourna's own API addresses.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/** @param {string | null} path */
export function useLoad(path) {
  const [state, setState] = useState(
    /** @type {{ data: any, error: import('./api.js').ApiError | null, loading: boolean }} */ ({
      data: null,
      error: null,
      loading: Boolean(path),
    }),
  );
  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path);
      setState({ data, error: null, loading: false });
    } catch (err) {
      setState({ data: null, error: /** @type {any} */ (err), loading: false });
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}
