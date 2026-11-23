// @ts-check
/**
 * The media package (19b-1): what an upload must be, what it becomes, where it's kept.
 * Pictures are made here with sharp, so each test says exactly what it sends.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  processImage,
  storeImage,
  localStorage,
  storageFromEnv,
  sniff,
  sizeWords,
  MAX_UPLOAD_BYTES,
  DEFAULT_MEDIA_DIR,
} from '../src/index.js';

/** A plain picture. @param {number} w @param {number} h @param {'jpeg'|'png'|'webp'} f */
const picture = (w, h, f = 'jpeg', alpha = false) =>
  sharp({
    create: {
      width: w,
      height: h,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 155, g: 209, b: 15, alpha: 0.5 } : { r: 155, g: 209, b: 15 },
    },
  })
    .toFormat(f)
    .toBuffer();

/** @param {Promise<unknown>} p */
const refusal = async (p) => {
  try {
    await p;
  } catch (e) {
    return { code: /** @type {any} */ (e).code, message: /** @type {Error} */ (e).message };
  }
  throw new Error('expected a refusal');
};

describe('processImage: a photo', () => {
  it('becomes a 1600 px JPEG and a 640 px one, in proportion', async () => {
    const out = await processImage(await picture(3000, 2000, 'png'), 'photo');
    expect(out.ext).toBe('jpg');
    expect(out.contentType).toBe('image/jpeg');
    const large = await sharp(out.large).metadata();
    const small = await sharp(out.small).metadata();
    expect([large.format, large.width, large.height]).toEqual(['jpeg', 1600, 1067]);
    expect([small.format, small.width, small.height]).toEqual(['jpeg', 640, 427]);
    expect([out.width, out.height]).toEqual([1600, 1067]);
  });

  it('is never made bigger than it was', async () => {
    const out = await processImage(await picture(800, 600, 'webp'), 'photo');
    expect((await sharp(out.large).metadata()).width).toBe(800);
    expect((await sharp(out.small).metadata()).width).toBe(640);
  });

  it('loses its hidden details: no camera, no GPS position', async () => {
    const withGps = await sharp(await picture(1200, 900))
      .withExif({
        IFD0: { Make: 'PhoneCo', Model: 'Pocket 12' },
        // 6.4541° N, 3.3947° E: a Lagos address someone wouldn't want on the internet
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '6/1 27/1 1476/100' },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined(); // the test file really has it
    const out = await processImage(withGps, 'photo');
    for (const b of [out.large, out.small]) {
      const m = await sharp(b).metadata();
      expect(m.exif).toBeUndefined();
      expect(b.includes(Buffer.from('PhoneCo'))).toBe(false);
    }
  });

  it('is turned the way the camera meant (a phone photo stored on its side)', async () => {
    // Stored 1000 wide × 1500 tall, with "rotate 90°" in its EXIF: it's really 1500 × 1000.
    const sideways = await sharp(await picture(1000, 1500))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const out = await processImage(sideways, 'photo');
    const m = await sharp(out.large).metadata();
    expect([m.width, m.height]).toEqual([1500, 1000]);
    expect(m.orientation).toBeUndefined();
  });

  it('is measured the way up it really is (a sideways photo 500 stored, 900 real, is wide enough)', async () => {
    const sideways = await sharp(await picture(500, 900))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const out = await processImage(sideways, 'photo');
    expect([out.width, out.height]).toEqual([900, 500]);
  });

  it('gets a white background where a PNG was see-through', async () => {
    const out = await processImage(await picture(700, 700, 'png', true), 'photo');
    const { data } = await sharp(out.small).raw().toBuffer({ resolveWithObject: true });
    // half-transparent green on white: lighter than the green itself
    expect(data[0]).toBeGreaterThan(200);
  });
});

describe('processImage: a logo', () => {
  it('fits inside a 512 square and a 128 one, transparency kept, never cropped', async () => {
    const out = await processImage(await picture(1000, 400, 'png', true), 'logo');
    expect(out.ext).toBe('png');
    const large = await sharp(out.large).metadata();
    const small = await sharp(out.small).metadata();
    expect([large.format, large.width, large.height, large.hasAlpha]).toEqual([
      'png',
      512,
      205,
      true,
    ]);
    expect([small.width, small.height]).toEqual([128, 51]);
  });

  it('may be small (64 px), where a photo may not', async () => {
    await expect(processImage(await picture(64, 64, 'png'), 'logo')).resolves.toBeTruthy();
    expect(await refusal(processImage(await picture(64, 64, 'png'), 'photo'))).toEqual({
      code: 'TOO_SMALL',
      message: 'That photo is only 64 pixels wide. Use one at least 600 wide.',
    });
    expect((await refusal(processImage(await picture(40, 40, 'png'), 'logo'))).message).toBe(
      'That logo is only 40 pixels wide. Use one at least 64 wide.',
    );
  });
});

describe('processImage: what it refuses, and the words it says', () => {
  it('over 10 MB', async () => {
    const big = Buffer.concat([await picture(700, 700), Buffer.alloc(MAX_UPLOAD_BYTES)]);
    expect(await refusal(processImage(big, 'photo'))).toEqual({
      code: 'TOO_BIG',
      message: 'That photo is 10 MB. Use one under 10 MB.',
    });
    const huge = Buffer.alloc(14 * 1024 * 1024 + 3);
    expect((await refusal(processImage(huge, 'logo'))).message).toBe(
      'That logo is 14 MB. Use one under 10 MB.',
    );
  });

  it('exactly 10 MB is allowed (the limit is "over")', async () => {
    const jpeg = await picture(700, 700);
    // a JPEG ends at its end marker; bytes after it are ignored by decoders
    const exact = Buffer.concat([jpeg, Buffer.alloc(MAX_UPLOAD_BYTES - jpeg.length)]);
    expect(exact.length).toBe(MAX_UPLOAD_BYTES);
    await expect(processImage(exact, 'photo')).resolves.toBeTruthy();
  });

  it('an empty file', async () => {
    expect((await refusal(processImage(Buffer.alloc(0), 'photo'))).code).toBe('EMPTY');
  });

  it('a PDF, a GIF, an iPhone HEIC, an SVG, and anything else', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const cases = [
      [Buffer.from('%PDF-1.7\n…'), 'That’s a PDF. Use a JPEG, PNG or WebP picture.'],
      [
        await sharp(await picture(700, 700))
          .gif()
          .toBuffer(),
        'That’s a GIF. Use a JPEG, PNG or WebP picture.',
      ],
      [
        Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(40)]),
        'That’s an iPhone HEIC photo. Use a JPEG, PNG or WebP picture.',
      ],
      [svg, 'SVG files can’t be used: they can carry scripts. Use a PNG or JPEG.'],
      [
        Buffer.from('<?xml version="1.0"?>\n<svg></svg>'),
        'SVG files can’t be used: they can carry scripts. Use a PNG or JPEG.',
      ],
      [
        Buffer.from('hello, not a picture'),
        'That isn’t a picture we can use. Use a JPEG, PNG or WebP.',
      ],
    ];
    for (const [bytes, message] of cases) {
      const r = await refusal(processImage(/** @type {Buffer} */ (bytes), 'logo'));
      expect(r).toEqual({ code: 'WRONG_TYPE', message });
    }
  });

  it('a damaged file (the start of a JPEG, cut off)', async () => {
    const jpeg = await picture(1200, 900);
    const cut = jpeg.subarray(0, Math.floor(jpeg.length / 3));
    expect(await refusal(processImage(cut, 'photo'))).toEqual({
      code: 'UNREADABLE',
      message: 'That photo couldn’t be read: the file may be damaged. Try another copy.',
    });
  });

  it('a small file that would decode into a huge picture (over 60 megapixels)', async () => {
    const bomb = await sharp({
      create: { width: 8000, height: 8000, channels: 3, background: '#000' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(1024 * 1024); // small on the wire…
    expect(await refusal(processImage(bomb, 'photo'))).toEqual({
      code: 'TOO_MANY_PIXELS', // …refused before decoding
      message: 'That photo is too big in pixels (over 60 megapixels). Use a smaller copy.',
    });
  });

  it('a file whose first bytes lie (says PNG, is not)', async () => {
    const fake = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(200, 7)]);
    expect((await refusal(processImage(fake, 'photo'))).code).toBe('UNREADABLE');
  });

  it('an unknown kind', async () => {
    // @ts-expect-error: on purpose
    expect((await refusal(processImage(await picture(700, 700), 'banner'))).code).toBe('BAD_KIND');
  });
});

