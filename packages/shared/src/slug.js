// @ts-check
/**
 * slug.js — turns a display name into a URL-safe "slug".
 *
 *   slugify('Ìrìn Lagos Tours')   → 'irin-lagos-tours'
 *   slugify('Front Desk (Yaba)')  → 'front-desk-yaba'
 *
 * Yoruba, Igbo and Hausa names carry tone marks and dots (Ìrìn, Ọlá, Ụzọ). normalize('NFD')
 * splits "ì" into "i" + a separate accent mark, and the \p{M} regex then deletes the marks,
 * so the letters survive as plain ASCII instead of being dropped.
 */

/**
 * @param {string} text
 * @param {number} [maxLength]
 */
export function slugify(text, maxLength = 50) {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // remove accent / tone marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // anything else becomes a hyphen
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, ''); // no leading/trailing hyphens
}

/**
 * Words an OPERATOR slug can't be. Booking links live at the root of the site
 * (okapigo.app/irin-lagos-tours), next to the app's own paths (/api, /pay, /health…). An
 * operator called "API Tours" must not get the slug "api" and break, or shadow, those paths.
 * Includes a few words kept for later pages, so adding them can never clash with a business.
 */
export const RESERVED_OPERATOR_SLUGS = new Set([
  // used today
  'api',
  'auth',
  'health',
  'media', // uploaded photos and logos (19b-1)
  'octo',
  'pay',
  'payments',
  'public',
  'simulator',
  'webhooks',
  // kept for later (guest web, operator app, static files, docs)
  'about',
  'admin',
  'app',
  'assets',
  'book',
  'booking',
  'bookings',
  'checkout',
  'embed',
  'help',
  'login',
  'privacy',
  'signup',
  'static',
  'terms',
  'trip',
  'trips',
  'widget',
  'www',
]);

/**
 * Words a TOUR slug can't be: the guest web (session 12) needs paths under an operator,
 * like /irin-lagos-tours/checkout, that must never be mistaken for a tour.
 */
export const RESERVED_TOUR_SLUGS = new Set(['book', 'checkout', 'embed', 'pay', 'trip', 'trips']);
