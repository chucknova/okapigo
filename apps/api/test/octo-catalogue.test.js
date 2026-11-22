/**
 * Session 17a: the OCTO API, catalogue side. Contract tests: every answer is checked against the
 * OCTO schemas (@okapigo/shared/octo, written from docs.octo.travel). And the rules:
 *   - a channel's own key; none (401), unknown or switched off (403)
 *   - only this channel's tours, published, of this business
 *   - seats are the same seats as the website's (a website hold lowers OCTO's vacancies)
 *   - prices are the website's prices (the same pipeline), with the OTA's net after commission
 *   - errors in OCTO's shape
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';
import {
  AvailabilitySchema,
  BookingPickupsSchema,
  CalendarDaySchema,
  ErrorSchema,
  OptionPickupsSchema,
  ProductContentSchema,
  ProductSchema,
  SupplierSchema,
} from '@okapigo/shared/octo';
import { addDays, localDate } from '@okapigo/shared/time';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

/** The seeded mock OTA's key for a test business (seed: `octo_dev_<slug>`). */
const keyOf = (/** @type {any} */ s) => `octo_dev_${s.operator.slug}`;

/** @param {string} key @param {string[]} [caps] */
const octo = (key, caps = []) => ({
  get: (/** @type {string} */ url) =>
    request(ctx.app)
      .get(url)
      .set('Authorization', `Bearer ${key}`)
      .set('Octo-Capabilities', caps.join(', ')),
  post: (/** @type {string} */ url) =>
    request(ctx.app)
      .post(url)
      .set('Authorization', `Bearer ${key}`)
      .set('Octo-Capabilities', caps.join(', ')),
});

/** Checks a value against an OCTO schema; on failure, says where. @param {any} schema @param {unknown} value */
function conforms(schema, value) {
  const r = schema.safeParse(value);
  expect(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))).toBe(true);
}

async function setup() {
  const s = await ctx.seedOperator();
  const tz = s.operator.timeZone;
  const today = localDate(new Date(), tz);
  const tour = (/** @type {string} */ slug) =>
    ctx.prisma.product.findFirstOrThrow({ where: { operatorId: s.operator.id, slug } });
  return { ...s, tz, today, tour, api: octo(keyOf(s)), priced: octo(keyOf(s), ['octo/pricing']) };
}

describe('who may ask', () => {
  it('no key: 401; an unknown or switched-off key: 403, in OCTO’s shape', async () => {
    const s = await setup();
    const none = await request(ctx.app).get('/octo/supplier');
    expect(none.status).toBe(401);
    conforms(ErrorSchema, none.body);
    expect(none.body.error).toBe('UNAUTHORIZED');
    const wrong = await octo('octo_not-a-real-key').get('/octo/supplier');
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toBe('FORBIDDEN');
    await ctx.prisma.channel.updateMany({
      where: { operatorId: s.operator.id },
      data: { isActive: false },
    });
    expect((await s.api.get('/octo/supplier')).status).toBe(403);
  });
});

