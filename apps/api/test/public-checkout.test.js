/**
 * The public checkout (stage 11b): quote → hold + book → review → release, as a guest.
 *
 * Also the two booking rules decided on 2026-11-17, which apply on EVERY channel:
 *   - children and infants need an adult (anyone in the tour's adult category, 13+ at Ìrìn)
 *   - tours with pickup points need one chosen, and it's stored on the booking
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { addDays, localDate } from '@okapigo/shared/time';
import { createTestContext, buildApp } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

const api = () => request(ctx.app);
const lead = { name: 'Adaeze Okafor', phone: '0803 123 4567', acceptTerms: true };
const adult = (name = 'Adaeze Okafor', age = 34) => ({ name, age });

/** Seeds an operator; returns it and a helper that finds a tour's next departure id. */
async function setup() {
  const seeded = await ctx.seedOperator();
  const slug = seeded.operator.slug;
  /** @param {string} tourSlug */
  const nextDeparture = async (tourSlug) => {
    const today = localDate(new Date(), 'Africa/Lagos');
    const res = await api().get(
      `/public/${slug}/tours/${tourSlug}/departures?to=${addDays(today, 27)}`,
    );
    return res.body.departures[0].id;
  };
  /** @param {object} body */
  const book = (body) =>
    api()
      .post(`/public/${slug}/bookings`)
      .send({ lead, addOns: [], ...body });
  return { ...seeded, slug, nextDeparture, book };
}

