/**
 * Stage 16e-4a: what Settings › Tours needs from the server for the list and the basics.
 *   - each tour's schedule in words: "Daily 09:00 · 15 seats", "Not scheduled yet"
 *   - how it travels and "arrive by", editable
 *   - a meeting point without a pin: the business's city, marked approximate, until a real one
 *   - putting a tour on sale needs a price (said plainly)
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';

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
      message: 'Add at least one price before putting it on sale.',
    });
    expect((await s.managerApi.get('/api/products')).status).toBe(200);
    expect(
      (await s.managerApi.patch(`/api/products/${made.body.product.id}`).send({ title: 'X y' }))
        .status,
    ).toBe(403);
  });
});