describe('the supplier and its products', () => {
  it('the supplier', async () => {
    const s = await setup();
    const res = await s.api.get('/octo/supplier');
    expect(res.status).toBe(200);
    conforms(SupplierSchema, res.body);
    expect(res.body).toMatchObject({
      id: s.operator.id,
      name: 'Ìrìn Lagos Tours',
      endpoint: 'http://localhost:4000/octo',
      contact: { telephone: '+2348090000123' },
    });
    expect(res.headers['octo-capabilities']).toBe('');
  });

  it('the products: every published tour on the channel, each conforming', async () => {
    const s = await setup();
    const res = await s.api.get('/octo/products');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    for (const p of res.body) conforms(ProductSchema, p);
    const tarkwa = res.body.find(
      (/** @type {any} */ p) => p.reference === 'tarkwa-bay-beach-and-lagoon',
    );
    expect(tarkwa).toMatchObject({
      internalName: 'Tarkwa Bay Beach and Lagoon Trip',
      timeZone: 'Africa/Lagos',
      availabilityRequired: true,
      availabilityType: 'START_TIME',
      options: [
        {
          id: 'DEFAULT',
          default: true,
          availabilityLocalStartTimes: ['10:00'],
          // Cancellable until the start, the refund by Ìrìn's policy (decided 17b).
          cancellationCutoff:
            'Until the start. Refund by the policy: Full refund 48 h+ · 50% 24–48 h · No refund under 24 h',
          cancellationCutoffAmount: 0,
          cancellationCutoffUnit: 'hour',
        },
      ],
    });
    // Without the pricing capability: no prices.
    expect(tarkwa.options[0].units[0].pricingFrom).toBeUndefined();
    expect(tarkwa.defaultCurrency).toBeUndefined();
    // Units: one per price category; children and infants come with an adult.
    expect(
      tarkwa.options[0].units.map((/** @type {any} */ u) => [
        u.id,
        u.type,
        u.restrictions.accompaniedBy,
      ]),
    ).toEqual([
      ['adult', 'ADULT', []],
      ['child', 'CHILD', ['adult']],
      ['infant', 'INFANT', ['adult']],
    ]);
    expect(tarkwa.options[0].units[0].restrictions).toMatchObject({ minAge: 13, maxAge: 120 });
  });

  it('prices: the website’s, tax included; the OTA’s net after its 20%', async () => {
    const s = await setup();
    const res = await s.priced.get('/octo/products');
    expect(res.headers['octo-capabilities']).toBe('octo/pricing');
    for (const p of res.body) conforms(ProductSchema, p);
    const tarkwa = res.body.find(
      (/** @type {any} */ p) => p.reference === 'tarkwa-bay-beach-and-lagoon',
    );
    expect(tarkwa).toMatchObject({
      defaultCurrency: 'NGN',
      availableCurrencies: ['NGN'],
      pricingPer: 'UNIT',
    });
    const adult = tarkwa.options[0].units[0].pricingFrom[0];
    // ₦40,000 including 7.5% VAT: ₦2,790.70 → ₦2,791 of VAT (whole naira); the OTA owes ₦32,000.
    expect(adult).toEqual({
      original: 4_000_000,
      retail: 4_000_000,
      net: 3_200_000,
      currency: 'NGN',
      currencyPrecision: 2,
      // The VAT inside the net, in whole naira like every percentage (INV-24): ₦2,232.80 → ₦2,233.
      includedTaxes: [{ name: 'VAT', retail: 279_100, original: 279_100, net: 223_300 }],
    });
    // The option's "from" price is the first unit's.
    expect(tarkwa.options[0].pricingFrom).toEqual([adult]);
    // An infant is free: no tax inside.
    expect(tarkwa.options[0].units[2].pricingFrom[0]).toMatchObject({
      retail: 0,
      net: 0,
      includedTaxes: [],
    });
    // "pricing" (without octo/) is accepted too: the docs use both.
    expect(
      (await octo(keyOf(s), ['pricing']).get('/octo/products')).headers['octo-capabilities'],
    ).toBe('octo/pricing');
  });

  it('a tour with no schedule yet still has a start time (the spec wants at least one)', async () => {
    const s = await setup();
    const walk = await s.tour('lagos-island-heritage-walk');
    await ctx.prisma.schedule.updateMany({
      where: { productId: walk.id },
      data: { isActive: false },
    });
    const res = await s.api.get(`/octo/products/${walk.id}`);
    conforms(ProductSchema, res.body);
    expect(res.body.options[0].availabilityLocalStartTimes).toEqual(['09:00']);
  });

  it('one product; another business’s, a draft, one off the channel: invalid', async () => {
    const s = await setup();
    const walk = await s.tour('lagos-island-heritage-walk');
    const one = await s.api.get(`/octo/products/${walk.id}`);
    expect(one.status).toBe(200);
    conforms(ProductSchema, one.body);
    expect(one.body.id).toBe(walk.id);

    const other = await ctx.seedOperator();
    const theirs = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: other.operator.id },
    });
    const bad = await s.api.get(`/octo/products/${theirs.id}`);
    expect(bad.status).toBe(400);
    conforms(ErrorSchema, bad.body);
    expect(bad.body).toEqual({
      error: 'INVALID_PRODUCT_ID',
      errorMessage: 'The Product ID was invalid or missing',
      productId: theirs.id,
    });
    expect((await s.api.get('/octo/products/not-a-uuid')).body.error).toBe('INVALID_PRODUCT_ID');

    await ctx.prisma.product.update({ where: { id: walk.id }, data: { status: 'draft' } });
    expect((await s.api.get(`/octo/products/${walk.id}`)).body.error).toBe('INVALID_PRODUCT_ID');
    await ctx.prisma.product.update({ where: { id: walk.id }, data: { status: 'published' } });
    await ctx.prisma.channelProduct.deleteMany({ where: { productId: walk.id } });
    expect((await s.api.get(`/octo/products/${walk.id}`)).body.error).toBe('INVALID_PRODUCT_ID');
    expect((await s.api.get('/octo/products')).body).toHaveLength(4);
  });
});

