// @vitest-environment node
/**
 * Sojourna's server (17d-1): its pages' API in front of the supplier's OCTO API, its OCTO
 * client, and its own store. Against a pretend supplier: what Sojourna asks, and what it says
 * back when things go wrong.
 */
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, HOLD_MINUTES } from '../server/app.js';
import { createOctoClient, OctoClientError, CAPABILITIES } from '../server/octo-client.js';
import { createStore } from '../server/store.js';
import {
  keepSubscribing,
  makeNotifyKey,
  NOTIFICATION_TYPES,
  subscribe,
} from '../server/notifications.js';

/** @type {string[]} */
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempFile = () => {
  const d = mkdtempSync(join(tmpdir(), 'sojourna-'));
  dirs.push(d);
  return join(d, 'bookings.json');
};

/**
 * A pretend supplier: answers by "METHOD /path", records what it was asked.
 * @param {Record<string, (body: any) => any>} routes
 */
function supplier(routes) {
  /** @type {Array<{ method: string, path: string, body: any }>} */
  const asked = [];
  /** @param {string} method */
  const handle = (method) => async (/** @type {string} */ path, /** @type {any} */ body) => {
    asked.push({ method, path, body });
    const route = routes[`${method} ${path}`];
    if (!route) throw new OctoClientError('octo', `No ${method} ${path}`, { code: 'BAD_REQUEST' });
    return route(body);
  };
  return { asked, octo: { get: handle('GET'), post: handle('POST'), del: handle('DELETE') } };
}

const BOOKING = {
  uuid: 'u-1',
  productId: 'p1',
  supplierReference: 'ILT-6WQ3PZ',
  status: 'ON_HOLD',
  utcExpiresAt: '2026-12-01T10:15:00Z',
};

