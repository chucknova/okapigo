// @ts-check
/**
 * @okapigo/media — photos and logos (stage 19b-1).
 *
 *   storeImage(storage, bytes, 'photo')  →  { url, small, width, height }
 *
 * One function for every picture that enters the app: an owner's upload (POST /api/uploads),
 * the demo's own photos (the seed and the nightly reset). So the demo's pictures went through
 * exactly the checks and sizes an owner's do.
 */
import { createHash } from 'node:crypto';
import { processImage } from './images.js';

export {
  processImage,
  sniff,
  sizeWords,
  ImageError,
  IMAGE_KINDS,
  MAX_UPLOAD_BYTES,
  MAX_PIXELS,
} from './images.js';
export { localStorage, storageFromEnv, KEY_PATTERN, DEFAULT_MEDIA_DIR } from './storage.js';

/**
 * Checks, resizes and stores a picture.
 * @param {import('./storage.js').Storage} storage
 * @param {Buffer} bytes
 * @param {import('./images.js').ImageKind} kind
 * @returns {Promise<{ url: string, small: string, width: number, height: number }>}
 */
export async function storeImage(storage, bytes, kind) {
  const img = await processImage(bytes, kind);
  // Named by the finished picture's bytes: the same upload twice → the same files.
  const id = createHash('sha256').update(img.large).digest('hex').slice(0, 16);
  const folder = kind === 'logo' ? 'logos' : 'photos';
  const smallSuffix = kind === 'logo' ? '-128' : '-640';
  const largeKey = `${folder}/${id}.${img.ext}`;
  const smallKey = `${folder}/${id}${smallSuffix}.${img.ext}`;
  await Promise.all([
    storage.put(largeKey, img.large, img.contentType),
    storage.put(smallKey, img.small, img.contentType),
  ]);
  return {
    url: storage.urlFor(largeKey),
    small: storage.urlFor(smallKey),
    width: img.width,
    height: img.height,
  };
}
