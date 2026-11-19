// @ts-check
/**
 * status.js — what the connection strip says (designs: tokens v1, "Connection strip"; O2
 * and Sync states; Sync edge cases). The strip is on every screen; tapping it opens Sync.
 *
 * One line, from the sync engine's state, most urgent first:
 *   sending      "Sending 3 changes…"
 *   conflict     "1 change needs a look · tap"
 *   signed out   "Online · 6 changes waiting to send"            (the sign-in ran out)
 *   stale        "Offline for 3 days · saved copy is out of date" (older than 72 hours)
 *   offline      "Offline · saved 06:40 · 3 changes waiting"
 *   unreachable  "Can’t reach OkapiGo · trying again in 30 s"
 *   server       "OkapiGo is having trouble · your changes are safe"
 *   online       "Online · up to date 06:40"
 */
import { localDate, localTime } from '@okapigo/shared/time';
import { formatAt } from '@okapigo/shared/tour-facts';

/** How long a saved copy is good for, offline (PRD: 72 hours). */
export const SAVED_FOR_MS = 72 * 3_600_000;
const DAY = 86_400_000;

/** @param {number} n @param {string} one @param {string} many */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @typedef {'online' | 'sending' | 'offline' | 'conflict' | 'trouble'} Tone
 * @param {import('./sync.js').SyncState} s
 * @param {Date} now
 * @param {string} timeZone
 * @returns {{ tone: Tone, icon: 'dot' | 'sync' | 'wifi-off' | 'alert', text: string }}
 */
export function stripFor(s, now, timeZone) {
  const waiting = s.outbox.length;
  const saved = s.savedAt ? localTime(new Date(s.savedAt), timeZone) : null;
  if (s.sending) {
    const left = s.sending.total - s.sending.done;
    return { tone: 'sending', icon: 'sync', text: `Sending ${plural(left, 'change', 'changes')}…` };
  }
  if (s.conflicts.length > 0) {
    const n = s.conflicts.length;
    return {
      tone: 'conflict',
      icon: 'alert',
      text: `${plural(n, 'change', 'changes')} ${n === 1 ? 'needs' : 'need'} a look · tap`,
    };
  }
  const offline = s.connection === 'offline';
  if (s.signedOut && !offline) {
    return {
      tone: 'trouble',
      icon: 'alert',
      text: waiting
        ? `Online · ${plural(waiting, 'change', 'changes')} waiting to send`
        : 'Online · sign in again',
    };
  }
  if (offline) {
    if (isStale(s, now)) {
      const days = Math.max(
        3,
        Math.floor((now.getTime() - Date.parse(/** @type {string} */ (s.savedAt))) / DAY),
      );
      return {
        tone: 'conflict',
        icon: 'wifi-off',
        text: `Offline for ${days} days · saved copy is out of date`,
      };
    }
    const parts = ['Offline'];
    if (saved) parts.push(`saved ${saved}`);
    if (waiting) parts.push(`${plural(waiting, 'change', 'changes')} waiting`);
    return { tone: 'offline', icon: 'wifi-off', text: parts.join(' · ') };
  }
  if (s.connection === 'unreachable') {
    const secs = s.retryAt
      ? Math.max(0, Math.ceil((Date.parse(s.retryAt) - now.getTime()) / 1000))
      : 0;
    return {
      tone: 'trouble',
      icon: 'alert',
      text:
        secs > 0
          ? `Can’t reach OkapiGo · trying again in ${secs} s`
          : 'Can’t reach OkapiGo · trying again',
    };
  }
  if (s.connection === 'server') {
    return {
      tone: 'trouble',
      icon: 'alert',
      text: 'OkapiGo is having trouble · your changes are safe',
    };
  }
  return {
    tone: 'online',
    icon: 'dot',
    text: saved ? `Online · up to date ${saved}` : 'Online',
  };
}

/** The saved copy is more than 72 hours old. @param {{ savedAt: string | null }} s @param {Date} now */
export function isStale(s, now) {
  return (
    Boolean(s.savedAt) &&
    now.getTime() - Date.parse(/** @type {string} */ (s.savedAt)) > SAVED_FOR_MS
  );
}

/**
 * "Tue 8 Dec, 06:40": until when the saved copy is good (O5, First run).
 * @param {string} savedAt @param {string} timeZone
 */
export function goodUntil(savedAt, timeZone) {
  return formatAt(Date.parse(savedAt) + SAVED_FOR_MS, timeZone);
}

/**
 * "06:40" today, or "Sat 5 Dec, 06:40" on another day.
 * @param {string | Date} at @param {Date} now @param {string} timeZone
 */
export function stamp(at, now, timeZone) {
  const d = new Date(at);
  return localDate(d, timeZone) === localDate(now, timeZone)
    ? localTime(d, timeZone)
    : formatAt(d.getTime(), timeZone);
}
