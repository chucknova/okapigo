/**
 * Stage 16e-4a: what Settings › Tours needs from the server for the list and the basics.
 *   - each tour's schedule in words: "Daily 09:00 · 15 seats", "Not scheduled yet"
 *   - how it travels and "arrive by", editable
 *   - a meeting point without a pin: the business's city, marked approximate, until a real one
 *   - putting a tour on sale needs a price (said plainly)
 * Stage 16e-4c: the extras as a whole; the holds line and the balance's days.
 * Stage 16e-4b: the prices as a whole (added, changed, archived; all or nothing), whether they
 * include the tax, how many bookings keep the old price; a schedule change's booked departures
 * in words.
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';
import { taxLine } from '../src/routes/products.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

/** @param {string} token */
const as = (token) => ({
  get: (/** @type {string} */ url) =>
    request(ctx.app).get(url).set('Authorization', `Bearer ${token}`),
  post: (/** @type {string} */ url) =>
    request(ctx.app).post(url).set('Authorization', `Bearer ${token}`),
  patch: (/** @type {string} */ url) =>
    request(ctx.app).patch(url).set('Authorization', `Bearer ${token}`),
  put: (/** @type {string} */ url) =>
    request(ctx.app).put(url).set('Authorization', `Bearer ${token}`),
});

const NEW_TOUR = {
  title: 'Epe Fish Market Morning',
  summary: 'The lagoon’s fish market at first light.',
  description: 'Illustrative tour for tests.',
  durationMinutes: 240,
  defaultCapacity: 10,
  meetingPoint: { name: 'Epe jetty', address: 'Epe, Lagos' },
};

async function setup() {
  const s = await ctx.seedOperator();
  return {
    ...s,
    api: as(await ctx.tokenFor(s.owner.id)),
    managerApi: as(await ctx.tokenFor(s.manager.id)),
  };
}

describe('the tour list', () => {
  it('each tour’s schedule in words', async () => {
    const s = await setup();
    const res = await s.api.get('/api/products');
    const runs = Object.fromEntries(
      res.body.products.map((/** @type {any} */ p) => [p.slug, p.runs]),
    );
    expect(runs['lagos-island-heritage-walk']).toBe('Daily 09:00 · 15 seats');
    // A tour with no schedule yet.
    const made = await s.api.post('/api/products').send(NEW_TOUR);
    const again = await s.api.get('/api/products');
    expect(
      again.body.products.find((/** @type {any} */ p) => p.id === made.body.product.id).runs,
    ).toBe('Not scheduled yet');
    // A schedule's own seats win over the tour's; a switched-off schedule doesn't count.
    const p = made.body.product;
    const rule = await s.api.post(`/api/products/${p.id}/schedules`).send({
      startDate: '2027-01-01',
      daysOfWeek: [6],
      times: ['06:30'],
      capacity: 1,
    });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const third = await s.api.get('/api/products');
    expect(third.body.products.find((/** @type {any} */ x) => x.id === p.id).runs).toBe(
      'Saturdays 06:30 · 1 seat',
    );
    await s.api.patch(`/api/schedules/${rule.body.schedule.id}`).send({ isActive: false });
    const fourth = await s.api.get('/api/products');
    expect(fourth.body.products.find((/** @type {any} */ x) => x.id === p.id).runs).toBe(
      'Not scheduled yet',
    );
  });
});