describe('availability', () => {
  it('a date range: each departure, conforming; the same seats as the website', async () => {
    const s = await setup();
    const tarkwa = await s.tour('tarkwa-bay-beach-and-lagoon');
    const from = addDays(s.today, 1);
    const to = addDays(s.today, 14);
    const body = {
      productId: tarkwa.id,
      optionId: 'DEFAULT',
      localDateStart: from,
      localDateEnd: to,
    };
    const res = await s.api.post('/octo/availability').send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.length).toBeGreaterThan(2);
    for (const a of res.body) conforms(AvailabilitySchema, a);
    const first = res.body[0];
    expect(first).toMatchObject({
      available: true,
      status: 'AVAILABLE',
      vacancies: 12,
      capacity: 12,
      maxUnits: 12,
      allDay: false,
      openingHours: [],
    });
    expect(first.localDateTimeStart).toMatch(/T10:00:00\+01:00$/);
    const d = await ctx.prisma.departure.findUniqueOrThrow({ where: { id: first.id } });
    expect(first.utcCutoffAt).toBe(d.startsAt.toISOString());

    // Seats held on the website count here too (one stock: INV-02).
    await ctx.prisma.departure.update({ where: { id: d.id }, data: { seatsHeld: 7 } });
    const again = await s.api
      .post('/octo/availability')
      .send({ ...body, availabilityIds: undefined });
    expect(again.body.find((/** @type {any} */ a) => a.id === d.id)).toMatchObject({
      vacancies: 5,
      status: 'LIMITED',
    });
    // Asking for more than are left: not available.
    const many = await s.api.post('/octo/availability').send({
      productId: tarkwa.id,
      optionId: 'DEFAULT',
      availabilityIds: [d.id],
      units: [{ id: 'adult', quantity: 6 }],
    });
    expect(many.body[0]).toMatchObject({ available: false, vacancies: 5 });
    await ctx.prisma.departure.update({ where: { id: d.id }, data: { seatsHeld: 12 } });
    const full = await s.api
      .post('/octo/availability')
      .send({ productId: tarkwa.id, optionId: 'DEFAULT', availabilityIds: [d.id] });
    expect(full.body[0]).toMatchObject({ available: false, status: 'SOLD_OUT', vacancies: 0 });
  });

  it('by id, with units and prices: the same total as the website’s quote', async () => {
    const s = await setup();
    const tarkwa = await s.tour('tarkwa-bay-beach-and-lagoon');
    const list = await s.api.post('/octo/availability').send({
      productId: tarkwa.id,
      optionId: 'DEFAULT',
      localDateStart: addDays(s.today, 1),
      localDateEnd: addDays(s.today, 14),
    });
    const id = list.body[0].id;
    const res = await s.priced.post('/octo/availability').send({
      productId: tarkwa.id,
      optionId: 'DEFAULT',
      availabilityIds: [id],
      units: [
        { id: 'adult', quantity: 2 },
        { id: 'child', quantity: 1 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    conforms(AvailabilitySchema, res.body[0]);
    expect(res.body[0].unitPricing.map((/** @type {any} */ u) => [u.unitId, u.retail])).toEqual([
      ['adult', 4_000_000],
      ['child', 2_200_000],
      ['infant', 0],
    ]);
    const quote = await request(ctx.app)
      .post(`/public/${s.operator.slug}/tours/tarkwa-bay-beach-and-lagoon/quote`)
      .send({ travellers: [{ age: 30 }, { age: 30 }, { age: 8 }], addOns: [] });
    expect(res.body[0].pricing).toMatchObject({
      retail: quote.body.quote.totalKobo,
      net: quote.body.quote.totalKobo - 2_040_000,
    });
    expect(res.body[0].pricing.includedTaxes[0].retail).toBe(quote.body.quote.taxKobo);
  });

  it('refused, in OCTO’s shape: an unknown option, unit, availability; a bad body; too long a range', async () => {
    const s = await setup();
    const tarkwa = await s.tour('tarkwa-bay-beach-and-lagoon');
    const base = {
      productId: tarkwa.id,
      localDateStart: s.today,
      localDateEnd: addDays(s.today, 3),
    };
    const cases = [
      [
        { ...base, optionId: 'VIP' },
        { error: 'INVALID_OPTION_ID', optionId: 'VIP' },
      ],
      [
        { ...base, optionId: 'DEFAULT', units: [{ id: 'pensioner', quantity: 1 }] },
        { error: 'INVALID_UNIT_ID', unitId: 'pensioner' },
      ],
      [
        {
          productId: tarkwa.id,
          optionId: 'DEFAULT',
          availabilityIds: ['5f1c7e1e-0000-4000-8000-000000000000'],
        },
        {
          error: 'INVALID_AVAILABILITY_ID',
          availabilityId: '5f1c7e1e-0000-4000-8000-000000000000',
        },
      ],
      [{ productId: tarkwa.id, optionId: 'DEFAULT' }, { error: 'BAD_REQUEST' }],
      [
        { ...base, optionId: 'DEFAULT', localDateEnd: addDays(s.today, 93) },
        { error: 'BAD_REQUEST' },
      ],
      [
        { ...base, optionId: 'DEFAULT', localDateEnd: addDays(s.today, -1) },
        { error: 'BAD_REQUEST' },
      ],
    ];
    for (const [body, want] of cases) {
      const res = await s.api.post('/octo/availability').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      conforms(ErrorSchema, res.body);
      expect(res.body).toMatchObject(want);
    }
    const notJson = await s.api
      .post('/octo/availability')
      .set('Content-Type', 'application/json')
      .send('{oops');
    expect(notJson.body.error).toBe('BAD_REQUEST');
    expect((await s.api.get('/octo/bookings-not-yet')).body.error).toBe('BAD_REQUEST');
    // A departure that has already started can't be asked about by its id either.
    const past = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: tarkwa.id, startsAt: { gt: new Date(Date.now() + 30 * 86_400_000) } },
      orderBy: { startsAt: 'desc' },
    });
    await ctx.prisma.departure.update({
      where: { id: past.id },
      data: {
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });
    const started = await s.api
      .post('/octo/availability')
      .send({ productId: tarkwa.id, optionId: 'DEFAULT', availabilityIds: [past.id] });
    expect(started.body).toMatchObject({
      error: 'INVALID_AVAILABILITY_ID',
      availabilityId: past.id,
    });
  });
});

describe('the calendar', () => {
  it('every day in the range: open days with their seats; days without a departure CLOSED', async () => {
    const s = await setup();
    const badagry = await s.tour('badagry-heritage-day-trip'); // Saturdays only
    const from = addDays(s.today, 1);
    const to = addDays(s.today, 14);
    const res = await s.priced.post('/octo/availability/calendar').send({
      productId: badagry.id,
      optionId: 'DEFAULT',
      localDateStart: from,
      localDateEnd: to,
      units: [{ id: 'adult', quantity: 2 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toHaveLength(14);
    for (const day of res.body) conforms(CalendarDaySchema, day);
    const open = res.body.filter((/** @type {any} */ d) => d.status !== 'CLOSED');
    expect(open.length).toBeGreaterThanOrEqual(2);
    for (const d of open) {
      expect(new Date(`${d.localDate}T12:00:00Z`).getUTCDay()).toBe(6);
      expect(d).toMatchObject({ available: true, vacancies: 14, capacity: 14 });
      expect(d.pricingFrom[0].retail).toBe(13_000_000); // 2 × ₦65,000
      expect(d.unitPricingFrom[0]).toMatchObject({ unitId: 'adult', retail: 6_500_000 });
    }
    // A party bigger than what's left that day: not available.
    const sat = open[0].localDate;
    const satDeparture = (
      await s.api.post('/octo/availability').send({
        productId: badagry.id,
        optionId: 'DEFAULT',
        localDateStart: sat,
        localDateEnd: sat,
      })
    ).body[0];
    await ctx.prisma.departure.update({ where: { id: satDeparture.id }, data: { seatsHeld: 13 } });
    const tight = await s.api.post('/octo/availability/calendar').send({
      productId: badagry.id,
      optionId: 'DEFAULT',
      localDateStart: sat,
      localDateEnd: sat,
      units: [{ id: 'adult', quantity: 2 }],
    });
    expect(tight.body[0]).toMatchObject({ available: false, vacancies: 1, status: 'LIMITED' });
    const closed = res.body.find((/** @type {any} */ d) => d.status === 'CLOSED');
    expect(closed).toEqual({
      localDate: closed.localDate,
      available: false,
      status: 'CLOSED',
      vacancies: null,
      capacity: null,
      openingHours: [],
    });
  });
});

describe('content and pickups (17d-1, OCTO’s optional capabilities)', () => {
  it('content: what’s included and not, what to bring, the stops, the terms, where to meet, the label', async () => {
    const s = await setup();
    const lekki = await s.tour('lekki-nature-and-craft');
    const plain = (await s.api.get(`/octo/products/${lekki.id}`)).body;
    expect(plain.features).toBeUndefined(); // only when asked for
    const res = await octo(keyOf(s), ['octo/content']).get(`/octo/products/${lekki.id}`);
    expect(res.headers['octo-capabilities']).toBe('octo/content');
    const p = res.body;
    conforms(ProductContentSchema, p);
    const of = (/** @type {string} */ type) =>
      p.features
        .filter((/** @type {any} */ f) => f.type === type)
        .map((/** @type {any} */ f) => f.shortDescription);
    expect(of('INCLUSION')).toEqual(lekki.inclusions);
    expect(of('EXCLUSION')).toEqual(lekki.exclusions);
    expect(of('PREARRIVAL_INFORMATION')).toEqual(expect.arrayContaining(lekki.whatToBring));
    expect(of('HIGHLIGHT')).toEqual(['Lekki Conservation Centre', 'Lekki Arts and Crafts Market']);
    expect(of('CANCELLATION_TERM')).toEqual([expect.stringMatching(/^Full refund \d+ h\+/)]);
    const mp = /** @type {any} */ (lekki.meetingPoint);
    expect(p.locations).toEqual([
      expect.objectContaining({
        title: mp.name,
        types: ['START'],
        place: expect.objectContaining({
          latitude: mp.lat,
          longitude: mp.lng,
          postalAddress: expect.objectContaining({
            streetAddress: mp.address,
            addressCountry: 'NG',
          }),
        }),
      }),
    ]);
    expect(p.categoryLabels).toEqual(lekki.activityLabel ? [lekki.activityLabel] : []);
    // A tour that says when to arrive: told before arriving.
    await ctx.prisma.product.update({ where: { id: lekki.id }, data: { arriveMinutesEarly: 15 } });
    const again = (await octo(keyOf(s), ['content']).get(`/octo/products/${lekki.id}`)).body;
    expect(again.features).toEqual(
      expect.arrayContaining([
        {
          shortDescription: 'Be at the meeting point 15 minutes before the start',
          type: 'PREARRIVAL_INFORMATION',
        },
      ]),
    );
  });

  it('pickups: where the van collects, required; a tour without pickups says so', async () => {
    const s = await setup();
    const lekki = await s.tour('lekki-nature-and-craft');
    const both = octo(keyOf(s), ['octo/pickups', 'octo/pricing']);
    const res = await both.get(`/octo/products/${lekki.id}`);
    expect(res.headers['octo-capabilities']).toBe('octo/pricing, octo/pickups');
    const option = res.body.options[0];
    conforms(OptionPickupsSchema, option);
    expect(option.pickupRequired).toBe(true);
    expect(option.pickupLocations).toEqual([
      expect.objectContaining({
        id: 'victoria-island',
        title: 'Victoria Island',
        shortDescription: 'Eko Hotel main gate · pickup at 07:15',
      }),
      expect.objectContaining({
        id: 'ikoyi',
        shortDescription: 'Falomo roundabout · pickup at 07:30',
      }),
      expect.objectContaining({ id: 'lekki-phase-1' }),
    ]);
    const walk = await s.tour('lagos-island-heritage-walk');
    const w = (await both.get(`/octo/products/${walk.id}`)).body.options[0];
    expect(w).toMatchObject({ pickupAvailable: false, pickupRequired: false, pickupLocations: [] });
  });

  it('the policy’s tiers (ours, not in the spec), for an OTA’s "full refund until…"', async () => {
    const s = await setup();
    const walk = await s.tour('lagos-island-heritage-walk');
    const option = (await s.api.get(`/octo/products/${walk.id}`)).body.options[0];
    expect(option.refundRules).toEqual([
      { hoursBefore: 48, refundPercent: 100 },
      { hoursBefore: 24, refundPercent: 50 },
      { hoursBefore: 0, refundPercent: 0 },
    ]);
  });

  it('a booking with a pickup: the standard’s pickupLocationId, and the time on the day', async () => {
    const s = await setup();
    const lekki = await s.tour('lekki-nature-and-craft');
    const d = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: lekki.id, startsAt: { gt: new Date(Date.now() + 3 * 86_400_000) } },
      orderBy: { startsAt: 'asc' },
    });
    const api = octo(keyOf(s), ['octo/pickups']);
    const res = await api.post('/octo/bookings').send({
      uuid: 'pk-1',
      productId: lekki.id,
      optionId: 'DEFAULT',
      availabilityId: d.id,
      unitItems: [{ unitId: 'adult' }],
      pickupRequested: true,
      pickupLocationId: 'ikoyi',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    conforms(BookingPickupsSchema, res.body);
    expect(res.body).toMatchObject({
      pickupRequested: true,
      pickupLocationId: 'ikoyi',
      localPickupDateTimeStart: expect.stringMatching(
        new RegExp(`^${localDate(d.startsAt, s.tz)}T07:30:00\\+01:00$`),
      ),
      pickupLocation: expect.objectContaining({ id: 'ikoyi', title: 'Ikoyi' }),
    });
    const missing = await api.post('/octo/bookings').send({
      productId: lekki.id,
      optionId: 'DEFAULT',
      availabilityId: d.id,
      unitItems: [{ unitId: 'adult' }],
    });
    expect(missing.status).toBe(400);
    expect(missing.body.errorMessage).toBe(
      'This tour picks guests up: send pickupLocationId, one of victoria-island, ikoyi, lekki-phase-1',
    );
  });
});
