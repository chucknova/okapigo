// @ts-check
/**
 * storage.js — where pictures are kept (stage 19b-1).
 *
 *   Storage = { put(key, bytes, type), get(key), urlFor(key), keyOf(url) }
 *
 *   local disk (now)   files under .data/media/ at the repo root (git-ignored); the API serves
 *                      them at /media/<key>
 *   Cloudflare R2      at deploy (19e): the same four functions over R2's S3 API, and the
 *                      urls point at R2's public address. Nothing else changes.
 *
 * A KEY names one stored file: "photos/3f5629c4c847e6cf.jpg", "logos/…-128.png". Keys come from
 * the picture's own bytes (a hash), so:
 *   - the same picture uploaded twice is stored once (and the demo's nightly reset reuses its
 *     files instead of piling up copies);
 *   - a key never changes what it points to, so browsers may keep a file for a year.
 *
 * `keyOf(url)` is the safety check for anything that reads a stored file back (posters, the
 * link-preview card): it accepts ONLY our own address followed by a key of exactly the shape we
 * make. Anything else (another site, "../../.env") is null, so the server never fetches a url a
 * user typed and never reads outside its folder.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

/** The only keys we ever make: a folder, 16 hex characters, maybe a size, the type. */
export const KEY_PATTERN = /^(photos|logos)\/[a-f0-9]{16}(-640|-128)?\.(jpg|png)$/;

/** The repo's .data/media folder, wherever the app is started from. */
export const DEFAULT_MEDIA_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../.data/media',
);

/**
 * @typedef {object} Storage
 * @property {(key: string, bytes: Buffer, contentType: string) => Promise<void>} put
 * @property {(key: string) => Promise<Buffer | null>} get  null when there's no such file
 * @property {(key: string) => string} urlFor   the public address of a key
 * @property {(url: unknown) => string | null} keyOf   the key of one of OUR urls; else null
 */

/**
 * Pictures on the local disk.
 * @param {{ dir?: string, publicUrl: string }} options publicUrl: where /media is served,
 *   like "http://localhost:4000/media"
 * @returns {Storage}
 */
export function localStorage({ dir = DEFAULT_MEDIA_DIR, publicUrl }) {
  const base = publicUrl.replace(/\/+$/, '');
  const pathOf = (/** @type {string} */ key) => {
    if (!KEY_PATTERN.test(key)) throw new Error(`Not a media key: ${key}`);
    return join(dir, key);
  };
  return {
    async put(key, bytes) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      // Write to a temporary name, then rename: a reader never sees half a file, and two
      // uploads of the same picture at once both end with the whole file.
      const tmp = `${path}.${randomUUID()}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, path);
    },
    async get(key) {
      if (!KEY_PATTERN.test(key)) return null;
      try {
        return await readFile(pathOf(key));
      } catch (e) {
        if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') return null;
        throw e;
      }
    },
    urlFor(key) {
      pathOf(key); // refuses a key we wouldn't make
      return `${base}/${key}`;
    },
    keyOf(url) {
      if (typeof url !== 'string' || !url.startsWith(`${base}/`)) return null;
      const key = url.slice(base.length + 1);
      return KEY_PATTERN.test(key) ? key : null;
    },
  };
}

/**
 * The storage the settings say: MEDIA_DIR and MEDIA_PUBLIC_URL, else the repo's .data/media
 * served by the API at API_PUBLIC_URL/media. Used by the API, the seed and the workers.
 * @param {Record<string, string | undefined>} [env]
 */
export function storageFromEnv(env = process.env) {
  const api = (env.API_PUBLIC_URL || 'http://localhost:4000').replace(/\/+$/, '');
  return localStorage({
    dir: env.MEDIA_DIR || DEFAULT_MEDIA_DIR,
    publicUrl: env.MEDIA_PUBLIC_URL || `${api}/media`,
  });
}
