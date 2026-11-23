// @ts-check
/**
 * Stage 19b-1: photos and logos.
 *   POST /api/uploads/:kind     who may, what's refused and in which words
 *   GET  /media/<key>           the stored picture, cached, usable from other addresses
 *   tours and the website       only this server's own pictures; up to 8 photos; credits
 *   going on sale               a price and 3 photos, checked only when put on sale
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext, uploadPhotos } from './helpers.js';
import { testPicture } from '@okapigo/media/testing';
import { RESERVED_OPERATOR_SLUGS } from '@okapigo/shared/slug';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

/** @param {string} token */
function as(token) {
  const withAuth =
    (/** @type {'get' | 'post' | 'patch'} */ method) => (/** @type {string} */ url) =>
      request(ctx.app)[method](url).set('Authorization', `Bearer ${token}`);
  return { get: withAuth('get'), post: withAuth('post'), patch: withAuth('patch') };
}

async function setup() {
  const seeded = await ctx.seedOperator();
  return {
    ...seeded,
    owner: as(await ctx.tokenFor(seeded.owner.id)),
    manager: as(await ctx.tokenFor(seeded.manager.id)),
    guide: as(await ctx.tokenFor(seeded.guides[0].id)),
  };
}

/** The path part of one of our picture urls ("/media/photos/….jpg"). @param {string} url */
const pathOf = (url) => new URL(url).pathname;

const NEW_TOUR = {
  title: 'Lagos Lagoon by Speedboat',
  summary: 'The city from the water.',
  description: 'Illustrative product for tests.',
  durationMinutes: 150,
  defaultCapacity: 10,
  meetingPoint: { name: 'Five Cowries jetty', address: 'Ikoyi', lat: 6.45, lng: 3.43 },
};
const ADULT = { key: 'adult', name: 'Adult', minAge: 13, maxAge: null, amountKobo: 3_000_000 };

