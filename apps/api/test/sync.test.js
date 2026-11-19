/**
 * Stage 15b: the operator app with no signal (OPS-09; flow brief 07, section 4).
 * PRD: "72 hours of offline actions sync with zero data loss".
 *   - the offline package: today's and tomorrow's departures I'm the guide on, with their
 *     manifests and each ticket's fingerprint (never the code); 304 when nothing changed
 *   - the outbox: changes applied in order, at the time they were made, each ONCE (sent
 *     again, or twice at once: the same answer, nothing done twice)
 *   - conflicts: cancelled meanwhile, someone else first, no longer my departure… kept, in
 *     plain words, the server's version standing, until someone dismisses them
 *   - 72 hours offline: the session still works and every change lands, with its own time
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { bookingIdFromGuestToken, ticketCode } from '@okapigo/db';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const HOUR = 3_600_000;
const ago = (/** @type {number} */ ms) => new Date(Date.now() - ms).toISOString();

/** @param {string} token */
function as(token) {
  const withAuth =
    (/** @type {'get' | 'post' | 'put' | 'patch'} */ m) => (/** @type {string} */ url) =>
      request(ctx.app)[m](url).set('Authorization', `Bearer ${token}`);
  return {
    token,
    get: withAuth('get'),
    post: withAuth('post'),
    put: withAuth('put'),
    patch: withAuth('patch'),
    /** Sends an outbox. @param {any[]} changes */
    sync: (changes) => withAuth('post')('/api/sync/changes').send({ changes }),
  };
}

