// @ts-check
/**
 * photos.js — the words and sizes around photos on guest pages (stage 19b-2b; designs: U4, U5).
 *
 *   creditLine(photo)          "Photo: Sho photography, CC BY-SA 4.0" (null: no credit)
 *   siteCredits(hero, tours)   the website's footer: everyone whose photo is on the page, once
 *   counterLine(i, n)          "1 of 3" on the tour page's photos
 *   srcSet(photo)              the 640 px copy for phones, the 1600 px one for big screens
 *
 * The licences of the demo's photos (Creative Commons BY and BY-SA) ask for the author and
 * the licence where the photo is shown. The tour page and the hero show it under the photo;
 * the website's cards stay clean, so its footer lists every credit on the page.
 */

/**
 * @typedef {{ url: string, small?: string, alt: string, credit?: string | null }} Photo
 */

/** @param {Photo | null | undefined} photo */
export const creditLine = (photo) => (photo?.credit ? `Photo: ${photo.credit}` : null);

/**
 * "Photo credits: Sho photography, CC BY-SA 4.0; Joeyjayjuniors, CC BY-SA 4.0" for the
 * website's footer: the hero and each card's photo, each credit once, in the page's order.
 * @param {Photo | null | undefined} hero
 * @param {Array<{ photo?: Photo | null }>} tours
 * @returns {string | null}
 */
export function siteCredits(hero, tours) {
  const credits = [hero, ...tours.map((t) => t.photo)]
    .map((p) => p?.credit?.trim())
    .filter((c) => typeof c === 'string' && c.length > 0);
  const once = [...new Set(credits)];
  return once.length ? `Photo credits: ${once.join('; ')}` : null;
}

/** "2 of 3" @param {number} index @param {number} count */
export const counterLine = (index, count) => `${index + 1} of ${count}`;

/**
 * The browser picks the smallest copy that fills the space: 640 px on a phone (3G), 1600 px
 * on a big screen. Photos from before the small copy existed have only `url`.
 * @param {Photo} photo
 */
export const srcSet = (photo) =>
  photo.small && photo.small !== photo.url ? `${photo.small} 640w, ${photo.url} 1600w` : undefined;

/**
 * Which photo is showing in a strip scrolled `scrollLeft` px, each `width` px wide.
 * @param {number} scrollLeft @param {number} width @param {number} count
 */
export const shownIndex = (scrollLeft, width, count) =>
  width > 0 ? Math.max(0, Math.min(count - 1, Math.round(scrollLeft / width))) : 0;
