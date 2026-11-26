// @ts-check
/**
 * posters.js — the Posters screen's logic (designs P1–P2, stage 18b): the choices, the
 * picture's address, fetching it with the staff member's sign-in, and the words around it.
 * The screen (screens/Posters.jsx) only draws these.
 */
import { hasAccess } from '@okapigo/shared/permissions';
import {
  POSTER_SIZES,
  POSTER_TEMPLATES,
  posterFileName,
  templateState,
} from '@okapigo/shared/posters';

/**
 * @typedef {{
 *   tourId: string | null,
 *   template: import('@okapigo/shared/posters').PosterTemplate,
 *   size: import('@okapigo/shared/posters').PosterSize,
 *   words: string,
 *   departureId: string | null,
 * }} PosterChoice
 */

/** Who sees Posters: marketing, at least to look (the owner and managers). @param {any} me @param {any} session */
export function canMakePosters(me, session) {
  if (me?.permissions?.marketing) return hasAccess(me.permissions.marketing, 'view');
  return ['owner', 'manager'].includes(session?.user?.role?.key);
}

/** A template's own words ("NEW TOUR"). @param {PosterChoice['template']} template */
export const defaultWords = (template) =>
  POSTER_TEMPLATES.find((t) => t.key === template)?.words ?? '';

/**
 * Where the screen starts: the first tour, New tour, square, its words.
 * @param {{ tours: Array<{ id: string, departures: Array<{ id: string }> }> }} data
 * @returns {PosterChoice}
 */
export function firstChoice(data) {
  const tour = data.tours[0] ?? null;
  return {
    tourId: tour?.id ?? null,
    template: 'new_tour',
    size: 'square',
    words: defaultWords('new_tour'),
    departureId: tour?.departures[0]?.id ?? null,
  };
}

/**
 * A change to one choice, and what it means for the others: a new template brings its own
 * words; a new tour, its first departure; a template that can't be used for the new tour
 * falls back to New tour.
 * @param {PosterChoice} c
 * @param {Partial<PosterChoice>} change
 * @param {{ tours: Array<{ id: string, departures: Array<{ id: string }> }>, weekend: { count: number } }} data
 * @returns {PosterChoice}
 */
export function choose(c, change, data) {
  let next = { ...c, ...change };
  if (change.template && change.template !== c.template) {
    next.words = defaultWords(change.template);
  }
  if (change.tourId && change.tourId !== c.tourId) {
    const tour = data.tours.find((t) => t.id === change.tourId);
    next.departureId = tour?.departures[0]?.id ?? null;
    if (tour && !templateState(next.template, tour, data.weekend.count).available) {
      next = { ...next, template: 'new_tour', words: defaultWords('new_tour') };
    }
  }
  return next;
}

/**
 * The picture's address for a choice (GET /api/posters/png).
 * @param {PosterChoice} c
 */
export function posterPath(c) {
  const q = new URLSearchParams({ template: c.template, size: c.size });
  if (c.template !== 'weekend' && c.tourId) q.set('productId', c.tourId);
  if (c.template === 'seats_left' && c.departureId) q.set('departureId', c.departureId);
  if (c.words.trim()) q.set('words', c.words.trim());
  return `/api/posters/png?${q}`;
}

/**
 * The file it downloads as.
 * @param {PosterChoice} c @param {string} tourSlug @param {string} businessSlug
 */
export const fileFor = (c, tourSlug, businessSlug) =>
  posterFileName(c.template === 'weekend' ? businessSlug : tourSlug, c.template, c.size);

/** "Download PNG · 1080 × 1080". @param {PosterChoice['size']} size */
/**
 * The line about the photo under the preview (19b-2b): Seats left and Offer show the tour's
 * cover; New tour and This weekend keep their panels (the route, the weekend's trips).
 * @param {string} template @param {{ hasPhoto?: boolean } | undefined} tour
 */
export function photoNote(template, tour) {
  if (template !== 'seats_left' && template !== 'offer') return null;
  return tour?.hasPhoto
    ? 'The tour’s cover photo is in it, with its credit.'
    : 'No photo yet: add photos in Settings › Tours and the cover goes in.';
}

export const downloadLabel = (size) =>
  `Download PNG · ${POSTER_SIZES[size].width} × ${POSTER_SIZES[size].height}`;

/** After the download (designs P2). @param {string} file @param {PosterChoice['size']} size */
export const savedWords = (file, size) =>
  `${file} (${POSTER_SIZES[size].width} × ${POSTER_SIZES[size].height}). Post it, or send it on WhatsApp.`;

/**
 * Fetches the picture with the staff member's sign-in (an <img> can't send it).
 * @param {string} path
 * @param {{ token: string | null, fetchImpl?: typeof fetch, online?: () => boolean, signal?: AbortSignal }} o
 * @returns {Promise<{ ok: true, blob: Blob } | { ok: false, problem: string }>}
 */
export async function fetchPoster(path, o) {
  const {
    token,
    fetchImpl = globalThis.fetch.bind(globalThis),
    online = () => globalThis.navigator?.onLine ?? true,
    signal,
  } = o;
  const offline = 'Couldn’t make the PNG (no connection). Try again when you’re online.';
  if (!online()) return { ok: false, problem: offline };
  let res;
  try {
    res = await fetchImpl(path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
      signal,
    });
  } catch (err) {
    if (/** @type {any} */ (err)?.name === 'AbortError') throw err;
    return { ok: false, problem: offline };
  }
  if (res.ok) return { ok: true, blob: await res.blob() };
  const body = await res.json().catch(() => null);
  return {
    ok: false,
    problem:
      res.status < 500 && body?.error?.message
        ? body.error.message
        : 'Couldn’t make the PNG. Try again.',
  };
}
