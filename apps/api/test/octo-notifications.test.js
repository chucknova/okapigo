/**
 * Session 17c-2: OCTO notifications. An OTA subscribes an address of its own
 * (/octo/notifications/subscriptions); the sync job tells it there, within a minute, what
 * changed: a tour (PRODUCT_UPDATE), departures' seats (AVAILABILITY_UPDATE), one of its
 * bookings (BOOKING_UPDATE). It then fetches the thing again.
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { pushChannelUpdates } from '@okapigo/db';
import { NotificationSchema, SubscriptionSchema, checkNotificationUrl } from '@okapigo/shared/octo';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

/** @param {string} key */
const octo = (key) => {
  /** @param {'get' | 'post' | 'patch' | 'delete'} m @param {string} url */
  const call = (m, url) =>
    request(ctx.app)
      [m](url)
      .set('Authorization', `Bearer ${key}`)
      .set('Octo-Capabilities', 'notifications');
  return {
    get: (/** @type {string} */ u) => call('get', u),
    post: (/** @type {string} */ u) => call('post', u),
    patch: (/** @type {string} */ u) => call('patch', u),
    delete: (/** @type {string} */ u) => call('delete', u),
  };
};

const SUBS = '/octo/notifications/subscriptions';
const ALL = ['PRODUCT_UPDATE', 'AVAILABILITY_UPDATE', 'BOOKING_UPDATE'];

async function setup() {
  const s = await ctx.seedOperator();
  const api = octo(`octo_dev_${s.operator.slug}`);
  const channel = await ctx.prisma.channel.findFirstOrThrow({
    where: { operatorId: s.operator.id },
  });
  const tarkwa = await ctx.prisma.product.findFirstOrThrow({
    where: { operatorId: s.operator.id, slug: 'tarkwa-bay-beach-and-lagoon' },
  });
  /** @param {string[]} notificationTypes */
  const subscribe = async (notificationTypes = ALL) => {
    const r = await api
      .post(SUBS)
      .send({ url: 'http://localhost:4400/octo-updates', notificationTypes });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };
  /** A pretend OTA: what it was told, or a failure. */
  const ota = (fail = false) => {
    /** @type {any[]} */
    const told = [];
    return {
      told,
      run: () =>
        pushChannelUpdates(ctx.prisma, {
          operatorId: s.operator.id,
          send: async (_sub, n) => {
            if (fail) throw new Error('it answered 503');
            expect(NotificationSchema.safeParse(n).error).toBeUndefined();
            told.push(n);
          },
        }),
      /** What it was told, short: "TYPE productId|uuid [from–to]". */
      lines: () =>
        told.map((n) =>
          [
            n.notificationType,
            n.data.productId ?? n.data.uuid,
            n.data.localDateStart,
            n.data.localDateEnd,
          ]
            .filter(Boolean)
            .join(' '),
        ),
      clear: () => (told.length = 0),
    };
  };
  const lagosDay = (/** @type {Date} */ at) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(at);
  return { ...s, api, channel, tarkwa, subscribe, ota, lagosDay };
}

