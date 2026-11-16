/**
 * The holds API (INV-23, INV-02) against the real database.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext, buildApp, createFakeJobs } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

function as(app, token) {
  const withAuth = (method) => (url) =>
    request(app)[method](url).set('Authorization', `Bearer ${token}`);
  return {
    get: withAuth('get'),
    post: withAuth('post'),
    patch: withAuth('patch'),
    delete: withAuth('delete'),
  };
}

/** Seeds an operator; returns role clients and the first upcoming Street Food departure. */
async function setup(app = ctx.app) {
  const seeded = await ctx.seedOperator();
  const manager = as(app, await ctx.tokenFor(seeded.manager.id)); // bookings: edit
  const guide = as(app, await ctx.tokenFor(seeded.guides[0].id)); // bookings: view
  const { body } = await manager.get('/api/products');
  const crawl = body.products.find((p) => p.slug === 'lagos-street-food-crawl');
  const [departure] = (await manager.get(`/api/products/${crawl.id}/availability`)).body.departures;
  return { ...seeded, manager, guide, crawl, departure };
}

const twoAdults = [{ age: 30 }, { age: 32 }];

describe('POST /api/holds', () => {
  it('holds seats, snapshots the price and schedules the expiry', async () => {
    const { manager, crawl, departure } = await setup();
    const plate = crawl.addOns.find((a) => a.name === 'Extra tasting plate');

    const res = await manager.post('/api/holds').send({
      departureId: departure.id,
      travellers: twoAdults,
      addOns: [{ addOnId: plate.id, quantity: 2 }],
    });

    expect(res.status).toBe(201);
    expect(res.body.hold).toMatchObject({
      status: 'active',
      seats: 2,
      channel: 'staff',
      totalKobo: 8_000_000, // 2 × ₦35,000 + 2 × ₦5,000
    });
    expect(res.body.hold.quote.lines).toHaveLength(2);

    const after = (await manager.get(`/api/products/${crawl.id}/availability`)).body.departures[0];
    expect(after.seatsAvailable).toBe(8);
    expect(ctx.jobs.scheduled.map((j) => j.holdId)).toEqual([res.body.hold.id]);
  });

  it('keeps the quoted price even if the operator changes prices mid-checkout', async () => {
    const { manager, crawl, departure } = await setup();
    const hold = (
      await manager.post('/api/holds').send({ departureId: departure.id, travellers: twoAdults })
    ).body.hold;

    const adult = crawl.priceCategories.find((c) => c.key === 'adult');
    await ctx.prisma.priceCategory.update({
      where: { id: adult.id },
      data: { amountKobo: 9_900_000 },
    });

    const again = await manager.get(`/api/holds/${hold.id}`);
    expect(again.body.hold.totalKobo).toBe(7_000_000); // still 2 × ₦35,000
  });

  it('says how many seats are left when there are not enough', async () => {
    const { manager, departure } = await setup();
    await manager
      .post('/api/holds')
      .send({ departureId: departure.id, travellers: Array(9).fill({ age: 30 }) });

    const res = await manager
      .post('/api/holds')
      .send({ departureId: departure.id, travellers: twoAdults });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'SOLD_OUT', seatsAvailable: 1 });
  });

  it('still succeeds if scheduling the expiry job fails (the sweeper is the backup)', async () => {
    const brokenJobs = {
      ...createFakeJobs(),
      scheduleHoldExpiry: async () => {
        throw new Error('Redis is down');
      },
    };
    const app = buildApp({ prisma: ctx.prisma, jobs: brokenJobs });
    const { manager, departure } = await setup(app);

    const res = await manager
      .post('/api/holds')
      .send({ departureId: departure.id, travellers: twoAdults });

    expect(res.status).toBe(201);
  });

  it('25 simultaneous one-seat holds through the API: exactly 10 succeed', async () => {
    const { manager, departure } = await setup(); // 10 seats

    const responses = await Promise.all(
      Array.from({ length: 25 }, () =>
        manager.post('/api/holds').send({ departureId: departure.id, travellers: [{ age: 30 }] }),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 409)).toHaveLength(15);
    const row = await ctx.prisma.departure.findUnique({ where: { id: departure.id } });
    expect(row.seatsHeld).toBe(10);
  });

  it('guides can look at holds but not create them', async () => {
    const { manager, guide, departure } = await setup();
    const hold = (
      await manager.post('/api/holds').send({ departureId: departure.id, travellers: twoAdults })
    ).body.hold;

    expect((await guide.get(`/api/holds/${hold.id}`)).status).toBe(200);
    expect(
      (await guide.post('/api/holds').send({ departureId: departure.id, travellers: twoAdults }))
        .status,
    ).toBe(403);
  });
});

describe('DELETE /api/holds/:id', () => {
  it('releases the seats once', async () => {
    const { manager, crawl, departure } = await setup();
    const hold = (
      await manager.post('/api/holds').send({ departureId: departure.id, travellers: twoAdults })
    ).body.hold;

    expect((await manager.delete(`/api/holds/${hold.id}`)).status).toBe(204);
    const second = await manager.delete(`/api/holds/${hold.id}`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('HOLD_NOT_ACTIVE');

    const after = (await manager.get(`/api/products/${crawl.id}/availability`)).body.departures[0];
    expect(after.seatsAvailable).toBe(10);
  });
});

describe('tenant isolation', () => {
  it("cannot hold, see or release another operator's seats", async () => {
    const mine = await setup();
    const theirs = await setup();
    const theirHold = (
      await theirs.manager
        .post('/api/holds')
        .send({ departureId: theirs.departure.id, travellers: twoAdults })
    ).body.hold;

    const grab = await mine.manager
      .post('/api/holds')
      .send({ departureId: theirs.departure.id, travellers: twoAdults });
    expect(grab.status).toBe(404);
    expect((await mine.manager.get(`/api/holds/${theirHold.id}`)).status).toBe(404);
    expect((await mine.manager.delete(`/api/holds/${theirHold.id}`)).status).toBe(404);
  });
});
