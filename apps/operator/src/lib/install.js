// @ts-check
/**
 * install.js — "Put OkapiGo on your home screen" (designs: First run).
 *
 * Android Chrome offers installing through an event (beforeinstallprompt) that has to be
 * caught early and kept; tapping "Install the app" replays it. iPhones have no such event:
 * the screen explains Share → "Add to Home Screen" instead.
 */

/** @type {any} */
let deferred = null;
/** @type {Set<() => void>} */
const listeners = new Set();

/** Call once, as the app starts (main.jsx). */
export function listenForInstall() {
  globalThis.addEventListener?.('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own button, at the right moment
    deferred = e;
    for (const fn of listeners) fn();
  });
}

/** @param {() => void} fn */
export function onInstallable(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const canInstall = () => deferred !== null;

/** Shows the browser's own install prompt. @returns {Promise<boolean>} installed */
export async function install() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  return outcome === 'accepted';
}

/** Already opened from the home screen. */
export const isInstalled = () =>
  Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches) ||
  Boolean(/** @type {any} */ (globalThis.navigator)?.standalone);

export const isIphone = () => /iPhone|iPad|iPod/.test(globalThis.navigator?.userAgent ?? '');
