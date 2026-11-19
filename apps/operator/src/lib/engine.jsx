// @ts-check
/**
 * The sync engine, for the screens: one engine for the whole app (made in main.jsx), read
 * with useSync() so a screen redraws when the engine's state changes.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';

/** @type {import('react').Context<import('./sync.js').SyncEngine | null>} */
export const EngineContext = createContext(/** @type {any} */ (null));

/** The engine itself (to record a change, dismiss a conflict…). */
export function useEngine() {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('useEngine outside <EngineContext>');
  return engine;
}

/** The engine's state; the screen redraws when it changes. */
export function useSync() {
  const engine = useEngine();
  return useSyncExternalStore(engine.subscribe, engine.getState);
}

/** The time now, ticking every `ms` (countdowns: "Send again in 0:24", "trying again in 30 s"). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
