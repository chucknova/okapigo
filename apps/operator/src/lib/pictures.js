// @ts-check
/**
 * pictures.js — the logo and the hero photo in Settings › Business details (stage 19b-2a;
 * designs: U1). Saved with the rest of the business details (PATCH /api/website { site }).
 *
 *   the logo     beside the name on the website, checkout, tickets, posters, link previews;
 *                none: the first letter
 *   the hero     the website's big photo, with its description (needed) and credit (optional);
 *                none: the style's pattern
 */
import { ALT_MAX, CREDIT_MAX } from './photos.js';

/**
 * @typedef {{ url: string, small: string }} Picture
 * @typedef {{ logo: Picture | null, hero: Picture | null, heroAlt: string, heroCredit: string }} PicturesForm
 */

/** From GET /api/website. @param {any} w @returns {PicturesForm} */
export function picturesForm(w) {
  const hero = w.site?.hero ?? null;
  return {
    logo: w.site?.logo ?? null,
    hero: hero ? { url: hero.url, small: hero.small ?? hero.url } : null,
    heroAlt: hero?.alt ?? '',
    heroCredit: hero?.credit ?? '',
  };
}

/** @param {Picture | null} a @param {Picture | null} b */
const samePicture = (a, b) => (a?.url ?? null) === (b?.url ?? null);

/**
 * "Logo", "Hero photo" for the save bar ("You changed the logo and the hero photo").
 * @param {PicturesForm} f @param {PicturesForm} saved
 */
export function pictureChanges(f, saved) {
  const changed = [];
  if (!samePicture(f.logo, saved.logo)) changed.push('Logo');
  if (
    !samePicture(f.hero, saved.hero) ||
    (f.hero &&
      (f.heroAlt.trim() !== saved.heroAlt.trim() ||
        f.heroCredit.trim() !== saved.heroCredit.trim()))
  ) {
    changed.push('Hero photo');
  }
  return changed;
}

/** @param {PicturesForm} f @returns {{ heroAlt?: string, heroCredit?: string }} */
export function pictureErrors(f) {
  /** @type {{ heroAlt?: string, heroCredit?: string }} */
  const e = {};
  if (f.hero && !f.heroAlt.trim())
    e.heroAlt = 'Describe the photo first: guests using screen readers need it.';
  else if (f.heroAlt.trim().length > ALT_MAX)
    e.heroAlt = `Too long: ${f.heroAlt.trim().length} of ${ALT_MAX} characters.`;
  if (f.hero && f.heroCredit.trim().length > CREDIT_MAX)
    e.heroCredit = `Too long: ${f.heroCredit.trim().length} of ${CREDIT_MAX} characters.`;
  return e;
}

/**
 * What goes in PATCH /api/website's `site`: only what changed; null removes one.
 * @param {PicturesForm} f @param {PicturesForm} saved
 */
export function picturesSite(f, saved) {
  /** @type {any} */
  const site = {};
  const changed = pictureChanges(f, saved);
  if (changed.includes('Logo')) site.logo = f.logo;
  if (changed.includes('Hero photo')) {
    site.hero = f.hero
      ? {
          url: f.hero.url,
          small: f.hero.small,
          alt: f.heroAlt.trim(),
          credit: f.heroCredit.trim() || null,
        }
      : null;
  }
  return site;
}
