// @ts-check
/**
 * pictures.js — our stored pictures as data for drawings (stage 19b-2b): the poster and the
 * link-preview card are drawn on the server (satori), which needs a picture's bytes, not its
 * address.
 *
 *   const read = pictureReader(media);
 *   await read('http://…/media/photos/3f56….jpg')  →  'data:image/jpeg;base64,…'  (or null)
 *
 * Only OUR pictures (media.keyOf): an address from anywhere else is null, so a drawing never
 * makes the server fetch something a user typed (no SSRF). A missing file is null too: the
 * drawing then uses its no-photo look, never a broken image.
 */

/**
 * @param {import('@okapigo/media').Storage} media
 * @returns {(url: string | null | undefined) => Promise<string | null>}
 */
export function pictureReader(media) {
  return async (url) => {
    // Not our address: keyOf gives null, and storage's get refuses anything that isn't one of
    // our keys (so one check is enough: a second here couldn't be told apart, 19b-2b).
    const key = media.keyOf(url) ?? '';
    const bytes = await media.get(key);
    if (!bytes) return null;
    const type = key.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `data:${type};base64,${bytes.toString('base64')}`;
  };
}

/** No pictures (tests, and drawings without storage). */
export const noPictures = async () => null;
