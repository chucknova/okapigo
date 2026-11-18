// @ts-check
/**
 * usePolling(): call a function now and every `ms` while `active`, and stop when the page
 * goes away. Used by "Confirming your payment…" (the webhook usually lands in 2–5 seconds).
 */
import { useEffect, useRef } from 'react';

/**
 * @param {() => void | Promise<void>} fn
 * @param {number} ms
 * @param {boolean} active
 */
export function usePolling(fn, ms, active) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => latest.current(), ms);
    return () => clearInterval(id);
  }, [ms, active]);
}