describe('subscribing (OCTO notifications)', () => {
  it('create, list, read, change, delete; the spec’s own spelling works too', async () => {
    const s = await setup();
    const made = await s.subscribe(['AVAILABILITY_UPDATE', 'AVAILABILITY_UPDATE']);
    expect(SubscriptionSchema.safeParse(made).success).toBe(true);
    expect(made).toMatchObject({
      url: 'http://localhost:4400/octo-updates',
      notificationTypes: ['AVAILABILITY_UPDATE'],
      headers: {},
    });
    const typo = await s.api.post('/octo/notifications/subcriptions').send({
      url: 'http://localhost:4401/x',
      notificationTypes: ['BOOKING_UPDATE'],
      headers: { 'Api-Key': 'sojourna-secret' },
    });
    expect(typo.status).toBe(200);
    expect((await s.api.get(SUBS)).body.map((/** @type {any} */ x) => x.id)).toEqual([
      made.id,
      typo.body.id,
    ]);
    expect((await s.api.get(`${SUBS}/${typo.body.id}`)).body.headers).toEqual({
      'Api-Key': 'sojourna-secret',
    });
    const changed = await s.api
      .patch(`${SUBS}/${made.id}`)
      .send({ notificationTypes: ['PRODUCT_UPDATE'] });
    expect(changed.body).toMatchObject({ notificationTypes: ['PRODUCT_UPDATE'], url: made.url });
    expect((await s.api.delete(`${SUBS}/${made.id}`)).status).toBe(200);
    expect((await s.api.get(SUBS)).body).toHaveLength(1);
    const gone = await s.api.get(`${SUBS}/${made.id}`);
    expect(gone.status).toBe(400);
    expect(gone.body.error).toBe('BAD_REQUEST');
  });

  it('refused: an unknown type, none, a header we set ourselves, not a web address', async () => {
    const s = await setup();
    const url = 'http://localhost:4400/x';
    for (const body of [
      { url, notificationTypes: ['SEATS'] },
      { url, notificationTypes: [] },
      { url, notificationTypes: ['PRODUCT_UPDATE'], headers: { Host: 'evil.example' } },
      { url, notificationTypes: ['PRODUCT_UPDATE'], headers: { 'Bad Name': 'x' } },
      { url, notificationTypes: ['PRODUCT_UPDATE'], headers: { A: 'one\r\ntwo' } },
      { url: 'ftp://x', notificationTypes: ['PRODUCT_UPDATE'] },
    ]) {
      const r = await s.api.post(SUBS).send(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error).toBe('BAD_REQUEST');
    }
  });

  it('another channel’s subscriptions are not this one’s', async () => {
    const s = await setup();
    const mine = await s.subscribe();
    const other = await ctx.seedOperator();
    const theirs = octo(`octo_dev_${other.operator.slug}`);
    expect((await theirs.get(SUBS)).body).toEqual([]);
    expect((await theirs.get(`${SUBS}/${mine.id}`)).status).toBe(400);
    expect((await theirs.delete(`${SUBS}/${mine.id}`)).status).toBe(400);
  });

  it('the address rule: https and public in production; localhost in development', () => {
    expect(checkNotificationUrl('https://ota.example/hooks', true)).toEqual({
      ok: true,
      url: 'https://ota.example/hooks',
    });
    for (const bad of [
      'http://ota.example/hooks',
      'https://localhost/x',
      'https://api.localhost/x',
      'https://127.0.0.1/x',
      'https://10.0.0.5/x',
      'https://172.16.0.1/x',
      'https://192.168.1.10/x',
      'https://169.254.169.254/latest',
      'https://[::1]/x',
      'https://db.internal/x',
    ]) {
      expect(checkNotificationUrl(bad, true), bad).toEqual({
        ok: false,
        problem: 'Use a public https:// address.',
      });
    }
    expect(checkNotificationUrl('https://172.32.0.1/x', true).ok).toBe(true);
    expect(checkNotificationUrl('http://localhost:4400/x', false)).toEqual({
      ok: true,
      url: 'http://localhost:4400/x',
    });
    expect(checkNotificationUrl('ftp://x', false)).toEqual({
      ok: false,
      problem: 'An address starting with https://',
    });
    expect(checkNotificationUrl('not a url', false)).toEqual({
      ok: false,
      problem: 'That isn’t a web address.',
    });
  });
});

