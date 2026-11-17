/**
 * Schedules → departures (INV-03), against the real database.
 *
 * Every test pins "now" to Tuesday 1 December 2026, 07:00 in Lagos (06:00 UTC), so dates and
 * counts are exact and don't depend on the day the tests run.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { localDate, dayOfWeek } from '@okapigo/shared/time';
import {
  createPrismaClient,
  seedDemoOperator,
  syncScheduleDepartures,
  extendAllSchedules,
} from '../src/index.js';

const NOW = new Date('2026-12-01T06:00:00Z');
const LAGOS = 'Africa/Lagos';
const DAY = 24 * 60 * 60 * 1000;

let prisma;
const created = [];

beforeAll(() => {
  prisma = createPrismaClient(process.env.DATABASE_URL);
});
afterAll(() => prisma.$disconnect());
afterEach(async () => {
  await prisma.operator.deleteMany({ where: { id: { in: created.splice(0) } } });
});

/** Seeds an operator "on 1 Dec 2026" and returns one tour's schedule and departures. */
async function seedTour(slug) {
  const operator = await seedDemoOperator(prisma, {
    slug: `test-${randomUUID().slice(0, 8)}`,
    now: NOW,
  });
  created.push(operator.id);
  const product = await prisma.product.findFirstOrThrow({
    where: { operatorId: operator.id, slug },
    include: { schedules: true },
  });
  return {
    product,
    schedule: product.schedules[0],
    departures: () => futureDepartures(product.id),
  };
}

function futureDepartures(productId) {
  return prisma.departure.findMany({
    where: { productId, startsAt: { gt: NOW } },
    orderBy: { startsAt: 'asc' },
  });
}

describe('seeded schedules', () => {
  it('Heritage Walk: daily 09:00 Lagos for 61 days, minus Christmas = 60 departures', async () => {
    const { departures } = await seedTour('lagos-island-heritage-walk');
    const deps = await departures();

    expect(deps).toHaveLength(60);
    expect(deps[0].startsAt.toISOString()).toBe('2026-12-01T08:00:00.000Z'); // 09:00 in Lagos
    expect(deps[0].endsAt.toISOString()).toBe('2026-12-01T11:00:00.000Z'); // 3 hours
    expect(deps[0]).toMatchObject({
      capacity: 15,
      seatsSold: 0,
      seatsHeld: 0,
      status: 'scheduled',
    });
    expect(deps.map((d) => localDate(d.startsAt, LAGOS))).not.toContain('2026-12-25');
  });

  it('Street Food Crawl: only Thursday to Saturday evenings', async () => {
    const { departures } = await seedTour('lagos-street-food-crawl');
    const deps = await departures();

    expect(deps).toHaveLength(27); // 8 full weeks × 3, plus Thu–Sat of the last partial week
    expect(new Set(deps.map((d) => dayOfWeek(localDate(d.startsAt, LAGOS))))).toEqual(
      new Set([4, 5, 6]),
    );
  });
});

