// @ts-check
/**
 * Stage 19b-2a: the rules behind a tour's photos, the logo and the hero (lib/photos.js,
 * lib/pictures.js, lib/letter.js), and sending a picture (lib/uploads.js) over a fake
 * connection.
 */
import { describe, it, expect } from 'vitest';
import {
  addFiles,
  photoItems,
  progressed,
  uploaded,
  uploadFailed,
  retrying,
  moved,
  madeCover,
  removed,
  setText,
  photoErrors,
  photoProblemCount,
  photosBody,
  photosChanged,
  saveWait,
  photosCountLine,
  photosShortNow,
  removeAsk,
  readyCount,
} from '../src/lib/photos.js';
import { picturesForm, pictureChanges, pictureErrors, picturesSite } from '../src/lib/pictures.js';
import { firstLetter } from '../src/lib/letter.js';
import { sendPicture, NO_CONNECTION } from '../src/lib/uploads.js';

const MB = 1024 * 1024;
const u = (/** @type {string} */ n) => `http://localhost:4000/media/photos/${n}.jpg`;
const SAVED = [
  { url: u('a'), small: u('a-640'), alt: 'The cathedral', credit: 'Sho, CC BY-SA 4.0' },
  { url: u('b'), small: u('b-640'), alt: 'Tinubu Square', credit: null },
];
let n = 0;
const key = () => `k${++n}`;

