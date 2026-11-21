/**
 * Session 17c: the channel manager.
 *   - the channels in words (tours, sales, what each owes), for owners; managers look
 *   - connecting one (its key and signing secret shown once), changing it, a new key
 *   - "via Mock OTA" on the bookings desk, the booking's page and the departure
 *   - the push: what changed since each OTA was last told, told once it's accepted
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';
import { pushChannelUpdates, signWebhook, webhookSecret } from '@okapigo/db';
import { checkWebhookUrl, owedBy } from '../src/routes/channels.js';
import { ProductSchema } from '@okapigo/shared/octo';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

/** @param {string} token */
const as = (token) => {
  /** @param {'get' | 'post' | 'patch' | 'put'} m @param {string} url */
  const call = (m, url) => request(ctx.app)[m](url).set('Authorization', `Bearer ${token}`);
  return {
    get: (/** @type {string} */ u) => call('get', u),
    post: (/** @type {string} */ u) => call('post', u),
    patch: (/** @type {string} */ u) => call('patch', u),
    put: (/** @type {string} */ u) => call('put', u),
  };
};
/** @param {string} key */
const octo = (key) => {
  /** @param {'get' | 'post'} m @param {string} url */
  const call = (m, url) =>
    request(ctx.app)
      [m](url)
      .set('Authorization', `Bearer ${key}`)
      .set('Octo-Capabilities', 'octo/pricing');
  return {
    get: (/** @type {string} */ u) => call('get', u),
    post: (/** @type {string} */ u) => call('post', u),
  };
};

async function setup() {
  const s = await ctx.seedOperator();
  const owner = as(await ctx.tokenFor(s.owner.id));
  const manager = as(await ctx.tokenFor(s.manager.id));
  const guide = as(await ctx.tokenFor(s.guides[0].id));
  const mock = await ctx.prisma.channel.findFirstOrThrow({ where: { operatorId: s.operator.id } });
  const api = octo(`octo_dev_${s.operator.slug}`);
  const tarkwa = await ctx.prisma.product.findFirstOrThrow({
    where: { operatorId: s.operator.id, slug: 'tarkwa-bay-beach-and-lagoon' },
  });
  /** An OTA sale of two adults on a Tarkwa Bay departure; returns the booking. @param {string} uuid */
  const sale = async (uuid, api2 = api) => {
    const d = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: tarkwa.id, startsAt: { gt: new Date(Date.now() + 4 * 86_400_000) } },
      orderBy: { startsAt: 'asc' },
    });
    await api2.post('/octo/bookings').send({
      uuid,
      productId: tarkwa.id,
      optionId: 'DEFAULT',
      availabilityId: d.id,
      unitItems: [{ unitId: 'adult' }, { unitId: 'adult' }],
    });
    const c = await api2
      .post(`/octo/bookings/${uuid}/confirm`)
      .send({ contact: { fullName: 'Ada Eze', emailAddress: 'ada@guest.example' } });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    return ctx.prisma.booking.findFirstOrThrow({ where: { channelBooking: { uuid } } });
  };
  return { ...s, owner, manager, guide, mock, api, tarkwa, sale };
}