describe('the pages’ API', () => {
  it('the business and its tours, passed on as OCTO gives them', async () => {
    const s = supplier({
      'GET /supplier': () => ({ name: 'Ìrìn Lagos Tours' }),
      'GET /products': () => [{ id: 'p1' }],
      'GET /products/p1': () => ({ id: 'p1', title: 'Tarkwa' }),
    });
    const app = createApp({ octo: s.octo, store: createStore(tempFile()) });
    expect((await request(app).get('/api/supplier')).body).toEqual({
      supplier: { name: 'Ìrìn Lagos Tours' },
    });
    expect((await request(app).get('/api/experiences')).body).toEqual({
      experiences: [{ id: 'p1' }],
    });
    expect((await request(app).get('/api/experiences/p1')).body.experience.title).toBe('Tarkwa');
    expect((await request(app).get('/api/nothing')).status).toBe(404);
  });

  it('the calendar and a day’s times: a date range to OCTO; bad dates refused', async () => {
    const s = supplier({
      'POST /availability/calendar': () => [{ localDate: '2026-12-12' }],
      'POST /availability': () => [{ id: 'd1' }],
    });
    const app = createApp({ octo: s.octo, store: createStore(tempFile()) });
    const cal = await request(app).get(
      '/api/experiences/p1/calendar?from=2026-12-01&to=2026-12-31',
    );
    expect(cal.body.days).toEqual([{ localDate: '2026-12-12' }]);
    const times = await request(app).get('/api/experiences/p1/times?date=2026-12-12');
    expect(times.body.times).toEqual([{ id: 'd1' }]);
    expect(s.asked.map((a) => a.body)).toEqual([
      {
        productId: 'p1',
        optionId: 'DEFAULT',
        localDateStart: '2026-12-01',
        localDateEnd: '2026-12-31',
      },
      {
        productId: 'p1',
        optionId: 'DEFAULT',
        localDateStart: '2026-12-12',
        localDateEnd: '2026-12-12',
      },
    ]);
    const bad = await request(app).get('/api/experiences/p1/calendar?from=december');
    expect(bad.status).toBe(400);
    expect(bad.body.problem).toBe('refused');
    expect((await request(app).get('/api/experiences/p1/times')).status).toBe(400);
  });

  it('holding seats: one unit item each, 15 minutes, the pickup; nobody: refused', async () => {
    const s = supplier({ 'POST /bookings': () => BOOKING });
    const app = createApp({ octo: s.octo, store: createStore(tempFile()) });
    const res = await request(app)
      .post('/api/holds')
      .send({
        productId: 'p1',
        availabilityId: 'd1',
        units: { adult: 2, child: 1, infant: 0 },
        pickupLocationId: 'ikoyi',
      });
    expect(res.status).toBe(201);
    expect(res.body.booking).toEqual(BOOKING);
    const sent = s.asked[0].body;
    expect(sent).toMatchObject({
      productId: 'p1',
      optionId: 'DEFAULT',
      availabilityId: 'd1',
      expirationMinutes: HOLD_MINUTES,
      pickupRequested: true,
      pickupLocationId: 'ikoyi',
      unitItems: [{ unitId: 'adult' }, { unitId: 'adult' }, { unitId: 'child' }],
    });
    expect(sent.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(HOLD_MINUTES).toBe(15);
    // No pickup asked: none sent.
    await request(app)
      .post('/api/holds')
      .send({ productId: 'p1', availabilityId: 'd1', units: { adult: 1 } });
    expect(s.asked[1].body.pickupLocationId).toBeUndefined();
    for (const units of [{}, { adult: 0 }, { adult: -1 }, { adult: 1.5 }, { adult: 21 }]) {
      const r = await request(app)
        .post('/api/holds')
        .send({ productId: 'p1', availabilityId: 'd1', units });
      expect(r.status, JSON.stringify(units)).toBe(400);
    }
  });

  it('seats gone meanwhile: "taken", with the seats left; the supplier down: "offline"', async () => {
    let down = false;
    const s = supplier({
      'POST /bookings': () => {
        if (down) throw new OctoClientError('offline', 'The supplier didn’t answer.');
        throw new OctoClientError('octo', 'Only 1 seat left.', {
          status: 400,
          code: 'UNPROCESSABLE_ENTITY',
          body: { error: 'UNPROCESSABLE_ENTITY', vacancies: 1 },
        });
      },
    });
    const app = createApp({ octo: s.octo, store: createStore(tempFile()) });
    const body = { productId: 'p1', availabilityId: 'd1', units: { adult: 2 } };
    const taken = await request(app).post('/api/holds').send(body);
    expect(taken.status).toBe(409);
    expect(taken.body).toEqual({ problem: 'taken', message: 'Only 1 seat left.', vacancies: 1 });
    down = true;
    const offline = await request(app).post('/api/holds').send(body);
    expect(offline.status).toBe(503);
    expect(offline.body.problem).toBe('offline');
  });

  it('another refusal: in the supplier’s words', async () => {
    const s = supplier({
      'POST /bookings': () => {
        throw new OctoClientError('octo', 'A child needs an adult.', {
          code: 'UNPROCESSABLE_ENTITY',
          body: { error: 'UNPROCESSABLE_ENTITY' },
        });
      },
    });
    const app = createApp({ octo: s.octo, store: createStore(tempFile()) });
    const r = await request(app)
      .post('/api/holds')
      .send({ productId: 'p1', availabilityId: 'd1', units: { child: 1 } });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ problem: 'refused', message: 'A child needs an adult.' });
  });

  it('the hold, while the guest pays: the booking and its tour; an unknown one: not found', async () => {
    const s = supplier({
      'GET /bookings/u-1': () => BOOKING,
      'GET /products/p1': () => ({ id: 'p1' }),
      'GET /bookings/nope': () => {
        throw new OctoClientError('octo', 'invalid', { code: 'INVALID_BOOKING_UUID' });
      },
    });
    const app = createApp({ octo: s.octo, store: createStore(tempFile()) });
    expect((await request(app).get('/api/holds/u-1')).body).toEqual({
      booking: BOOKING,
      experience: { id: 'p1' },
    });
    const missing = await request(app).get('/api/holds/nope');
    expect(missing.status).toBe(404);
  });

  it('paying (a test): confirmed with Sojourna’s reference, kept, then shown', async () => {
    const file = tempFile();
    const s = supplier({
      'POST /bookings/u-1/confirm': (b) => ({
        ...BOOKING,
        status: 'CONFIRMED',
        resellerReference: b.resellerReference,
      }),
      'GET /bookings/u-1': () => ({ ...BOOKING, status: 'CONFIRMED' }),
      'GET /supplier': () => ({ name: 'Ìrìn Lagos Tours' }),
      'GET /products/p1': () => ({ id: 'p1' }),
    });
    const app = createApp({ octo: s.octo, store: createStore(file), newRef: () => 'SJ-48213' });
    const res = await request(app)
      .post('/api/holds/u-1/confirm')
      .send({ fullName: ' Hannah Weber ', email: 'hannah@guest.example', phone: '' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ref: 'SJ-48213' });
    expect(s.asked[0].body).toEqual({
      resellerReference: 'SJ-48213',
      // No phone given: none sent.
      contact: {
        fullName: 'Hannah Weber',
        emailAddress: 'hannah@guest.example',
      },
    });
    const kept = JSON.parse(readFileSync(file, 'utf8')).bookings;
    expect(kept).toEqual([
      expect.objectContaining({
        ref: 'SJ-48213',
        uuid: 'u-1',
        productId: 'p1',
        supplierReference: 'ILT-6WQ3PZ',
        lead: { name: 'Hannah Weber', email: 'hannah@guest.example', phone: null },
      }),
    ]);
    const shown = await request(app).get('/api/bookings/SJ-48213');
    expect(shown.body).toMatchObject({
      stored: { ref: 'SJ-48213' },
      booking: { status: 'CONFIRMED' },
      experience: { id: 'p1' },
      supplier: { name: 'Ìrìn Lagos Tours' },
    });
    expect((await request(app).get('/api/bookings/SJ-00000')).status).toBe(404);
  });

  it('paying: a name and an email first; the hold gone; the supplier not confirming', async () => {
    let mode = 'expired';
    const s = supplier({
      'POST /bookings/u-1/confirm': () => {
        if (mode === 'expired')
          throw new OctoClientError('octo', 'released', { code: 'INVALID_BOOKING_UUID' });
        throw new OctoClientError('offline', 'no answer');
      },
    });
    const store = createStore(tempFile());
    const app = createApp({ octo: s.octo, store });
    const ok = { fullName: 'Hannah Weber', email: 'hannah@guest.example' };
    expect(
      (
        await request(app)
          .post('/api/holds/u-1/confirm')
          .send({ ...ok, fullName: 'H' })
      ).body.message,
    ).toBe('Type the lead guest’s full name.');
    expect(
      (
        await request(app)
          .post('/api/holds/u-1/confirm')
          .send({ ...ok, email: 'nope' })
      ).status,
    ).toBe(400);
    const gone = await request(app).post('/api/holds/u-1/confirm').send(ok);
    expect(gone.status).toBe(410);
    expect(gone.body.problem).toBe('expired');
    mode = 'offline';
    const failed = await request(app).post('/api/holds/u-1/confirm').send(ok);
    expect(failed.status).toBe(502);
    expect(failed.body.problem).toBe('not_confirmed');
    expect(store.all()).toEqual([]); // nothing kept
  });

  it('a booking whose tour is off sale now still shows', async () => {
    const file = tempFile();
    const store = createStore(file);
    store.add({
      ref: 'SJ-11111',
      uuid: 'u-1',
      productId: 'gone',
      supplierReference: 'ILT-X',
      lead: { name: 'A B', email: 'a@b.example', phone: null },
      createdAt: '2026-11-21T10:00:00Z',
    });
    const s = supplier({
      'GET /bookings/u-1': () => BOOKING,
      'GET /supplier': () => ({ name: 'Ìrìn' }),
    });
    const r = await request(createApp({ octo: s.octo, store })).get('/api/bookings/SJ-11111');
    expect(r.status).toBe(200);
    expect(r.body.experience).toBeNull();
  });
});

