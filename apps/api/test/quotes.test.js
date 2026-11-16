/**
 * POST /api/quotes: the pricing pipeline (INV-24) applied to real seeded products.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

const N = (naira) => naira * 100;

async function setup() {
  const seeded = await ctx.seedOperator();
  const token = await ctx.tokenFor(seeded.guides[0].id); // guides have products: view
  const api = {
    get: (url) => request(ctx.app).get(url).set('Authorization', `Bearer ${token}`),
    quote: (body) =>
      request(ctx.app).post('/api/quotes').set('Authorization', `Bearer ${token}`).send(body),
  };
  const { body } = await api.get('/api/products');
  const tours = Object.fromEntries(body.products.map((p) => [p.slug, p]));
  return { ...seeded, api, tours };
}

describe('POST /api/quotes', () => {
  it('prices a Heritage Walk family with VAT included', async () => {
    const { api, tours } = await setup();

    const res = await api.quote({
      productId: tours['lagos-island-heritage-walk'].id,
      travellers: [{ age: 41 }, { age: 38 }, { age: 9 }, { age: 1 }],
    });

    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({
      subtotalKobo: N(62500),
      taxKobo: N(4360), // the VAT already inside ₦62,500
      totalKobo: N(62500),
      tax: { name: 'VAT', inclusive: true },
    });
  });

  it('adds Street Food add-ons by id and quantity', async () => {
    const { api, tours } = await setup();
    const crawl = tours['lagos-street-food-crawl'];
    const plate = crawl.addOns.find((a) => a.name === 'Extra tasting plate');

    const res = await api.quote({
      productId: crawl.id,
      travellers: [{ age: 30 }, { age: 29 }],
      addOns: [{ addOnId: plate.id, quantity: 3 }],
    });

    // 2 × ₦35,000 + 3 × ₦5,000
    expect(res.body.quote.totalKobo).toBe(N(85000));
    expect(res.body.quote.lines.map((l) => l.type)).toEqual(['ticket', 'addOn']);
  });

  it("uses the operator's own tax and fee settings", async () => {
    const { api, tours, operator } = await setup();
    await ctx.prisma.operator.update({
      where: { id: operator.id },
      data: {
        pricing: {
          tax: { name: 'VAT', basisPoints: 750, inclusive: false },
          fees: [{ name: 'Service fee', type: 'percent', basisPoints: 250 }],
        },
      },
    });

    const res = await api.quote({
      productId: tours['lagos-island-heritage-walk'].id,
      travellers: [{ age: 30 }],
    });

    // ₦25,000 + 2.5% fee (₦625) = ₦25,625; + 7.5% VAT (₦1,921.88 → ₦1,922) = ₦27,547
    expect(res.body.quote).toMatchObject({
      feesKobo: N(625),
      taxKobo: N(1922),
      totalKobo: N(27547),
    });
  });

  it('explains why a basket cannot be priced', async () => {
    const { api, tours } = await setup();
    const crawl = tours['lagos-street-food-crawl']; // only used to borrow an add-on id
    const badagry = tours['badagry-heritage-day-trip'];
    // Badagry stops taking infants: archive its infant price.
    await ctx.prisma.priceCategory.updateMany({
      where: { productId: badagry.id, key: 'infant' },
      data: { isActive: false },
    });

    const noInfants = await api.quote({ productId: badagry.id, travellers: [{ age: 1 }] });
    const wrongAddOn = await api.quote({
      productId: badagry.id,
      travellers: [{ age: 30 }],
      addOns: [{ addOnId: crawl.addOns[0].id, quantity: 1 }], // belongs to another tour
    });

    expect(noInfants.status).toBe(400);
    expect(noInfants.body.error.code).toBe('NO_PRICE_FOR_AGE');
    expect(wrongAddOn.status).toBe(400);
    expect(wrongAddOn.body.error.code).toBe('UNKNOWN_ADD_ON');
  });

  it('validates the request shape', async () => {
    const { api, tours } = await setup();
    const res = await api.quote({
      productId: tours['lagos-island-heritage-walk'].id,
      travellers: [{ age: 30, categoryKey: 'adult' }], // one or the other, not both
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it("cannot quote another operator's product", async () => {
    const mine = await setup();
    const theirs = await setup();
    const res = await mine.api.quote({
      productId: theirs.tours['lagos-island-heritage-walk'].id,
      travellers: [{ age: 30 }],
    });
    expect(res.status).toBe(404);
  });
});