describe('the channels, in words', () => {
  it('the seeded mock OTA; owners and managers see it, guides don’t', async () => {
    const s = await setup();
    const res = await s.owner.get('/api/channels');
    expect(res.status).toBe(200);
    expect(res.body.octoEndpoint).toBe('http://localhost:4000/octo');
    expect(res.body.channels).toEqual([
      expect.objectContaining({
        id: s.mock.id,
        name: 'Mock OTA',
        status: 'Connected',
        commission: '20%',
        commissionBasisPoints: 2000,
        apiKeyHint: `…${`octo_dev_${s.operator.slug}`.slice(-4)}`,
        toursLine: '5 of 5 tours',
        salesLine: 'No sales this month',
        owedKobo: 0,
        owedLine: 'Owes nothing',
        lastActivity: 'No bookings yet',
        webhookUrl: null,
        pushLine: 'No webhook: it asks when it needs to.',
      }),
    ]);
    // Never the key itself.
    expect(JSON.stringify(res.body)).not.toContain(`octo_dev_${s.operator.slug}`);
    expect((await s.manager.get('/api/channels')).status).toBe(200);
    expect(
      (await s.manager.patch(`/api/channels/${s.mock.id}`).send({ isActive: false })).status,
    ).toBe(403);
    expect((await s.guide.get('/api/channels')).status).toBe(403);
  });

  it('a sale and a refund: this month’s sales, and what it owes', async () => {
    const s = await setup();
    await s.sale('c-1');
    const after = (await s.owner.get('/api/channels')).body.channels[0];
    expect(after).toMatchObject({
      salesLine: '1 booking · ₦80,000 this month',
      owedKobo: 6_400_000,
      owedLine: '₦64,000 owed',
      lastActivity: expect.stringMatching(/^Last booking \d\d:\d\d$/),
    });
    // A hold not confirmed yet: not a sale, owes nothing.
    const d = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: s.tarkwa.id, startsAt: { gt: new Date(Date.now() + 4 * 86_400_000) } },
      orderBy: { startsAt: 'asc' },
    });
    const held = await s.api.post('/octo/bookings').send({
      uuid: 'c-held',
      productId: s.tarkwa.id,
      optionId: 'DEFAULT',
      availabilityId: d.id,
      unitItems: [{ unitId: 'adult' }],
    });
    expect(held.status).toBe(200);
    expect((await s.owner.get('/api/channels')).body.channels[0]).toMatchObject({
      salesLine: '1 booking · ₦80,000 this month',
      owedKobo: 6_400_000,
    });
    // Sold last month: not this month's sales, still owed.
    await ctx.prisma.channelBooking.update({
      where: { channelId_uuid: { channelId: s.mock.id, uuid: 'c-1' } },
      data: { confirmedAt: new Date(Date.now() - 40 * 86_400_000) },
    });
    expect((await s.owner.get('/api/channels')).body.channels[0]).toMatchObject({
      salesLine: 'No sales this month',
      owedKobo: 6_400_000,
    });
    // Cancelled 30 hours before: half back to the guest; it owes the other half's net.
    const b = await ctx.prisma.booking.findFirstOrThrow({
      where: { channelBooking: { uuid: 'c-1' } },
    });
    await ctx.prisma.departure.update({
      where: { id: b.departureId },
      data: { startsAt: new Date(Date.now() + 30 * 3_600_000) },
    });
    expect((await s.api.post('/octo/bookings/c-1/cancel').send({})).status).toBe(200);
    expect((await s.owner.get('/api/channels')).body.channels[0]).toMatchObject({
      owedKobo: 3_200_000,
      owedLine: '₦32,000 owed',
    });
    const page = (await s.owner.get(`/api/desk/bookings/${b.id}`)).body.booking;
    expect(page.money).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Mock OTA owes you',
          value: '₦32,000 (₦40,000 less 20%)',
        }),
      ]),
    );
  });

  it('one channel: its tours (on or not, and why) and its latest bookings', async () => {
    const s = await setup();
    const booking = await s.sale('c-2');
    // Another channel's sale isn't this one's.
    const other2 = await s.owner
      .post('/api/channels')
      .send({ name: 'Tripwell', commissionPercent: 15, productIds: [s.tarkwa.id] });
    await s.sale('t-1', octo(other2.body.apiKey));
    await ctx.prisma.product.update({ where: { id: s.tarkwa.id }, data: { status: 'draft' } });
    const res = await s.owner.get(`/api/channels/${s.mock.id}`);
    expect(res.status).toBe(200);
    expect(res.body.channel.tours).toHaveLength(5);
    expect(
      res.body.channel.tours.find((/** @type {any} */ t) => t.id === s.tarkwa.id),
    ).toMatchObject({
      on: true,
      note: 'Not on sale: the OTA won’t see it',
    });
    expect(res.body.channel.bookings).toEqual([
      expect.objectContaining({
        id: booking.id,
        reference: booking.reference,
        lead: 'Ada Eze',
        total: '₦80,000',
        status: 'paid',
      }),
    ]);
    const other = await ctx.seedOperator();
    const theirs = await ctx.prisma.channel.findFirstOrThrow({
      where: { operatorId: other.operator.id },
    });
    expect((await s.owner.get(`/api/channels/${theirs.id}`)).status).toBe(404);
  });
});

