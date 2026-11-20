// @ts-check
/**
 * now.js — the time now, as React state that ticks (a held booking's countdown, 16c; a chat's
 * booking chip, 16d). Reading the clock while drawing would give a different answer on each
 * draw; this changes only when it ticks.
 */
import { useEffect, useState } from 'react';

/** The time now, every `ms` while `on`. @param {number} ms @param {boolean} [on] */
export function useNow(ms, on = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}
