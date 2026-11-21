/**
 * Sessions 17c and 17c-2: the push job tells each OTA, at the address it subscribed through
 * OCTO, what changed: a JSON POST with the headers it asked for, five seconds at most, and
 * words for the owner when it doesn't land.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { createPrismaClient, seedDemoOperator } from '@okapigo/db';
import { JOBS } from '@okapigo/jobs';
import { createProcessors } from '../src/processors.js';
import { createSimulatorProvider } from '@okapigo/payments';

const logger = pino({ level: 'silent' });
// Seeding a whole business and telling 60 days of departures: give it time under load.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });
/** @type {any} */
let prisma;
/** @type {string[]} */
const created = [];

beforeAll(() => {
  prisma = createPrismaClient(process.env.DATABASE_URL);
});
afterAll(() => prisma.$disconnect());
afterEach(async () => {
  await prisma.operator.deleteMany({ where: { id: { in: created.splice(0) } } });
});

/**
 * A business whose Sojourna subscribed for tour updates, and the push job with a pretend fetch.
 * @param {(url: string, init: any) => Promise<any>} fetch
 */
async function setup(fetch) {
  const operator = await seedDemoOperator(prisma, { slug: `test-${randomUUID().slice(0, 8)}` });
  created.push(operator.id);
  const channel = await prisma.channel.findFirstOrThrow({ where: { operatorId: operator.id } });
  const sub = await prisma.channelSubscription.create({
    data: {
      operatorId: operator.id,
      channelId: channel.id,
      url: 'http://localhost:4400/octo-updates',
      notificationTypes: ['PRODUCT_UPDATE'],
      headers: { 'Api-Key': 'sojourna-secret' },
    },
  });
  const processors = createProcessors({
    prisma,
    logger,
    provider: createSimulatorProvider({ baseUrl: 'http://localhost:4000' }),
    fetch: /** @type {any} */ (fetch),
  });
  const run = () => processors[JOBS.pushChannels]({ operatorId: operator.id });
  return { operator, sub, run };
}

describe('push-channels', () => {
  it('a JSON POST to the subscribed address, with the headers the OTA asked for', async () => {
    /** @type {Array<{ url: string, init: any }>} */
    const calls = [];
    const { sub, run } = await setup(async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 204 };
    });
    expect(await run()).toMatchObject({ subscriptions: 1, sent: 5, failed: 0 });
    const { url, init } = calls[0];
    expect(url).toBe('http://localhost:4400/octo-updates');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({
      'Api-Key': 'sojourna-secret',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body)).toMatchObject({
      subscriptionId: sub.id,
      notificationType: 'PRODUCT_UPDATE',
      data: { productId: expect.any(String) },
    });
    // Told everything: nothing the next time.
    calls.length = 0;
    expect(await run()).toMatchObject({ sent: 0, failed: 0 });
    expect(calls).toEqual([]);
  });

  it('when it doesn’t land: words the owner can read', async () => {
    for (const [fetch, words] of /** @type {const} */ ([
      [async () => ({ ok: false, status: 503 }), 'it answered 503'],
      [
        async () => {
          throw Object.assign(new Error('x'), { name: 'TimeoutError' });
        },
        'no answer in 5 seconds',
      ],
      [
        async () => {
          throw new TypeError('fetch failed');
        },
        'could not reach it',
      ],
    ])) {
      const { sub, run } = await setup(fetch);
      expect(await run()).toMatchObject({ sent: 0, failed: 1 });
      const after = await prisma.channelSubscription.findUniqueOrThrow({ where: { id: sub.id } });
      expect(after.lastPushError).toBe(words);
    }
  });
});