describe('uploading', () => {
  it('a photo: 201 with its two sizes, served at /media, kept a year, usable anywhere', async () => {
    const s = await setup();
    const res = await s.owner
      .post('/api/uploads/photo')
      .set('Content-Type', 'image/png')
      .send(await testPicture({ width: 2400, height: 1600, format: 'png', shade: 41 }));
    expect(res.status).toBe(201);
    expect(res.body.picture).toEqual({
      url: expect.stringMatching(/^http:\/\/localhost:4000\/media\/photos\/[a-f0-9]{16}\.jpg$/),
      small: expect.stringMatching(/-640\.jpg$/),
      width: 1600,
      height: 1067,
    });
    const served = await request(ctx.app).get(pathOf(res.body.picture.url));
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(served.body.length).toBeGreaterThan(1000);
    expect((await request(ctx.app).get(pathOf(res.body.picture.small))).status).toBe(200);
  });

  it('a logo: a PNG, served as one; the label sent is ignored, the bytes decide', async () => {
    const s = await setup();
    const res = await s.owner
      .post('/api/uploads/logo')
      .set('Content-Type', 'text/plain') // wrong on purpose
      .send(await testPicture({ width: 300, height: 300, format: 'webp', shade: 42 }));
    expect(res.status).toBe(201);
    expect(res.body.picture.url).toMatch(/\/media\/logos\/[a-f0-9]{16}\.png$/);
    expect(res.body.picture.small).toMatch(/-128\.png$/);
    const served = await request(ctx.app).get(pathOf(res.body.picture.small));
    expect(served.headers['content-type']).toBe('image/png');
  });

  it('says what was wrong: the wrong kind of file, too big, empty, an unknown kind', async () => {
    const s = await setup();
    const pdf = await s.owner
      .post('/api/uploads/photo')
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('%PDF-1.7 a menu'));
    expect(pdf.status).toBe(400);
    expect(pdf.body.error).toEqual({
      code: 'WRONG_TYPE',
      message: 'That’s a PDF. Use a JPEG, PNG or WebP picture.',
    });
    const big = await s.owner
      .post('/api/uploads/photo')
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.concat([await testPicture(), Buffer.alloc(14 * 1024 * 1024)]));
    expect(big.status).toBe(413);
    expect(big.body.error.message).toBe('That photo is 14 MB. Use one under 10 MB.');
    const empty = await s.owner.post('/api/uploads/logo').set('Content-Type', 'image/png');
    expect(empty.body.error.code).toBe('EMPTY');
    const banner = await s.owner
      .post('/api/uploads/banner')
      .set('Content-Type', 'image/jpeg')
      .send(await testPicture());
    expect(banner.status).toBe(404);
  });

  it('only for whoever may change tours or the website: not a manager, a guide, or nobody', async () => {
    const s = await setup();
    const pic = await testPicture({ shade: 43 });
    for (const who of [s.manager, s.guide]) {
      const res = await who.post('/api/uploads/photo').set('Content-Type', 'image/jpeg').send(pic);
      expect(res.status).toBe(403);
    }
    const anon = await request(ctx.app)
      .post('/api/uploads/photo')
      .set('Content-Type', 'image/jpeg')
      .send(pic);
    expect(anon.status).toBe(401);
  });

  it('a role that may change only the website (marketing) can upload too', async () => {
    const s = await setup();
    const manager = await roleOf(s.operator.id, 'manager');
    const role = await ctx.prisma.role.update({
      where: { id: manager.id },
      data: { permissions: { ...manager.permissions, marketing: 'edit' } },
    });
    expect(/** @type {any} */ (role.permissions).products).toBe('view');
    const res = await s.manager
      .post('/api/uploads/logo')
      .set('Content-Type', 'image/png')
      .send(await testPicture({ format: 'png', shade: 44 }));
    expect(res.status).toBe(201);
  });

  it('so can a role that may change only tours (products)', async () => {
    const s = await setup();
    const manager = await roleOf(s.operator.id, 'manager');
    await ctx.prisma.role.update({
      where: { id: manager.id },
      data: { permissions: { ...manager.permissions, products: 'edit', marketing: 'view' } },
    });
    const res = await s.manager
      .post('/api/uploads/photo')
      .set('Content-Type', 'image/jpeg')
      .send(await testPicture({ shade: 45 }));
    expect(res.status).toBe(201);
  });

  it('/media answers only for pictures it has, and only our kind of name', async () => {
    for (const path of [
      '/media/photos/ffffffffffffffff.jpg', // our shape, but there's no such picture
      '/media/photos/../../package.json',
      '/media/%2e%2e/%2e%2e/.env',
      '/media/other/0123456789abcdef.jpg',
    ]) {
      expect((await request(ctx.app).get(path)).status).toBe(404);
    }
    // "media" can't be a business's address, so /media is never someone's website.
    expect(RESERVED_OPERATOR_SLUGS.has('media')).toBe(true);
  });
});

/** @param {string} operatorId @param {string} key */
const roleOf = (operatorId, key) =>
  ctx.prisma.role.findFirstOrThrow({ where: { operatorId, key } }).then((r) => ({
    ...r,
    permissions: /** @type {Record<string, string>} */ (r.permissions),
  }));