describe('connecting and changing a channel', () => {
  it('connect: its key and signing secret shown once; the key works with OCTO', async () => {
    const s = await setup();
    const walk = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: s.operator.id, slug: 'lagos-island-heritage-walk' },
    });
    const res = await s.owner.post('/api/channels').send({
      name: 'Tripwell',
      commissionPercent: 17.5,
      productIds: [walk.id],
      webhookUrl: 'http://localhost:4400/octo-updates',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.apiKey).toMatch(/^octo_[A-Za-z0-9_-]{43}$/);
    expect(res.body.webhookSecret).toBe(webhookSecret(TEST_AUTH_SECRET, res.body.channel.id));
    expect(res.body.channel).toMatchObject({
      name: 'Tripwell',
      commission: '17.5%',
      toursLine: '1 of 5 tours',
      webhookUrl: 'http://localhost:4400/octo-updates',
      pushLine: 'Updates start within 30 seconds.',
    });
    const products = (await octo(res.body.apiKey).get('/octo/products')).body;
    expect(products.map((/** @type {any} */ p) => p.id)).toEqual([walk.id]);
    // The key isn't kept: only its hash.
    const row = await ctx.prisma.channel.findUniqueOrThrow({ where: { id: res.body.channel.id } });
    expect(JSON.stringify(row)).not.toContain(res.body.apiKey);
    // Seen again: no key.
    expect(JSON.stringify((await s.owner.get('/api/channels')).body)).not.toContain(
      res.body.apiKey,
    );
  });

  it('refused: a name already used, someone else’s tour, a bad commission, a bad address', async () => {
    const s = await setup();
    const dup = await s.owner
      .post('/api/channels')
      .send({ name: 'Mock OTA', commissionPercent: 10 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('NAME_TAKEN');
    const other = await ctx.seedOperator();
    const theirs = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: other.operator.id },
    });
    const foreign = await s.owner
      .post('/api/channels')
      .send({ name: 'X Tours', commissionPercent: 10, productIds: [theirs.id] });
    expect(foreign.body.error.code).toBe('INVALID_TOUR');
    for (const commissionPercent of [-1, 101, 12.345]) {
      expect(
        (await s.owner.post('/api/channels').send({ name: 'X Tours', commissionPercent })).status,
      ).toBe(400);
    }
    expect(
      (
        await s.owner
          .post('/api/channels')
          .send({ name: 'X Tours', commissionPercent: 10, webhookUrl: 'ftp://x' })
      ).status,
    ).toBe(400);
  });

  it('change: tours, commission (new sales only), the webhook; switched off, its key stops', async () => {
    const s = await setup();
    const old = await s.sale('c-3');
    const res = await s.owner.patch(`/api/channels/${s.mock.id}`).send({
      productIds: [s.tarkwa.id],
      commissionPercent: 25,
      webhookUrl: 'http://localhost:4400/hook',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.channel).toMatchObject({ toursLine: '1 of 5 tours', commission: '25%' });
    expect((await s.api.get('/octo/products')).body).toHaveLength(1);
    // The old sale keeps its 20%; a new one owes at 25%.
    expect(
      (await ctx.prisma.channelBooking.findUniqueOrThrow({ where: { bookingId: old.id } }))
        .commissionBasisPoints,
    ).toBe(2000);
    await s.sale('c-4');
    expect((await s.owner.get('/api/channels')).body.channels[0].owedKobo).toBe(
      6_400_000 + 6_000_000,
    );
    // A new address: the last one's error is gone.
    await ctx.prisma.channel.update({
      where: { id: s.mock.id },
      data: { lastPushError: 'it answered 503' },
    });
    await s.owner
      .patch(`/api/channels/${s.mock.id}`)
      .send({ webhookUrl: 'http://localhost:4401/hook' });
    expect((await s.owner.get('/api/channels')).body.channels[0].pushLine).toBe(
      'Updates start within 30 seconds.',
    );
    // A webhook cleared: it only asks again.
    await s.owner.patch(`/api/channels/${s.mock.id}`).send({ webhookUrl: null });
    expect((await s.owner.get('/api/channels')).body.channels[0].webhookUrl).toBeNull();
    // Switched off: its key stops working at once.
    await s.owner.patch(`/api/channels/${s.mock.id}`).send({ isActive: false });
    expect((await s.api.get('/octo/supplier')).status).toBe(403);
    expect((await s.owner.get('/api/channels')).body.channels[0].status).toBe('Switched off');
  });

  it('a new key: the old one stops at once', async () => {
    const s = await setup();
    const res = await s.owner.post(`/api/channels/${s.mock.id}/key`);
    expect(res.status).toBe(200);
    expect(res.body.apiKeyHint).toBe(`…${res.body.apiKey.slice(-4)}`);
    expect((await s.api.get('/octo/supplier')).status).toBe(403);
    expect((await octo(res.body.apiKey).get('/octo/supplier')).status).toBe(200);
  });

  it('the webhook address rule: https and public in production; localhost in development', () => {
    expect(checkWebhookUrl(null, true)).toEqual({ ok: true, url: null });
    expect(checkWebhookUrl('https://ota.example/hooks', true)).toEqual({
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
      expect(checkWebhookUrl(bad, true), bad).toEqual({
        ok: false,
        problem: 'Use the OTA’s public https:// address.',
      });
    }
    expect(checkWebhookUrl('https://172.32.0.1/x', true).ok).toBe(true);
    expect(checkWebhookUrl('http://localhost:4400/x', false)).toEqual({
      ok: true,
      url: 'http://localhost:4400/x',
    });
    expect(checkWebhookUrl('ftp://x', false)).toEqual({
      ok: false,
      problem: 'An address starting with https://',
    });
  });

  it('what an OTA owes: each sale’s net less each refund’s, at the share frozen at the sale', () => {
    expect(
      owedBy([
        {
          commissionBasisPoints: 2000,
          booking: {
            payments: [{ provider: 'ota', status: 'succeeded', amountKobo: 8_000_000 }],
            refunds: [{ provider: 'ota', status: 'processed', amountKobo: 4_000_000 }],
          },
        },
        {
          commissionBasisPoints: 1000,
          booking: {
            payments: [
              { provider: 'ota', status: 'succeeded', amountKobo: 1_000_000 },
              { provider: 'paystack', status: 'succeeded', amountKobo: 999 },
            ],
            refunds: [{ provider: 'ota', status: 'failed', amountKobo: 1_000_000 }],
          },
        },
      ]),
    ).toBe(6_400_000 - 3_200_000 + 900_000);
  });
});

