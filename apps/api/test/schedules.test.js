/**
 * Schedules, departures and availability through the API (INV-03, INV-02 read side).
 *
 * These run against the real clock (the seed starts schedules "today"), so assertions are
 * about relationships ("every departure is a Saturday", "seats went down by 2") rather than
 * fixed dates. Exact-date behaviour is covered in packages/db/test/departures.test.js.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { addDays, dayOfWeek, localDate } from '@okapigo/shared/time';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

function as(token) {
  const agent = request(ctx.app);
  const withAuth = (method) => (url) => agent[method](url).set('Authorization', `Bearer ${token}`);
  return { get: withAuth('get'), post: withAuth('post'), patch: withAuth('patch') };
}

const today = () => localDate(new Date(), 'Africa/Lagos');

/** Seeds an operator and returns clients for each role plus the tours by slug. */
async function setup() {
  const seeded = await ctx.seedOperator();
  const owner = as(await ctx.tokenFor(seeded.owner.id));
  const { body } = await owner.get('/api/products');
  const tours = Object.fromEntries(body.products.map((p) => [p.slug, p]));
  return {
    ...seeded,
    owner,
    manager: as(await ctx.tokenFor(seeded.manager.id)),
    guide: as(await ctx.tokenFor(seeded.guides[0].id)),
    tours,
  };
}