describe('the OCTO client', () => {
  /** @param {(url: string, init: any) => any} fn */
  const client = (fn) => {
    /** @type {any[]} */
    const calls = [];
    const octo = createOctoClient({
      baseUrl: 'http://supplier.example/octo/',
      apiKey: 'octo_test',
      fetch: /** @type {any} */ (
        async (/** @type {string} */ url, /** @type {any} */ init) => {
          calls.push({ url, init });
          return fn(url, init);
        }
      ),
    });
    return { octo, calls };
  };
  const json = (/** @type {number} */ status, /** @type {any} */ body) =>
    new Response(JSON.stringify(body), { status });

  it('its key, every capability, JSON; the answer', async () => {
    const { octo, calls } = client(() => json(200, { ok: true }));
    expect(await octo.post('/bookings', { a: 1 })).toEqual({ ok: true });
    expect(calls[0].url).toBe('http://supplier.example/octo/bookings');
    expect(calls[0].init.headers).toEqual({
      Authorization: 'Bearer octo_test',
      'Octo-Capabilities': CAPABILITIES,
      'Content-Type': 'application/json',
    });
    expect(CAPABILITIES).toBe('octo/pricing, octo/content, octo/pickups');
    expect(calls[0].init.body).toBe('{"a":1}');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    await octo.get('/products');
    expect(calls[1].init).toMatchObject({ method: 'GET', body: undefined });
    await octo.del('/notifications/subscriptions/s-1');
    expect(calls[2]).toMatchObject({
      url: 'http://supplier.example/octo/notifications/subscriptions/s-1',
      init: { method: 'DELETE' },
    });
    expect(calls[1].init.headers['Content-Type']).toBeUndefined();
  });

  it('down, 5xx, not JSON: offline; an OCTO error: its code and words', async () => {
    const fail = async (/** @type {() => any} */ fn) => {
      try {
        await client(fn).octo.get('/products');
        return null;
      } catch (e) {
        return e;
      }
    };
    expect(await fail(() => Promise.reject(new TypeError('fetch failed')))).toMatchObject({
      kind: 'offline',
    });
    expect(await fail(() => json(503, { error: 'X' }))).toMatchObject({
      kind: 'offline',
      status: 503,
    });
    expect(await fail(() => new Response('<html>', { status: 404 }))).toMatchObject({
      kind: 'offline',
    });
    expect(
      await fail(() =>
        json(400, { error: 'INVALID_PRODUCT_ID', errorMessage: 'The Product ID was invalid' }),
      ),
    ).toMatchObject({
      kind: 'octo',
      status: 400,
      code: 'INVALID_PRODUCT_ID',
      message: 'The Product ID was invalid',
    });
  });
});