describe('"via Mock OTA"', () => {
  it('on the bookings desk, the booking’s page and the departure', async () => {
    const s = await setup();
    const booking = await s.sale('c-5');
    const list = await s.owner.get('/api/desk/bookings?filter=all');
    expect(list.body.list.rows.find((/** @type {any} */ r) => r.id === booking.id).via).toBe(
      'via Mock OTA',
    );
    const page = (await s.owner.get(`/api/desk/bookings/${booking.id}`)).body.booking;
    expect(page.refLine).toContain(' · MOCK OTA · ');
    expect(page.money).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringMatching(/^Paid by Mock OTA · /),
          value: '₦80,000 paid',
        }),
        expect.objectContaining({
          label: 'Mock OTA owes you',
          value: '₦64,000 (₦80,000 less 20%)',
        }),
      ]),
    );
    expect(page.timeline[0]).toMatch(/ · booked through Mock OTA$/);
    const dep = (await s.owner.get(`/api/departures/${booking.departureId}/overview`)).body;
    const row = dep.departure.rows.find((/** @type {any} */ r) => r.id === booking.id);
    expect(row).toMatchObject({ via: 'via Mock OTA', pay: 'Paid by Mock OTA', payTone: 'paid' });
  });
});

describe('the push (what changed, within 60 seconds)', () => {
  /** A pretend OTA: what it was told, or a failure. */
  const pretendOta = (fail = false) => {
    /** @type {any[]} */
    const told = [];
    return {
      told,
      send: async (/** @type {any} */ _channel, /** @type {any} */ payload) => {
        if (fail) throw new Error('it answered 503');
        told.push(payload);
      },
    };
  };

  it('nothing without a webhook; the first time, everything; then only what changed', async () => {
    const s = await setup();
    const ota = pretendOta();
    expect(
      await pushChannelUpdates(ctx.prisma, { send: ota.send, operatorId: s.operator.id }),
    ).toEqual({
      channels: 0,
      sent: 0,
      failed: 0,
    });
    await ctx.prisma.channel.update({
      where: { id: s.mock.id },
      data: { webhookUrl: 'http://localhost:4400/hook' },
    });
    const first = await pushChannelUpdates(ctx.prisma, {
      send: ota.send,
      operatorId: s.operator.id,
    });
    expect(first).toMatchObject({ channels: 1, failed: 0 });
    expect(ota.told.filter((p) => p.event === 'product_update')).toHaveLength(5);
    const lines = ota.told
      .filter((p) => p.event === 'availability_update')
      .flatMap((p) => p.availabilities);
    expect(lines.length).toBeGreaterThan(50); // 60 days of five tours' departures
    expect(lines[0]).toMatchObject({ status: 'AVAILABLE', available: true });
    expect(ota.told[0]).toMatchObject({ supplierId: s.operator.id, sentAt: expect.any(String) });
    expect(
      (await ctx.prisma.channel.findUniqueOrThrow({ where: { id: s.mock.id } })).lastPushAt,
    ).not.toBeNull();

    // Nothing changed: nothing told.
    ota.told.length = 0;
    await pushChannelUpdates(ctx.prisma, { send: ota.send, operatorId: s.operator.id });
    expect(ota.told).toEqual([]);

    // A sale on the website's side of things (a hold): that departure, its seats.
    const d = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: s.tarkwa.id, startsAt: { gt: new Date(Date.now() + 86_400_000) } },
      orderBy: { startsAt: 'asc' },
    });
    await ctx.prisma.departure.update({ where: { id: d.id }, data: { seatsHeld: 7 } });
    await pushChannelUpdates(ctx.prisma, { send: ota.send, operatorId: s.operator.id });
    expect(ota.told).toEqual([
      expect.objectContaining({
        event: 'availability_update',
        productId: s.tarkwa.id,
        optionId: 'DEFAULT',
        availabilities: [
          expect.objectContaining({
            id: d.id,
            vacancies: 5,
            status: 'LIMITED',
            available: true,
            capacity: 12,
          }),
        ],
      }),
    ]);

    // Full: sold out, not available.
    ota.told.length = 0;
    await ctx.prisma.departure.update({ where: { id: d.id }, data: { seatsHeld: 12 } });
    await pushChannelUpdates(ctx.prisma, { send: ota.send, operatorId: s.operator.id });
    expect(ota.told[0].availabilities).toEqual([
      expect.objectContaining({ id: d.id, vacancies: 0, status: 'SOLD_OUT', available: false }),
    ]);

    // A price change: that tour, fetch it again.
    ota.told.length = 0;
    await ctx.prisma.priceCategory.updateMany({
      where: { productId: s.tarkwa.id, key: 'adult' },
      data: { amountKobo: 4_500_000 },
    });
    await pushChannelUpdates(ctx.prisma, { send: ota.send, operatorId: s.operator.id });
    expect(ota.told).toEqual([
      expect.objectContaining({ event: 'product_update', productId: s.tarkwa.id, available: true }),
    ]);

    // Called off: closed.
    ota.told.length = 0;
    await ctx.prisma.departure.update({ where: { id: d.id }, data: { status: 'cancelled' } });
    await pushChannelUpdates(ctx.prisma, { send: ota.send, operatorId: s.operator.id });
    expect(ota.told[0].availabilities).toEqual([
      expect.objectContaining({ id: d.id, status: 'CLOSED', available: false, vacancies: 0 }),
    ]);

    // Removed from the schedule (an empty one deleted): closed, then forgotten.
    ota.told.length = 0;
    const empty = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: s.tarkwa.id, startsAt: { gt: new Date(Date.now() + 20 * 86_400_000) } },
      orderBy: { startsAt: 'asc' },
    });
    await ctx.prisma.departure.delete({ where: { id: empty.id } });
    await pushChannelUpdates(ctx.prisma, { send: ota.send, operatorId: s.operator.id });
    expect(ota.told).toEqual([
      expect.objectContaining({
        availabilities: [expect.objectContaining({ id: empty.id, status: 'CLOSED' })],
      }),
    ]);
    expect(
      await ctx.prisma.channelSyncState.count({
        where: { channelId: s.mock.id, subject: `departure:${empty.id}` },
      }),
    ).toBe(0);
    ota.told.length = 0;
    await pushChannelUpdates(ctx.prisma, { send: ota.send, operatorId: s.operator.id });
    expect(ota.told).toEqual([]);

    // One that's now in the past: nothing to tell, just forgotten.
    const soon = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: s.tarkwa.id, status: 'scheduled', startsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
    });
    await ctx.prisma.departure.update({
      where: { id: soon.id },
      data: { startsAt: new Date(Date.now() - 61_000), endsAt: new Date(Date.now() - 1_000) },
    });
    await pushChannelUpdates(ctx.prisma, { send: ota.send, operatorId: s.operator.id });
    expect(ota.told).toEqual([]);
    expect(
      await ctx.prisma.channelSyncState.count({
        where: { channelId: s.mock.id, subject: `departure:${soon.id}` },
      }),
    ).toBe(0);
  });

  it('a tour off sale: told, every departure closed; taken off the channel: closed, then forgotten', async () => {
    const s = await setup();
    await ctx.prisma.channel.update({
      where: { id: s.mock.id },
      data: { webhookUrl: 'http://localhost:4400/hook' },
    });
    const ota = pretendOta();
    await pushChannelUpdates(ctx.prisma, { send: ota.send, operatorId: s.operator.id });
    ota.told.length = 0;
    await ctx.prisma.product.update({ where: { id: s.tarkwa.id }, data: { status: 'draft' } });
    await pushChannelUpdates(ctx.prisma, { send: ota.send, operatorId: s.operator.id });
    expect(ota.told[0]).toMatchObject({
      event: 'product_update',
      productId: s.tarkwa.id,
      available: false,
    });
    const closed = ota.told.slice(1).flatMap((p) => p.availabilities);
    expect(closed.length).toBeGreaterThan(5);
    expect(closed.every((/** @type {any} */ l) => l.status === 'CLOSED')).toBe(true);
    // Another tour taken off the channel: its departures closed, then nothing more about it.
    const walk = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: s.operator.id, slug: 'lagos-island-heritage-walk' },
    });
    const walkDepartures = await ctx.prisma.channelSyncState.count({
      where: { channelId: s.mock.id, subject: { startsWith: 'departure:' } },
    });
    ota.told.length = 0;
    await ctx.prisma.channelProduct.deleteMany({ where: { productId: walk.id } });
    await pushChannelUpdates(ctx.prisma, { send: ota.send, operatorId: s.operator.id });
    expect(ota.told.length).toBeGreaterThan(0);
    expect(
      ota.told.every((p) => p.productId === walk.id && p.event === 'availability_update'),
    ).toBe(true);
    const lines = ota.told.flatMap((p) => p.availabilities);
    expect(
      lines.every((/** @type {any} */ l) => l.status === 'CLOSED' && l.localDateTimeStart),
    ).toBe(true);
    expect(
      await ctx.prisma.channelSyncState.count({
        where: { channelId: s.mock.id, subject: `product:${walk.id}` },
      }),
    ).toBe(0);
    expect(
      await ctx.prisma.channelSyncState.count({
        where: { channelId: s.mock.id, subject: { startsWith: 'departure:' } },
      }),
    ).toBe(walkDepartures - lines.length);
    ota.told.length = 0;
    await pushChannelUpdates(ctx.prisma, { send: ota.send, operatorId: s.operator.id });
    expect(ota.told).toEqual([]);
  });

  it('an OTA that’s down: the error kept, nothing remembered, told again next time', async () => {
    const s = await setup();
    await ctx.prisma.channel.update({
      where: { id: s.mock.id },
      data: { webhookUrl: 'http://localhost:4400/hook' },
    });
    const down = pretendOta(true);
    expect(
      await pushChannelUpdates(ctx.prisma, { send: down.send, operatorId: s.operator.id }),
    ).toMatchObject({
      failed: 1,
      sent: 0,
    });
    const c = await ctx.prisma.channel.findUniqueOrThrow({ where: { id: s.mock.id } });
    expect(c).toMatchObject({ lastPushError: 'it answered 503', lastPushAt: null });
    expect(await ctx.prisma.channelSyncState.count({ where: { channelId: s.mock.id } })).toBe(0);
    expect((await s.owner.get('/api/channels')).body.channels[0].pushLine).toBe(
      'Updates aren’t reaching it: it answered 503. Trying again every 30 seconds.',
    );
    const up = pretendOta();
    await pushChannelUpdates(ctx.prisma, { send: up.send, operatorId: s.operator.id });
    expect(up.told.length).toBeGreaterThan(5);
    const after = await ctx.prisma.channel.findUniqueOrThrow({ where: { id: s.mock.id } });
    expect(after.lastPushError).toBeNull();
    expect((await s.owner.get('/api/channels')).body.channels[0].pushLine).toMatch(
      /^Updates sent · last \d\d:\d\d$/,
    );
  });

  it('a switched-off channel isn’t told; the signature is the OTA’s to check', async () => {
    const s = await setup();
    await ctx.prisma.channel.update({
      where: { id: s.mock.id },
      data: { webhookUrl: 'http://localhost:4400/hook', isActive: false },
    });
    expect(
      (await pushChannelUpdates(ctx.prisma, { send: pretendOta().send, operatorId: s.operator.id }))
        .channels,
    ).toBe(0);
    const secret = webhookSecret('a'.repeat(32), 'ch-1');
    expect(secret).toBe(
      createHmac('sha256', 'a'.repeat(32)).update('channel-webhook:ch-1').digest('hex'),
    );
    expect(webhookSecret('a'.repeat(32), 'ch-2')).not.toBe(secret);
    const body = '{"event":"product_update"}';
    expect(signWebhook(secret, 1_700_000_000, body)).toBe(
      `t=1700000000,v1=${createHmac('sha256', secret).update(`1700000000.${body}`).digest('hex')}`,
    );
  });

  it('what the OTA fetches after a price change matches', async () => {
    const s = await setup();
    await ctx.prisma.priceCategory.updateMany({
      where: { productId: s.tarkwa.id, key: 'adult' },
      data: { amountKobo: 4_500_000 },
    });
    const p = (await s.api.get(`/octo/products/${s.tarkwa.id}`)).body;
    expect(ProductSchema.safeParse(p).success).toBe(true);
    expect(p.options[0].units[0].pricingFrom[0].retail).toBe(4_500_000);
  });
});
