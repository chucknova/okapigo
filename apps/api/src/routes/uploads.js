// @ts-check
/**
 * Photos and logos (stage 19b-1; designs: U1–U3, U7–U8 on the 19b canvas).
 *
 *   POST /api/uploads/photo    products: edit OR marketing: edit    the file as the body
 *   POST /api/uploads/logo                                          → 201 { picture: { url,
 *                                                                     small, width, height } }
 *   GET  /media/<key>          public                               the stored picture
 *
 * HOW AN UPLOAD BECOMES PART OF A TOUR (two steps, like every other setting):
 *   1. The staff app sends the file as soon as it's picked; this route checks it, makes its
 *      sizes and stores them (@okapigo/media), and answers with their addresses.
 *   2. Saving the tour (PATCH /api/products/:id { photos }) or the website (PATCH /api/website
 *      { site: { logo, hero } }) puts those addresses in. Those routes accept ONLY addresses
 *      this server made (`assertOwnPictures`), never a link to another site: a guest's page
 *      never loads a picture from somewhere we don't control (a tracker, a swapped image).
 *
 * The body is the file's bytes as they are ("image/jpeg"), not a multipart form: one file per
 * request, which is what the screens do, and no form parser to trust. The file's real type is
 * read from its bytes; the Content-Type header is ignored.
 *
 * Who: whoever may change tours or the website (the owner, in the default roles).
 * A picture uploaded and never saved stays on disk unused (it's small, and named by its
 * content, so uploading it again reuses it). Cleaning those up is a later job.
 */
import express, { Router } from 'express';
import { storeImage, ImageError, MAX_UPLOAD_BYTES, KEY_PATTERN } from '@okapigo/media';
import { hasAccess } from '@okapigo/shared/permissions';
import { HttpError } from '../middleware/errors.js';

const KINDS = new Set(['photo', 'logo']);

/**
 * Refuses picture addresses this server didn't make.
 * @param {import('@okapigo/media').Storage} media
 * @param {Array<{ url: string, small?: string } | null | undefined>} pictures
 */
export function assertOwnPictures(media, pictures) {
  for (const p of pictures) {
    if (!p) continue;
    for (const url of [p.url, p.small]) {
      if (url !== undefined && media.keyOf(url) === null) {
        throw new HttpError(
          400,
          'NOT_AN_UPLOAD',
          'Upload the picture here: links to pictures on other sites can’t be used.',
        );
      }
    }
  }
}

/** @param {{ media: import('@okapigo/media').Storage }} deps */
export function uploadsRouter({ media }) {
  const router = Router();

  /** Either permission will do: tour photos (products) or the logo and hero (marketing). */
  const canUpload = (/** @type {any} */ req, /** @type {any} */ _res, /** @type {any} */ next) => {
    const p = req.auth?.permissions ?? {};
    if (hasAccess(p.products ?? 'none', 'edit') || hasAccess(p.marketing ?? 'none', 'edit')) {
      return next();
    }
    throw new HttpError(403, 'FORBIDDEN', 'You need edit access to tours or the website.');
  };

  router.post(
    '/uploads/:kind',
    canUpload,
    // Any Content-Type: the bytes are checked, not the label. The parser's limit is above
    // ours, so a file a little over 10 MB gets our sentence ("That photo is 14 MB…") rather
    // than a bare "too large"; far bigger ones are cut off by the parser.
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES * 2.5 }),
    async (req, res) => {
      const kind = req.params.kind;
      if (!KINDS.has(kind)) throw new HttpError(404, 'NOT_FOUND', 'Upload a photo or a logo.');
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      try {
        const picture = await storeImage(media, bytes, /** @type {'photo' | 'logo'} */ (kind));
        res.status(201).json({ picture });
      } catch (e) {
        if (e instanceof ImageError) {
          throw new HttpError(e.code === 'TOO_BIG' ? 413 : 400, e.code, e.message);
        }
        throw e;
      }
    },
  );

  return router;
}

/**
 * Serves stored pictures. Public: they're on public pages anyway, and their names are long
 * hashes nobody can guess or list.
 * @param {{ media: import('@okapigo/media').Storage }} deps
 */
export function mediaRouter({ media }) {
  const router = Router();
  router.get(/^\/media\/(.+)$/, async (req, res, next) => {
    const key = /** @type {Record<string, string>} */ (req.params)[0];
    if (!KEY_PATTERN.test(key)) return next(); // not one of ours: the normal 404
    const bytes = await media.get(key);
    if (!bytes) return next();
    res.set({
      'Content-Type': key.endsWith('.png') ? 'image/png' : 'image/jpeg',
      // A key's content never changes (it's named by its bytes): keep it a year.
      'Cache-Control': 'public, max-age=31536000, immutable',
      // The guest web and the staff app may live on another address in development (and
      // R2 will be another address in production): let any page show these pictures.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.send(bytes);
  });
  return router;
}
