// @ts-check
/**
 * save-parts.js — one save bar for a page made of sections (Settings › Tours, 16e-4b; designs:
 * "Unsaved changes: Adult price", one bar at the bottom of every settings page).
 *
 * The page owns the bar; each section (Basics, Prices, Schedule…) reports what it has unsaved
 * and hands over how to save and discard itself:
 *
 *   page      const parts = useSaveParts();
 *             <Basics part={parts.part('basics')} />
 *             <SaveBar changed={parts.changed} blocked={parts.blocked} onSave={parts.saveAll} … />
 *   section   useSavePart(part, changed, problems > 0, save, discard);
 *
 * "Save changes" saves each section with something unsaved, in the order they're on the page,
 * and stops at the first that fails (its own note says why); what was saved stays saved.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * @typedef {{
 *   report: (changed: string[], blocked: boolean) => void,
 *   bind: (save: () => Promise<boolean>, discard: () => void) => void,
 * }} SavePart
 */

export function useSaveParts() {
  /** What each section has unsaved, in the order they first reported. */
  const [parts, setParts] = useState(
    /** @type {Array<{ key: string, changed: string[], blocked: boolean }>} */ ([]),
  );
  const fns = useRef(
    /** @type {Record<string, { save: () => Promise<boolean>, discard: () => void }>} */ ({}),
  );
  const cache = useRef(/** @type {Record<string, SavePart>} */ ({}));
  const [saving, setSaving] = useState(false);

  /** The same handle for a key every time (so sections' effects don't re-run for nothing). */
  const part = useCallback((/** @type {string} */ key) => {
    cache.current[key] ??= {
      report: (changed, blocked) =>
        setParts((all) => {
          const at = all.findIndex((p) => p.key === key);
          const now = { key, changed, blocked };
          if (at === -1) return [...all, now];
          const was = all[at];
          if (was.blocked === blocked && was.changed.join('\n') === changed.join('\n')) return all;
          return all.map((p, i) => (i === at ? now : p));
        }),
      bind: (save, discard) => {
        fns.current[key] = { save, discard };
      },
    };
    return cache.current[key];
  }, []);

  const changed = parts.flatMap((p) => p.changed);
  const blocked = parts.some((p) => p.blocked && p.changed.length > 0);

  const saveAll = async () => {
    setSaving(true);
    try {
      for (const p of parts) {
        if (p.changed.length === 0) continue;
        if (!(await fns.current[p.key]?.save())) return false;
      }
      return true;
    } finally {
      setSaving(false);
    }
  };
  const discardAll = () => {
    for (const f of Object.values(fns.current)) f.discard();
  };
  return { part, changed, blocked, saving, saveAll, discardAll };
}

/**
 * A section's side: report what it has unsaved (and whether something must be fixed first),
 * and how to save and discard it.
 * @param {SavePart} part @param {string[]} changed @param {boolean} blocked
 * @param {() => Promise<boolean>} save @param {() => void} discard
 */
export function useSavePart(part, changed, blocked, save, discard) {
  const key = changed.join('\n');
  useEffect(() => {
    part.report(key ? key.split('\n') : [], blocked);
  }, [part, key, blocked]);
  // Gone from the page: nothing unsaved any more.
  useEffect(() => () => part.report([], false), [part]);
  // The latest save and discard (they close over the section's current form).
  useEffect(() => {
    part.bind(save, discard);
  });
}
