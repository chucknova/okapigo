/**
 * Stage 16b: the schedule (O6) and a departure's page (O7), and the rules decided with them:
 *   - a week, Monday first: seats sold of what it can sell, guide, van or boat, tags
 *   - a departure: its numbers, who's booked, the guide's notes, what cancelling means
 *   - who can take it: guides free or busy (and where), vans and boats free, busy, too small or
 *     the wrong kind, each saying why
 *   - once a van is assigned, sales stop at its seats (decided 2026-11-20)
 *   - cancelling for weather refunds everyone (refunds started) and keeps the reason
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { bookingIdFromGuestToken } from '@okapigo/db';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const HOUR = 3_600_000;
/** @param {string} token */
const as = (token) => ({
  get: (/** @type {string} */ url) =>
    request(ctx.app).get(url).set('Authorization', `Bearer ${token}`),
  post: (/** @type {string} */ url) =>
    request(ctx.app).post(url).set('Authorization', `Bearer ${token}`),
  put: (/** @type {string} */ url) =>
    request(ctx.app).put(url).set('Authorization', `Bearer ${token}`),
});

async function setup() {
  const seeded = await ctx.seedOperator();
  const { operator } = seeded;
  const manager = as(await ctx.tokenFor(seeded.manager.id));
  const guide = (/** @type {string} */ n) =>
    seeded.guides.find((/** @type {any} */ g) => g.name === n);
  const asKemi = as(await ctx.tokenFor(guide('Kemi Adeyemi').id));
  const resource = (/** @type {string} */ name) =>
    ctx.prisma.resource.findFirstOrThrow({ where: { operatorId: operator.id, name } });
  /** The first Saturday at least two days away, and its departures by tour. */
  const saturday = async () => {
    const badagryProduct = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug: 'badagry-heritage-day-trip' },
    });
    const badagry = (
      await ctx.prisma.departure.findMany({
        where: {
          productId: badagryProduct.id,
          startsAt: { gt: new Date(Date.now() + 2 * 86_400_000) },
        },
        orderBy: { startsAt: 'asc' },
        take: 20,
      })
    ).find((d) => new Date(d.startsAt.getTime() + HOUR).getUTCDay() === 6);
    const on = async (/** @type {string} */ slug, /** @type {number} */ hoursAfter) => {
      const p = await ctx.prisma.product.findFirstOrThrow({
        where: { operatorId: operator.id, slug },
      });
      return ctx.prisma.departure.findFirstOrThrow({
        where: {
          productId: p.id,
          startsAt: new Date(/** @type {any} */ (badagry).startsAt.getTime() + hoursAfter * HOUR),
        },
      });
    };
    return {
      badagry: /** @type {any} */ (badagry),
      lekki: await on('lekki-nature-and-craft', 1),
      walk: await on('lagos-island-heritage-walk', 2),
      tarkwa: await on('tarkwa-bay-beach-and-lagoon', 3),
    };
  };
  /** A paid website booking; returns its id. */
  const book = async (
    /** @type {any} */ d,
    name = 'Bisi Lawal',
    travellers = [{ name, age: 34 }],
  ) => {
    const res = await request(ctx.app)
      .post(`/public/${operator.slug}/bookings`)
      .send({
        lead: {
          name,
          email: `${name.split(' ')[0].toLowerCase()}@guest.example`,
          phone: '0803 123 4567',
          acceptTerms: true,
        },
        departureId: d.id,
        travellers,
        addOns: [],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { token } = res.body;
    const { reference } = (
      await request(ctx.app).post(`/public/bookings/${token}/pay`).send({ option: 'full' })
    ).body.payment;
    await ctx.provider.complete(reference);
    await request(ctx.app).post(`/public/bookings/${token}/payments/${reference}/check`);
    return /** @type {string} */ (bookingIdFromGuestToken(TEST_AUTH_SECRET, token));
  };
  return { ...seeded, manager, asKemi, guide, resource, saturday, book };
}

describe('the schedule (O6)', () => {
  it('a week, Monday first: seats of what it can sell, guide, vehicle, tags; tours to filter by', async () => {
    const s = await setup();
    const sat = await s.saturday();
    await s.book(sat.tarkwa, 'Bisi Lawal', [
      { name: 'Bisi Lawal', age: 40 },
      { name: 'Tayo Lawal', age: 10 },
    ]);
    const van1 = await s.resource('Van 1');
    await s.manager
      .put(`/api/departures/${sat.badagry.id}/assignment`)
      .send({ guideId: s.guide('Femi Ogunleye').id, resourceId: van1.id });

    const res = await s.manager.get(
      `/api/schedule/week?start=${sat.badagry.startsAt.toISOString().slice(0, 10)}`,
    );
    expect(res.status).toBe(200);
    const w = res.body.week;
    expect(w.days.map((/** @type {any} */ d) => d.dow)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    expect(w.label).toMatch(/^Mon \d+ \w{3} – Sun \d+ \w{3}$/);
    const saturdayCards = w.days[5].cards;
    const card = (/** @type {string} */ id) =>
      saturdayCards.find((/** @type {any} */ c) => c.id === id);
    expect(card(sat.badagry.id)).toMatchObject({
      time: '07:00',
      guide: 'Femi',
      vehicle: 'Van 1 · 14',
      seats: 14,
      tag: null,
    });
    expect(card(sat.tarkwa.id)).toMatchObject({
      sold: 2,
      guide: null,
      needsGuide: true,
      tag: 'NEEDS GUIDE',
    });
    expect(card(sat.walk.id)).toMatchObject({ vehicle: 'On foot', needsGuide: false });
    expect(w.days[5].flag).toBe(true);
    expect(w.withoutGuide).toBe(1);
    expect(w.tours.map((/** @type {any} */ t) => t.name)).toContain('Tarkwa Bay Beach Day');
    // The weeks either side, and this week, to move between them.
    expect(w.previous < w.start && w.start < w.next).toBe(true);
  });

  it('for the office only', async () => {
    const s = await setup();
    expect((await s.asKemi.get('/api/schedule/week')).status).toBe(403);
  });
});

describe('a departure (O7)', () => {
  it('its numbers, who’s booked, the notes, and what cancelling means', async () => {
    const s = await setup();
    const sat = await s.saturday();
    await s.book(sat.tarkwa, 'Bisi Lawal', [
      { name: 'Bisi Lawal', age: 40 },
      { name: 'Femi Lawal', age: 42 },
      { name: 'Tayo Lawal', age: 10, dietaryNeeds: 'Vegetarian' },
    ]);
    await s.manager
      .put(`/api/departures/${sat.tarkwa.id}/assignment`)
      .send({ notes: 'Skipper: Bode. Boat leaves 10:15 sharp.' });
    const d = (await s.manager.get(`/api/departures/${sat.tarkwa.id}/overview`)).body.departure;
    expect(d).toMatchObject({
      title: 'Tarkwa Bay Beach and Lagoon Trip',
      transport: 'boat',
      when: expect.stringMatching(/^Sat \d+ \w{3} · 10:00–\d\d:\d\d$/),
      notes: 'Skipper: Bode. Boat leaves 10:15 sharp.',
      guide: null,
      numbers: { booked: 3, held: 0, left: expect.any(Number), seats: expect.any(Number) },
    });
    expect(d.rows).toEqual([
      expect.objectContaining({
        lead: 'Bisi Lawal',
        people: '2 adults, 1 child',
        extras: 'Vegetarian',
        pay: 'Paid',
      }),
    ]);
    expect(d.extrasLine).toBe('Dietary: 1 vegetarian');
    expect(d.cancel).toMatchObject({ bookings: 1, guests: 3, refundKobo: expect.any(Number) });
    expect(d.cancel.refundKobo).toBeGreaterThan(0);
  });

  it('who can take it: free first; busy says where; vans and boats say why not', async () => {
    const s = await setup();
    const sat = await s.saturday();
    // Femi on the Badagry trip (07:00–17:00) with Van 1; Van 2 on Lekki (08:00–13:00).
    await s.manager
      .put(`/api/departures/${sat.badagry.id}/assignment`)
      .send({ guideId: s.guide('Femi Ogunleye').id, resourceId: (await s.resource('Van 1')).id });
    await s.manager
      .put(`/api/departures/${sat.lekki.id}/assignment`)
      .send({ resourceId: (await s.resource('Van 2')).id });

    const o = (await s.manager.get(`/api/departures/${sat.tarkwa.id}/options`)).body.options;
    expect(o.title).toMatch(/^Tarkwa Bay Beach Day, 10:00–\d\d:\d\d$/);
    const femi = o.guides.find((/** @type {any} */ g) => g.name === 'Femi');
    expect(femi).toMatchObject({
      state: 'busy',
      why: 'Busy: on the Badagry Day Trip until 17:00',
    });
    expect(o.guides[0].state).toBe('free');
    expect(o.guides[0].why).toMatch(/^Free 10:00–\d\d:\d\d/);
    // Tarkwa goes by boat: the boat is free; the vans aren't for boat trips.
    expect(o.resources.map((/** @type {any} */ r) => [r.name, r.state, r.why])).toEqual([
      ['Boat', 'free', 'Free · fits 0'],
      ['Van 1', 'wrong', 'not for boat trips'],
      ['Van 2', 'wrong', 'not for boat trips'],
    ]);

    // Lekki by van: Van 1 busy on Badagry; with 12 booked, a 10-seat Van 3 is too small.
    await ctx.prisma.resource.create({
      data: { operatorId: s.operator.id, kind: 'van', name: 'Van 3', seats: 10 },
    });
    await ctx.prisma.departure.update({ where: { id: sat.lekki.id }, data: { seatsSold: 12 } });
    const lekki = (await s.manager.get(`/api/departures/${sat.lekki.id}/options`)).body.options;
    const r = Object.fromEntries(lekki.resources.map((/** @type {any} */ x) => [x.name, x]));
    expect(r['Van 2']).toMatchObject({ state: 'assigned', why: 'Assigned · 12 booked fit' });
    expect(r['Van 1']).toMatchObject({
      state: 'busy',
      why: 'Busy: on the Badagry Day Trip until 17:00',
    });
    expect(r['Van 3']).toMatchObject({
      state: 'small',
      why: 'Too small: 12 are booked. Choose a bigger one, or move 2 guests to another date first.',
    });
    expect(r.Boat).toMatchObject({ state: 'wrong', why: 'not for road trips' });

    // A walk is on foot: no vehicles to choose.
    expect(
      (await s.manager.get(`/api/departures/${sat.walk.id}/options`)).body.options.resources,
    ).toEqual([]);
  });

  it('once a van is assigned, sales stop at its seats', async () => {
    const s = await setup();
    const sat = await s.saturday();
    const small = await ctx.prisma.resource.create({
      data: { operatorId: s.operator.id, kind: 'van', name: 'Minivan', seats: 2 },
    });
    await s.manager
      .put(`/api/departures/${sat.badagry.id}/assignment`)
      .send({ resourceId: small.id });
    await s.book(sat.badagry, 'Bisi Lawal', [
      { name: 'Bisi Lawal', age: 40 },
      { name: 'Femi Lawal', age: 42 },
    ]);
    const full = await request(ctx.app)
      .post(`/public/${s.operator.slug}/bookings`)
      .send({
        lead: {
          name: 'Ade Coker',
          email: 'ade@guest.example',
          phone: '0803 123 4567',
          acceptTerms: true,
        },
        departureId: sat.badagry.id,
        travellers: [{ name: 'Ade Coker', age: 30 }],
        addOns: [],
      });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('SOLD_OUT');
    // The guest's dates say so too.
    const dates = (
      await request(ctx.app).get(
        `/public/${s.operator.slug}/tours/badagry-heritage-day-trip/departures`,
      )
    ).body.departures;
    expect(dates.find((/** @type {any} */ x) => x.id === sat.badagry.id)).toMatchObject({
      seatsAvailable: 0,
      soldOut: true,
    });
  });

  it('seats held right now count: fewer to sell, and full when sold and held fill it', async () => {
    const s = await setup();
    const sat = await s.saturday();
    const small = await ctx.prisma.resource.create({
      data: { operatorId: s.operator.id, kind: 'van', name: 'Minivan', seats: 3 },
    });
    await s.manager
      .put(`/api/departures/${sat.badagry.id}/assignment`)
      .send({ resourceId: small.id });
    const seen = async () => {
      const dates = (
        await request(ctx.app).get(
          `/public/${s.operator.slug}/tours/badagry-heritage-day-trip/departures`,
        )
      ).body.departures;
      const week = (
        await s.manager.get(
          `/api/schedule/week?start=${sat.badagry.startsAt.toISOString().slice(0, 10)}`,
        )
      ).body.week;
      return {
        left: dates.find((/** @type {any} */ x) => x.id === sat.badagry.id).seatsAvailable,
        card: week.days[5].cards.find((/** @type {any} */ c) => c.id === sat.badagry.id),
      };
    };
    // Someone at checkout holds 2 of the 3 seats; one is sold: none left, and the card is full.
    await ctx.prisma.departure.update({
      where: { id: sat.badagry.id },
      data: { seatsHeld: 1 },
    });
    expect((await seen()).left).toBe(2);
    await ctx.prisma.departure.update({
      where: { id: sat.badagry.id },
      data: { seatsSold: 1, seatsHeld: 2 },
    });
    const now = await seen();
    expect(now.left).toBe(0);
    expect(now.card).toMatchObject({ full: true, tag: 'SOLD OUT', sold: 1, seats: 3 });
  });

  it('cancelling for weather: everyone refunded (refunds started), the reason kept and told', async () => {
    const s = await setup();
    const sat = await s.saturday();
    await s.book(sat.tarkwa, 'Bisi Lawal');
    await s.book(sat.tarkwa, 'Chuka Obi');
    // A booking never paid: cancelled too, but nothing to refund (and no refund tried).
    const unpaid = await request(ctx.app)
      .post(`/public/${s.operator.slug}/bookings`)
      .send({
        lead: {
          name: 'Ade Coker',
          email: 'ade@guest.example',
          phone: '0803 123 4567',
          acceptTerms: true,
        },
        departureId: sat.tarkwa.id,
        travellers: [{ name: 'Ade Coker', age: 30 }],
        addOns: [],
      });
    expect(unpaid.status).toBe(201);
    const res = await s.manager
      .post(`/api/departures/${sat.tarkwa.id}/cancel`)
      .send({ reason: 'the weather on the lagoon' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ refundsStarted: 2, refundsFailed: 0 });
    expect(
      await ctx.prisma.refund.count({ where: { booking: { departureId: sat.tarkwa.id } } }),
    ).toBe(2);
    const d = await ctx.prisma.departure.findUniqueOrThrow({ where: { id: sat.tarkwa.id } });
    expect(d).toMatchObject({ status: 'cancelled', cancelReason: 'the weather on the lagoon' });
    const week = (
      await s.manager.get(`/api/schedule/week?start=${d.startsAt.toISOString().slice(0, 10)}`)
    ).body.week;
    const card = week.days
      .flatMap((/** @type {any} */ x) => x.cards)
      .find((/** @type {any} */ c) => c.id === d.id);
    expect(card).toMatchObject({
      tag: 'CANCELLED',
      cancelReason: 'the weather on the lagoon',
      needsGuide: false,
    });
  });
});