/** A business, its staff, and a departure moved onto tour day with Kemi as its guide. */
async function setup() {
  const seeded = await ctx.seedOperator();
  const { operator } = seeded;
  const manager = as(await ctx.tokenFor(seeded.manager.id));
  const byName = (/** @type {string} */ n) =>
    seeded.guides.find((/** @type {any} */ g) => g.name === n);
  const kemi = byName('Kemi Adeyemi');
  const chinedu = byName('Chinedu Eze');
  const asKemi = as(await ctx.tokenFor(kemi.id));
  const asChinedu = as(await ctx.tokenFor(chinedu.id));

  /** The n-th future departure of a tour (n from 0). */
  const departureOf = async (/** @type {string} */ slug, n = 0) => {
    const product = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug },
    });
    const list = await ctx.prisma.departure.findMany({
      where: { productId: product.id, startsAt: { gt: new Date(Date.now() + 2 * 86_400_000) } },
      orderBy: { startsAt: 'asc' },
      take: n + 1,
    });
    return list[n];
  };

  /** A website booking, paid in full. Returns its id and ticket code. */
  const book = async (
    /** @type {any} */ departure,
    { name = 'Adaeze Okafor', travellers = [{ name: 'Adaeze Okafor', age: 34 }] } = {},
  ) => {
    const res = await request(ctx.app)
      .post(`/public/${operator.slug}/bookings`)
      .send({
        lead: {
          name,
          email: `${name.split(' ')[0].toLowerCase()}@guest.example`,
          phone: '0803 123 4567',
          acceptTerms: true,
        },
        departureId: departure.id,
        travellers,
        addOns: [],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { token } = res.body;
    const { reference } = (
      await request(ctx.app).post(`/public/bookings/${token}/pay`).send({ option: 'full' })
    ).body.payment;
    await ctx.provider.complete(reference);
    await request(ctx.app).post(`/public/bookings/${token}/payments/${reference}/check`);
    const id = /** @type {string} */ (bookingIdFromGuestToken(TEST_AUTH_SECRET, token));
    const travellerIds = (
      await ctx.prisma.traveller.findMany({
        where: { bookingId: id },
        orderBy: { position: 'asc' },
      })
    ).map((t) => t.id);
    return { id, code: ticketCode(TEST_AUTH_SECRET, id), travellerIds };
  };

  /** Moves a departure so it starts `fromNow` ms from now (negative: already started). */
  const moveTo = async (/** @type {any} */ departure, /** @type {number} */ fromNow) => {
    const startsAt = new Date(Date.now() + fromNow);
    await ctx.prisma.departure.update({
      where: { id: departure.id },
      data: { startsAt, endsAt: new Date(startsAt.getTime() + 3 * HOUR) },
    });
  };
  /** Assigns a guide (as the manager). */
  const assign = async (/** @type {any} */ departure, /** @type {string | null} */ guideId) => {
    const res = await manager.put(`/api/departures/${departure.id}/assignment`).send({ guideId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };

  /** Today's walk, with Kemi as the guide; it started an hour ago unless told otherwise. */
  const tourDay = async (/** @type {{ startsIn?: number, bookings?: any[] }} */ o = {}) => {
    const walk = await departureOf('lagos-island-heritage-walk');
    const bookings = [];
    for (const b of o.bookings ?? [{}]) bookings.push(await book(walk, b));
    await moveTo(walk, o.startsIn ?? -HOUR);
    await assign(walk, kemi.id);
    return { walk, bookings };
  };

  /** One change, as a phone would make it. @param {any} c */
  const change = (c) => ({ id: randomUUID(), at: new Date().toISOString(), ...c });
  const traveller = (/** @type {string} */ id) =>
    ctx.prisma.traveller.findUniqueOrThrow({ where: { id } });

  return {
    ...seeded,
    managerUser: seeded.manager,
    manager,
    kemi,
    chinedu,
    asKemi,
    asChinedu,
    departureOf,
    book,
    moveTo,
    assign,
    tourDay,
    change,
    traveller,
  };
}

describe('the offline package (what the phone saves)', () => {
  it('today’s and tomorrow’s departures I guide, with manifests and ticket fingerprints only', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay({ startsIn: 2 * HOUR });
    // Chinedu's departure today, and one of Kemi's in three days: neither is in her package.
    const bay = await s.departureOf('lagos-street-food-crawl');
    await s.moveTo(bay, 3 * HOUR);
    await s.assign(bay, s.chinedu.id);
    const later = await s.departureOf('lagos-island-heritage-walk', 1);
    await s.moveTo(later, 72 * HOUR);
    await s.assign(later, s.kemi.id);

    const res = await s.asKemi.get('/api/sync/package');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-cache');
    const pkg = res.body.package;
    expect(pkg.days).toHaveLength(2);
    expect(pkg.departures.map((/** @type {any} */ m) => m.departure.id)).toEqual([walk.id]);
    const [m] = pkg.departures;
    expect(m.guide.name).toBe('Kemi Adeyemi');
    expect(m.bookings[0].travellers[0].displayName).toBe('Adaeze Okafor');
    // The fingerprint of the QR's code, never the code itself (a lost phone gives no tickets).
    expect(m.bookings[0].ticketFingerprint).toBe(
      createHash('sha256').update(bookings[0].code).digest('hex'),
    );
    expect(JSON.stringify(res.body)).not.toContain(bookings[0].code);

    expect(
      (await s.asChinedu.get('/api/sync/package')).body.package.departures.map(
        (/** @type {any} */ d) => d.departure.id,
      ),
    ).toEqual([bay.id]);
  });

  it('refreshing: 304 Not Modified while nothing changed; the new version once something did', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay();
    const first = await s.asKemi.get('/api/sync/package');
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();
    const again = await s.asKemi.get('/api/sync/package').set('If-None-Match', etag);
    expect(again.status).toBe(304);

    await s.manager
      .post(`/api/departures/${walk.id}/check-ins`)
      .send({ bookingId: bookings[0].id, status: 'present' });
    const changed = await s.asKemi.get('/api/sync/package').set('If-None-Match', etag);
    expect(changed.status).toBe(200);
    expect(changed.body.package.departures[0].counts.present).toBe(1);
  });
});

describe('the outbox: in order, at the time it happened, once', () => {
  it('a check-in made offline at 09:05 says 09:05; sent again, the same answer, done once', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay();
    const tapped = ago(40 * 60_000);
    const c = s.change({
      at: tapped,
      kind: 'check_in',
      departureId: walk.id,
      code: bookings[0].code,
      status: 'present',
    });
    const first = await s.asKemi.sync([c]);
    expect(first.status).toBe(200);
    expect(first.body.results).toEqual([
      expect.objectContaining({ id: c.id, outcome: 'applied', repeated: false, code: null }),
    ]);
    const t = await s.traveller(bookings[0].travellerIds[0]);
    expect(t.checkInStatus).toBe('present');
    expect(t.checkedInAt?.toISOString()).toBe(tapped);
    expect(t.checkedInById).toBe(s.kemi.id);

    // The phone lost signal before hearing back, and sends it again.
    const second = await s.asKemi.sync([c]);
    expect(second.body.results[0]).toMatchObject({ id: c.id, outcome: 'applied', repeated: true });
    expect(
      await ctx.prisma.bookingEvent.count({
        where: { bookingId: bookings[0].id, type: 'checked_in' },
      }),
    ).toBe(1);
    expect(await ctx.prisma.syncChange.count({ where: { clientId: c.id } })).toBe(1);
  });

  it('the same outbox sent twice at once (two tabs, a retry): the same answers, nothing twice', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay({
      bookings: [{}, { name: 'Tunde Bakare', travellers: [{ name: 'Tunde Bakare', age: 40 }] }],
    });
    const changes = bookings.map((b) =>
      s.change({ kind: 'check_in', departureId: walk.id, bookingId: b.id, status: 'present' }),
    );
    const [a, b] = await Promise.all([s.asKemi.sync(changes), s.asKemi.sync(changes)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    for (const r of [...a.body.results, ...b.body.results]) expect(r.outcome).toBe('applied');
    expect(await ctx.prisma.syncChange.count({ where: { userId: s.kemi.id } })).toBe(2);
    expect(
      await ctx.prisma.bookingEvent.count({
        where: { bookingId: { in: bookings.map((x) => x.id) }, type: 'checked_in' },
      }),
    ).toBe(2);
  });

  it('applied oldest first: present, undo, then late ends late', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay();
    const base = { kind: 'check_in', departureId: walk.id, bookingId: bookings[0].id };
    const res = await s.asKemi.sync([
      s.change({ ...base, at: ago(30 * 60_000), status: 'present' }),
      s.change({ ...base, at: ago(29 * 60_000), status: 'pending' }),
      s.change({ ...base, at: ago(28 * 60_000), status: 'late' }),
    ]);
    expect(res.body.results.map((/** @type {any} */ r) => r.outcome)).toEqual([
      'applied',
      'applied',
      'applied',
    ]);
    expect((await s.traveller(bookings[0].travellerIds[0])).checkInStatus).toBe('late');
  });

  it('a phone whose clock runs fast: the time is never later than when it arrived', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay();
    const before = Date.now();
    await s.asKemi.sync([
      s.change({
        at: new Date(Date.now() + 2 * HOUR).toISOString(),
        kind: 'check_in',
        departureId: walk.id,
        bookingId: bookings[0].id,
        status: 'present',
      }),
    ]);
    const at = (await s.traveller(bookings[0].travellerIds[0])).checkedInAt?.getTime() ?? 0;
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('a change that was never valid is rejected; the ones after it still apply', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay();
    const forged = `${bookings[0].code.slice(0, -4)}AAAA`;
    const res = await s.asKemi.sync([
      s.change({ kind: 'check_in', departureId: walk.id, code: forged, status: 'present' }),
      s.change({
        kind: 'check_in',
        departureId: walk.id,
        code: bookings[0].code,
        status: 'present',
      }),
    ]);
    expect(res.body.results.map((/** @type {any} */ r) => [r.outcome, r.code])).toEqual([
      ['rejected', 'NOT_OUR_TICKET'],
      ['applied', null],
    ]);
    // Rejected isn't a conflict: there's nothing for anyone to decide.
    expect((await s.asKemi.get('/api/sync/conflicts')).body.conflicts).toEqual([]);
  });

  it('refused as a whole when malformed: too many, the same id twice, no time', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay();
    const one = s.change({
      kind: 'check_in',
      departureId: walk.id,
      bookingId: bookings[0].id,
      status: 'present',
    });
    expect((await s.asKemi.sync(Array.from({ length: 501 }, () => s.change(one)))).status).toBe(
      400,
    );
    expect((await s.asKemi.sync([one, one])).status).toBe(400);
    const { at: _at, ...noTime } = one;
    expect((await s.asKemi.sync([noTime])).status).toBe(400);
    expect((await s.asKemi.sync([])).status).toBe(400);
    expect((await s.traveller(bookings[0].travellerIds[0])).checkInStatus).toBe('pending');
  });
});

