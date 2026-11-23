/**
 * The public catalogue (BKG-32 read side): what any browser can see without signing in.
 *
 * The things that matter most here are what must NOT be visible: draft tours, archived
 * prices, sold/held counts, and anything belonging to another operator.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { addDays, localDate } from '@okapigo/shared/time';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

const get = (url) => request(ctx.app).get(url);
const today = () => localDate(new Date(), 'Africa/Lagos');

describe('GET /public/:operatorSlug (tour cards)', () => {
  it('lists published tours with a "from" price and the next date with seats', async () => {
    const { operator } = await ctx.seedOperator();

    const res = await get(`/public/${operator.slug}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.body.operator).toEqual({
      slug: operator.slug,
      name: 'Ìrìn Lagos Tours',
      city: 'Lagos',
      currency: 'NGN',
      timeZone: 'Africa/Lagos',
      websiteStyle: 'lagoon', // the default since stage 12g (was "classic" before anyone chose)
      websiteMode: 'auto',
      pricesInclude: 'VAT', // "prices include VAT" (Ìrìn's prices include 7.5% VAT)
      logo: null, // none uploaded: the first letter (19b-1)
    });
    expect(res.body.tours).toHaveLength(5);

    const walk = res.body.tours.find((t) => t.slug === 'lagos-island-heritage-walk');
    // ₦25,000 (the adult price), not ₦12,500 (child) or ₦0 (infant).
    expect(walk.fromPriceKobo).toBe(2_500_000);
    expect(walk.nextDeparture).toMatchObject({ localTime: '09:00', seatsAvailable: 15 });
    // Stage 12b: what the cards show besides the price.
    expect(walk).toMatchObject({
      activityLabel: 'Walking',
      scheduleSummary: 'Daily 09:00',
      cancellationHeadline: 'Free cancellation up to 48 hours before',
    });
    const food = res.body.tours.find((t) => t.slug === 'lagos-street-food-crawl');
    expect(food.scheduleSummary).toBe('Thu–Sat 18:30');
    // The walk runs daily, so its next date is today or tomorrow.
    expect([today(), addDays(today(), 1)]).toContain(walk.nextDeparture.localDate);
  });

  it('skips a sold-out departure when picking the next date', async () => {
    const { operator } = await ctx.seedOperator();
    const product = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug: 'lagos-island-heritage-walk' },
    });
    const [first, second] = await ctx.prisma.departure.findMany({
      where: { productId: product.id, startsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
      take: 2,
    });
    // Fill the first departure completely (12 sold + 3 held = 15 = capacity).
    await ctx.prisma.departure.update({
      where: { id: first.id },
      data: { seatsSold: 12, seatsHeld: 3 },
    });

    const res = await get(`/public/${operator.slug}`);
    const walk = res.body.tours.find((t) => t.slug === 'lagos-island-heritage-walk');

    expect(walk.nextDeparture.localDate).toBe(localDate(second.startsAt, 'Africa/Lagos'));
  });

  it('hides draft and archived tours', async () => {
    const { operator } = await ctx.seedOperator();
    await ctx.prisma.product.updateMany({
      where: { operatorId: operator.id, slug: 'badagry-heritage-day-trip' },
      data: { status: 'draft' },
    });
    await ctx.prisma.product.updateMany({
      where: { operatorId: operator.id, slug: 'lekki-nature-and-craft' },
      data: { status: 'archived' },
    });

    const res = await get(`/public/${operator.slug}`);

    expect(res.body.tours.map((t) => t.slug).sort()).toEqual([
      'lagos-island-heritage-walk',
      'lagos-street-food-crawl',
      'tarkwa-bay-beach-and-lagoon',
    ]);
  });

  it('answers 404 for an unknown operator or a malformed slug', async () => {
    expect((await get('/public/no-such-operator')).status).toBe(404);
    expect((await get('/public/Not_A_Slug')).status).toBe(404);
  });
});

describe('GET /public/:operatorSlug/tours/:tourSlug (tour page)', () => {
  it('shows the content, active prices and add-ons, and the cancellation terms', async () => {
    const { operator } = await ctx.seedOperator();

    const res = await get(`/public/${operator.slug}/tours/lagos-street-food-crawl`);

    expect(res.status).toBe(200);
    const { tour } = res.body;
    expect(tour).toMatchObject({
      slug: 'lagos-street-food-crawl',
      title: 'Lagos Street Food Crawl',
      fromPriceKobo: 3_500_000,
    });
    expect(tour.priceCategories.map((c) => [c.key, c.amountKobo])).toEqual([
      ['adult', 3_500_000],
      ['child', 2_000_000],
      ['infant', 0],
    ]);
    expect(tour.addOns.map((a) => a.priceKobo).sort()).toEqual([400_000, 500_000]);
    expect(tour.meetingPoint).toHaveProperty('name');
    // Stage 12b: the chips at the top of the tour page.
    expect(tour).toMatchObject({
      activityLabel: 'Evening',
      scheduleSummary: 'Thu–Sat 18:30',
      maxGuests: 10,
    });
    expect(tour.cancellationPolicy.rules).toContainEqual({
      hoursBefore: 48,
      refundBasisPoints: 10_000,
    });
  });

  it('leaves out archived prices and add-ons, and internal fields', async () => {
    const { operator } = await ctx.seedOperator();
    const product = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug: 'lagos-street-food-crawl' },
      include: { addOns: true },
    });
    await ctx.prisma.addOn.update({
      where: { id: product.addOns[0].id },
      data: { isActive: false },
    });
    await ctx.prisma.priceCategory.updateMany({
      where: { productId: product.id, key: 'child' },
      data: { isActive: false },
    });

    const { body } = await get(`/public/${operator.slug}/tours/lagos-street-food-crawl`);

    expect(body.tour.addOns).toHaveLength(1);
    expect(body.tour.priceCategories.map((c) => c.key)).toEqual(['adult', 'infant']);
    // Whitelisted output: none of the staff-only fields.
    for (const field of ['id', '_id', 'status', 'cancellationPolicyId', 'defaultCapacity']) {
      expect(body.tour).not.toHaveProperty(field);
    }
  });

  it('answers 404 for a draft tour, as if it did not exist', async () => {
    const { operator } = await ctx.seedOperator();
    await ctx.prisma.product.updateMany({
      where: { operatorId: operator.id, slug: 'badagry-heritage-day-trip' },
      data: { status: 'draft' },
    });

    const page = await get(`/public/${operator.slug}/tours/badagry-heritage-day-trip`);
    const dates = await get(`/public/${operator.slug}/tours/badagry-heritage-day-trip/departures`);
    const missing = await get(`/public/${operator.slug}/tours/no-such-tour`);

    expect([page.status, dates.status, missing.status]).toEqual([404, 404, 404]);
    expect(page.body).toEqual(missing.body); // nothing hints that the draft exists
  });
});

describe('GET /public/:operatorSlug/tours/:tourSlug/departures (dates and seats)', () => {
  it('lists Badagry Saturdays with seats left, never cached, without sales figures', async () => {
    const { operator } = await ctx.seedOperator();
    const from = today();

    const res = await get(
      `/public/${operator.slug}/tours/badagry-heritage-day-trip/departures?from=${from}&to=${addDays(from, 27)}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.departures.length).toBeGreaterThanOrEqual(3);
    for (const d of res.body.departures) {
      expect(d).toMatchObject({ localTime: '07:00', seatsAvailable: 14, soldOut: false });
      // How many were sold or held is the operator's business, not the public's.
      expect(d).not.toHaveProperty('seatsSold');
      expect(d).not.toHaveProperty('seatsHeld');
      expect(d).not.toHaveProperty('capacity');
    }
  });

  it('keeps a sold-out date in the list, marked soldOut', async () => {
    const { operator } = await ctx.seedOperator();
    const product = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug: 'badagry-heritage-day-trip' },
    });
    const first = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: product.id, startsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
    });
    await ctx.prisma.departure.update({ where: { id: first.id }, data: { seatsSold: 14 } });

    const res = await get(
      `/public/${operator.slug}/tours/badagry-heritage-day-trip/departures?to=${addDays(today(), 27)}`,
    );

    const full = res.body.departures.find((d) => d.id === first.id);
    expect(full).toMatchObject({ seatsAvailable: 0, soldOut: true });
  });

  it("only ever shows the named operator's departures", async () => {
    const a = await ctx.seedOperator();
    const b = await ctx.seedOperator(); // same tour slugs, different operator

    const res = await get(`/public/${a.operator.slug}/tours/lagos-island-heritage-walk/departures`);

    const ids = res.body.departures.map((d) => d.id);
    expect(ids.length).toBeGreaterThan(0);
    const owners = await ctx.prisma.departure.findMany({
      where: { id: { in: ids } },
      select: { operatorId: true },
    });
    expect(new Set(owners.map((o) => o.operatorId))).toEqual(new Set([a.operator.id]));
    expect(b.operator.id).not.toBe(a.operator.id);
  });

  it('refuses a range longer than 92 days', async () => {
    const { operator } = await ctx.seedOperator();
    const from = today();

    const res = await get(
      `/public/${operator.slug}/tours/lagos-island-heritage-walk/departures?from=${from}&to=${addDays(from, 120)}`,
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RANGE_TOO_LONG');
  });
});
