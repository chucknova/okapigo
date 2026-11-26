// @ts-check
/**
 * Stage 19b-2b: photos and the logo where guests see them.
 *   pictureReader      only our own pictures become data for drawings
 *   the trip page      the logo, and the tour's cover
 *   a payment link     the logo
 *   posters            the logo; Seats left's panel and Offer's circle show the cover, credited
 *   the link preview   the logo; the cover (or the website's hero) on the right, credited
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { addDays, localDate } from '@okapigo/shared/time';
import { createTestContext, uploadPhotos, testMedia } from './helpers.js';
import { pictureReader } from '../src/lib/pictures.js';
import { posterElement } from '../src/lib/poster.js';
import { cardSvg } from '../src/lib/share-card.js';
import { testPicture } from '@okapigo/media/testing';

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

/** A business whose Heritage Walk has 3 photos (credited) and whose site has a logo. */
async function withPictures() {
  const seeded = await ctx.seedOperator();
  const owner = as(await ctx.tokenFor(seeded.owner.id));
  const photos = (await uploadPhotos(owner, 3, 120)).map((p, i) => ({
    ...p,
    credit: i === 0 ? 'Sho photography, CC BY-SA 4.0' : null,
  }));
  const walk = await ctx.prisma.product.findFirstOrThrow({
    where: { operatorId: seeded.operator.id, slug: 'lagos-island-heritage-walk' },
  });
  await owner.patch(`/api/products/${walk.id}`).send({ photos });
  const up = await owner
    .post('/api/uploads/logo')
    .set('Content-Type', 'image/png')
    .send(await testPicture({ format: 'png', width: 256, height: 256, shade: 123 }));
  const logo = { url: up.body.picture.url, small: up.body.picture.small };
  await owner.patch('/api/website').send({ site: { logo } });
  return { ...seeded, owner, walk, photos, logo };
}