describe('conflicts: kept in plain words; the server’s version stands', () => {
  it('cancelled while the phone was offline: nothing changed, shown to the guide and the manager', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay();
    const tapped = ago(10 * 60_000);
    await s.manager
      .post(`/api/bookings/${bookings[0].id}/cancel`)
      .send({ initiatedBy: 'guest', reason: 'Changed plans' });

    const res = await s.asKemi.sync([
      s.change({
        at: tapped,
        kind: 'check_in',
        departureId: walk.id,
        code: bookings[0].code,
        status: 'present',
      }),
    ]);
    const [r] = res.body.results;
    expect(r).toMatchObject({ outcome: 'conflict', code: 'BOOKING_CANCELLED' });
    expect(r.message).toMatch(
      /^You marked Adaeze Okafor present at \d\d:\d\d, but the booking was cancelled at \d\d:\d\d\. Nothing changed\.$/,
    );
    expect((await s.traveller(bookings[0].travellerIds[0])).checkInStatus).toBe('pending');

    const mine = (await s.asKemi.get('/api/sync/conflicts')).body.conflicts;
    expect(mine).toEqual([
      expect.objectContaining({
        changeId: r.id,
        code: 'BOOKING_CANCELLED',
        message: r.message,
        by: { id: s.kemi.id, name: 'Kemi Adeyemi' },
      }),
    ]);
    // The manager sees everyone's; another guide sees none, and can't dismiss it.
    expect((await s.manager.get('/api/sync/conflicts')).body.conflicts).toHaveLength(1);
    expect((await s.asChinedu.get('/api/sync/conflicts')).body.conflicts).toEqual([]);
    expect((await s.asChinedu.post(`/api/sync/conflicts/${mine[0].id}/dismiss`)).status).toBe(404);

    // "OK": gone from the list, kept in the record.
    expect((await s.asKemi.post(`/api/sync/conflicts/${mine[0].id}/dismiss`)).status).toBe(204);
    expect((await s.manager.get('/api/sync/conflicts')).body.conflicts).toEqual([]);
    expect((await s.asKemi.post(`/api/sync/conflicts/${mine[0].id}/dismiss`)).status).toBe(404);
    const kept = await ctx.prisma.syncChange.findFirstOrThrow({ where: { clientId: r.id } });
    expect(kept.dismissedById).toBe(s.kemi.id);
  });

  it('someone else changed the traveller first: theirs stands (unless it’s the same change)', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay({
      bookings: [
        {
          travellers: [
            { name: 'Adaeze Okafor', age: 34 },
            { name: 'Tunde Bakare', age: 40 },
          ],
        },
      ],
    });
    const [adaeze, tunde] = bookings[0].travellerIds;
    // While Kemi's phone is offline, the manager marks Tunde late, and Adaeze present.
    await s.manager
      .post(`/api/departures/${walk.id}/check-ins`)
      .send({ bookingId: bookings[0].id, travellerIds: [tunde], status: 'late' });
    await s.manager
      .post(`/api/departures/${walk.id}/check-ins`)
      .send({ bookingId: bookings[0].id, travellerIds: [adaeze], status: 'present' });

    const base = { kind: 'check_in', departureId: walk.id, bookingId: bookings[0].id };
    const res = await s.asKemi.sync([
      // Kemi saw Tunde pending and marked him present: someone changed him since.
      s.change({ ...base, travellerIds: [tunde], status: 'present', seen: { [tunde]: 'pending' } }),
      // Kemi saw Adaeze pending and marked her present: the same as the server now. Fine.
      s.change({
        ...base,
        travellerIds: [adaeze],
        status: 'present',
        seen: { [adaeze]: 'pending' },
      }),
    ]);
    const [t, a] = res.body.results;
    expect(t).toMatchObject({ outcome: 'conflict', code: 'CHANGED_FIRST' });
    expect(t.message).toBe(
      `You marked Tunde Bakare present at ${t.message.match(/at (\d\d:\d\d)/)[1]}, but ${s.managerUser.name} had already marked Tunde Bakare late at ${t.message.match(/late at (\d\d:\d\d)/)[1]}. Theirs stands.`,
    );
    expect(a.outcome).toBe('applied');
    expect((await s.traveller(tunde)).checkInStatus).toBe('late');

    // Without `seen` (an older phone, or online), the last tap wins, as before.
    const blind = await s.asKemi.sync([
      s.change({ ...base, travellerIds: [tunde], status: 'present' }),
    ]);
    expect(blind.body.results[0].outcome).toBe('applied');
    expect((await s.traveller(tunde)).checkInStatus).toBe('present');
  });

  it('a no-show from the phone, but another guide checked them in: refused, online and offline', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay();
    await s.manager
      .post(`/api/departures/${walk.id}/check-ins`)
      .send({ bookingId: bookings[0].id, status: 'present' });

    const res = await s.asKemi.sync([
      s.change({ kind: 'no_show', departureId: walk.id, bookingId: bookings[0].id }),
    ]);
    expect(res.body.results[0]).toMatchObject({ outcome: 'conflict', code: 'CHECKED_IN' });
    expect(res.body.results[0].message).toMatch(
      /^You marked Adaeze Okafor’s booking a no-show at \d\d:\d\d, but .+ had checked Adaeze Okafor in at \d\d:\d\d\. Theirs stands\.$/,
    );
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookings[0].id } });
    expect(b.status).toBe('paid');

    const online = await s.asKemi
      .post(`/api/departures/${walk.id}/no-shows`)
      .send({ bookingId: bookings[0].id });
    expect(online.status).toBe(409);
    expect(online.body.error.code).toBe('CHECKED_IN');
  });

  it('no longer my departure: kept as a conflict; the manager may sync any departure', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay();
    await s.assign(walk, s.chinedu.id);
    const c = {
      kind: 'check_in',
      departureId: walk.id,
      bookingId: bookings[0].id,
      status: 'present',
    };
    const res = await s.asKemi.sync([s.change(c)]);
    expect(res.body.results[0]).toMatchObject({ outcome: 'conflict', code: 'NOT_ASSIGNED' });
    expect(res.body.results[0].message).toMatch(
      /^You marked Adaeze Okafor present at \d\d:\d\d, but you’re no longer the guide on this departure\. Nothing changed\.$/,
    );
    expect((await s.manager.sync([s.change(c)])).body.results[0].outcome).toBe('applied');
  });

  it('a conflict sent again is still that conflict, even if it would apply now', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay();
    await s.assign(walk, s.chinedu.id);
    const c = s.change({
      kind: 'check_in',
      departureId: walk.id,
      bookingId: bookings[0].id,
      status: 'present',
    });
    expect((await s.asKemi.sync([c])).body.results[0].code).toBe('NOT_ASSIGNED');
    await s.assign(walk, s.kemi.id); // back on it: the same change would apply now…
    const again = (await s.asKemi.sync([c])).body.results[0];
    expect(again).toMatchObject({ outcome: 'conflict', code: 'NOT_ASSIGNED', repeated: true });
    // …but it was answered already: nothing redone behind the answer the phone was given.
    expect((await s.traveller(bookings[0].travellerIds[0])).checkInStatus).toBe('pending');
  });

  it('a name typed offline; if the office typed another meanwhile, theirs stands', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay({
      bookings: [
        {
          travellers: [
            { name: 'Adaeze Okafor', age: 34 },
            { name: 'To Be Named', age: 30 },
          ],
        },
      ],
    });
    // (A website booking names everyone; clear the second, like a WhatsApp booking.)
    const [, second] = bookings[0].travellerIds;
    await ctx.prisma.traveller.update({ where: { id: second }, data: { name: '' } });

    const named = await s.asKemi.sync([
      s.change({
        kind: 'name',
        departureId: walk.id,
        travellerId: second,
        name: ' Bisi  Okafor ',
        seen: '',
      }),
    ]);
    expect(named.body.results[0]).toMatchObject({
      outcome: 'applied',
      data: { name: 'Bisi Okafor' },
    });

    const clash = await s.asKemi.sync([
      s.change({
        kind: 'name',
        departureId: walk.id,
        travellerId: second,
        name: 'Bisola',
        seen: '',
      }),
    ]);
    expect(clash.body.results[0]).toMatchObject({ outcome: 'conflict', code: 'CHANGED_FIRST' });
    expect(clash.body.results[0].message).toMatch(
      /^You named Guest 2 of Adaeze Okafor’s booking “Bisola” at \d\d:\d\d, but someone else had already named them “Bisi Okafor”\. Theirs stands\.$/,
    );
    expect((await s.traveller(second)).name).toBe('Bisi Okafor');
  });
});

