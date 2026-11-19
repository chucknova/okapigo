/**
 * The guest's booking is read in ONE snapshot (found in stage 14b, the flaky "Book now"
 * browser journey). Prisma reads a booking and its payments with separate queries; a payment
 * settling between them showed "paid" on a booking still "held". Read at REPEATABLE READ,
 * every query of the read sees the same moment.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { addDays, localDate } from '@okapigo/shared/time';
import { createTestContext, buildApp, createFakeJobs } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

describe('the guest’s booking, read in one snapshot', () => {
  it('the database adapter really runs a transaction at REPEATABLE READ', async () => {
    const [row] = await ctx.prisma.$transaction((tx) => tx.$queryRaw`SHOW transaction_isolation`, {
      isolationLevel: 'RepeatableRead',
    });
    expect(/** @type {any} */ (row).transaction_isolation).toBe('repeatable read');
  });

  it('GET /public/bookings/:token reads inside such a transaction', async () => {
    const { operator } = await ctx.seedOperator();
    /** @type {any[]} */
    const levels = [];
    // The same database client, recording how transactions are asked for.
    const prisma = new Proxy(ctx.prisma, {
      get(target, prop, receiver) {
        if (prop === '$transaction') {
          return (/** @type {any} */ fn, /** @type {any} */ opts) => {
            levels.push(opts?.isolationLevel ?? null);
            return target.$transaction(fn, opts);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const app = buildApp({ prisma, jobs: createFakeJobs() });
    const today = localDate(new Date(), 'Africa/Lagos');
    const deps = (
      await request(app).get(
        `/public/${operator.slug}/tours/lagos-island-heritage-walk/departures?to=${addDays(today, 20)}`,
      )
    ).body.departures;
    const { token } = (
      await request(app)
        .post(`/public/${operator.slug}/bookings`)
        .send({
          lead: { name: 'Adaeze Okafor', email: 'adaeze@guest.example', acceptTerms: true },
          departureId: deps[2].id,
          travellers: [{ name: 'Adaeze Okafor', age: 34 }],
          addOns: [],
        })
    ).body;
    levels.length = 0;
    expect((await request(app).get(`/public/bookings/${token}`)).status).toBe(200);
    expect(levels).toContain('RepeatableRead');
  });
});
