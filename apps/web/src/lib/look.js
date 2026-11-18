// @ts-check
/**
 * look.js — the operator's website style on every guest page (MKT-08, stage 12g).
 *
 *   <html data-style="classic" data-mode="dark">
 *
 * tokens.css holds every style; these two attributes pick one. Lagoon (no data-style) is the
 * default, and "auto" (no data-mode) follows the guest's phone. Only the LOOK changes:
 * content, tour links and booking links stay exactly the same.
 *
 * Who sets them:
 *   - the SERVER, in the HTML of the catalogue, tour and checkout pages (no flash of Lagoon)
 *   - this file, once a page knows its operator (trip and payment link pages are private:
 *     their HTML holds nothing about the booking, so the style arrives with the data)
 *
 * PREVIEW (MKT-09, "preview any style with real content"): add ?style=earth&mode=dark to any
 * guest address. It's kept for the visit (sessionStorage), so the preview survives clicking
 * through to a tour and checkout. Only this browser sees it. ?preview=off ends it.
 */
import { useEffect } from 'react';
import { STYLE_NAMES, MODES } from '@okapigo/shared/tokens';

const PREVIEW_KEY = 'okg-look-preview';

/** @typedef {{ style?: string | null, mode?: string | null }} Look */

/** @param {unknown} v @returns {string | null} */
const validStyle = (v) =>
  typeof v === 'string' && STYLE_NAMES.includes(/** @type {any} */ (v)) ? v : null;
/** @param {unknown} v @returns {string | null} */
const validMode = (v) =>
  typeof v === 'string' && MODES.includes(/** @type {any} */ (v)) ? v : null;

/** The preview chosen in the address (?style=, ?mode=), remembered for this visit. */
function preview() {
  try {
    return /** @type {Look} */ (JSON.parse(sessionStorage.getItem(PREVIEW_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

/**
 * Reads ?style= and ?mode= once, when the app starts (main.jsx), and applies them at once.
 * @param {string} search  location.search
 */
export function startPreview(search) {
  const q = new URLSearchParams(search);
  if (q.get('preview') === 'off') {
    try {
      sessionStorage.removeItem(PREVIEW_KEY);
    } catch {
      // Storage blocked: there was no stored preview either.
    }
    return;
  }
  const style = validStyle(q.get('style'));
  const mode = validMode(q.get('mode'));
  if (!style && !mode) return;
  try {
    sessionStorage.setItem(
      PREVIEW_KEY,
      JSON.stringify({ ...preview(), ...(style && { style }), ...(mode && { mode }) }),
    );
  } catch {
    // Storage blocked: the preview still applies to this page.
  }
  applyLook({ style, mode });
}

/**
 * Sets the attributes on <html>. A preview wins over the operator's choice.
 * @param {Look} look
 * @param {HTMLElement} [root]
 */
export function applyLook(look, root = document.documentElement) {
  const p = preview();
  const style = validStyle(p.style) ?? validStyle(look.style) ?? 'lagoon';
  const mode = validMode(p.mode) ?? validMode(look.mode) ?? 'auto';
  if (style === 'lagoon') delete root.dataset.style;
  else root.dataset.style = style;
  if (mode === 'auto') delete root.dataset.mode;
  else root.dataset.mode = mode;
}

/**
 * For screens: apply the operator's look once it's known.
 * @param {{ websiteStyle?: string, websiteMode?: string } | null | undefined} operator
 */
export function useLook(operator) {
  const style = operator?.websiteStyle;
  const mode = operator?.websiteMode;
  useEffect(() => {
    if (style === undefined && mode === undefined) return; // not loaded yet: keep what's there
    applyLook({ style, mode });
  }, [style, mode]);
}
