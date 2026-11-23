// @ts-check
/**
 * ready-to-sell.js — what a tour needs before it can go ON SALE (stage 19b-1).
 *
 *   at least one price          (since stage 6)
 *   at least 3 photos           (decided 2026-11-23: "a minimum of 3 photos, with one cover
 *                                photo, but still allow them to make a draft")
 *
 * The cover is simply the first photo, so 3 photos always include a cover.
 *
 * When the rule applies (decided the same day):
 *   - only at the moment a tour is PUT on sale: a draft can be made with no photos;
 *   - a tour already on sale with fewer keeps selling, marked "needs 1 more photo";
 *   - removing a photo that takes an on-sale tour under 3 is allowed, after a warning.
 *
 * Used by the API (it refuses to put an unready tour on sale) and the staff app (the draft's
 * checklist, the tours list), so both say the same words.
 */

/** Photos a tour needs before it goes on sale. */
export const MIN_PHOTOS_TO_SELL = 3;

/** How many more photos it needs to go on sale (0 when it has enough). @param {number} count */
export const photosShort = (count) => Math.max(0, MIN_PHOTOS_TO_SELL - count);

/** "1 more photo", "2 more photos", "3 photos" (none yet). @param {number} count */
export function photosWanted(count) {
  const short = photosShort(count);
  if (short === 0) return null;
  if (count === 0) return `${MIN_PHOTOS_TO_SELL} photos`;
  return `${short} more ${short === 1 ? 'photo' : 'photos'}`;
}

/**
 * What's missing before it can go on sale, in the order the checklist shows them.
 * @param {{ activePrices: number, photoCount: number }} tour
 * @returns {Array<{ part: 'prices' | 'photos', line: string }>}
 */
export function missingToSell({ activePrices, photoCount }) {
  /** @type {Array<{ part: 'prices' | 'photos', line: string }>} */
  const missing = [];
  if (activePrices < 1) missing.push({ part: 'prices', line: 'Add its prices' });
  const wanted = photosWanted(photoCount);
  if (wanted) {
    missing.push({
      part: 'photos',
      line:
        photoCount === 0
          ? `Add ${wanted}`
          : `Add ${wanted} (it has ${photoCount} of ${MIN_PHOTOS_TO_SELL})`,
    });
  }
  return missing;
}

/**
 * The API's refusal, in one sentence.
 *   prices only   "Add at least one price before putting it on sale."  (unchanged since 6)
 *   photos only   "Add 2 more photos before putting it on sale (it has 1 of 3)."
 *   both          "Add at least one price and 3 photos before putting it on sale."
 * @param {{ activePrices: number, photoCount: number }} tour
 * @returns {string | null} null when it's ready
 */
export function notReadyMessage({ activePrices, photoCount }) {
  const noPrices = activePrices < 1;
  const wanted = photosWanted(photoCount);
  if (!noPrices && !wanted) return null;
  if (!wanted) return 'Add at least one price before putting it on sale.';
  const has = photoCount > 0 ? ` (it has ${photoCount} of ${MIN_PHOTOS_TO_SELL})` : '';
  if (!noPrices) return `Add ${wanted} before putting it on sale${has}.`;
  return `Add at least one price and ${wanted} before putting it on sale${has}.`;
}
