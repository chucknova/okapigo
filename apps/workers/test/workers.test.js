/**
 * Background jobs against the real database AND the real Redis.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { Worker } from 'bullmq';
import { createPrismaClient, seedDemoOperator, createHold } from '@okapigo/db';
import { createJobClient, connectionFor, QUEUES, JOBS } from '@okapigo/jobs';
import { createProcessors } from '../src/processors.js';
import { createSimulatorProvider } from '@okapigo/payments';

const logger = pino({ level: 'silent' });
let prisma;
let processors;
const created = [];

beforeAll(() => {
  prisma = createPrismaClient(process.env.DATABASE_URL);
  processors = createProcessors({
    prisma,
    logger,
    provider: createSimulatorProvider({ baseUrl: 'http://localhost:4000' }),
  });
});
afterAll(() => prisma.$disconnect());
afterEach(async () => {
  await prisma.operator.deleteMany({ where: { id: { in: created.splice(0) } } });
});

/** A seeded operator and its first upcoming Heritage Walk departure. */
async function heritageDeparture() {
  const operator = await seedDemoOperator(prisma, { slug: `test-${randomUUID().slice(0, 8)}` });
  created.push(operator.id);
  const departure = await prisma.departure.findFirstOrThrow({
    where: {
      operatorId: operator.id,
      product: { slug: 'lagos-island-heritage-walk' },
      startsAt: { gt: new Date() },
    },
    orderBy: { startsAt: 'asc' },
  });
  return { operator, departure };
}

/** A 2-seat hold whose 15 minutes run out `msFromNow` from now (made in the "past"). */
function holdExpiringIn(ctx, msFromNow) {
  return createHold(prisma, {
    operatorId: ctx.operator.id,
    departureId: ctx.departure.id,
    seats: 2,
    channel: 'web',
    travellers: [{ age: 30 }, { age: 31 }],
    quote: {},
    totalKobo: 5_000_000,
    holdMinutes: 15,
    now: new Date(Date.now() - 15 * 60_000 + msFromNow),
  });
}

const seatsHeld = async (id) =>
  (await prisma.departure.findUniqueOrThrow({ where: { id } })).seatsHeld;

describe('processors (called directly)', () => {
  it('expire-hold releases a due hold once; repeating it is harmless', async () => {
    const ctx = await heritageDeparture();
    const hold = await holdExpiringIn(ctx, -1000); // already due

    expect(await processors[JOBS.expireHold]({ holdId: hold.id })).toEqual({ released: true });
    expect(await processors[JOBS.expireHold]({ holdId: hold.id })).toEqual({ released: false });
    expect(await seatsHeld(ctx.departure.id)).toBe(0);
  });

  it('sweep-holds catches due holds that never got a job', async () => {
    const ctx = await heritageDeparture();
    await holdExpiringIn(ctx, -1000);

    const { expired } = await processors[JOBS.sweepHolds]();

    expect(expired).toBeGreaterThanOrEqual(1);
    expect(await seatsHeld(ctx.departure.id)).toBe(0);
  });

  it('extend-schedules is safe to run any number of times', async () => {
    // Limited to OUR operator. Walking every schedule in the database made this test's time
    // depend on how many operators other test files had seeded at that moment, and it timed
    // out under load (stage 11b). Surviving a schedule deleted mid-run is now tested
    // deterministically in packages/db/test/departures.test.js.
    const { operator } = await heritageDeparture();
    const ours = () => prisma.departure.count({ where: { operatorId: operator.id } });
    const before = await ours();
    const job = { data: { operatorId: operator.id } };

    const first = await processors[JOBS.extendSchedules](job);
    await processors[JOBS.extendSchedules](job);

    expect(first).toMatchObject({ schedules: 5, failed: [] });
    expect(await ours()).toBe(before); // freshly seeded: nothing to add, nothing duplicated
  });
});

describe('verify-ledger', () => {
  it('passes when the books balance', async () => {
    await heritageDeparture();
    expect(await processors[JOBS.verifyLedger]()).toMatchObject({ ok: true });
  });
});

describe('through BullMQ and Redis', () => {
  it('a scheduled expiry job releases the hold when its time comes', async () => {
    const prefix = `test-${randomUUID().slice(0, 8)}`; // private queues for this test
    const jobs = createJobClient(process.env.REDIS_URL, { prefix });
    const worker = new Worker(QUEUES.holds, (job) => processors[job.name](job.data), {
      connection: connectionFor(process.env.REDIS_URL),
      prefix,
    });

    try {
      const ctx = await heritageDeparture();
      const hold = await holdExpiringIn(ctx, 300); // due in 0.3 s
      const done = new Promise((resolve) =>
        worker.on('completed', (_job, result) => resolve(result)),
      );

      await jobs.scheduleHoldExpiry(hold.id, hold.expiresAt);
      expect(await seatsHeld(ctx.departure.id)).toBe(2); // still held right after scheduling

      expect(await done).toEqual({ released: true }); // ~1.3 s later the worker ran it
      expect(await seatsHeld(ctx.departure.id)).toBe(0);
    } finally {
      await worker.close();
      await jobs.close();
    }
  }, 15_000);
});