describe('photo items', () => {
  it('start from the saved photos, ready, credits as text', () => {
    const items = photoItems(SAVED);
    expect(items.map((i) => [i.url, i.small, i.alt, i.credit, i.status])).toEqual([
      [u('a'), u('a-640'), 'The cathedral', 'Sho, CC BY-SA 4.0', 'ready'],
      [u('b'), u('b-640'), 'Tinubu Square', '', 'ready'],
    ]);
    expect(photoItems([{ url: u('c'), alt: 'x' }])[0].small).toBe(u('c')); // no small: the url
    expect(photoItems(/** @type {any} */ (null))).toEqual([]);
  });

  it('picked files: added as uploading; too big and past 8 refused in words', () => {
    const items = photoItems(SAVED);
    const r = addFiles(
      items,
      [
        { name: 'boat.jpg', size: 2 * MB },
        { name: 'huge.jpg', size: 14 * MB },
      ],
      key,
    );
    expect(r.items).toHaveLength(3);
    expect(r.items[2]).toMatchObject({ name: 'boat.jpg', status: 'uploading', progress: 0 });
    expect(r.added).toEqual([{ key: r.items[2].key, index: 0 }]);
    expect(r.refused).toEqual(['huge.jpg: That photo is 14 MB. Use one under 10 MB.']);

    const seven = addFiles([], Array(7).fill({ name: 'p.jpg', size: 1 }), key).items;
    const over = addFiles(seven, Array(3).fill({ name: 'p.jpg', size: 1 }), key);
    expect(over.items).toHaveLength(8);
    expect(over.refused).toEqual(['Up to 8 photos a tour: 2 weren’t added.']);
    expect(addFiles(over.items, [{ name: 'p.jpg', size: 1 }], key).refused).toEqual([
      'Up to 8 photos a tour: 1 wasn’t added.',
    ]);
    // Exactly 10 MB is allowed (the limit is "over").
    expect(addFiles([], [{ name: 'p.jpg', size: 10 * MB }], key).refused).toEqual([]);
  });

  it('an upload: progress (0–100), arrived, failed, sent again', () => {
    const { items } = addFiles([], [{ name: 'boat.jpg', size: 1 }], key);
    const k = items[0].key;
    expect(progressed(items, k, 35.6)[0].progress).toBe(36);
    expect(progressed(items, k, 140)[0].progress).toBe(100);
    expect(progressed(items, k, -5)[0].progress).toBe(0);
    const done = uploaded(items, k, { url: u('c'), small: u('c-640') });
    expect(done[0]).toMatchObject({
      status: 'ready',
      url: u('c'),
      small: u('c-640'),
      progress: 100,
    });
    const failed = uploadFailed(items, k, NO_CONNECTION);
    expect(failed[0]).toMatchObject({ status: 'failed', error: NO_CONNECTION });
    expect(retrying(failed, k)[0]).toMatchObject({ status: 'uploading', error: null, progress: 0 });
  });

  it('order: up, down, make cover; never past either end', () => {
    const items = photoItems([...SAVED, { url: u('c'), alt: 'Freedom Park' }]);
    const [a, b, c] = items.map((i) => i.key);
    const alts = (/** @type {any[]} */ xs) => xs.map((i) => i.alt);
    expect(alts(moved(items, c, -1))).toEqual(['The cathedral', 'Freedom Park', 'Tinubu Square']);
    expect(alts(moved(items, a, 1))).toEqual(['Tinubu Square', 'The cathedral', 'Freedom Park']);
    expect(moved(items, a, -1)).toBe(items);
    expect(moved(items, c, 1)).toBe(items);
    expect(moved(items, 'nope', 1)).toBe(items);
    expect(alts(madeCover(items, c))).toEqual(['Freedom Park', 'The cathedral', 'Tinubu Square']);
    expect(madeCover(items, 'nope')).toBe(items);
    expect(alts(removed(items, b))).toEqual(['The cathedral', 'Freedom Park']);
    expect(setText(items, b, 'credit', 'Joey')[1].credit).toBe('Joey');
  });

  it('what to fix: a ready photo needs a description; long text; uploading may wait', () => {
    let items = photoItems(SAVED);
    items = setText(items, items[1].key, 'alt', '  ');
    items = setText(items, items[0].key, 'credit', 'c'.repeat(121));
    const up = addFiles(items, [{ name: 'boat.jpg', size: 1 }], key);
    const errors = photoErrors(up.items);
    expect(errors).toEqual({
      [items[0].key]: { credit: 'Too long: 121 of 120 characters.' },
      [items[1].key]: { alt: 'Describe the photo: guests using screen readers need it.' },
    });
    expect(photoProblemCount(up.items)).toBe(2);
    const long = setText(items, items[1].key, 'alt', 'a'.repeat(201));
    expect(photoErrors(long)[items[1].key].alt).toBe('Too long: 201 of 200 characters.');
  });

  it('what is saved: ready photos in order, trimmed, an empty credit is none', () => {
    let items = photoItems(SAVED);
    items = setText(items, items[0].key, 'alt', '  The cathedral  ');
    items = setText(items, items[0].key, 'credit', '  ');
    const up = addFiles(items, [{ name: 'boat.jpg', size: 1 }], key).items;
    const failed = uploadFailed(up, up[2].key, 'x');
    expect(photosBody(failed)).toEqual([
      { url: u('a'), small: u('a-640'), alt: 'The cathedral', credit: null },
      { url: u('b'), small: u('b-640'), alt: 'Tinubu Square', credit: null },
    ]);
  });

  it('changed: a different order or words; and while anything uploads', () => {
    const saved = photoItems(SAVED);
    expect(photosChanged(photoItems(SAVED), saved)).toBe(false);
    expect(photosChanged(madeCover(saved, saved[1].key), saved)).toBe(true);
    expect(photosChanged(setText(saved, saved[0].key, 'credit', 'New'), saved)).toBe(true);
    const up = addFiles(saved, [{ name: 'boat.jpg', size: 1 }], key).items;
    expect(photosChanged(up, saved)).toBe(true);
    expect(saveWait(up)).toBe('Save when the upload ends.');
    const two = addFiles(up, [{ name: 'b.jpg', size: 1 }], key).items;
    expect(saveWait(two)).toBe('Save when the 2 uploads end.');
    expect(saveWait(saved)).toBeNull();
  });

  it('the count: needed until 3, then of 8; and how many are on their way', () => {
    const two = photoItems(SAVED);
    expect(photosCountLine([])).toBe('0 of 3 needed');
    expect(photosCountLine(two)).toBe('2 of 3 needed');
    expect(photosShortNow(two)).toBe(true);
    const up = addFiles(two, [{ name: 'boat.jpg', size: 1 }], key).items;
    expect(photosCountLine(up)).toBe('2 of 3 needed · 1 uploading');
    const three = photoItems([...SAVED, { url: u('c'), alt: 'c' }]);
    expect(photosCountLine(three)).toBe('3 of 8 ✓');
    expect(photosShortNow(three)).toBe(false);
    expect(readyCount(up)).toBe(2);
  });

  it('removing asks first only when a tour ON SALE would go under 3', () => {
    const three = photoItems([...SAVED, { url: u('c'), alt: 'c' }]);
    const onSale = { title: 'Badagry Heritage Day Trip', status: 'published' };
    expect(removeAsk(onSale, three, three[0].key)).toBe(
      'Badagry Heritage Day Trip will have 2 photos, under the 3 a tour on sale should have. It stays on sale.',
    );
    expect(removeAsk(onSale, three.slice(0, 2), three[0].key)).toBe(
      'Badagry Heritage Day Trip will have 1 photo, under the 3 a tour on sale should have. It stays on sale.',
    );
    const four = photoItems([...SAVED, { url: u('c'), alt: 'c' }, { url: u('d'), alt: 'd' }]);
    expect(removeAsk(onSale, four, four[0].key)).toBeNull(); // 3 left: fine
    expect(removeAsk({ ...onSale, status: 'draft' }, three, three[0].key)).toBeNull();
    const up = addFiles(three, [{ name: 'boat.jpg', size: 1 }], key).items;
    expect(removeAsk(onSale, up, up[3].key)).toBeNull(); // not a photo of the tour yet
  });
});