describe("a tour's photos", () => {
  it('are saved with their description and credit; an empty credit is none', async () => {
    const s = await setup();
    const made = await s.owner.post('/api/products').send(NEW_TOUR);
    const [a, b] = await uploadPhotos(s.owner, 2, 50);
    const res = await s.owner.patch(`/api/products/${made.body.product.id}`).send({
      photos: [
        { ...a, alt: 'A speedboat under the bridge', credit: '  FrankvEck, CC BY-SA 4.0 ' },
        { ...b, alt: 'The Marina skyline', credit: '' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.product.photos).toEqual([
      {
        url: a.url,
        small: a.small,
        alt: 'A speedboat under the bridge',
        credit: 'FrankvEck, CC BY-SA 4.0',
      },
      { url: b.url, small: b.small, alt: 'The Marina skyline', credit: null },
    ]);
  });

  it('can be given when the tour is made (New tour, with its photos)', async () => {
    const s = await setup();
    const photos = await uploadPhotos(s.owner, 3, 55);
    const made = await s.owner.post('/api/products').send({ ...NEW_TOUR, photos });
    expect(made.status).toBe(201);
    expect(made.body.product.photos.map((/** @type {any} */ p) => p.url)).toEqual(
      photos.map((p) => p.url),
    );
  });

  it('must be pictures this server made: never a link to another site', async () => {
    const s = await setup();
    const made = await s.owner.post('/api/products').send(NEW_TOUR);
    const [own] = await uploadPhotos(s.owner, 1, 60);
    for (const photo of [
      { url: 'https://tracker.example/pixel.jpg', alt: 'x' },
      { url: own.url, small: 'https://tracker.example/pixel.jpg', alt: 'x' },
      { url: 'http://localhost:4000/media/../../.env', alt: 'x' },
    ]) {
      const res = await s.owner
        .patch(`/api/products/${made.body.product.id}`)
        .send({ photos: [photo] });
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: 'NOT_AN_UPLOAD',
        message: 'Upload the picture here: links to pictures on other sites can’t be used.',
      });
    }
    const atMaking = await s.owner.post('/api/products').send({
      ...NEW_TOUR,
      title: 'Another one',
      photos: [{ url: 'https://x.example/a.jpg', alt: 'x' }],
    });
    expect(atMaking.body.error.code).toBe('NOT_AN_UPLOAD');
  });

  it('need a description; at most 8; a credit of at most 120 characters', async () => {
    const s = await setup();
    const made = await s.owner.post('/api/products').send(NEW_TOUR);
    const id = made.body.product.id;
    const [p] = await uploadPhotos(s.owner, 1, 65);
    const send = (/** @type {any} */ photos) =>
      s.owner.patch(`/api/products/${id}`).send({ photos });
    expect((await send([{ ...p, alt: '' }])).status).toBe(400);
    expect((await send([{ url: p.url, small: p.small }])).status).toBe(400);
    expect((await send([{ ...p, credit: 'x'.repeat(121) }])).status).toBe(400);
    expect((await send(Array(8).fill(p))).status).toBe(200);
    const nine = await send(Array(9).fill(p));
    expect(nine.status).toBe(400);
    expect(JSON.stringify(nine.body)).toContain('Up to 8 photos a tour.');
  });
});

describe('going on sale: a price and 3 photos (decided 2026-11-23)', () => {
  it('says what is missing, then lets it go on sale with 3', async () => {
    const s = await setup();
    const made = await s.owner.post('/api/products').send(NEW_TOUR);
    const id = made.body.product.id;
    const publish = () => s.owner.patch(`/api/products/${id}`).send({ status: 'published' });

    expect((await publish()).body.error).toEqual({
      code: 'NOT_READY_TO_PUBLISH',
      message: 'Add at least one price and 3 photos before putting it on sale.',
    });
    const photos = await uploadPhotos(s.owner, 3, 70);
    await s.owner.patch(`/api/products/${id}`).send({ photos: photos.slice(0, 1) });
    expect((await publish()).body.error.message).toBe(
      'Add at least one price and 2 more photos before putting it on sale (it has 1 of 3).',
    );
    await s.owner.post(`/api/products/${id}/price-categories`).send(ADULT);
    await s.owner.patch(`/api/products/${id}`).send({ photos: photos.slice(0, 2) });
    expect((await publish()).body.error.message).toBe(
      'Add 1 more photo before putting it on sale (it has 2 of 3).',
    );
    // The photos and the switch in one save count the photos being sent.
    const live = await s.owner.patch(`/api/products/${id}`).send({ photos, status: 'published' });
    expect(live.status).toBe(200);
    expect(live.body.product.status).toBe('published');
  });

  it('can NOT start out on sale, even with 3 photos (a new tour has no prices yet)', async () => {
    const s = await setup();
    const photos = await uploadPhotos(s.owner, 3, 75);
    const res = await s.owner
      .post('/api/products')
      .send({ ...NEW_TOUR, photos, status: 'published' });
    expect(res.body.error).toEqual({
      code: 'NOT_READY_TO_PUBLISH',
      message: 'Add at least one price before putting it on sale.',
    });
  });

  it('a tour already on sale keeps selling: under 3 photos, a photo removed, saved again', async () => {
    const s = await setup();
    // The seeded tours are on sale with no photos (as your businesses' tours were before 19b).
    const walk = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: s.operator.id, slug: 'lagos-island-heritage-walk' },
    });
    expect(walk.status).toBe('published');
    const edited = await s.owner
      .patch(`/api/products/${walk.id}`)
      .send({ summary: 'Still on sale.', status: 'published' });
    expect(edited.status).toBe(200);

    const photos = await uploadPhotos(s.owner, 3, 80);
    await s.owner.patch(`/api/products/${walk.id}`).send({ photos });
    // Removing one, under 3: allowed (the staff app warns first); it stays on sale.
    const fewer = await s.owner.patch(`/api/products/${walk.id}`).send({ photos: photos.slice(1) });
    expect(fewer.status).toBe(200);
    expect(fewer.body.product).toMatchObject({ status: 'published' });
    expect(fewer.body.product.photos).toHaveLength(2);
  });

  it('taken off sale with 2 photos, it needs 3 to go back on', async () => {
    const s = await setup();
    const walk = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: s.operator.id, slug: 'lagos-island-heritage-walk' },
    });
    await s.owner.patch(`/api/products/${walk.id}`).send({ status: 'draft' });
    const back = await s.owner.patch(`/api/products/${walk.id}`).send({ status: 'published' });
    expect(back.body.error.message).toBe('Add 3 photos before putting it on sale.');
  });
});

