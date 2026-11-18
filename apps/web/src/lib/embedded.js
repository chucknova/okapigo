// @ts-check
/**
 * embedded.js — "are we inside the booking widget, and how?" (stage 12h).
 *
 *   inline    the frame sits in the host page and grows to fit (it reports its height)
 *   overlay   opened by the "Book now" button: a fixed-size frame over a dimmed page; it
 *             scrolls inside, and a Close (×) asks the host page to close it
 *
 * A separate file so the checkout screens (the × in their header) and the widget screens can
 * both read it without importing each other.
 */
import { createContext, useContext } from 'react';

const OVERLAY_KEY = 'okg-embed-overlay';

/**
 * embed.js opens the overlay at /embed/…?overlay=1. Remembered for the visit, so later steps
 * (whose addresses don't carry it) are still in overlay mode.
 * @param {string} search
 */
export function overlayVisit(search) {
  const now = new URLSearchParams(search).get('overlay') === '1';
  try {
    if (now) sessionStorage.setItem(OVERLAY_KEY, '1');
    return now || sessionStorage.getItem(OVERLAY_KEY) === '1';
  } catch {
    return now;
  }
}

/** Asks the host page (embed.js) to close the overlay. Only a type: safe to send anywhere. */
export function closeOverlay() {
  window.parent.postMessage({ type: 'okapigo:close' }, '*');
}

/** @type {import('react').Context<{ embedded: boolean, overlay: boolean }>} */
export const EmbeddedContext = createContext({ embedded: false, overlay: false });

/** True inside the widget: Pay opens Paystack in a new tab instead of in the frame. */
export const useEmbedded = () => useContext(EmbeddedContext).embedded;

/** In the overlay: the function that closes it (for a × button); otherwise null. */
export const useOverlayClose = () => (useContext(EmbeddedContext).overlay ? closeOverlay : null);
