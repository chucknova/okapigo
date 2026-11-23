// @ts-check
/**
 * photos.js — a tour's photos while they're being edited (stage 19b-2a; designs: U2, U3, U7, U8
 * on the 19b canvas). Plain functions over a list of items; the screens only draw them.
 *
 *   an item     { key, url, small, alt, credit, name, status, progress, error }
 *               status  'ready'      uploaded (or already the tour's): it has its url
 *                       'uploading'  on its way (progress 0–100)
 *                       'failed'     didn't arrive (error says why; "Try again" or "Remove")
 *
 * The order IS the order guests see: the first is the cover (card, link preview, poster).
 * Uploading happens as soon as photos are picked (lib/uploads.js); the tour only changes when
 * it's saved, like every other setting.
 *
 * The rules it shares with the server (@okapigo/shared/ready-to-sell): 3 photos to go on sale,
 * 8 at most.
 */
import { MIN_PHOTOS_TO_SELL, MAX_TOUR_PHOTOS } from '@okapigo/shared/ready-to-sell';
import { tooBigLine } from '@okapigo/shared/uploads';

/** A description (alt text) can be this long; the credit this long (the server's limits). */
export const ALT_MAX = 200;
export const CREDIT_MAX = 120;

/**
 * @typedef {{
 *   key: string, url: string | null, small: string | null, alt: string, credit: string,
 *   name: string, status: 'ready' | 'uploading' | 'failed', progress: number,
 *   error: string | null,
 * }} PhotoItem
 */

/** The tour's saved photos as items. @param {any[]} photos @returns {PhotoItem[]} */
export const photoItems = (photos) =>
  (photos ?? []).map((p, i) => ({
    key: `saved-${i}-${p.url}`,
    url: p.url,
    small: p.small ?? p.url,
    alt: p.alt ?? '',
    credit: p.credit ?? '',
    name: '',
    status: 'ready',
    progress: 100,
    error: null,
  }));

/** @param {PhotoItem[]} items */
export const readyCount = (items) => items.filter((i) => i.status === 'ready').length;
/** @param {PhotoItem[]} items */
export const uploadingCount = (items) => items.filter((i) => i.status === 'uploading').length;

/**
 * Picked files → new items, uploading. Too big ones and ones past 8 aren't added: `refused`
 * says why, in the server's words.
 * @param {PhotoItem[]} items
 * @param {Array<{ name: string, size: number }>} files
 * @param {() => string} makeKey
 * @returns {{ items: PhotoItem[], added: Array<{ key: string, index: number }>, refused: string[] }}
 */
export function addFiles(items, files, makeKey) {
  const next = [...items];
  /** @type {Array<{ key: string, index: number }>} */
  const added = [];
  /** @type {string[]} */
  const refused = [];
  let over = 0;
  files.forEach((file, index) => {
    const big = tooBigLine('photo', file.size);
    if (big) return refused.push(`${file.name}: ${big}`);
    if (next.length >= MAX_TOUR_PHOTOS) return over++;
    const key = makeKey();
    next.push({
      key,
      url: null,
      small: null,
      alt: '',
      credit: '',
      name: file.name,
      status: 'uploading',
      progress: 0,
      error: null,
    });
    added.push({ key, index });
  });
  if (over) {
    refused.push(
      `Up to ${MAX_TOUR_PHOTOS} photos a tour: ${over} ${over === 1 ? 'wasn’t' : 'weren’t'} added.`,
    );
  }
  return { items: next, added, refused };
}

/** @param {PhotoItem[]} items @param {string} key @param {Partial<PhotoItem>} change */
const update = (items, key, change) => items.map((i) => (i.key === key ? { ...i, ...change } : i));

/** @param {PhotoItem[]} items @param {string} key @param {number} percent */
export const progressed = (items, key, percent) =>
  update(items, key, { progress: Math.max(0, Math.min(100, Math.round(percent))) });

/** @param {PhotoItem[]} items @param {string} key @param {{ url: string, small: string }} picture */
export const uploaded = (items, key, picture) =>
  update(items, key, {
    url: picture.url,
    small: picture.small,
    status: 'ready',
    progress: 100,
    error: null,
  });

/** @param {PhotoItem[]} items @param {string} key @param {string} error */
export const uploadFailed = (items, key, error) =>
  update(items, key, { status: 'failed', error, progress: 0 });

/** Sent again ("Try again"). @param {PhotoItem[]} items @param {string} key */
export const retrying = (items, key) =>
  update(items, key, { status: 'uploading', error: null, progress: 0 });

/** @param {PhotoItem[]} items @param {string} key @param {'alt' | 'credit'} field @param {string} value */
export const setText = (items, key, field, value) => update(items, key, { [field]: value });