describe('the logo and the hero photo (the website)', () => {
  it('are saved, shown back, and removed with null', async () => {
    const s = await setup();
    const logoRes = await s.owner
      .post('/api/uploads/logo')
      .set('Content-Type', 'image/png')
      .send(await testPicture({ format: 'png', width: 512, height: 512, shade: 90 }));
    const [hero] = await uploadPhotos(s.owner, 1, 91);
    const logo = { url: logoRes.body.picture.url, small: logoRes.body.picture.small };
    const saved = await s.owner.patch('/api/website').send({
      site: {
        logo,
        hero: { ...hero, alt: 'Tinubu Square from above', credit: 'Joeyjayjuniors, CC BY-SA 4.0' },
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.website.site).toMatchObject({
      logo,
      hero: { url: hero.url, small: hero.small, alt: 'Tinubu Square from above' },
    });
    // The rest of the site's words are untouched.
    expect(saved.body.website.site.tagline).toBeTruthy();

    // Guests see them: the logo on every page (with the name), the hero on the website.
    const pub = await request(ctx.app).get(`/public/${s.operator.slug}`);
    expect(pub.body.operator.logo).toEqual(logo);
    expect(pub.body.site.hero).toEqual({
      url: hero.url,
      small: hero.small,
      alt: 'Tinubu Square from above',
      credit: 'Joeyjayjuniors, CC BY-SA 4.0',
    });
    const tourPage = await request(ctx.app).get(
      `/public/${s.operator.slug}/tours/lagos-island-heritage-walk`,
    );
    expect(tourPage.body.operator.logo).toEqual(logo);

    const removed = await s.owner.patch('/api/website').send({ site: { logo: null } });
    expect(removed.body.website.site.logo).toBeUndefined();
    expect(removed.body.website.site.hero.url).toBe(hero.url);
  });

  it('must be pictures this server made', async () => {
    const s = await setup();
    const res = await s.owner.patch('/api/website').send({
      site: { logo: { url: 'https://x.example/logo.png', small: 'https://x.example/s.png' } },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_AN_UPLOAD');
    const [hero] = await uploadPhotos(s.owner, 1, 95);
    const badSmall = await s.owner
      .patch('/api/website')
      .send({ site: { hero: { ...hero, small: 'https://x.example/s.jpg', alt: 'x' } } });
    expect(badSmall.body.error.code).toBe('NOT_AN_UPLOAD');
  });
});
