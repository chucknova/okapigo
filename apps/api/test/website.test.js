/**
 * Stage 12g-1: the operator's website style and mode.
 *   GET / PATCH /api/website (marketing)       choose Lagoon · Classic · Earth, auto · light · dark
 *   <html data-style data-mode>                the server-made pages draw in that style at once
 *   the guest views carry it                   trip and payment link pages apply it on load
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';
import { lookAttributes } from '../src/routes/share-pages.js';
import { IRIN_SITE } from '@okapigo/db';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

/** @param {string} token */
function as(token) {
  const withAuth = (/** @type {'get' | 'patch'} */ method) => (/** @type {string} */ url) =>
    request(ctx.app)[method](url).set('Authorization', `Bearer ${token}`);
  return { get: withAuth('get'), patch: withAuth('patch') };
}

/** The opening <html …> tag of a page. @param {string} html */
const htmlTag = (html) => /** @type {string} */ (html.match(/<html[^>]*>/)?.[0]);

describe('choosing the look', () => {
  it('starts as Lagoon, following the phone; the owner (marketing: edit) changes it', async () => {
    const { owner } = await ctx.seedOperator();
    const staff = as(await ctx.tokenFor(owner.id));

    expect((await staff.get('/api/website')).body.website).toMatchObject({
      style: 'lagoon',
      mode: 'auto',
      styles: ['lagoon', 'classic', 'earth'],
      modes: ['auto', 'light', 'dark'],
    });
    const res = await staff.patch('/api/website').send({ style: 'earth', mode: 'dark' });
    expect(res.status).toBe(200);
    expect(res.body.website).toMatchObject({ style: 'earth', mode: 'dark' });
    // Only what was sent changes.
    await staff.patch('/api/website').send({ mode: 'light' });
    expect((await staff.get('/api/website')).body.website).toMatchObject({
      style: 'earth',
      mode: 'light',
    });
  });

  it('refuses unknown styles and modes, and an empty change', async () => {
    const { owner } = await ctx.seedOperator();
    const staff = as(await ctx.tokenFor(owner.id));
    expect((await staff.patch('/api/website').send({ style: 'neon' })).status).toBe(400);
    expect((await staff.patch('/api/website').send({ mode: 'sepia' })).status).toBe(400);
    expect((await staff.patch('/api/website').send({})).status).toBe(400);
  });

  it('the manager (marketing: view) can see it but not change it; a guide can’t see it', async () => {
    const { manager, guides } = await ctx.seedOperator();
    const mgr = as(await ctx.tokenFor(manager.id));
    expect((await mgr.get('/api/website')).status).toBe(200);
    expect((await mgr.patch('/api/website').send({ style: 'classic' })).status).toBe(403);
    expect((await as(await ctx.tokenFor(guides[0].id)).get('/api/website')).status).toBe(403);
  });
});

describe('the pages draw in it', () => {
  it('catalogue and tour pages carry data-style and data-mode in their HTML', async () => {
    const { operator, owner } = await ctx.seedOperator();
    // Lagoon, auto: the defaults, so no attributes.
    expect(htmlTag((await request(ctx.app).get(`/${operator.slug}`)).text)).toBe(
      '<html lang="en">',
    );

    await as(await ctx.tokenFor(owner.id))
      .patch('/api/website')
      .send({ style: 'classic', mode: 'dark' });
    for (const path of [
      `/${operator.slug}`,
      `/${operator.slug}/lagos-island-heritage-walk`,
      `/${operator.slug}/lagos-island-heritage-walk/book`,
    ]) {
      expect(htmlTag((await request(ctx.app).get(path)).text), path).toBe(
        '<html lang="en" data-style="classic" data-mode="dark">',
      );
    }
    // The app's own data says so too.
    expect((await request(ctx.app).get(`/public/${operator.slug}`)).body.operator).toMatchObject({
      websiteStyle: 'classic',
      websiteMode: 'dark',
    });
  });

  it('only known values reach the HTML', () => {
    expect(lookAttributes({ style: 'earth', mode: 'auto' })).toBe(' data-style="earth"');
    expect(lookAttributes({ style: 'lagoon', mode: 'light' })).toBe(' data-mode="light"');
    expect(lookAttributes({ style: '"><script>', mode: 'x' })).toBe('');
    expect(lookAttributes(undefined)).toBe('');
  });
});

describe('the business details (stage 12g-2)', () => {
  it('reads the seeded words, merges a change over them, and null clears one field', async () => {
    const { owner, operator } = await ctx.seedOperator();
    const staff = as(await ctx.tokenFor(owner.id));
    expect((await staff.get('/api/website')).body.website.site).toEqual(IRIN_SITE);

    const res = await staff.patch('/api/website').send({
      site: { tagline: 'Lagos, at walking pace', about: null },
      whatsapp: '0803 123 4567',
    });
    expect(res.status).toBe(200);
    expect(res.body.website).toMatchObject({ whatsapp: '+2348031234567' });
    expect(res.body.website.site.tagline).toBe('Lagos, at walking pace');
    expect(res.body.website.site.about).toBeUndefined(); // cleared
    expect(res.body.website.site.faqs).toEqual(IRIN_SITE.faqs); // untouched

    // The public site shows the change; the cleared About is null (that section hides).
    const pub = (await request(ctx.app).get(`/public/${operator.slug}`)).body.site;
    expect(pub).toMatchObject({
      tagline: 'Lagos, at walking pace',
      about: null,
      contact: { whatsapp: '+2348031234567', email: IRIN_SITE.email },
    });
  });

  it('refuses what a public page shouldn’t show: bad emails, http links, too much, unknown fields', async () => {
    const { owner } = await ctx.seedOperator();
    const staff = as(await ctx.tokenFor(owner.id));
    const bad = [
      { site: { email: 'not an email' } },
      { site: { socials: [{ network: 'instagram', url: 'http://instagram.example/irin' }] } },
      { site: { socials: [{ network: 'myspace', url: 'https://myspace.example/irin' }] } },
      { site: { tagline: 'x'.repeat(81) } },
      { site: { whyUs: [1, 2, 3, 4].map((i) => ({ title: `T${i}`, text: 'x' })) } },
      { phone: '12345' },
      { colour: 'pink' },
    ];
    for (const body of bad) {
      expect((await staff.patch('/api/website').send(body)).status, JSON.stringify(body)).toBe(400);
    }
    // Nothing above was saved.
    expect((await staff.get('/api/website')).body.website.site).toEqual(IRIN_SITE);
  });

  it('a page title like "><script> is text, never HTML, on the site’s own page', async () => {
    const { owner, operator } = await ctx.seedOperator();
    await as(await ctx.tokenFor(owner.id))
      .patch('/api/website')
      .send({ site: { tagline: '"><script>alert(1)</script>' } });
    const html = (await request(ctx.app).get(`/${operator.slug}`)).text;
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
