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