describe('POST /public/:operatorSlug/tours/:tourSlug/quote', () => {
  it('prices the counters (2 adults, 1 child, 1 infant = ₦62,500 incl. VAT)', async () => {
    const { slug } = await setup();

    const res = await api()
      .post(`/public/${slug}/tours/lagos-island-heritage-walk/quote`)
      .send({
        travellers: [
          { categoryKey: 'adult' },
          { categoryKey: 'adult' },
          { categoryKey: 'child' },
          { categoryKey: 'infant' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.quote.totalKobo).toBe(6_250_000);
    expect(res.body.blocker).toBeNull();
    expect(res.body.availability).toBeNull(); // no date chosen
  });

  it('still prices a child-only basket, but says it cannot be booked yet', async () => {
    const { slug } = await setup();

    const res = await api()
      .post(`/public/${slug}/tours/lagos-island-heritage-walk/quote`)
      .send({ travellers: [{ categoryKey: 'child' }] });

    expect(res.status).toBe(200);
    expect(res.body.quote.totalKobo).toBe(1_250_000);
    expect(res.body.blocker).toEqual({
      code: 'ADULT_REQUIRED',
      message: 'Children must travel with an adult. Add at least one adult (13 or over).',
    });
  });

  it('with a date, reports seats and add-on stock left on it', async () => {
    const { slug, nextDeparture, book } = await setup();
    const departureId = await nextDeparture('lagos-street-food-crawl');
    const tour = (await api().get(`/public/${slug}/tours/lagos-street-food-crawl`)).body.tour;
    const plate = tour.addOns.find((a) => a.name.includes('tasting plate'));
    // Someone else books 2 seats and 3 plates on that night.
    await book({
      departureId,
      travellers: [adult(), adult('Tunde Bakare', 40)],
      addOns: [{ addOnId: plate.id, quantity: 3 }],
    });

    const res = await api()
      .post(`/public/${slug}/tours/lagos-street-food-crawl/quote`)
      .send({ departureId, travellers: [{ categoryKey: 'adult' }] });

    expect(res.body.availability.seatsAvailable).toBe(8);
    expect(res.body.availability.addOns).toContainEqual({ id: plate.id, left: 7 });
  });
});

describe('POST /public/:operatorSlug/bookings', () => {
  it('holds the seats, creates a "web" booking and returns a guest link token', async () => {
    const { slug, operator, nextDeparture, book } = await setup();
    const departureId = await nextDeparture('lagos-island-heritage-walk');

    const res = await book({
      departureId,
      travellers: [
        { ...adult(), categoryKey: 'adult' },
        { name: 'Chidi Okafor', age: 7, categoryKey: 'child' },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{44}$/);
    const { booking } = res.body;
    expect(booking).toMatchObject({
      status: 'held',
      operator: { slug, name: 'Ìrìn Lagos Tours' },
      tour: { slug: 'lagos-island-heritage-walk' },
      departure: { localTime: '09:00' },
      totalKobo: 3_750_000,
      balanceKobo: 3_750_000,
      pickupPoint: null,
    });
    expect(booking.reference).toMatch(/^[A-Z]+-[A-Z0-9]{6}$/); // ILT-… for Ìrìn; T-… for test operators
    expect(new Date(booking.holdExpiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    // Guest view: nothing internal.
    for (const field of ['id', 'notes', 'timeline', 'channel', 'holdId']) {
      expect(booking).not.toHaveProperty(field);
    }

    const row = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id, reference: booking.reference },
      include: { events: true, departure: true },
    });
    expect(row.channel).toBe('web');
    expect(row.events[0]).toMatchObject({ type: 'created', actorType: 'guest' });
    expect(row.departure.seatsHeld).toBe(2);
    expect(ctx.jobs.scheduled.some((j) => j.holdId === row.holdId)).toBe(true);
  });

  it('refuses children without an adult, and holds nothing', async () => {
    const { nextDeparture, book } = await setup();
    const departureId = await nextDeparture('lagos-island-heritage-walk');

    const res = await book({
      departureId,
      travellers: [
        { name: 'Chidi Okafor', age: 7 },
        { name: 'Ada Okafor', age: 1 },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ADULT_REQUIRED');
    const departure = await ctx.prisma.departure.findUniqueOrThrow({ where: { id: departureId } });
    expect(departure.seatsHeld).toBe(0);
  });

  it('accepts a 13-year-old as the adult (the tour says adults are 13+)', async () => {
    const { nextDeparture, book } = await setup();
    const departureId = await nextDeparture('lagos-island-heritage-walk');

    const res = await book({
      departureId,
      travellers: [
        { name: 'Kemi Bello', age: 13 },
        { name: 'Tobi Bello', age: 8 },
      ],
    });

    expect(res.status).toBe(201);
  });

  it("refuses an age that doesn't match the counter it came from", async () => {
    const { nextDeparture, book } = await setup();
    const departureId = await nextDeparture('lagos-island-heritage-walk');

    const res = await book({
      departureId,
      travellers: [adult(), { name: 'Kemi Bello', age: 13, categoryKey: 'child' }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'AGE_CATEGORY_MISMATCH',
      message: 'For age 13, choose Adult (13+), not Child (3–12).',
    });
  });

  it('needs a pickup point on Lekki, and stores a copy of the one chosen', async () => {
    const { operator, nextDeparture, book } = await setup();
    const departureId = await nextDeparture('lekki-nature-and-craft');

    const missing = await book({ departureId, travellers: [adult()] });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('PICKUP_POINT_REQUIRED');
    expect(missing.body.error.pickupPoints).toEqual(['Victoria Island', 'Ikoyi', 'Lekki Phase 1']);

    const wrong = await book({ departureId, travellers: [adult()], pickupPoint: 'Ikeja' });
    expect(wrong.body.error.code).toBe('UNKNOWN_PICKUP_POINT');

    const ok = await book({ departureId, travellers: [adult()], pickupPoint: 'Ikoyi' });
    expect(ok.status).toBe(201);
    const expected = { name: 'Ikoyi', address: 'Falomo roundabout', time: '07:30' };
    expect(ok.body.booking.pickupPoint).toEqual(expected);

    // A copy: renaming the pickup point later doesn't move this guest.
    await ctx.prisma.product.updateMany({
      where: { operatorId: operator.id, slug: 'lekki-nature-and-craft' },
      data: { pickupPoints: [{ name: 'Ikoyi Link Bridge', address: 'Somewhere new' }] },
    });
    const again = await api().get(`/public/bookings/${ok.body.token}`);
    expect(again.body.booking.pickupPoint).toEqual(expected);
  });

  it('refuses a pickup point on a tour without pickup', async () => {
    const { nextDeparture, book } = await setup();
    const departureId = await nextDeparture('lagos-island-heritage-walk');

    const res = await book({ departureId, travellers: [adult()], pickupPoint: 'Ikoyi' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_PICKUP_POINT');
  });

  it('says how many seats are left when there are too few', async () => {
    const { nextDeparture, book } = await setup();
    const departureId = await nextDeparture('lagos-street-food-crawl');
    await ctx.prisma.departure.update({ where: { id: departureId }, data: { seatsSold: 9 } });

    const res = await book({ departureId, travellers: [adult(), adult('Tunde Bakare', 40)] });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'SOLD_OUT', message: 'Only 1 seats left.' });
  });

  it("can't book a draft tour, or another operator's departure", async () => {
    const a = await setup();
    const b = await setup();
    const draftDeparture = await a.nextDeparture('badagry-heritage-day-trip');
    await ctx.prisma.product.updateMany({
      where: { operatorId: a.operator.id, slug: 'badagry-heritage-day-trip' },
      data: { status: 'draft' },
    });
    const othersDeparture = await b.nextDeparture('lagos-island-heritage-walk');

    const draft = await a.book({ departureId: draftDeparture, travellers: [adult()] });
    const others = await a.book({ departureId: othersDeparture, travellers: [adult()] });

    expect([draft.status, others.status]).toEqual([404, 404]);
  });

  it('validates the lead booker (terms must be accepted)', async () => {
    const { nextDeparture, book } = await setup();
    const departureId = await nextDeparture('lagos-island-heritage-walk');

    const res = await book({
      departureId,
      lead: { name: 'Adaeze', phone: '0803 123 4567' },
      travellers: [adult()],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.issues[0].path).toBe('lead.acceptTerms');
  });
});

describe('the same rules on the staff channel', () => {
  it('staff bookings also need an adult and a pickup point', async () => {
    const { owner, nextDeparture } = await setup();
    const staff = request(ctx.app);
    const token = await ctx.tokenFor(owner.id);
    const post = (body) =>
      staff
        .post('/api/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send({ lead, addOns: [], ...body });

    const childOnly = await post({
      departureId: await nextDeparture('lagos-island-heritage-walk'),
      travellers: [{ name: 'Chidi Okafor', age: 7 }],
    });
    const noPickup = await post({
      departureId: await nextDeparture('lekki-nature-and-craft'),
      travellers: [adult()],
    });

    expect(childOnly.body.error.code).toBe('ADULT_REQUIRED');
    expect(noPickup.body.error.code).toBe('PICKUP_POINT_REQUIRED');
  });
});

describe('GET /public/bookings/:token and POST …/release', () => {
  it('shows the booking to whoever has the link, and nobody else', async () => {
    const { nextDeparture, book } = await setup();
    const created = await book({
      departureId: await nextDeparture('lagos-island-heritage-walk'),
      travellers: [adult()],
    });
    const { token } = created.body;

    const mine = await api().get(`/public/bookings/${token}`);
    expect(mine.status).toBe(200);
    expect(mine.headers['cache-control']).toBe('private, no-store');
    expect(mine.body.booking.reference).toBe(created.body.booking.reference);

    // One character changed: a forged link looks exactly like a missing booking.
    const forged = token.slice(0, 30) + (token[30] === 'A' ? 'B' : 'A') + token.slice(31);
    const res = await api().get(`/public/bookings/${forged}`);
    expect(res.status).toBe(404);
    expect((await api().get('/public/bookings/not-a-token')).status).toBe(404);
  });

  it('releasing gives the seats back and cancels the held booking, once', async () => {
    const { nextDeparture, book } = await setup();
    const departureId = await nextDeparture('lagos-island-heritage-walk');
    const { token } = (await book({ departureId, travellers: [adult()] })).body;

    const first = await api().post(`/public/bookings/${token}/release`);
    const second = await api().post(`/public/bookings/${token}/release`);

    expect(first.status).toBe(204);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('NOT_HELD');
    const view = await api().get(`/public/bookings/${token}`);
    expect(view.body.booking).toMatchObject({ status: 'cancelled', holdExpiresAt: null });
    const departure = await ctx.prisma.departure.findUniqueOrThrow({ where: { id: departureId } });
    expect(departure.seatsHeld).toBe(0);
  });
});

describe('rate limits', () => {
  it('answers 429 with Retry-After once an IP makes too many bookings', async () => {
    const { slug, nextDeparture } = await setup();
    const departureId = await nextDeparture('lagos-island-heritage-walk');
    const app = buildApp({
      prisma: ctx.prisma,
      jobs: ctx.jobs,
      publicLimits: {
        quote: { limit: 100, windowSeconds: 60 },
        booking: { limit: 2, windowSeconds: 600 },
        guest: { limit: 100, windowSeconds: 60 },
      },
    });
    const attempt = () =>
      request(app)
        .post(`/public/${slug}/bookings`)
        .send({ lead, departureId, travellers: [adult()], addOns: [] });

    const results = [await attempt(), await attempt(), await attempt()];

    expect(results.map((r) => r.status)).toEqual([201, 201, 429]);
    expect(results[2].body.error.code).toBe('RATE_LIMITED');
    expect(Number(results[2].headers['retry-after'])).toBeGreaterThan(0);
    expect(results[1].headers['ratelimit-remaining']).toBe('0');
  });

  it('lets requests through if the counter store is down (fail open)', async () => {
    const { slug } = await setup();
    const app = buildApp({
      prisma: ctx.prisma,
      rateLimitStore: {
        hit: async () => {
          throw new Error('redis down');
        },
      },
    });

    const res = await request(app)
      .post(`/public/${slug}/tours/lagos-island-heritage-walk/quote`)
      .send({ travellers: [{ categoryKey: 'adult' }] });

    expect(res.status).toBe(200);
  });
});