describe('the store', () => {
  it('kept in a file: back after a restart; newest first; references unique', () => {
    const file = tempFile();
    const a = createStore(file);
    const b = (/** @type {string} */ ref) => ({
      ref,
      uuid: `u-${ref}`,
      productId: 'p1',
      supplierReference: 'ILT-1',
      lead: { name: 'A B', email: 'a@b.example', phone: null },
      createdAt: '2026-11-21T10:00:00Z',
    });
    a.add(b('SJ-1'));
    a.add(b('SJ-2'));
    const again = createStore(file);
    expect(again.all().map((x) => x.ref)).toEqual(['SJ-2', 'SJ-1']);
    expect(again.byRef('SJ-1')?.uuid).toBe('u-SJ-1');
    expect(again.byRef('SJ-9')).toBeNull();
    expect(again.has('SJ-2')).toBe(true);
    expect(again.has('SJ-3')).toBe(false);
    // Updating one it doesn't have: nothing, and nothing written.
    expect(again.update('SJ-9', { cancelledAt: 'x' })).toBeNull();
    expect(createStore(file).byRef('SJ-9')).toBeNull();
    expect(again.update('SJ-1', { cancelledAt: 'x' })?.cancelledAt).toBe('x');
    expect(createStore(file).byRef('SJ-1')?.cancelledAt).toBe('x');
    expect(createStore(join(tmpdir(), 'no-such-dir-x', 'f.json')).all()).toEqual([]);
  });
});

