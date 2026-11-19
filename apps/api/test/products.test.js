/**
 * The catalogue API (INV-01, INV-05, INV-10) against the real database.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

/** request(app) with a Bearer token already set. */
function as(token) {
  const agent = request(ctx.app);
  const withAuth = (method) => (url) => agent[method](url).set('Authorization', `Bearer ${token}`);
  return { get: withAuth('get'), post: withAuth('post'), patch: withAuth('patch') };
}

/** Seeds an operator and returns its owner's API client, plus the seed data. */
async function ownerOf() {
  const seeded = await ctx.seedOperator();
  return { ...seeded, owner: as(await ctx.tokenFor(seeded.owner.id)) };
}

const NEW_TOUR = {
  title: 'Makoko Waterfront Boat Tour',
  summary: 'A guided canoe ride.',
  description: 'Illustrative product for tests.',
  durationMinutes: 120,
  defaultCapacity: 8,
  meetingPoint: { name: 'Third Mainland jetty', address: 'Yaba', lat: 6.4965, lng: 3.3878 },
};

const ADULT = { key: 'adult', name: 'Adult', minAge: 13, maxAge: null, amountKobo: 1_500_000 };
const CHILD = { key: 'child', name: 'Child', minAge: 3, maxAge: 12, amountKobo: 800_000 };

describe('the short name (stage 13c: WhatsApp list rows, 24 characters)', () => {
  it('is optional, at most 24 characters, and null clears it; the database refuses spaces around it', async () => {
    const { owner, operator } = await ctx.seedOperator();
    const staff = as(await ctx.tokenFor(owner.id));
    const created = await staff.post('/api/products').send(NEW_TOUR);
    expect(created.status).toBe(201);
    expect(created.body.product.shortTitle).toBeNull();
    const id = created.body.product.id;

    expect(
      (await staff.patch(`/api/products/${id}`).send({ shortTitle: 'x'.repeat(25) })).status,
    ).toBe(400);
    const set = await staff.patch(`/api/products/${id}`).send({ shortTitle: '  Lagoon Sunset  ' });
    expect(set.body.product.shortTitle).toBe('Lagoon Sunset'); // trimmed
    const cleared = await staff.patch(`/api/products/${id}`).send({ shortTitle: null });
    expect(cleared.body.product.shortTitle).toBeNull();

    await expect(
      ctx.prisma.product.update({ where: { id }, data: { shortTitle: ' Sunset' } }),
    ).rejects.toThrow(/products_short_title_valid/);
    const walk = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug: 'lagos-island-heritage-walk' },
    });
    expect(walk.shortTitle).toBe('Heritage Walk'); // seeded
  });
});

describe('reading the catalogue', () => {
  it("returns Ìrìn's five tours with prices in kobo, to anyone with products: view", async () => {
    const { guides } = await ctx.seedOperator();
    const guide = as(await ctx.tokenFor(guides[0].id)); // guides have products: view

    const res = await guide.get('/api/products');

    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(5);
    const heritage = res.body.products.find((p) => p.slug === 'lagos-island-heritage-walk');
    expect(heritage.priceCategories.map((c) => [c.key, c.amountKobo])).toEqual([
      ['adult', 2_500_000],
      ['child', 1_250_000],
      ['infant', 0],
    ]);
  });

  it('filters by status', async () => {
    const { owner } = await ownerOf();
    await owner.post('/api/products').send(NEW_TOUR); // a draft

    const drafts = await owner.get('/api/products?status=draft');
    const published = await owner.get('/api/products?status=published');

    expect(drafts.body.products.map((p) => p.title)).toEqual([NEW_TOUR.title]);
    expect(published.body.products).toHaveLength(5);
  });
});

describe('who may edit', () => {
  it('guides and managers can view products but not change them', async () => {
    const { manager, guides } = await ctx.seedOperator();

    for (const user of [manager, guides[0]]) {
      const client = as(await ctx.tokenFor(user.id));
      expect((await client.get('/api/products')).status).toBe(200);
      expect((await client.post('/api/products').send(NEW_TOUR)).status).toBe(403);
    }
  });
});