describe('pictureReader', () => {
  it('our own pictures as data; anything else, or a missing file, is nothing', async () => {
    const owner = as(await ctx.tokenFor((await ctx.seedOperator()).owner.id));
    const [p] = await uploadPhotos(owner, 1, 130);
    const read = pictureReader(testMedia);
    expect(await read(p.url)).toMatch(/^data:image\/jpeg;base64,\/9j\//); // a JPEG's first bytes
    const logo = await owner
      .post('/api/uploads/logo')
      .set('Content-Type', 'image/png')
      .send(await testPicture({ format: 'png', width: 128, height: 128, shade: 131 }));
    expect(await read(logo.body.picture.small)).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(await read('https://elsewhere.example/a.jpg')).toBeNull();
    expect(await read('http://localhost:4000/media/photos/ffffffffffffffff.jpg')).toBeNull();
    expect(await read(null)).toBeNull();
  });
});

describe('the trip page and a payment link', () => {
  it('the trip page: the logo, and the tour’s cover with its credit', async () => {
    const s = await withPictures();
    const today = localDate(new Date(), 'Africa/Lagos');
    const deps = (
      await request(ctx.app).get(
        `/public/${s.operator.slug}/tours/lagos-island-heritage-walk/departures?to=${addDays(today, 14)}`,
      )
    ).body.departures;
    const { token } = (
      await request(ctx.app)
        .post(`/public/${s.operator.slug}/bookings`)
        .send({
          lead: { name: 'Adaeze Okafor', email: 'adaeze@guest.example', acceptTerms: true },
          departureId: deps[0].id,
          travellers: [{ name: 'Adaeze Okafor', age: 34 }],
          addOns: [],
        })
    ).body;
    const b = (await request(ctx.app).get(`/public/bookings/${token}`)).body.booking;
    expect(b.operator.logo).toEqual(s.logo);
    expect(b.tour.photo).toEqual(s.photos[0]);
  });

  it('a payment link: the logo', async () => {
    const s = await withPictures();
    const manager = as(await ctx.tokenFor(s.manager.id));
    const deps = (await manager.get(`/api/products/${s.walk.id}/availability`)).body.departures;
    const booking = (
      await manager.post('/api/bookings').send({
        departureId: deps[0].id,
        lead: { name: 'Amara Eze', email: 'amara@guest.example', acceptTerms: true },
        travellers: [{ name: 'Amara Eze', age: 34 }],
      })
    ).body.booking;
    const created = await manager
      .post(`/api/bookings/${booking.id}/payment-links`)
      .send({ amountKobo: 1_000_000 });
    const token = created.body.url.split('/').pop();
    const link = (await request(ctx.app).get(`/public/payment-links/${token}`)).body.link;
    expect(link.operator.logo).toEqual(s.logo);
  });

  it('none: null, so the pages draw the letter and no cover', async () => {
    const s = await ctx.seedOperator();
    const view = (await request(ctx.app).get(`/public/${s.operator.slug}`)).body;
    expect(view.operator.logo).toBeNull();
  });
});

/** Every element in a satori tree. @param {any} el @returns {any[]} */
const all = (el) =>
  !el || typeof el !== 'object' ? [] : [el, ...[el.props?.children].flat().flatMap((c) => all(c))];
const imgs = (/** @type {any} */ el) => all(el).filter((e) => e.type === 'img');
const texts = (/** @type {any} */ el) =>
  all(el)
    .map((e) => e.props?.children)
    .filter((c) => typeof c === 'string');

const POSTER = {
  size: /** @type {const} */ ('square'),
  words: 'THIS SATURDAY',
  business: { name: 'Ìrìn Lagos Tours', site: 'okapigo.app/irin', logo: 'http://x/l.png' },
  url: 'https://okapigo.app/irin/tarkwa',
  tour: {
    title: 'Tarkwa Bay Beach and Lagoon Trip',
    summary: 'Sun and sea.',
    stops: ['Jetty', 'Tarkwa Bay'],
    meetingPoint: 'Jetty',
    price: '₦40,000',
    childPrice: null,
    duration: '6 hours',
    runs: 'Weekends 10:00',
    photo: { url: 'http://x/p.jpg', credit: 'Liesel81, CC BY-SA 4.0' },
  },
  departure: { when: 'Sat 28 Nov at 10:00', seats: 4 },
};
const PICS = { logo: 'data:image/png;base64,LOGO', photo: 'data:image/jpeg;base64,PHOTO' };

describe('posters', () => {
  it('Seats left: the logo for the letter, the cover in the panel, its credit at the foot', () => {
    const el = posterElement({ ...POSTER, template: 'seats_left', pictures: PICS });
    const srcs = imgs(el).map((i) => i.props.src);
    expect(srcs).toContain(PICS.logo);
    expect(srcs).toContain(PICS.photo);
    expect(texts(el)).toContain('Photo: Liesel81, CC BY-SA 4.0');
    expect(texts(el)).not.toContain('Ì');
    const photo = imgs(el).find((i) => i.props.src === PICS.photo);
    expect(photo.props.style).toMatchObject({ objectFit: 'cover', borderRadius: 28 });
    // Tall: the photo goes full width.
    const story = posterElement({
      ...POSTER,
      template: 'seats_left',
      size: 'story',
      pictures: PICS,
    });
    expect(imgs(story).find((i) => i.props.src === PICS.photo).props.width).toBe(936);
  });

  it('Offer: the cover in the circle; no credit when the photo has none', () => {
    const el = posterElement({
      ...POSTER,
      template: 'offer',
      words: 'Beach day',
      tour: { ...POSTER.tour, photo: { url: 'http://x/p.jpg', credit: null } },
      pictures: PICS,
    });
    const photo = imgs(el).find((i) => i.props.src === PICS.photo);
    expect(photo.props.style.borderRadius).toBe(999);
    expect(texts(el).some((t) => t.startsWith('Photo:'))).toBe(false);
  });

  it('New tour and This weekend keep their panels; without pictures, everything as before', () => {
    const tour = posterElement({
      ...POSTER,
      template: 'new_tour',
      words: 'New tour',
      pictures: PICS,
    });
    expect(imgs(tour).map((i) => i.props.src)).not.toContain(PICS.photo);
    expect(imgs(tour).map((i) => i.props.src)).toContain(PICS.logo);
    expect(texts(tour)).toContain('THE ROUTE');
    const bare = posterElement({ ...POSTER, template: 'seats_left' });
    expect(texts(bare)).toContain('Ì');
    expect(texts(bare).some((t) => t.startsWith('Photo:'))).toBe(false);
    expect(imgs(bare).some((i) => String(i.props.src).startsWith('data:image/svg+xml'))).toBe(true);
  });

  it('the route draws them from our storage: the maker says which have a photo', async () => {
    const s = await withPictures();
    const posters = (await s.owner.get('/api/posters')).body;
    const byTitle = Object.fromEntries(posters.tours.map((/** @type {any} */ t) => [t.title, t]));
    expect(byTitle['Lagos Island Heritage Walk'].hasPhoto).toBe(true);
    expect(byTitle['Lagos Street Food Crawl'].hasPhoto).toBe(false);
    const png = async (/** @type {string} */ id) =>
      (
        await s.owner
          .get(`/api/posters/png?template=offer&size=square&productId=${id}`)
          .buffer(true)
          .parse((res, cb) => {
            const chunks = /** @type {Buffer[]} */ ([]);
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => cb(null, Buffer.concat(chunks)));
          })
      ).body;
    const withPhoto = await png(s.walk.id);
    // The same poster without the photo (the walk's photos removed) draws differently.
    await ctx.prisma.product.update({ where: { id: s.walk.id }, data: { photos: [] } });
    const without = await png(s.walk.id);
    expect(withPhoto.length).toBeGreaterThan(1000);
    expect(withPhoto.equals(without)).toBe(false);
  }, 60_000); // two full posters drawn, on a busy machine
});