describe('the back office (17d-2)', () => {
  const stored = (/** @type {string} */ ref, productId = 'p1') => ({
    ref,
    uuid: `u-${ref}`,
    productId,
    supplierReference: 'ILT-1',
    lead: { name: 'Hannah Weber', email: 'h@guest.example', phone: null },
    createdAt: '2026-11-21T10:00:00Z',
  });
  const at = new Date('2026-11-21T10:42:00Z');

  it('every booking, its status asked of the supplier now; the time it last answered', async () => {
    const store = createStore(tempFile());
    store.add(stored('SJ-1'));
    store.add(stored('SJ-2', 'gone'));
    store.add(stored('SJ-3'));
    const s = supplier({
      'GET /supplier': () => ({ name: 'Ìrìn Lagos Tours' }),
      'GET /bookings/u-SJ-1': () => ({ status: 'CONFIRMED' }),
      'GET /bookings/u-SJ-2': () => ({ status: 'CANCELLED' }),
      'GET /products/p1': () => ({ title: 'Tarkwa Bay' }),
    });
    const app = createApp({ octo: s.octo, store, now: () => at });
    const res = await request(app).get('/api/bookings');
    expect(res.status).toBe(200);
    expect(res.body.supplier.name).toBe('Ìrìn Lagos Tours');
    expect(res.body.lastSyncAt).toBe('2026-11-21T10:42:00.000Z');
    expect(
      res.body.rows.map((/** @type {any} */ r) => [
        r.stored.ref,
        r.booking?.status ?? null,
        r.title,
      ]),
    ).toEqual([
      ['SJ-3', null, 'Tarkwa Bay'], // one the supplier can't find: still listed
      ['SJ-2', 'CANCELLED', null], // its tour taken off sale: still listed
      ['SJ-1', 'CONFIRMED', 'Tarkwa Bay'],
    ]);
    // Each tour asked once.
    expect(s.asked.filter((a) => a.path === '/products/p1')).toHaveLength(1);
  });

  it('cancelling: through OCTO, noted as Sojourna’s; too late; an unknown one', async () => {
    const store = createStore(tempFile());
    store.add(stored('SJ-1'));
    store.add(stored('SJ-2'));
    const s = supplier({
      'POST /bookings/u-SJ-1/cancel': () => ({
        status: 'CANCELLED',
        cancellation: { refund: 'FULL' },
      }),
      'POST /bookings/u-SJ-2/cancel': () => {
        throw new OctoClientError('octo', 'The tour has started: it can’t be cancelled now.', {
          code: 'UNPROCESSABLE_ENTITY',
          body: { error: 'UNPROCESSABLE_ENTITY' },
        });
      },
    });
    const app = createApp({ octo: s.octo, store, now: () => at });
    const res = await request(app).post('/api/bookings/SJ-1/cancel');
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('CANCELLED');
    expect(s.asked[0].body).toEqual({ reason: 'Cancelled by the guest on Sojourna' });
    expect(store.byRef('SJ-1')?.cancelledAt).toBe('2026-11-21T10:42:00.000Z');
    expect(store.lastSyncAt()).toBe('2026-11-21T10:42:00.000Z');
    const late = await request(app).post('/api/bookings/SJ-2/cancel');
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ problem: 'too_late' });
    expect(store.byRef('SJ-2')?.cancelledAt).toBeUndefined();
    expect((await request(app).post('/api/bookings/SJ-9/cancel')).status).toBe(404);
  });

  it('the supplier’s notifications: with Sojourna’s key, noted; anyone else turned away', async () => {
    const store = createStore(tempFile());
    const app = createApp({ octo: supplier({}).octo, store, notifyKey: 'k-1', now: () => at });
    const n = { notificationType: 'BOOKING_UPDATE', data: { uuid: 'u-1' } };
    expect((await request(app).post('/octo-updates').send(n)).status).toBe(401);
    expect(
      (await request(app).post('/octo-updates').set('X-Sojourna-Key', 'wrong').send(n)).status,
    ).toBe(401);
    expect(store.lastSyncAt()).toBeNull();
    expect(
      (await request(app).post('/octo-updates').set('X-Sojourna-Key', 'k-1').send(n)).status,
    ).toBe(204);
    expect(store.lastSyncAt()).toBe('2026-11-21T10:42:00.000Z');
    // An empty key never opens the door.
    const empty = createApp({
      octo: supplier({}).octo,
      store: createStore(tempFile()),
      notifyKey: '',
    });
    expect(
      (await request(empty).post('/octo-updates').set('X-Sojourna-Key', '').send(n)).status,
    ).toBe(401);
    // No key set: nobody is let in.
    const closed = createApp({ octo: supplier({}).octo, store: createStore(tempFile()) });
    expect(
      (await request(closed).post('/octo-updates').set('X-Sojourna-Key', '').send(n)).status,
    ).toBe(401);
  });
});

