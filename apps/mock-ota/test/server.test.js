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
  return { asked, octo: { get: handle('GET'), post: handle('POST') } };
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
      contact: {
        fullName: 'Hannah Weber',
        emailAddress: 'hannah@guest.example',
        phoneNumber: null,
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
    expect(createStore(join(tmpdir(), 'no-such-dir-x', 'f.json')).all()).toEqual([]);
  });
});