/** @param {PhotoItem[]} items @param {string} key */
export const removed = (items, key) => items.filter((i) => i.key !== key);

/** One place earlier (-1) or later (+1). @param {PhotoItem[]} items @param {string} key @param {-1 | 1} by */
export function moved(items, key, by) {
  const at = items.findIndex((i) => i.key === key);
  const to = at + by;
  if (at === -1 || to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

/** First, so it's the cover. @param {PhotoItem[]} items @param {string} key */
export function madeCover(items, key) {
  const item = items.find((i) => i.key === key);
  return item ? [item, ...items.filter((i) => i !== item)] : items;
}

/**
 * What must be fixed, per photo. Only ready photos need a description: one still uploading
 * can be described meanwhile.
 * @param {PhotoItem[]} items
 * @returns {Record<string, { alt?: string, credit?: string }>}
 */
export function photoErrors(items) {
  /** @type {Record<string, { alt?: string, credit?: string }>} */
  const errors = {};
  for (const i of items) {
    /** @type {{ alt?: string, credit?: string }} */
    const e = {};
    if (i.status === 'ready' && !i.alt.trim())
      e.alt = 'Describe the photo: guests using screen readers need it.';
    else if (i.alt.trim().length > ALT_MAX)
      e.alt = `Too long: ${i.alt.trim().length} of ${ALT_MAX} characters.`;
    if (i.credit.trim().length > CREDIT_MAX)
      e.credit = `Too long: ${i.credit.trim().length} of ${CREDIT_MAX} characters.`;
    if (e.alt || e.credit) errors[i.key] = e;
  }
  return errors;
}

/** How many things to fix. @param {PhotoItem[]} items */
export const photoProblemCount = (items) =>
  Object.values(photoErrors(items)).reduce((n, e) => n + (e.alt ? 1 : 0) + (e.credit ? 1 : 0), 0);

/**
 * What the server gets: the ready photos, in order. A photo that failed or is still uploading
 * isn't sent (saving waits for uploads: see `saveWait`).
 * @param {PhotoItem[]} items
 */
export const photosBody = (items) =>
  items
    .filter((i) => i.status === 'ready' && i.url)
    .map((i) => ({
      url: /** @type {string} */ (i.url),
      small: /** @type {string} */ (i.small ?? i.url),
      alt: i.alt.trim(),
      credit: i.credit.trim() || null,
    }));

/** Anything different from what's saved (order, a photo, a description, a credit)? */
export const photosChanged = (/** @type {PhotoItem[]} */ items, /** @type {PhotoItem[]} */ saved) =>
  JSON.stringify(photosBody(items)) !== JSON.stringify(photosBody(saved)) ||
  uploadingCount(items) > 0;

/** "Save when the upload ends." while any photo is on its way; else null. @param {PhotoItem[]} items */
export const saveWait = (items) => {
  const n = uploadingCount(items);
  if (n === 0) return null;
  return n === 1 ? 'Save when the upload ends.' : `Save when the ${n} uploads end.`;
};

/**
 * The count beside "Photos": "2 of 3 needed · 1 uploading", "3 of 8 ✓".
 * @param {PhotoItem[]} items
 */
export function photosCountLine(items) {
  const ready = readyCount(items);
  const up = uploadingCount(items);
  const base =
    ready < MIN_PHOTOS_TO_SELL
      ? `${ready} of ${MIN_PHOTOS_TO_SELL} needed`
      : `${ready} of ${MAX_TOUR_PHOTOS} ✓`;
  return up ? `${base} · ${up} uploading` : base;
}

/** Below 3: shown as a thing to do (the warning colour), not a mistake. @param {PhotoItem[]} items */
export const photosShortNow = (items) => readyCount(items) < MIN_PHOTOS_TO_SELL;

/**
 * Removing a photo from a tour ON SALE that takes it under 3 asks first (decided 2026-11-23:
 * allowed, after a warning). Null: no need to ask.
 * @param {{ title: string, status: string }} product
 * @param {PhotoItem[]} items
 * @param {string} key
 */
export function removeAsk(product, items, key) {
  const item = items.find((i) => i.key === key);
  if (product.status !== 'published' || item?.status !== 'ready') return null;
  const left = readyCount(items) - 1;
  if (left >= MIN_PHOTOS_TO_SELL) return null;
  return `${product.title} will have ${left} ${left === 1 ? 'photo' : 'photos'}, under the ${MIN_PHOTOS_TO_SELL} a tour on sale should have. It stays on sale.`;
}

/** "Photo 2" and its place, for buttons read aloud ("Move photo 2 up"). @param {number} index */
export const photoName = (index) => `photo ${index + 1}`;