describe('the basics', () => {
  it('a new tour without a pin gets the city’s, approximate; a real one replaces it', async () => {
    const s = await setup();
    const made = await s.api.post('/api/products').send(NEW_TOUR);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.product).toMatchObject({
      status: 'draft',
      transport: 'on_foot',
      arriveMinutesEarly: null,
      meetingPoint: { name: 'Epe jetty', lat: 6.4541, lng: 3.3947, approximate: true },
    });
    const id = made.body.product.id;
    // The real pin, pasted: no longer approximate.
    const pinned = await s.api.patch(`/api/products/${id}`).send({
      meetingPoint: { name: 'Epe jetty', address: 'Epe, Lagos', lat: 6.5841, lng: 3.9834 },
    });
    expect(pinned.body.product.meetingPoint).toEqual({
      name: 'Epe jetty',
      address: 'Epe, Lagos',
      lat: 6.5841,
      lng: 3.9834,
    });
    // A pin sent back with "approximate" from a client doesn't make a real one approximate.
    const kept = await s.api.patch(`/api/products/${id}`).send({
      meetingPoint: { ...pinned.body.product.meetingPoint, approximate: true },
    });
    expect(kept.body.product.meetingPoint.approximate).toBeUndefined();
  });

  it('a business in another city: that city’s pin', async () => {
    const s = await setup();
    await ctx.prisma.operator.update({ where: { id: s.operator.id }, data: { city: 'Abuja' } });
    const made = await s.api.post('/api/products').send(NEW_TOUR);
    expect(made.body.product.meetingPoint).toMatchObject({
      lat: 9.0579,
      lng: 7.4951,
      approximate: true,
    });
    // An unknown city (or none): Lagos's.
    await ctx.prisma.operator.update({ where: { id: s.operator.id }, data: { city: null } });
    const other = await s.api
      .post('/api/products')
      .send({ ...NEW_TOUR, title: 'Epe Fish Market Evening' });
    expect(other.body.product.meetingPoint).toMatchObject({ lat: 6.4541, lng: 3.3947 });
  });

  it('how it travels; arrive by; checked', async () => {
    const s = await setup();
    const made = await s.api.post('/api/products').send({ ...NEW_TOUR, transport: 'boat' });
    expect(made.body.product.transport).toBe('boat');
    const id = made.body.product.id;
    const res = await s.api
      .patch(`/api/products/${id}`)
      .send({ transport: 'van', arriveMinutesEarly: 15 });
    expect(res.body.product).toMatchObject({ transport: 'van', arriveMinutesEarly: 15 });
    expect((await s.api.patch(`/api/products/${id}`).send({ transport: 'bike' })).status).toBe(400);
    expect(
      (await s.api.patch(`/api/products/${id}`).send({ arriveMinutesEarly: 121 })).status,
    ).toBe(400);
    expect(
      (await s.api.patch(`/api/products/${id}`).send({ arriveMinutesEarly: null })).body.product
        .arriveMinutesEarly,
    ).toBeNull();
  });

  it('on sale needs a price, said plainly; a manager can only look', async () => {
    const s = await setup();
    const made = await s.api.post('/api/products').send(NEW_TOUR);
    const res = await s.api
      .patch(`/api/products/${made.body.product.id}`)
      .send({ status: 'published' });
    expect(res.body.error).toMatchObject({
      code: 'NOT_READY_TO_PUBLISH',
      // 19b-1: and 3 photos.
      message: 'Add at least one price and 3 photos before putting it on sale.',
    });
    expect((await s.managerApi.get('/api/products')).status).toBe(200);
    expect(
      (await s.managerApi.patch(`/api/products/${made.body.product.id}`).send({ title: 'X y' }))
        .status,
    ).toBe(403);
  });
});