describe('sniff and sizeWords', () => {
  it('know the kinds by their first bytes', async () => {
    expect(sniff(await picture(10, 10, 'jpeg'))).toBe('jpeg');
    expect(sniff(await picture(10, 10, 'png'))).toBe('png');
    expect(sniff(await picture(10, 10, 'webp'))).toBe('webp');
    expect(sniff(Buffer.from('  <svg>'))).toBe('svg');
    expect(sniff(Buffer.from('RIFF0000WAVE'))).toBe(null);
  });
  it('words sizes', () => {
    expect(sizeWords(14 * 1024 * 1024)).toBe('14 MB');
    expect(sizeWords(4.25 * 1024 * 1024)).toBe('4.3 MB');
    expect(sizeWords(800 * 1024)).toBe('800 KB');
    expect(sizeWords(10)).toBe('1 KB');
  });
});

describe('storage on the local disk, and storeImage', () => {
  /** @type {string} */ let dir;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'okg-media-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores both sizes and gives their addresses', async () => {
    const storage = localStorage({ dir, publicUrl: 'http://localhost:4000/media/' });
    const r = await storeImage(storage, await picture(2000, 1000), 'photo');
    expect(r.url).toMatch(/^http:\/\/localhost:4000\/media\/photos\/[a-f0-9]{16}\.jpg$/);
    expect(r.small).toBe(r.url.replace('.jpg', '-640.jpg'));
    expect([r.width, r.height]).toEqual([1600, 800]);
    const key = /** @type {string} */ (storage.keyOf(r.url));
    expect((await sharp(/** @type {Buffer} */ (await storage.get(key))).metadata()).width).toBe(
      1600,
    );
    const logo = await storeImage(storage, await picture(300, 300, 'png'), 'logo');
    expect(logo.url).toMatch(/\/media\/logos\/[a-f0-9]{16}\.png$/);
    expect(logo.small).toBe(logo.url.replace('.png', '-128.png'));
  });

  it('keeps the same picture once, however often it comes', async () => {
    const d = await mkdtemp(join(tmpdir(), 'okg-media-once-'));
    const storage = localStorage({ dir: d, publicUrl: 'http://x/media' });
    const bytes = await picture(900, 900);
    const a = await storeImage(storage, bytes, 'photo');
    const b = await storeImage(storage, bytes, 'photo');
    expect(b.url).toBe(a.url);
    expect(await readdir(join(d, 'photos'))).toHaveLength(2); // one picture, two sizes
    await rm(d, { recursive: true, force: true });
  });

  it('keyOf: only our own address, only keys of our shape', () => {
    const storage = localStorage({ dir, publicUrl: 'https://cdn.example/media' });
    const ok = 'https://cdn.example/media/photos/0123456789abcdef-640.jpg';
    expect(storage.keyOf(ok)).toBe('photos/0123456789abcdef-640.jpg');
    for (const bad of [
      'https://evil.example/media/photos/0123456789abcdef.jpg', // someone else's site
      'https://cdn.example/media/../../.env',
      'https://cdn.example/media/photos/../../secrets.jpg',
      'https://cdn.example/media/photos/0123456789ABCDEF.jpg', // not our shape
      'https://cdn.example/media/photos/0123456789abcdef.gif',
      'https://cdn.example/mediaphotos/0123456789abcdef.jpg',
      42,
      null,
    ]) {
      expect(storage.keyOf(bad)).toBeNull();
    }
  });

  it('get: null for a missing file or a key of the wrong shape; put refuses strange keys', async () => {
    const storage = localStorage({ dir, publicUrl: 'http://x/media' });
    expect(await storage.get('photos/ffffffffffffffff.jpg')).toBeNull();
    expect(await storage.get('../package.json')).toBeNull();
    await expect(storage.put('../evil.jpg', Buffer.from('x'), 'image/jpeg')).rejects.toThrow(
      'Not a media key',
    );
  });

  it('storageFromEnv: the settings, else the repo folder served by the API', () => {
    const fromApi = storageFromEnv({ API_PUBLIC_URL: 'http://localhost:4100/' });
    expect(fromApi.urlFor('photos/0123456789abcdef.jpg')).toBe(
      'http://localhost:4100/media/photos/0123456789abcdef.jpg',
    );
    const set = storageFromEnv({ MEDIA_PUBLIC_URL: 'https://media.example', MEDIA_DIR: dir });
    expect(set.urlFor('logos/0123456789abcdef.png')).toBe(
      'https://media.example/logos/0123456789abcdef.png',
    );
    expect(storageFromEnv({}).urlFor('logos/0123456789abcdef.png')).toBe(
      'http://localhost:4000/media/logos/0123456789abcdef.png',
    );
    expect(DEFAULT_MEDIA_DIR.endsWith(join('.data', 'media'))).toBe(true);
  });
});
