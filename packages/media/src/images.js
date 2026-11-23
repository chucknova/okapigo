// @ts-check
/**
 * images.js — turns an uploaded file into the pictures the app shows (stage 19b-1).
 *
 *   the upload (any size, straight off a phone)
 *     │  1. what is it, really?  (the file's first bytes, never its name or the browser's word)
 *     │  2. JPEG, PNG or WebP only; not too big, not too small
 *     ▼
 *   sharp: turned the right way up, resized, re-encoded; EVERYTHING ELSE DROPPED
 *     ▼
 *   photo → 1600 px wide JPEG (pages, posters) + 640 px (cards, phones on 3G)
 *   logo  → 512 px PNG, transparency kept (posters, link previews) + 128 px (headers)
 *
 * Why re-encode instead of storing the file as sent?
 *   - PRIVACY: a phone photo carries hidden details (EXIF): the camera, the time, and often the
 *     GPS position where it was taken, maybe the owner's house. Re-encoding writes only pixels.
 *   - SAFETY: we only ever serve files WE made. A file that claims to be a picture but hides
 *     something else (a script in an SVG, a "polyglot" file) never reaches a guest's browser.
 *   - SPEED: a 6 MB phone photo becomes about 250 KB, and a card gets a 640 px copy.
 *
 * No SVG, even for logos: an SVG is a document that can carry scripts.
 */
import sharp from 'sharp';

/** The two kinds of upload, and the sizes each becomes. */
export const IMAGE_KINDS = /** @type {const} */ ({
  photo: { large: 1600, small: 640, minWidth: 600, format: 'jpeg' },
  logo: { large: 512, small: 128, minWidth: 64, format: 'png' },
});
/** @typedef {keyof typeof IMAGE_KINDS} ImageKind */

/** 10 MB: a phone's full-size photo fits; a video or a scan of a book doesn't. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/**
 * 60 megapixels. A small file can still DECODE into a huge picture (a "decompression bomb":
 * a 50 KB PNG of 30,000 × 30,000 plain pixels would need gigabytes of memory). sharp refuses
 * anything bigger before decoding it.
 */
export const MAX_PIXELS = 60_000_000;

/** A problem with the upload, worded for the person who sent it. */
export class ImageError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** "14 MB", "800 KB": for messages. @param {number} bytes */
export const sizeWords = (bytes) =>
  bytes >= 1024 * 1024
    ? `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * What a file really is, from its first bytes ("magic numbers"). Only the kinds we accept,
 * plus the common ones people try, so the message can say what went wrong.
 * @param {Buffer} b
 * @returns {'jpeg' | 'png' | 'webp' | 'pdf' | 'gif' | 'heic' | 'svg' | null}
 */
export function sniff(b) {
  const at = (/** @type {number} */ i, /** @type {string} */ s) =>
    b.subarray(i, i + s.length).toString('latin1') === s;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (at(0, '\x89PNG\r\n\x1a\n')) return 'png';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'webp';
  if (at(0, '%PDF')) return 'pdf';
  if (at(0, 'GIF8')) return 'gif';
  if (at(4, 'ftyp') && /^(heic|heix|hevc|mif1|msf1|avif)/.test(b.subarray(8, 12).toString())) {
    return 'heic';
  }
  const head = b.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return null;
}

const REFUSED = {
  pdf: 'That’s a PDF. Use a JPEG, PNG or WebP picture.',
  gif: 'That’s a GIF. Use a JPEG, PNG or WebP picture.',
  heic: 'That’s an iPhone HEIC photo. Use a JPEG, PNG or WebP picture.',
  svg: 'SVG files can’t be used: they can carry scripts. Use a PNG or JPEG.',
};

/**
 * Checks an upload and makes its two sizes.
 * @param {Buffer} bytes the file as sent
 * @param {ImageKind} kind
 * @returns {Promise<{ large: Buffer, small: Buffer, ext: 'jpg' | 'png', contentType: string, width: number, height: number }>}
 */
export async function processImage(bytes, kind) {
  const spec = IMAGE_KINDS[kind];
  if (!spec) throw new ImageError('BAD_KIND', 'Unknown kind of picture.');
  const what = kind === 'logo' ? 'logo' : 'photo';
  if (!bytes || bytes.length === 0) {
    throw new ImageError('EMPTY', 'That file is empty. Pick the picture again.');
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new ImageError(
      'TOO_BIG',
      `That ${what} is ${sizeWords(bytes.length)}. Use one under ${sizeWords(MAX_UPLOAD_BYTES)}.`,
    );
  }
  const type = sniff(bytes);
  if (type === 'pdf' || type === 'gif' || type === 'heic' || type === 'svg') {
    throw new ImageError('WRONG_TYPE', REFUSED[type]);
  }
  if (type === null) {
    throw new ImageError('WRONG_TYPE', 'That isn’t a picture we can use. Use a JPEG, PNG or WebP.');
  }

  // `failOn: 'error'`: a truncated or corrupt file is refused rather than half-drawn.
  const input = () => sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'error' });
  let meta;
  try {
    meta = await input().metadata();
  } catch (e) {
    const tooMany = /pixel limit/i.test(String(/** @type {Error} */ (e).message));
    throw new ImageError(
      tooMany ? 'TOO_MANY_PIXELS' : 'UNREADABLE',
      tooMany
        ? `That ${what} is too big in pixels (over ${MAX_PIXELS / 1_000_000} megapixels). Use a smaller copy.`
        : `That ${what} couldn’t be read: the file may be damaged. Try another copy.`,
    );
  }
  // EXIF orientation 5–8 means the picture is stored on its side: its real width is its height.
  const sideways = (meta.orientation ?? 1) >= 5;
  const width = (sideways ? meta.height : meta.width) ?? 0;
  if (width < spec.minWidth) {
    throw new ImageError(
      'TOO_SMALL',
      `That ${what} is only ${width} pixels wide. Use one at least ${spec.minWidth} wide.`,
    );
  }

  /** @param {number} size */
  const make = (size) => {
    // .rotate() with no angle: turn it the way the camera meant (EXIF orientation), then the
    // orientation tag is gone with the rest of the metadata (sharp keeps none unless asked).
    const p = input().rotate();
    if (spec.format === 'jpeg') {
      return p
        .resize({ width: size, withoutEnlargement: true })
        .flatten({ background: '#ffffff' }) // a transparent PNG photo gets white, not black
        .jpeg({ quality: size >= 1000 ? 80 : 75, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    }
    // A logo fits INSIDE a square: never cropped, transparency kept.
    return p
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
  };
  let large, small;
  try {
    [large, small] = await Promise.all([make(spec.large), make(spec.small)]);
  } catch {
    // The header was fine but the pixels weren't: a file cut off part-way (a dropped upload),
    // or damaged. Found by a test: reading the header alone doesn't notice.
    throw new ImageError(
      'UNREADABLE',
      `That ${what} couldn’t be read: the file may be damaged. Try another copy.`,
    );
  }
  return {
    large: large.data,
    small: small.data,
    ext: spec.format === 'jpeg' ? 'jpg' : 'png',
    contentType: spec.format === 'jpeg' ? 'image/jpeg' : 'image/png',
    width: large.info.width,
    height: large.info.height,
  };
}