/** A website booking on a tour's first departure after `afterDays` (held: a seat taken). */
async function aBooking(/** @type {any} */ s, /** @type {string} */ slug, afterDays = 2) {
  const product = await ctx.prisma.product.findFirstOrThrow({
    where: { operatorId: s.operator.id, slug },
  });
  const d = await ctx.prisma.departure.findFirstOrThrow({
    where: {
      productId: product.id,
      startsAt: { gt: new Date(Date.now() + afterDays * 86_400_000) },
    },
    orderBy: { startsAt: 'asc' },
  });
  const res = await request(ctx.app)
    .post(`/public/${s.operator.slug}/bookings`)
    .send({
      lead: {
        name: 'Funmi Adeyemi',
        email: 'funmi@guest.example',
        phone: '0805 987 6543',
        acceptTerms: true,
      },
      departureId: d.id,
      travellers: [{ name: 'Funmi Adeyemi', age: 30 }],
      addOns: [],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { product, departure: d };
}

describe('prices', () => {
  it('whether they include the tax, in words', () => {
    expect(taxLine({ name: 'VAT', basisPoints: 750, inclusive: true })).toBe(
      'Prices include 7.5% VAT.',
    );
    expect(taxLine({ name: 'VAT', basisPoints: 750, inclusive: false })).toBe(
      '7.5% VAT is added to these prices at checkout.',
    );
    expect(taxLine(null)).toBe('No tax is added to these prices.');
    expect(taxLine({ name: 'VAT', basisPoints: 0, inclusive: true })).toBe(
      'No tax is added to these prices.',
    );
  });

  it('a tour says how many bookings would keep the old price', async () => {
    const s = await setup();
    const { product } = await aBooking(s, 'lagos-island-heritage-walk');
    // Only held (a few minutes, not paid): not yet a booking that keeps a price.
    expect((await s.api.get(`/api/products/${product.id}`)).body.product.upcomingBookings).toBe(0);
    await ctx.prisma.booking.updateMany({
      where: { productId: product.id },
      data: { status: 'confirmed' },
    });
    const res = await s.api.get(`/api/products/${product.id}`);
    expect(res.body.product).toMatchObject({
      pricesNote: 'Prices include 7.5% VAT.',
      upcomingBookings: 1,
    });
    // A cancelled booking doesn't count.
    await ctx.prisma.booking.updateMany({
      where: { productId: product.id },
      data: { status: 'cancelled' },
    });
    expect((await s.api.get(`/api/products/${product.id}`)).body.product.upcomingBookings).toBe(0);
  });

  it('all at once: changed, added, left out (archived), in order', async () => {
    const s = await setup();
    const p = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: s.operator.id, slug: 'badagry-heritage-day-trip' },
      include: { priceCategories: { orderBy: { sortOrder: 'asc' } } },
    });
    const [adult, child, infant] = p.priceCategories;
    const res = await s.api.put(`/api/products/${p.id}/price-categories`).send({
      categories: [
        { id: adult.id, name: 'Adult', minAge: 13, maxAge: 64, amountKobo: 7_000_000 },
        { name: 'Senior (65+)', minAge: 65, maxAge: null, amountKobo: 5_000_000 },
        { id: child.id, name: 'Child', minAge: 3, maxAge: 12, amountKobo: 3_500_000 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      res.body.product.priceCategories.map((/** @type {any} */ c) => [
        c.key,
        c.amountKobo,
        c.isActive,
      ]),
    ).toEqual([
      ['adult', 7_000_000, true],
      ['senior-65', 5_000_000, true],
      ['child', 3_500_000, true],
      ['infant', 0, false],
    ]);
    // The infant price is archived, not deleted: bookings may point at it.
    expect(
      (await ctx.prisma.priceCategory.findUniqueOrThrow({ where: { id: infant.id } })).isActive,
    ).toBe(false);
    // Brought back by sending it again; another "Senior (65+)" gets its own key.
    const again = await s.api.put(`/api/products/${p.id}/price-categories`).send({
      categories: [
        { id: adult.id, name: 'Adult', minAge: 13, maxAge: 59, amountKobo: 7_000_000 },
        { name: 'Senior (65+)', minAge: 60, maxAge: null, amountKobo: 5_000_000 },
        { id: infant.id, name: 'Infant', minAge: 0, maxAge: 2, amountKobo: 0 },
      ],
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    const active = again.body.product.priceCategories.filter((/** @type {any} */ c) => c.isActive);
    expect(active.map((/** @type {any} */ c) => c.key)).toEqual(['adult', 'senior-65-2', 'infant']);
  });

  it('refused as a whole: two prices for the same age; on sale with none; someone else’s price', async () => {
    const s = await setup();
    const p = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: s.operator.id, slug: 'badagry-heritage-day-trip' },
      include: { priceCategories: { orderBy: { sortOrder: 'asc' } } },
    });
    const [adult, child] = p.priceCategories;
    const overlap = await s.api.put(`/api/products/${p.id}/price-categories`).send({
      categories: [
        { id: adult.id, name: 'Adult', minAge: 10, maxAge: null, amountKobo: 1 },
        { id: child.id, name: 'Child', minAge: 3, maxAge: 12, amountKobo: 1 },
      ],
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('AGE_RANGE_OVERLAP');
    // Nothing changed.
    expect(
      (await ctx.prisma.priceCategory.findUniqueOrThrow({ where: { id: adult.id } })).amountKobo,
    ).toBe(6_500_000);
    const none = await s.api.put(`/api/products/${p.id}/price-categories`).send({ categories: [] });
    expect(none.body.error.code).toBe('NOT_READY_TO_PUBLISH');
    const other = await ctx.seedOperator();
    const theirs = await ctx.prisma.priceCategory.findFirstOrThrow({
      where: { operatorId: other.operator.id },
    });
    const stolen = await s.api.put(`/api/products/${p.id}/price-categories`).send({
      categories: [{ id: theirs.id, name: 'X', minAge: 0, maxAge: null, amountKobo: 1 }],
    });
    expect(stolen.status).toBe(404);
    expect(
      (await s.managerApi.put(`/api/products/${p.id}/price-categories`).send({ categories: [] }))
        .status,
    ).toBe(403);
  });
});

describe('the schedule', () => {
  it('a change that leaves booked departures says which, in words', async () => {
    const s = await setup();
    const { product, departure } = await aBooking(s, 'badagry-heritage-day-trip');
    const rule = await ctx.prisma.schedule.findFirstOrThrow({ where: { productId: product.id } });
    // Sundays instead of Saturdays: the booked Saturday stays, for a person to decide.
    const res = await s.api.patch(`/api/schedules/${rule.id}`).send({ daysOfWeek: [0] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.sync.created).toBeGreaterThan(0);
    expect(res.body.sync.removed).toBeGreaterThan(0);
    expect(res.body.sync.attention).toEqual([
      {
        id: departure.id,
        text: expect.stringMatching(
          /^Sat \d{1,2} \w{3}, 07:00 · 1 guest · no longer in the schedule$/,
        ),
      },
    ]);
    // Fewer seats than are booked: said too.
    await s.api.patch(`/api/schedules/${rule.id}`).send({ daysOfWeek: [6] });
    const d2 = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: product.id, startsAt: { gt: new Date(Date.now() + 9 * 86_400_000) } },
      orderBy: { startsAt: 'asc' },
    });
    await ctx.prisma.departure.update({ where: { id: d2.id }, data: { seatsSold: 3 } });
    const tight = await s.api.patch(`/api/schedules/${rule.id}`).send({ capacity: 2 });
    expect(tight.body.sync.attention.map((/** @type {any} */ a) => a.text)).toContainEqual(
      expect.stringMatching(/ · 3 guests · more guests than the new seats$/),
    );
  });
});

describe('extras (16e-4c)', () => {
  it('all at once: changed, added, left out (archived after the active ones)', async () => {
    const s = await setup();
    const p = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: s.operator.id, slug: 'lagos-street-food-crawl' },
      include: { addOns: { orderBy: { sortOrder: 'asc' } } },
    });
    const [plate, wine] = p.addOns;
    const res = await s.api.put(`/api/products/${p.id}/add-ons`).send({
      addOns: [
        { name: 'Lunch', priceKobo: 800_000, stockPerDeparture: null },
        {
          id: wine.id,
          name: 'Palm wine',
          description: 'Fresh',
          priceKobo: 300_000,
          stockPerDeparture: 6,
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      res.body.product.addOns.map((/** @type {any} */ a) => [
        a.name,
        a.priceKobo,
        a.stockPerDeparture,
        a.isActive,
      ]),
    ).toEqual([
      ['Lunch', 800_000, null, true],
      ['Palm wine', 300_000, 6, true],
      [plate.name, plate.priceKobo, plate.stockPerDeparture, false],
    ]);
    const other = await ctx.seedOperator();
    const theirs = await ctx.prisma.addOn.findFirstOrThrow({
      where: { operatorId: other.operator.id },
    });
    const stolen = await s.api.put(`/api/products/${p.id}/add-ons`).send({
      addOns: [{ id: theirs.id, name: 'X', priceKobo: 1, stockPerDeparture: null }],
    });
    expect(stolen.status).toBe(404);
    expect(
      (await s.managerApi.put(`/api/products/${p.id}/add-ons`).send({ addOns: [] })).status,
    ).toBe(403);
  });

  it('a tour says how long seats are held, and when balances are due', async () => {
    const s = await setup();
    const p = await ctx.prisma.product.findFirstOrThrow({ where: { operatorId: s.operator.id } });
    const res = await s.api.get(`/api/products/${p.id}`);
    expect(res.body.product).toMatchObject({
      balanceDueDays: 7,
      holdsLine:
        'Seats are held 15 minutes on the website and 30 minutes on WhatsApp, for every tour.',
    });
    // The website's comes from the business's own setting.
    await ctx.prisma.operator.update({ where: { id: s.operator.id }, data: { holdMinutes: 20 } });
    expect((await s.api.get(`/api/products/${p.id}`)).body.product.holdsLine).toMatch(
      /^Seats are held 20 minutes on the website/,
    );
  });
});