describe('availability', () => {
  it('lists bookable Badagry departures: Saturdays at 07:00 Lagos, 14 seats each', async () => {
    const { guide, tours } = await setup(); // guides have products: view
    const from = today();

    const res = await guide.get(
      `/api/products/${tours['badagry-heritage-day-trip'].id}/availability?from=${from}&to=${addDays(from, 27)}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.departures.length).toBeGreaterThanOrEqual(3); // 4 weeks → 3 or 4 Saturdays
    for (const d of res.body.departures) {
      expect(dayOfWeek(d.localDate)).toBe(6);
      expect(d.localTime).toBe('07:00');
      expect(d).toMatchObject({ capacity: 14, seatsAvailable: 14, status: 'scheduled' });
    }
  });

  it('shows seats going down as they are sold or held, and hides cancelled departures', async () => {
    const { owner, manager, tours, operator } = await setup();
    const productId = tours['lagos-island-heritage-walk'].id;
    const url = `/api/products/${productId}/availability`;
    const [first, second] = (await owner.get(url)).body.departures;

    // Seats change through bookings from session 6; here we set them directly.
    await ctx.prisma.departure.update({
      where: { id: first.id },
      data: { seatsSold: 3, seatsHeld: 2 },
    });
    expect(
      (await manager.patch(`/api/departures/${second.id}`).send({ status: 'cancelled' })).status,
    ).toBe(200);

    const after = (await owner.get(url)).body.departures;
    expect(after.find((d) => d.id === first.id).seatsAvailable).toBe(10); // 15 − 3 − 2
    expect(after.find((d) => d.id === second.id)).toBeUndefined();
    expect(operator.timeZone).toBe('Africa/Lagos');
  });

  it('refuses a date range longer than 92 days', async () => {
    const { owner, tours } = await setup();
    const from = today();
    const res = await owner.get(
      `/api/products/${tours['lagos-island-heritage-walk'].id}/availability?from=${from}&to=${addDays(from, 120)}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RANGE_TOO_LONG');
  });
});

describe('schedules', () => {
  it('a new schedule creates its departures straight away', async () => {
    const { owner, tours } = await setup();
    const productId = tours['lekki-nature-and-craft'].id;

    const res = await owner.post(`/api/products/${productId}/schedules`).send({
      startDate: today(),
      daysOfWeek: [1], // add Monday afternoons
      times: ['14:00'],
      capacity: 8,
    });

    expect(res.status).toBe(201);
    expect(res.body.sync.created).toBeGreaterThanOrEqual(8); // ~60 days of Mondays
    const deps = (
      await owner.get(`/api/departures?productId=${productId}&to=${addDays(today(), 60)}`)
    ).body.departures.filter((d) => d.scheduleId === res.body.schedule.id);
    expect(deps.every((d) => d.localTime === '14:00' && d.capacity === 8)).toBe(true);
  });

  it('adding an exception date removes that departure', async () => {
    const { owner, tours } = await setup();
    const productId = tours['lagos-island-heritage-walk'].id;
    const [schedule] = (await owner.get(`/api/products/${productId}/schedules`)).body.schedules;
    const tomorrow = addDays(today(), 1);

    const res = await owner
      .patch(`/api/schedules/${schedule.id}`)
      .send({ skipDates: [...schedule.skipDates, tomorrow] });

    expect(res.status).toBe(200);
    expect(res.body.sync.removed).toBe(1);
    const dates = (await owner.get(`/api/departures?productId=${productId}`)).body.departures.map(
      (d) => d.localDate,
    );
    expect(dates).not.toContain(tomorrow);
  });

  it('rejects impossible rules', async () => {
    const { owner, tours } = await setup();
    const res = await owner
      .post(`/api/products/${tours['lagos-island-heritage-walk'].id}/schedules`)
      .send({ startDate: '2026-02-30', daysOfWeek: [7], times: ['25:00'] });

    expect(res.status).toBe(400);
    expect(res.body.error.issues.map((i) => i.path).sort()).toEqual([
      'daysOfWeek.0',
      'startDate',
      'times.0',
    ]);
  });

  it('only the owner (products: edit) can change schedules', async () => {
    const { manager, tours } = await setup();
    const res = await manager
      .post(`/api/products/${tours['lagos-island-heritage-walk'].id}/schedules`)
      .send({ startDate: today(), daysOfWeek: [1], times: ['09:00'] });
    expect(res.status).toBe(403);
  });
});

describe('single departures', () => {
  it('owner adds a one-off departure (e.g. a private Sunday food crawl)', async () => {
    const { owner, tours } = await setup();
    const productId = tours['lagos-street-food-crawl'].id;
    const date = addDays(today(), 3);

    const res = await owner
      .post(`/api/products/${productId}/departures`)
      .send({ date, time: '19:00', capacity: 6 });

    expect(res.status).toBe(201);
    expect(res.body.departure).toMatchObject({
      localDate: date,
      localTime: '19:00',
      capacity: 6,
      scheduleId: null,
    });
  });

  it('refuses a one-off departure in the past', async () => {
    const { owner, tours } = await setup();
    const res = await owner
      .post(`/api/products/${tours['lagos-street-food-crawl'].id}/departures`)
      .send({ date: addDays(today(), -1), time: '19:00' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IN_THE_PAST');
  });

  it('will not shrink capacity below the guests already booked', async () => {
    const { manager, tours } = await setup();
    const [dep] = (
      await manager.get(`/api/products/${tours['tarkwa-bay-beach-and-lagoon'].id}/availability`)
    ).body.departures;
    await ctx.prisma.departure.update({ where: { id: dep.id }, data: { seatsSold: 7 } });

    const tooSmall = await manager.patch(`/api/departures/${dep.id}`).send({ capacity: 6 });
    const fits = await manager.patch(`/api/departures/${dep.id}`).send({ capacity: 8 });

    expect(tooSmall.status).toBe(409);
    expect(tooSmall.body.error.code).toBe('CAPACITY_BELOW_BOOKED');
    expect(fits.body.departure).toMatchObject({ capacity: 8, seatsAvailable: 1 });
  });

  it('will not cancel a departure that has guests (that needs refunds, session 7)', async () => {
    const { manager, tours } = await setup();
    const [dep] = (
      await manager.get(`/api/products/${tours['tarkwa-bay-beach-and-lagoon'].id}/availability`)
    ).body.departures;
    await ctx.prisma.departure.update({ where: { id: dep.id }, data: { seatsHeld: 1 } });

    const res = await manager.patch(`/api/departures/${dep.id}`).send({ status: 'cancelled' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_GUESTS');
  });

  it('guides cannot cancel departures (they have operations, not bookings, edit)', async () => {
    const { guide, tours } = await setup();
    const [dep] = (
      await guide.get(`/api/products/${tours['tarkwa-bay-beach-and-lagoon'].id}/availability`)
    ).body.departures;

    const res = await guide.patch(`/api/departures/${dep.id}`).send({ status: 'cancelled' });
    expect(res.status).toBe(403);
  });
});

describe('tenant isolation', () => {
  it("cannot see or change another operator's schedules or departures", async () => {
    const mine = await setup();
    const theirs = await setup();
    const theirProduct = theirs.tours['lagos-island-heritage-walk'];
    const [theirSchedule] = (await theirs.owner.get(`/api/products/${theirProduct.id}/schedules`))
      .body.schedules;
    const [theirDeparture] = (
      await theirs.owner.get(`/api/products/${theirProduct.id}/availability`)
    ).body.departures;

    expect((await mine.owner.get(`/api/products/${theirProduct.id}/availability`)).status).toBe(
      404,
    );
    expect(
      (await mine.owner.patch(`/api/schedules/${theirSchedule.id}`).send({ isActive: false }))
        .status,
    ).toBe(404);
    expect(
      (
        await mine.manager
          .patch(`/api/departures/${theirDeparture.id}`)
          .send({ status: 'cancelled' })
      ).status,
    ).toBe(404);

    // My calendar contains only my own departures.
    const mineList = (await mine.owner.get('/api/departures')).body.departures;
    const myProductIds = new Set(Object.values(mine.tours).map((t) => t.id));
    expect(mineList.every((d) => myProductIds.has(d.productId))).toBe(true);
  });
});