describe('creating and publishing a tour', () => {
  it('goes draft → prices → published', async () => {
    const { owner } = await ownerOf();

    const created = await owner.post('/api/products').send(NEW_TOUR);
    expect(created.status).toBe(201);
    expect(created.body.product).toMatchObject({
      slug: 'makoko-waterfront-boat-tour', // derived from the title
      status: 'draft',
    });
    const id = created.body.product.id;

    // Can't publish with no way to pay.
    const tooEarly = await owner.patch(`/api/products/${id}`).send({ status: 'published' });
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.error.code).toBe('NOT_READY_TO_PUBLISH');

    expect((await owner.post(`/api/products/${id}/price-categories`).send(ADULT)).status).toBe(201);
    expect((await owner.post(`/api/products/${id}/price-categories`).send(CHILD)).status).toBe(201);

    const live = await owner.patch(`/api/products/${id}`).send({ status: 'published' });
    expect(live.status).toBe(200);
    expect(live.body.product.priceCategories.map((c) => c.key)).toEqual(['adult', 'child']);
  });

  it('refuses a product that is published from the start', async () => {
    const { owner } = await ownerOf();
    const res = await owner.post('/api/products').send({ ...NEW_TOUR, status: 'published' });
    expect(res.status).toBe(400);
  });

  it('refuses a link (slug) that another product already uses', async () => {
    const { owner } = await ownerOf();
    const res = await owner
      .post('/api/products')
      .send({ ...NEW_TOUR, slug: 'lagos-street-food-crawl' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLUG_TAKEN');
  });

  it('rejects money that is not whole kobo', async () => {
    const { owner } = await ownerOf();
    const { body } = await owner.post('/api/products').send(NEW_TOUR);

    const res = await owner
      .post(`/api/products/${body.product.id}/price-categories`)
      .send({ ...ADULT, amountKobo: 15000.5 });

    expect(res.status).toBe(400);
    expect(res.body.error.issues[0].path).toBe('amountKobo');
  });
});

describe('price categories (INV-05)', () => {
  async function heritageWalk(owner) {
    const { body } = await owner.get('/api/products');
    return body.products.find((p) => p.slug === 'lagos-island-heritage-walk');
  }

  it('refuses a new category whose ages overlap an existing one', async () => {
    const { owner } = await ownerOf();
    const product = await heritageWalk(owner);

    const res = await owner
      .post(`/api/products/${product.id}/price-categories`)
      .send({ key: 'teen', name: 'Teen', minAge: 12, maxAge: 17, amountKobo: 1_800_000 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AGE_RANGE_OVERLAP');
  });

  it('refuses an edit that would create an overlap', async () => {
    const { owner } = await ownerOf();
    const child = (await heritageWalk(owner)).priceCategories.find((c) => c.key === 'child');

    const res = await owner.patch(`/api/price-categories/${child.id}`).send({ maxAge: 15 });

    expect(res.status).toBe(409);
  });

  it('allows a new band once the old one is archived', async () => {
    const { owner } = await ownerOf();
    const product = await heritageWalk(owner);
    const child = product.priceCategories.find((c) => c.key === 'child');

    await owner.patch(`/api/price-categories/${child.id}`).send({ isActive: false });
    const res = await owner
      .post(`/api/products/${product.id}/price-categories`)
      .send({ key: 'junior', name: 'Junior', minAge: 3, maxAge: 12, amountKobo: 1_000_000 });

    expect(res.status).toBe(201);
  });

  it('will not archive the last active price of a published tour', async () => {
    const { owner } = await ownerOf();
    const product = await heritageWalk(owner);
    const [adult, child, infant] = product.priceCategories;

    await owner.patch(`/api/price-categories/${child.id}`).send({ isActive: false });
    await owner.patch(`/api/price-categories/${infant.id}`).send({ isActive: false });
    const res = await owner.patch(`/api/price-categories/${adult.id}`).send({ isActive: false });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_READY_TO_PUBLISH');
  });

  it('changes a price', async () => {
    const { owner } = await ownerOf();
    const adult = (await heritageWalk(owner)).priceCategories.find((c) => c.key === 'adult');

    const res = await owner
      .patch(`/api/price-categories/${adult.id}`)
      .send({ amountKobo: 2_750_000 });

    expect(res.body.priceCategory.amountKobo).toBe(2_750_000);
  });
});

describe('add-ons (INV-10)', () => {
  it('adds an add-on with limited stock, then archives it', async () => {
    const { owner } = await ownerOf();
    const { body } = await owner.get('/api/products');
    const tarkwa = body.products.find((p) => p.slug === 'tarkwa-bay-beach-and-lagoon');

    const created = await owner
      .post(`/api/products/${tarkwa.id}/add-ons`)
      .send({ name: 'Snorkel set', priceKobo: 500_000, stockPerDeparture: 4 });
    expect(created.status).toBe(201);
    expect(created.body.addOn).toMatchObject({ stockPerDeparture: 4, isActive: true });

    const archived = await owner
      .patch(`/api/add-ons/${created.body.addOn.id}`)
      .send({ isActive: false });
    expect(archived.body.addOn.isActive).toBe(false);
  });
});

describe('tenant isolation', () => {
  it("cannot see or change another operator's products, prices or add-ons", async () => {
    const { owner } = await ownerOf();
    const other = await ownerOf();
    const theirs = (await other.owner.get('/api/products')).body.products.find(
      (p) => p.slug === 'lagos-street-food-crawl',
    );

    expect((await owner.get(`/api/products/${theirs.id}`)).status).toBe(404);
    expect(
      (await owner.patch(`/api/products/${theirs.id}`).send({ title: 'Mine now' })).status,
    ).toBe(404);
    expect(
      (
        await owner
          .patch(`/api/price-categories/${theirs.priceCategories[0].id}`)
          .send({ amountKobo: 1 })
      ).status,
    ).toBe(404);
    expect(
      (await owner.patch(`/api/add-ons/${theirs.addOns[0].id}`).send({ priceKobo: 1 })).status,
    ).toBe(404);

    // Their list is untouched.
    const still = (await other.owner.get(`/api/products/${theirs.id}`)).body.product;
    expect(still.title).toBe('Lagos Street Food Crawl');
  });
});