/** A real small picture as data (satori decodes what it draws). @param {'png' | 'jpeg'} format @param {number} shade */
const dataOf = async (format, shade) =>
  `data:image/${format};base64,${(await testPicture({ format, width: 64, height: 64, shade })).toString('base64')}`;

describe('the link preview card', () => {
  const INPUT = {
    operatorName: 'Ìrìn Lagos Tours',
    facts: '10 hours · Saturdays at 07:00',
    title: 'Badagry Heritage Day Trip',
    price: '₦65,000',
    logo: 'http://x/l.png',
    photo: { url: 'http://x/p.jpg', credit: 'Ei’eke, CC BY 4.0' },
  };
  /** @param {string | null | undefined} url */
  const read = async (url) =>
    url === 'http://x/l.png'
      ? dataOf('png', 1)
      : url === 'http://x/p.jpg'
        ? dataOf('jpeg', 2)
        : null;

  it('with a photo: it fills the right; the logo for the letter', async () => {
    const svg = await cardSvg(INPUT, { readPicture: read });
    expect(svg).toContain(await dataOf('jpeg', 2));
    expect(svg).toContain(await dataOf('png', 1));
    // Cover-cropped into the right 500 px: drawn full height, centred on x = 700 + 250.
    const m = /<image x="([\d.]+)" y="0" width="([\d.]+)" height="630"/.exec(svg);
    expect(Number(m?.[1]) + Number(m?.[2]) / 2).toBe(950);
  });

  it('without: the circles and the letter, as before', async () => {
    const svg = await cardSvg({ ...INPUT, logo: null, photo: null }, { readPicture: read });
    expect(svg).not.toContain('<image');
    const unread = await cardSvg(INPUT); // no reader: pictures can't be read, so none
    expect(unread).not.toContain('<image');
  });

  it("a tour's card, and the website's: the cover and the hero; a new photo, a new address", async () => {
    const s = await withPictures();
    /** @param {string} path */
    const cardUrl = async (path) => {
      const html = (await request(ctx.app).get(path)).text;
      return /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
    };
    const tourPath = `/${s.operator.slug}/lagos-island-heritage-walk`;
    const before = await cardUrl(tourPath);
    const [other] = await uploadPhotos(s.owner, 1, 140);
    await s.owner.patch(`/api/products/${s.walk.id}`).send({
      photos: [{ ...other, alt: 'A new cover' }, ...s.photos],
    });
    const after = await cardUrl(tourPath);
    expect(after).not.toBe(before); // chat apps fetch the new picture

    const siteBefore = await cardUrl(`/${s.operator.slug}`);
    const [hero] = await uploadPhotos(s.owner, 1, 141);
    await s.owner.patch('/api/website').send({ site: { hero: { ...hero, alt: 'Tinubu Square' } } });
    expect(await cardUrl(`/${s.operator.slug}`)).not.toBe(siteBefore);
  });
});