describe('syncScheduleDepartures', () => {
  it('is idempotent: running it again changes nothing', async () => {
    const { schedule, departures } = await seedTour('lagos-island-heritage-walk');
    const before = await departures();

    const result = await syncScheduleDepartures(prisma, schedule.id, { now: NOW });

    expect(result).toEqual({ created: 0, removed: 0, needsAttention: [] });
    expect((await departures()).map((d) => d.id)).toEqual(before.map((d) => d.id));
  });

  it('rolls the window forward as time passes', async () => {
    const { schedule } = await seedTour('lagos-island-heritage-walk');

    const result = await syncScheduleDepartures(prisma, schedule.id, {
      now: new Date(NOW.getTime() + 7 * DAY),
    });

    expect(result.created).toBe(7); // one new day at the far end for each day that passed
    expect(result.removed).toBe(0); // past departures are never deleted
  });

  it('switching to weekends removes EMPTY weekday departures but keeps booked ones', async () => {
    const { schedule, departures } = await seedTour('lagos-island-heritage-walk');
    // Pretend a guest bought 2 seats on Wednesday 2 December.
    const wednesday = (await departures()).find(
      (d) => localDate(d.startsAt, LAGOS) === '2026-12-02',
    );
    await prisma.departure.update({ where: { id: wednesday.id }, data: { seatsSold: 2 } });

    await prisma.schedule.update({ where: { id: schedule.id }, data: { daysOfWeek: [0, 6] } });
    const result = await syncScheduleDepartures(prisma, schedule.id, { now: NOW });

    const remaining = await departures();
    const weekdays = remaining.filter(
      (d) => ![0, 6].includes(dayOfWeek(localDate(d.startsAt, LAGOS))),
    );
    expect(weekdays.map((d) => d.id)).toEqual([wednesday.id]); // only the booked one survives
    expect(result.needsAttention).toEqual([
      expect.objectContaining({ id: wednesday.id, seatsSold: 2, reason: 'NO_LONGER_IN_SCHEDULE' }),
    ]);
  });

  it('a capacity change respects hand-edited departures and guests already booked', async () => {
    const { schedule, departures } = await seedTour('lagos-island-heritage-walk');
    const [handEdited, overbooked, normal] = await departures();
    await prisma.departure.update({ where: { id: handEdited.id }, data: { capacity: 20 } });
    await prisma.departure.update({ where: { id: overbooked.id }, data: { seatsSold: 12 } });

    await prisma.schedule.update({ where: { id: schedule.id }, data: { capacity: 10 } });
    const result = await syncScheduleDepartures(prisma, schedule.id, {
      now: NOW,
      previousCapacity: 15,
    });

    const byId = Object.fromEntries((await departures()).map((d) => [d.id, d]));
    expect(byId[normal.id].capacity).toBe(10); // followed the schedule
    expect(byId[handEdited.id].capacity).toBe(20); // staff's own change kept
    expect(byId[overbooked.id].capacity).toBe(15); // can't drop below 12 guests…
    expect(result.needsAttention).toEqual([
      expect.objectContaining({ id: overbooked.id, reason: 'OVER_NEW_CAPACITY' }), // …so reported
    ]);
  });

  it('deactivating a schedule removes all its future empty departures', async () => {
    const { schedule, departures } = await seedTour('tarkwa-bay-beach-and-lagoon');

    await prisma.schedule.update({ where: { id: schedule.id }, data: { isActive: false } });
    await syncScheduleDepartures(prisma, schedule.id, { now: NOW });

    expect(await departures()).toEqual([]);
  });
});

describe('the overselling guard (CHECK constraint)', () => {
  it('refuses more sold + held seats than the departure has', async () => {
    const { departures } = await seedTour('lagos-street-food-crawl'); // capacity 10
    const [first] = await departures();

    await expect(
      prisma.departure.update({ where: { id: first.id }, data: { seatsSold: 8, seatsHeld: 3 } }),
    ).rejects.toThrow(/departures_seats_within_capacity/);
  });

  it('refuses two departures of one product at the same moment', async () => {
    const { product, departures } = await seedTour('lagos-street-food-crawl');
    const [first] = await departures();

    await expect(
      prisma.departure.create({
        data: {
          operatorId: product.operatorId,
          productId: product.id,
          startsAt: first.startsAt,
          endsAt: first.endsAt,
          capacity: 5,
        },
      }),
    ).rejects.toThrow(/departures_product_id_starts_at_key/);
  });
});

describe('extendAllSchedules', () => {
  it('rolls every window forward, and skips a schedule deleted while it runs', async () => {
    const { product, schedule } = await seedTour('lagos-island-heritage-walk');
    const operatorId = product.operatorId;

    // A Prisma client that deletes one schedule right AFTER the job has listed them: the
    // race that happens when an operator (e.g. a visitor sandbox) is deleted mid-run.
    // Doing it at exactly this moment makes the race deterministic instead of lucky.
    const racing = new Proxy(prisma, {
      get(target, prop) {
        if (prop === 'schedule') {
          return new Proxy(target.schedule, {
            get(model, method) {
              if (method !== 'findMany') return Reflect.get(model, method);
              return async (/** @type {any} */ args) => {
                const listed = await model.findMany(args);
                await target.schedule.delete({ where: { id: schedule.id } });
                return listed;
              };
            },
          });
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    // A week later: every other schedule has a week of new days to add.
    const result = await extendAllSchedules(/** @type {any} */ (racing), {
      now: new Date(NOW.getTime() + 7 * DAY),
      operatorId,
    });

    expect(result).toMatchObject({ schedules: 5, skipped: 1, failed: [] });
    expect(result.created).toBeGreaterThan(0);
  });
});
