/**
 * Session 17c: the push job tells each OTA, at its webhook, what changed: a signed POST,
 * five seconds at most, and words for the owner when it doesn't land.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import { pino } from 'pino';
import { createPrismaClient, seedDemoOperator, webhookSecret } from '@okapigo/db';
import { JOBS } from '@okapigo/jobs';
import { createProcessors } from '../src/processors.js';
import { createSimulatorProvider } from '@okapigo/payments';

const logger = pino({ level: 'silent' });
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });
const SECRET = 'a-test-secret-that-is-at-least-32-characters';
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
 * A business whose mock OTA has a webhook, and the push job with a pretend fetch.
 * @param {(url: string, init: any) => Promise<any>} fetch
 */
async function setup(fetch) {
  const operator = await seedDemoOperator(prisma, { slug: `test-${randomUUID().slice(0, 8)}` });
  created.push(operator.id);
  const channel = await prisma.channel.update({
    where: { operatorId_name: { operatorId: operator.id, name: 'Mock OTA' } },
    data: { webhookUrl: 'http://localhost:4400/octo-updates' },
  });
  const processors = createProcessors({
    prisma,
    logger,
    provider: createSimulatorProvider({ baseUrl: 'http://localhost:4000' }),
    authSecret: SECRET,
    fetch: /** @type {any} */ (fetch),
  });
  const run = () => processors[JOBS.pushChannels]({ operatorId: operator.id });
  return { operator, channel, run };
}

describe('push-channels', () => {
  it('a signed JSON POST to the webhook; the OTA can check it with its secret', async () => {
    /** @type {Array<{ url: string, init: any }>} */
    const calls = [];
    const { channel, run } = await setup(async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    });
    const before = Math.floor(Date.now() / 1000);
    expect(await run()).toMatchObject({ channels: 1, failed: 0 });
    expect(calls.length).toBeGreaterThan(5);
    const { url, init } = calls[0];
    expect(url).toBe('http://localhost:4400/octo-updates');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers['Content-Type']).toBe('application/json');
    const [, t, v1] =
      /^t=(\d+),v1=([0-9a-f]{64})$/.exec(init.headers['Octo-Webhook-Signature']) ?? [];
    expect(Number(t)).toBeGreaterThanOrEqual(before);
    expect(Number(t)).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    // What the OTA does: its secret, the timestamp and the exact body.
    const secret = createHmac('sha256', SECRET)
      .update(`channel-webhook:${channel.id}`)
      .digest('hex');
    expect(secret).toBe(webhookSecret(SECRET, channel.id));
    expect(v1).toBe(createHmac('sha256', secret).update(`${t}.${init.body}`).digest('hex'));
    expect(JSON.parse(init.body)).toHaveProperty('event');
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
      const { channel, run } = await setup(fetch);
      expect(await run()).toMatchObject({ sent: 0, failed: 1 });
      const after = await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
      expect(after.lastPushError).toBe(words);
    }
  });
});
