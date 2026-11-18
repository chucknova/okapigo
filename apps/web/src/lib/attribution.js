// @ts-check
/**
 * attribution.js — where this visit came from, carried into the booking (BKG-01: "UTM codes
 * carry into the booking", stage 12h-2).
 *
 *   https://okapigo.app/irin-lagos-tours?utm_source=instagram&utm_campaign=december
 *   → booking.attribution = { via: 'website', utm_source: 'instagram', utm_campaign: 'december' }
 *
 * In the widget, embed.js passes the HOST page's codes on to the frame's address, plus the
 * host's name (okg_host), so a booking says "widget on irinlagostours.com, from Instagram".
 *
 * Kept for the visit (sessionStorage): the codes are on the first page only, and the guest
 * books a few pages later. The FIRST codes of a visit win: that's the link that brought them.
 * The server checks every value again (AttributionSchema); this file just collects them.
 */
const KEY = 'okg-attribution';
const UTM = /** @type {const} */ ([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
]);
const SAFE = /^[\p{L}\p{N} ._\-+:/]{1,100}$/u;
const HOST = /^[a-z0-9.-]+(:\d{2,5})?$/i;

/** @typedef {Partial<Record<typeof UTM[number] | 'host', string>> & { via?: 'website' | 'widget' }} Attribution */

/** @returns {Attribution | null} */
function stored() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

/**
 * Called once when the app starts (main.jsx).
 * @param {string} search  location.search
 * @param {string} path    location.pathname (/embed/… means the widget)
 */
export function captureAttribution(search, path) {
  if (stored()) return; // the first page of the visit already said where it came from
  const q = new URLSearchParams(search);
  /** @type {Attribution} */
  const found = { via: path.startsWith('/embed') ? 'widget' : 'website' };
  for (const key of UTM) {
    const v = q.get(key)?.trim();
    if (v && SAFE.test(v)) found[key] = v;
  }
  const host = q.get('okg_host');
  if (found.via === 'widget' && host && HOST.test(host) && host.length <= 255) found.host = host;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(found));
  } catch {
    // Storage blocked: the booking just won't say where it came from.
  }
}

/** What to send with a new booking. @returns {Attribution | undefined} */
export function currentAttribution() {
  return stored() ?? undefined;
}