describe('72 hours offline (PRD: zero data loss)', () => {
  it('signed in 3 days ago, offline since: the session works and every change lands, with its time', async () => {
    const s = await setup();
    const { walk, bookings } = await s.tourDay({
      startsIn: -72 * HOUR,
      bookings: [
        {},
        { name: 'Tunde Bakare', travellers: [{ name: 'Tunde Bakare', age: 40 }] },
        { name: 'Ngozi Eze', travellers: [{ name: 'Ngozi Eze', age: 29 }] },
      ],
    });
    // The clock moved forward: the phone signed in 73 hours ago and hasn't been heard since.
    await ctx.prisma.session.updateMany({
      where: { userId: s.kemi.id },
      data: {
        createdAt: new Date(Date.now() - 73 * HOUR),
        lastUsedAt: new Date(Date.now() - 73 * HOUR),
      },
    });
    const [adaeze, tunde, ngozi] = bookings;
    const times = [ago(72 * HOUR + 10 * 60_000), ago(72 * HOUR + 5 * 60_000), ago(71 * HOUR)];
    const res = await s.asKemi.sync([
      s.change({
        at: times[0],
        kind: 'check_in',
        departureId: walk.id,
        code: adaeze.code,
        status: 'present',
      }),
      s.change({
        at: times[1],
        kind: 'check_in',
        departureId: walk.id,
        code: tunde.code,
        status: 'late',
        confirmOwed: false,
      }),
      s.change({ at: times[2], kind: 'no_show', departureId: walk.id, bookingId: ngozi.id }),
    ]);
    expect(res.status).toBe(200);
    expect(res.body.results.map((/** @type {any} */ r) => r.outcome)).toEqual([
      'applied',
      'applied',
      'applied',
    ]);
    expect((await s.traveller(adaeze.travellerIds[0])).checkedInAt?.toISOString()).toBe(times[0]);
    expect((await s.traveller(tunde.travellerIds[0])).checkInStatus).toBe('late');
    expect((await s.traveller(ngozi.travellerIds[0])).checkInStatus).toBe('no_show');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: ngozi.id } })).status).toBe(
      'no_show',
    );
    const stored = await ctx.prisma.syncChange.findMany({
      where: { userId: s.kemi.id },
      orderBy: { happenedAt: 'asc' },
    });
    expect(stored.map((c) => c.happenedAt.toISOString())).toEqual(times);
  });
});
