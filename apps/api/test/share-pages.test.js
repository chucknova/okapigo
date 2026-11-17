/**
 * Stage 11e: share pages with link previews (BKG-32).
 *
 * These tests read the HTML the way a crawler does (WhatsApp, facebookexternalhit,
 * Twitterbot): no JavaScript, just the <meta> tags in the <head>.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext, buildApp } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

const WEB = 'https://okapigo.example';
const app = () =>
  buildApp({ prisma: ctx.prisma, apiPublicUrl: 'https://api.okapigo.example', webPublicUrl: WEB });

/**
 * The content of a meta tag, unescaped, or undefined. Matches property= or name=.
 * @param {string} html
 * @param {string} key  e.g. 'og:title'
 */
function meta(html, key) {
  const match = html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`));
  return match?.[1]
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

describe('GET /:operatorSlug/:tourSlug (a tour link)', () => {
  it('has the preview tags a crawler needs, in the server-made HTML', async () => {
    const { operator } = await ctx.seedOperator();

    const res = await request(app()).get(`/${operator.slug}/badagry-heritage-day-trip`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    const html = res.text;
    expect(meta(html, 'og:title')).toBe('Badagry Heritage Day Trip · Ìrìn Lagos Tours');
    expect(meta(html, 'og:site_name')).toBe('Ìrìn Lagos Tours');
    expect(meta(html, 'og:url')).toBe(`${WEB}/${operator.slug}/badagry-heritage-day-trip`);
    expect(html).toContain(
      `<link rel="canonical" href="${WEB}/${operator.slug}/badagry-heritage-day-trip">`,
    );
    expect(meta(html, 'og:description')).toMatch(
      /^A full day in Badagry.* · From ₦65,000 · 10 hours · Next: (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2} [A-Z][a-z]{2}$/,
    );
    expect(meta(html, 'og:description')).toContain('Next: Sat'); // Badagry runs on Saturdays
    expect(meta(html, 'product:price:amount')).toBe('65000.00');
    expect(meta(html, 'product:price:currency')).toBe('NGN');
    // No photo yet (uploads arrive in session 18): a text card, and no og:image at all.
    expect(meta(html, 'twitter:card')).toBe('summary');
    expect(meta(html, 'og:image')).toBeUndefined();
  });

  it('uses the first photo when the tour has one, with its alt text', async () => {
    const { operator } = await ctx.seedOperator();
    await ctx.prisma.product.updateMany({
      where: { operatorId: operator.id, slug: 'tarkwa-bay-beach-and-lagoon' },
      data: {
        photos: [
          { url: 'https://cdn.example/tarkwa.jpg', alt: 'Boats on the lagoon at Tarkwa Bay' },
        ],
      },
    });

    const { text } = await request(app()).get(`/${operator.slug}/tarkwa-bay-beach-and-lagoon`);

    expect(meta(text, 'og:image')).toBe('https://cdn.example/tarkwa.jpg');
    expect(meta(text, 'og:image:alt')).toBe('Boats on the lagoon at Tarkwa Bay');
    expect(meta(text, 'twitter:card')).toBe('summary_large_image');
  });

  it('escapes what operators type, so a title can never become a script', async () => {
    const { operator } = await ctx.seedOperator();
    await ctx.prisma.product.updateMany({
      where: { operatorId: operator.id, slug: 'lagos-street-food-crawl' },
      data: { title: 'Suya "&" <script>alert(1)</script>' },
    });

    const { text } = await request(app()).get(`/${operator.slug}/lagos-street-food-crawl`);

    expect(text).not.toContain('<script>');
    expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(meta(text, 'og:title')).toBe('Suya "&" <script>alert(1)</script> · Ìrìn Lagos Tours');
  });

  it('leaves out the next date when every departure is full', async () => {
    const { operator } = await ctx.seedOperator();
    const tour = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug: 'badagry-heritage-day-trip' },
    });
    await ctx.prisma.$executeRaw`
      UPDATE departures SET seats_sold = capacity WHERE product_id = ${tour.id}::uuid`;

    const { text } = await request(app()).get(`/${operator.slug}/badagry-heritage-day-trip`);

    expect(meta(text, 'og:description')).toMatch(/ · From ₦65,000 · 10 hours$/);
  });

  it('a draft, a missing tour or a missing operator is a "noindex" 404 page', async () => {
    const { operator } = await ctx.seedOperator();
    await ctx.prisma.product.updateMany({
      where: { operatorId: operator.id, slug: 'lekki-nature-and-craft' },
      data: { status: 'draft' },
    });

    for (const path of [
      `/${operator.slug}/lekki-nature-and-craft`,
      `/${operator.slug}/no-such-tour`,
      '/no-such-operator/lagos-island-heritage-walk',
      '/no-such-operator',
    ]) {
      const res = await request(app()).get(path);
      expect(res.status, path).toBe(404);
      expect(res.text).toContain('<meta name="robots" content="noindex">');
      expect(meta(res.text, 'og:title')).toBeUndefined();
    }
  });
});

describe('GET /:operatorSlug (the catalogue link)', () => {
  it('previews the business: name, how many tours, the cheapest price, the titles', async () => {
    const { operator } = await ctx.seedOperator();

    const { text } = await request(app()).get(`/${operator.slug}`);

    expect(meta(text, 'og:title')).toBe('Ìrìn Lagos Tours');
    expect(meta(text, 'og:url')).toBe(`${WEB}/${operator.slug}`);
    expect(meta(text, 'og:description')).toMatch(
      /^5 tours from ₦25,000: Badagry Heritage Day Trip, Lagos Island Heritage Walk, /,
    );
    expect(text).toContain(`href="/${operator.slug}/lagos-island-heritage-walk"`);
  });
});

describe('the rest of the app still wins', () => {
  it('health, the JSON API and reserved words are never treated as an operator', async () => {
    const a = app();

    expect((await request(a).get('/health')).body).toHaveProperty('status');
    // An unknown path under a reserved word gets the normal JSON 404, not a share page.
    const pay = await request(a).get('/pay');
    expect(pay.status).toBe(404);
    expect(pay.headers['content-type']).toMatch(/json/);
    const checkout = await request(a).get('/checkout/anything');
    expect(checkout.headers['content-type']).toMatch(/json/);
  });

  it('a reserved word as a TOUR slug is skipped too (kept for the guest web)', async () => {
    const { operator } = await ctx.seedOperator();

    const res = await request(app()).get(`/${operator.slug}/checkout`);

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
  });
});

describe('reserved slugs', () => {
  it('sign-up never gives an operator a reserved slug', async () => {
    const email = `share-${Date.now()}@test.example`;
    const start = await request(ctx.app)
      .post('/auth/signup')
      .send({ businessName: 'API', name: 'Ada Lovelace', contact: email });
    expect(start.status).toBe(202);

    const code = ctx.sender.lastCodeFor(email);
    const done = await request(ctx.app).post('/auth/signup/verify').send({ contact: email, code });
    ctx.track(done.body.operator?.slug);
    await ctx.prisma.otpChallenge.deleteMany({ where: { destination: email } });

    expect(done.status).toBe(201);
    // "API" slugifies to "api", a reserved word, so it gets a suffix as if taken.
    expect(done.body.operator.slug).toMatch(/^api-[0-9a-f]{4}$/);
  });

  it('a tour can\'t be given a reserved slug; one made from its title gets "-tour"', async () => {
    const { owner } = await ctx.seedOperator();
    const token = await ctx.tokenFor(owner.id);
    const post = (body) =>
      request(ctx.app)
        .post('/api/products')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Checkout',
          summary: 'A test tour.',
          description: 'A test tour.',
          durationMinutes: 60,
          defaultCapacity: 5,
          meetingPoint: { name: 'Here', address: 'Somewhere', lat: 6.5, lng: 3.4 },
          ...body,
        });

    const given = await post({ slug: 'checkout' });
    expect(given.status).toBe(400);
    expect(given.body.error.issues[0].message).toBe('That word is reserved for booking pages');

    const derived = await post({});
    expect(derived.status).toBe(201);
    expect(derived.body.product.slug).toBe('checkout-tour');
  });
});