describe('the logo and the hero photo', () => {
  const logo = { url: 'http://x/media/logos/l.png', small: 'http://x/media/logos/l-128.png' };
  const hero = { url: u('h'), small: u('h-640'), alt: 'Tinubu Square', credit: 'Joey' };

  it('start from the website; none is null', () => {
    expect(picturesForm({ site: { logo, hero } })).toEqual({
      logo,
      hero: { url: hero.url, small: hero.small },
      heroAlt: 'Tinubu Square',
      heroCredit: 'Joey',
    });
    expect(picturesForm({ site: {} })).toEqual({
      logo: null,
      hero: null,
      heroAlt: '',
      heroCredit: '',
    });
  });

  it('what changed, what is sent (only that), and null to remove', () => {
    const saved = picturesForm({ site: { logo, hero } });
    expect(pictureChanges(saved, saved)).toEqual([]);
    expect(picturesSite(saved, saved)).toEqual({});
    const noLogo = { ...saved, logo: null };
    expect(pictureChanges(noLogo, saved)).toEqual(['Logo']);
    expect(picturesSite(noLogo, saved)).toEqual({ logo: null });
    const retold = { ...saved, heroAlt: ' Tinubu Square at noon ', heroCredit: ' ' };
    expect(pictureChanges(retold, saved)).toEqual(['Hero photo']);
    expect(picturesSite(retold, saved)).toEqual({
      hero: { url: hero.url, small: hero.small, alt: 'Tinubu Square at noon', credit: null },
    });
    // The description alone, or the credit alone, is a change too.
    expect(pictureChanges({ ...saved, heroAlt: 'Tinubu Square at dusk' }, saved)).toEqual([
      'Hero photo',
    ]);
    expect(pictureChanges({ ...saved, heroCredit: 'Joey Jay' }, saved)).toEqual(['Hero photo']);
    const gone = { ...saved, hero: null };
    expect(picturesSite(gone, saved)).toEqual({ hero: null });
    const fresh = picturesForm({ site: {} });
    const added = { ...fresh, logo, hero: { url: u('n'), small: u('n-640') }, heroAlt: 'x' };
    expect(pictureChanges(added, fresh)).toEqual(['Logo', 'Hero photo']);
    // Text typed with no hero photo doesn't count as a change.
    expect(pictureChanges({ ...fresh, heroAlt: 'typed' }, fresh)).toEqual([]);
  });

  it('a hero photo needs a description; long words refused', () => {
    const base = picturesForm({ site: { hero } });
    expect(pictureErrors(base)).toEqual({});
    expect(pictureErrors({ ...base, heroAlt: ' ' })).toEqual({
      heroAlt: 'Describe the photo first: guests using screen readers need it.',
    });
    expect(pictureErrors({ ...base, heroAlt: 'a'.repeat(201) }).heroAlt).toBe(
      'Too long: 201 of 200 characters.',
    );
    expect(pictureErrors({ ...base, heroCredit: 'c'.repeat(121) }).heroCredit).toBe(
      'Too long: 121 of 120 characters.',
    );
    expect(pictureErrors({ ...base, hero: null, heroAlt: '' })).toEqual({});
  });

  it('the first letter, as a person sees it', () => {
    expect(firstLetter('Ìrìn Lagos Tours')).toBe('Ì');
    expect(firstLetter('  ọjà tours')).toBe('Ọ');
    expect(firstLetter('')).toBe('?');
  });
});