describe('subscribing to the supplier’s updates (17d-2)', () => {
  it('old subscriptions to the same address removed; a new one with a fresh key', async () => {
    const s = supplier({
      'GET /notifications/subscriptions': () => [
        { id: 'old-1', url: 'http://localhost:4400/octo-updates' },
        { id: 'other', url: 'http://elsewhere.example/hook' },
      ],
      'DELETE /notifications/subscriptions/old-1': () => ({}),
      'POST /notifications/subscriptions': (b) => ({ id: 'new', ...b }),
    });
    const made = await subscribe({
      octo: s.octo,
      url: 'http://localhost:4400/octo-updates',
      key: 'k-1',
    });
    expect(made.id).toBe('new');
    expect(s.asked.map((a) => `${a.method} ${a.path}`)).toEqual([
      'GET /notifications/subscriptions',
      'DELETE /notifications/subscriptions/old-1',
      'POST /notifications/subscriptions',
    ]);
    expect(s.asked[2].body).toEqual({
      url: 'http://localhost:4400/octo-updates',
      notificationTypes: NOTIFICATION_TYPES,
      headers: { 'X-Sojourna-Key': 'k-1' },
    });
    expect(NOTIFICATION_TYPES).toEqual(['BOOKING_UPDATE', 'AVAILABILITY_UPDATE', 'PRODUCT_UPDATE']);
    expect(makeNotifyKey()).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(makeNotifyKey()).not.toBe(makeNotifyKey());
  });

  it('the supplier down: tries again later', async () => {
    let calls = 0;
    const octo = {
      get: async () => {
        calls += 1;
        if (calls === 1) throw new OctoClientError('offline', 'down');
        return [];
      },
      post: async () => ({ id: 'new' }),
      del: async () => ({}),
    };
    /** @type {string[]} */
    const lines = [];
    keepSubscribing({
      octo: /** @type {any} */ (octo),
      url: 'u',
      key: 'k',
      every: 10,
      log: (l) => lines.push(l),
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(lines).toEqual([
      'Sojourna: couldn’t subscribe yet (down); trying again in 30 seconds',
      'Sojourna: subscribed to updates at u',
    ]);
  });
});
