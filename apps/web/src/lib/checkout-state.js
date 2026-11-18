// @ts-check
/**
 * checkout-state.js — what the guest has chosen so far, and the live price.
 *
 * useCheckout(): the date, counters, extras and pickup point, kept in sessionStorage per
 * tour. A refresh, a slow reload or going Back loses nothing ("Nothing you entered is
 * lost"). sessionStorage, not localStorage: a new tab or tomorrow's visit starts fresh, and
 * nothing outlives the browser tab. It can be unavailable (private mode, blocked storage),
 * so every read and write is wrapped and the page still works without it.
 *
 * useQuote(): asks the server for the price of the current basket, 300 ms after the guest
 * stops tapping. The server's pricing pipeline is the only thing that knows money; while a
 * newer answer is on its way, `updating` is true and the screen says "Updating…".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * @typedef {{
 *   departure: { id: string, startsAt?: string, localDate: string, localTime: string, seatsAvailable: number } | null,
 *   counts: Record<string, number>,       // price category key → travellers
 *   addOns: Record<string, number>,       // add-on id → quantity
 *   pickup: string | null,                // pickup point name
 * }} CheckoutState
 */

/** @returns {CheckoutState} */
const empty = () => ({ departure: null, counts: {}, addOns: {}, pickup: null });

/** @param {string} key */
function load(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    return empty();
  }
}

/**
 * @param {string} operatorSlug
 * @param {string} tourSlug
 */
export function useCheckout(operatorSlug, tourSlug) {
  const key = `okg-checkout:${operatorSlug}/${tourSlug}`;
  const [state, setState] = useState(() => load(key));
  // The latest state, readable synchronously (React state only updates on the next render).
  const latest = useRef(state);

  /**
   * Saves a change AT ONCE, not in an effect after rendering. Choosing a date navigates to
   * step 2 in the same moment, and step 2 reads storage when it opens: a write that waited
   * for an effect came too late (step 1 had already gone), so step 2 found no date and sent
   * the guest back to step 1. Seen in the browser; covered by a test.
   * @param {Partial<CheckoutState>} patch
   */
  const update = useCallback(
    (patch) => {
      const next = { ...latest.current, ...patch };
      latest.current = next;
      try {
        sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage full or blocked: the checkout still works, it just won't survive a refresh.
      }
      setState(next);
    },
    [key],
  );
  return { state, update };
}

/** How long to wait after the last tap before asking for a price. */
export const QUOTE_DEBOUNCE_MS = 300;

/**
 * @param {string} path  POST /public/:operator/tours/:tour/quote
 * @param {{ departureId: string, travellers: Array<{ categoryKey: string }>, addOns: Array<{ addOnId: string, quantity: number }> } | null} body
 *   null = nothing to price (no travellers yet)
 */
export function useQuote(path, body) {
  const requestKey = body ? JSON.stringify(body) : null;
  const [result, setResult] = useState(
    /** @type {{ key: string | null, data: any, error: unknown }} */ ({
      key: null,
      data: null,
      error: null,
    }),
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (requestKey === null) return;
    let cancelled = false;
    // Wait for the guest to stop tapping: + + + is one request, not three.
    const timer = setTimeout(() => {
      api(path, { method: 'POST', body: JSON.parse(requestKey) }).then(
        (data) => !cancelled && setResult({ key: requestKey, data, error: null }),
        (error) => !cancelled && setResult((r) => ({ key: requestKey, data: r.data, error })),
      );
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true; // a newer basket (or leaving the page) wins
      clearTimeout(timer);
    };
  }, [path, requestKey, attempt]);

  const current = result.key === requestKey;
  return {
    /** The latest answer that arrived (possibly for an older basket while updating). */
    data: result.data,
    /** A newer basket is waiting for its price. */
    updating: requestKey !== null && !current,
    error: current ? result.error : null,
    retry: useCallback(() => setAttempt((n) => n + 1), []),
  };
}