/** A fake XMLHttpRequest: the test plays the server. */
class FakeXhr {
  constructor() {
    /** @type {any} */
    this.upload = {};
    /** @type {Record<string, string>} */
    this.headers = {};
    this.status = 0;
    this.responseText = '';
    this.timeout = 0;
    FakeXhr.last = this;
  }
  /** @param {string} method @param {string} url */
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  /** @param {string} k @param {string} v */
  setRequestHeader(k, v) {
    this.headers[k] = v;
  }
  /** @param {any} body */
  send(body) {
    this.body = body;
  }
  abort() {
    /** @type {any} */ (this).onabort?.();
  }
  /** @param {number} status @param {any} json */
  respond(status, json) {
    this.status = status;
    this.responseText = typeof json === 'string' ? json : JSON.stringify(json);
    /** @type {any} */ (this).onload?.();
  }
}
/** @type {FakeXhr | null} */
FakeXhr.last = null;
const makeXhr = () => /** @type {any} */ (new FakeXhr());
const file = (size = 1000, type = 'image/jpeg') =>
  /** @type {any} */ ({ size, type, name: 'p.jpg' });
const xhr = () => /** @type {FakeXhr} */ (FakeXhr.last);

describe('sendPicture', () => {
  it('sends the bytes with the sign-in, reports progress, gives back the picture', async () => {
    const seen = /** @type {number[]} */ ([]);
    const f = file();
    const s = sendPicture({
      file: f,
      kind: 'photo',
      token: 'tok',
      makeXhr,
      onProgress: (p) => seen.push(p),
      online: () => true,
    });
    expect([xhr().method, xhr().url]).toEqual(['POST', '/api/uploads/photo']);
    expect(xhr().headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'image/jpeg' });
    expect(xhr().body).toBe(f);
    expect(xhr().timeout).toBe(120_000);
    xhr().upload.onprogress({ lengthComputable: true, loaded: 25, total: 100 });
    xhr().upload.onprogress({ lengthComputable: false, loaded: 1, total: 0 });
    const picture = { url: u('p'), small: u('p-640'), width: 1600, height: 1067 };
    xhr().respond(201, { picture });
    expect(await s.done).toEqual({ ok: true, picture });
    expect(seen).toEqual([25]);
  });

  it('a logo goes to its own address; no type: sent as bytes', () => {
    sendPicture({ file: file(10, ''), kind: 'logo', token: null, makeXhr, online: () => true });
    expect(xhr().url).toBe('/api/uploads/logo');
    expect(xhr().headers).toEqual({ 'Content-Type': 'application/octet-stream' });
  });

  it("says what went wrong: the server's words, signed out, broken, no connection, timed out", async () => {
    const cases = [
      [
        (/** @type {FakeXhr} */ x) =>
          x.respond(400, {
            error: {
              code: 'WRONG_TYPE',
              message: 'That’s a PDF. Use a JPEG, PNG or WebP picture.',
            },
          }),
        'That’s a PDF. Use a JPEG, PNG or WebP picture.',
      ],
      [
        (/** @type {FakeXhr} */ x) => x.respond(401, { error: { code: 'UNAUTHENTICATED' } }),
        'Sign in again, then try again.',
      ],
      [
        (/** @type {FakeXhr} */ x) =>
          x.respond(500, { error: { message: 'Something went wrong' } }),
        'The upload didn’t work. Try again.',
      ],
      [
        (/** @type {FakeXhr} */ x) => x.respond(200, '<html>Hotel Wi-Fi</html>'),
        'The upload didn’t work. Try again.',
      ],
      [(/** @type {FakeXhr} */ x) => /** @type {any} */ (x).onerror(), NO_CONNECTION],
      [(/** @type {FakeXhr} */ x) => /** @type {any} */ (x).ontimeout(), NO_CONNECTION],
    ];
    for (const [play, message] of cases) {
      const s = sendPicture({
        file: file(),
        kind: 'photo',
        token: 't',
        makeXhr,
        online: () => true,
      });
      /** @type {any} */ (play)(xhr());
      expect(await s.done).toEqual({ ok: false, cancelled: false, message });
    }
  });

  it('cancelled: says so, quietly', async () => {
    const s = sendPicture({ file: file(), kind: 'photo', token: 't', makeXhr, online: () => true });
    s.cancel();
    expect(await s.done).toEqual({ ok: false, cancelled: true, message: '' });
  });

  it('too big or offline: refused before sending anything', async () => {
    FakeXhr.last = null;
    const big = sendPicture({
      file: file(14 * MB),
      kind: 'logo',
      token: 't',
      makeXhr,
      online: () => true,
    });
    expect(await big.done).toEqual({
      ok: false,
      cancelled: false,
      message: 'That logo is 14 MB. Use one under 10 MB.',
    });
    const off = sendPicture({
      file: file(),
      kind: 'photo',
      token: 't',
      makeXhr,
      online: () => false,
    });
    expect(await off.done).toEqual({
      ok: false,
      cancelled: false,
      message: 'No connection: the photo wasn’t sent.',
    });
    expect(FakeXhr.last).toBeNull();
  });
});