describe('the push (what changed, within a minute)', () => {
  it('nothing without a subscription; the first time, everything; then only what changed', async () => {
    const s = await setup();
    const ota = s.ota();
    expect(await ota.run()).toEqual({ subscriptions: 0, sent: 0, failed: 0 });
    const sub = await s.subscribe(['PRODUCT_UPDATE', 'AVAILABILITY_UPDATE']);
    expect(await ota.run()).toMatchObject({ subscriptions: 1, sent: 10, failed: 0 });
    expect(ota.told.filter((n) => n.notificationType === 'PRODUCT_UPDATE')).toHaveLength(5);
    const days = ota.told.filter((n) => n.notificationType === 'AVAILABILITY_UPDATE');
    expect(days).toHaveLength(5); // one per tour, its 60 days
    expect(ota.told[0]).toMatchObject({ subscriptionId: sub.id });
    const saved = await ctx.prisma.channelSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(saved.lastPushAt).not.toBeNull();

    // Nothing changed: nothing told.
    ota.clear();
    await ota.run();
    expect(ota.told).toEqual([]);

    // A hold on one departure (from the website, say): that tour, that day.
    const d = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: s.tarkwa.id, startsAt: { gt: new Date(Date.now() + 86_400_000) } },
      orderBy: { startsAt: 'asc' },
    });
    const day = s.lagosDay(d.startsAt);
    await ctx.prisma.departure.update({ where: { id: d.id }, data: { seatsHeld: 7 } });
    await ota.run();
    expect(ota.lines()).toEqual([`AVAILABILITY_UPDATE ${s.tarkwa.id} ${day} ${day}`]);
    expect(ota.told[0].data.optionId).toBe('DEFAULT');

    // A price change: that tour, fetch it again.
    ota.clear();
    await ctx.prisma.priceCategory.updateMany({
      where: { productId: s.tarkwa.id, key: 'adult' },
      data: { amountKobo: 4_500_000 },
    });
    await ota.run();
    expect(ota.lines()).toEqual([`PRODUCT_UPDATE ${s.tarkwa.id}`]);

    // Called off, and another removed from the schedule: both days, once; the removed one
    // forgotten after.
    ota.clear();
    const later = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: s.tarkwa.id, startsAt: { gt: new Date(Date.now() + 20 * 86_400_000) } },
      orderBy: { startsAt: 'asc' },
    });
    await ctx.prisma.departure.update({ where: { id: d.id }, data: { status: 'cancelled' } });
    await ctx.prisma.departure.delete({ where: { id: later.id } });
    await ota.run();
    expect(ota.lines()).toEqual([
      `AVAILABILITY_UPDATE ${s.tarkwa.id} ${day} ${s.lagosDay(later.startsAt)}`,
    ]);
    const states = (/** @type {string} */ subject) =>
      ctx.prisma.notificationState.count({ where: { subscriptionId: sub.id, subject } });
    expect(await states(`departure:${later.id}`)).toBe(0);
    ota.clear();
    await ota.run();
    expect(ota.told).toEqual([]);

    // One whose time has come (as if told an hour ago, and it started a minute ago): nothing
    // to tell, just forgotten.
    const soon = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: s.tarkwa.id, status: 'scheduled', startsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
    });
    const started = new Date(Date.now() - 61_000);
    await ctx.prisma.departure.update({
      where: { id: soon.id },
      data: { startsAt: started, endsAt: new Date(Date.now() - 1_000) },
    });
    const was = await ctx.prisma.notificationState.findUniqueOrThrow({
      where: {
        subscriptionId_subject: { subscriptionId: sub.id, subject: `departure:${soon.id}` },
      },
    });
    await ctx.prisma.notificationState.update({
      where: {
        subscriptionId_subject: { subscriptionId: sub.id, subject: `departure:${soon.id}` },
      },
      data: { fingerprint: was.fingerprint.replace(/\|[^|]+$/, `|${started.toISOString()}`) },
    });
    await ota.run();
    expect(ota.told).toEqual([]);
    expect(await states(`departure:${soon.id}`)).toBe(0);
  });

  it('a tour off sale: told, its days closed; taken off the channel: told once, then forgotten', async () => {
    const s = await setup();
    const sub = await s.subscribe(['PRODUCT_UPDATE', 'AVAILABILITY_UPDATE']);
    const ota = s.ota();
    await ota.run();
    ota.clear();
    await ctx.prisma.product.update({ where: { id: s.tarkwa.id }, data: { status: 'draft' } });
    await ota.run();
    expect(ota.lines()).toEqual([
      `PRODUCT_UPDATE ${s.tarkwa.id}`,
      expect.stringMatching(new RegExp(`^AVAILABILITY_UPDATE ${s.tarkwa.id} \\d{4}-`)),
    ]);
    // Another tour taken off the channel.
    const walk = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: s.operator.id, slug: 'lagos-island-heritage-walk' },
    });
    ota.clear();
    await ctx.prisma.channelProduct.deleteMany({ where: { productId: walk.id } });
    await ota.run();
    expect(ota.lines()).toEqual([
      `PRODUCT_UPDATE ${walk.id}`,
      expect.stringMatching(new RegExp(`^AVAILABILITY_UPDATE ${walk.id} \\d{4}-`)),
    ]);
    expect(
      await ctx.prisma.notificationState.count({
        where: { subscriptionId: sub.id, subject: `product:${walk.id}` },
      }),
    ).toBe(0);
    ota.clear();
    await ota.run();
    expect(ota.told).toEqual([]);
  });

  it('its bookings: told when one changes (e.g. the business cancels it); only what it asked for', async () => {
    const s = await setup();
    await s.subscribe(['BOOKING_UPDATE']);
    const ota = s.ota();
    await ota.run();
    expect(ota.told).toEqual([]); // no bookings yet, and no tours or seats asked for
    const d = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: s.tarkwa.id, startsAt: { gt: new Date(Date.now() + 4 * 86_400_000) } },
      orderBy: { startsAt: 'asc' },
    });
    await s.api.post('/octo/bookings').send({
      uuid: 'n-1',
      productId: s.tarkwa.id,
      optionId: 'DEFAULT',
      availabilityId: d.id,
      unitItems: [{ unitId: 'adult' }],
    });
    await ota.run();
    expect(ota.lines()).toEqual(['BOOKING_UPDATE n-1']);
    ota.clear();
    await ota.run();
    expect(ota.told).toEqual([]);
    // The business cancels it (weather): told.
    const b = await ctx.prisma.booking.findFirstOrThrow({
      where: { channelBooking: { uuid: 'n-1' } },
    });
    await ctx.prisma.booking.update({ where: { id: b.id }, data: { status: 'cancelled' } });
    await ota.run();
    expect(ota.lines()).toEqual(['BOOKING_UPDATE n-1']);
    // Its day long past: nothing more about it, and forgotten.
    ota.clear();
    await ctx.prisma.departure.update({
      where: { id: d.id },
      data: { startsAt: new Date(Date.now() - 3 * 86_400_000 + 4_321) },
    });
    await ota.run();
    expect(ota.told).toEqual([]);
    expect(
      await ctx.prisma.notificationState.count({
        where: { subject: { startsWith: 'booking:' }, subscription: { channelId: s.channel.id } },
      }),
    ).toBe(0);
  });

  it('an OTA that’s down: the error kept, nothing remembered, told again next time', async () => {
    const s = await setup();
    const sub = await s.subscribe(['PRODUCT_UPDATE']);
    expect(await s.ota(true).run()).toMatchObject({ failed: 1, sent: 0 });
    const kept = await ctx.prisma.channelSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(kept).toMatchObject({ lastPushError: 'it answered 503', lastPushAt: null });
    expect(await ctx.prisma.notificationState.count({ where: { subscriptionId: sub.id } })).toBe(0);
    const up = s.ota();
    await up.run();
    expect(up.told).toHaveLength(5);
    const after = await ctx.prisma.channelSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.lastPushError).toBeNull();
    // A new address: the old one's error is gone.
    await ctx.prisma.channelSubscription.update({
      where: { id: sub.id },
      data: { lastPushError: 'it answered 503' },
    });
    await s.api.patch(`${SUBS}/${sub.id}`).send({ url: 'http://localhost:4401/new' });
    const moved = await ctx.prisma.channelSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(moved).toMatchObject({ url: 'http://localhost:4401/new', lastPushError: null });
  });

  it('a switched-off channel isn’t told', async () => {
    const s = await setup();
    await s.subscribe();
    await ctx.prisma.channel.update({ where: { id: s.channel.id }, data: { isActive: false } });
    expect((await s.ota().run()).subscriptions).toBe(0);
  });
});
