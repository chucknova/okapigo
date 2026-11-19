/**
 * Stage 15a: running tour days (OPS-01, OPS-07, OPS-08), the server side of the operator app
 * (flow brief 07, with your decisions of 2026-11-19).
 *   - vans and the boat: a name and its seats; the owner adds them
 *   - assigning a guide and a van/boat: never two places at once (the app's check AND the
 *     database's exclusion constraint); a van too small is a warning
 *   - the manifest: travellers, dietary needs, extras, pickup, money; unnamed travellers;
 *     cancelled bookings struck through; a guide sees only their own departures
 *   - check-in by ticket or by name: present / late / undo; safe to repeat; refused with why
 *     (another departure, cancelled, money owed unless confirmed)
 *   - no-shows, after the start only; optional names at check-in
 *   - a departure called off: every guest told why, with their full refund
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { bookingIdFromGuestToken, ticketCode } from '@okapigo/db';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';
import { printableManifest } from '../src/routes/operations.js';
import { sendGuestMessages } from '../src/messages/send.js';
import { createChannels } from '../src/whatsapp/channels.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

/** @param {string} token */
function as(token) {
  const withAuth =
    (/** @type {'get' | 'post' | 'put' | 'patch'} */ m) => (/** @type {string} */ url) =>
      request(ctx.app)[m](url).set('Authorization', `Bearer ${token}`);
  return {
    get: withAuth('get'),
    post: withAuth('post'),
    put: withAuth('put'),
    patch: withAuth('patch'),
  };
}

/** A business, its staff signed in, and helpers to find departures and make bookings. */
async function setup() {
  const seeded = await ctx.seedOperator();
  const { operator } = seeded;
  const owner = as(await ctx.tokenFor(seeded.owner.id));
  const manager = as(await ctx.tokenFor(seeded.manager.id));
  const byName = (/** @type {string} */ n) =>
    seeded.guides.find((/** @type {any} */ g) => g.name === n);
  const kemi = byName('Kemi Adeyemi');
  const chinedu = byName('Chinedu Eze');
  const asKemi = as(await ctx.tokenFor(kemi.id));
  const asChinedu = as(await ctx.tokenFor(chinedu.id));

  /** The next departure of a tour on or after `daysAhead` days (optionally on a Saturday). */
  const departureOf = async (/** @type {string} */ slug, daysAhead = 2, saturday = false) => {
    const product = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug },
    });
    const list = await ctx.prisma.departure.findMany({
      where: {
        productId: product.id,
        startsAt: { gt: new Date(Date.now() + daysAhead * 86_400_000) },
      },
      orderBy: { startsAt: 'asc' },
      take: 20,
    });
    return saturday
      ? list.find((d) => new Date(d.startsAt.getTime() + 3_600_000).getUTCDay() === 6)
      : list[0];
  };

  /** A website booking on a departure, paid in full (or left owing with payLater). */
  const book = async (
    /** @type {any} */ departure,
    {
      name = 'Adaeze Okafor',
      travellers = [{ name: 'Adaeze Okafor', age: 34 }],
      payLater = false,
    } = {},
  ) => {
    if (payLater) {
      const created = await manager.post('/api/bookings').send({
        departureId: departure.id,
        lead: { name, phone: '0803 555 0101', acceptTerms: true },
        travellers,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      await manager.post(`/api/bookings/${created.body.booking.id}/confirm`).send({});
      return created.body.booking.id;
    }
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
    return /** @type {string} */ (bookingIdFromGuestToken(TEST_AUTH_SECRET, token));
  };
  return { ...seeded, owner, manager, kemi, chinedu, asKemi, asChinedu, departureOf, book };
}

describe('vans and the boat (decided: a name and its seats)', () => {
  it('seeded; the owner adds and changes one; names are unique; a manager can’t add', async () => {
    const { owner, manager, asKemi } = await setup();
    expect(
      (await asKemi.get('/api/resources')).body.resources.map((/** @type {any} */ r) => [
        r.kind,
        r.name,
        r.seats,
      ]),
    ).toEqual([
      ['boat', 'Boat', 12],
      ['van', 'Van 1', 14],
      ['van', 'Van 2', 14],
    ]);
    const made = await owner.post('/api/resources').send({ kind: 'van', name: 'Van 3', seats: 18 });
    expect(made.status).toBe(201);
    expect(
      (await owner.post('/api/resources').send({ kind: 'van', name: 'Van 3', seats: 10 })).body
        .error.code,
    ).toBe('NAME_TAKEN');
    expect(
      (await owner.patch(`/api/resources/${made.body.resource.id}`).send({ seats: 16 })).body
        .resource.seats,
    ).toBe(16);
    expect(
      (await manager.post('/api/resources').send({ kind: 'boat', name: 'Boat 2', seats: 8 }))
        .status,
    ).toBe(403);
  });
});

describe('assigning a guide and a van (OPS-01: never two places at once)', () => {
  it('the manager assigns; a clash is refused with where they are; a small van is a warning', async () => {
    const { manager, asKemi, kemi, operator, departureOf } = await setup();
    const badagry = await departureOf('badagry-heritage-day-trip', 2, true); // Sat 07:00–17:00
    const walk = await ctx.prisma.departure.findFirstOrThrow({
      where: {
        operatorId: operator.id,
        startsAt: new Date(badagry.startsAt.getTime() + 2 * 3_600_000),
      }, // Sat 09:00
    });
    const van1 = await ctx.prisma.resource.findFirstOrThrow({
      where: { operatorId: operator.id, name: 'Van 1' },
    });

    const ok = await manager.put(`/api/departures/${badagry.id}/assignment`).send({
      guideId: kemi.id,
      resourceId: van1.id,
      notes: 'Driver: Sola',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({
      assignment: {
        guide: { id: kemi.id, name: 'Kemi Adeyemi' },
        resource: expect.objectContaining({ name: 'Van 1', seats: 14 }),
        notes: 'Driver: Sola',
      },
      warnings: [],
    });

    const busy = await manager
      .put(`/api/departures/${walk.id}/assignment`)
      .send({ guideId: kemi.id });
    expect(busy.status).toBe(409);
    expect(busy.body.error).toMatchObject({
      code: 'GUIDE_BUSY',
      message: 'Kemi Adeyemi is on the Badagry Heritage Day Trip until 17:00.',
    });
    const vanBusy = await manager
      .put(`/api/departures/${walk.id}/assignment`)
      .send({ resourceId: van1.id });
    expect(vanBusy.body.error).toMatchObject({
      code: 'RESOURCE_BUSY',
      message: 'Van 1 is on the Badagry Heritage Day Trip until 17:00.',
    });

    // The boat seats 12; with 13 guests booked it's allowed, with a warning.
    const boat = await ctx.prisma.resource.findFirstOrThrow({
      where: { operatorId: operator.id, name: 'Boat' },
    });
    await ctx.prisma.departure.update({ where: { id: walk.id }, data: { seatsSold: 13 } });
    const small = await manager
      .put(`/api/departures/${walk.id}/assignment`)
      .send({ resourceId: boat.id });
    expect(small.body.warnings).toEqual(['RESOURCE_TOO_SMALL']);

    // The other way round: the walk first (09:00–12:00), then the Badagry trip that started
    // earlier (07:00) but runs through it: still a clash.
    const otherSat = await ctx.prisma.departure.findFirstOrThrow({
      where: {
        operatorId: operator.id,
        productId: badagry.productId,
        startsAt: { gt: new Date(badagry.startsAt.getTime() + 86_400_000) },
      },
      orderBy: { startsAt: 'asc' },
    });
    const otherWalk = await ctx.prisma.departure.findFirstOrThrow({
      where: {
        operatorId: operator.id,
        startsAt: new Date(otherSat.startsAt.getTime() + 2 * 3_600_000),
      },
    });
    expect(
      (await manager.put(`/api/departures/${otherWalk.id}/assignment`).send({ guideId: kemi.id }))
        .status,
    ).toBe(200);
    const reverse = await manager
      .put(`/api/departures/${otherSat.id}/assignment`)
      .send({ guideId: kemi.id });
    expect(reverse.body.error?.code).toBe('GUIDE_BUSY');
    // Back to back is fine: the evening Street Food Crawl the same Saturday.
    const evening = await ctx.prisma.departure.findFirstOrThrow({
      where: {
        operatorId: operator.id,
        startsAt: {
          gt: otherWalk.endsAt,
          lt: new Date(otherWalk.startsAt.getTime() + 12 * 3_600_000),
        },
      },
    });
    expect(
      (await manager.put(`/api/departures/${evening.id}/assignment`).send({ guideId: kemi.id }))
        .status,
    ).toBe(200);

    // A guide can't assign (bookings: view only).
    expect(
      (await asKemi.put(`/api/departures/${walk.id}/assignment`).send({ notes: 'x' })).status,
    ).toBe(403);
  });

  it('the database itself refuses a double booking, however it’s written', async () => {
    const { kemi, departureOf } = await setup();
    const badagry = await departureOf('badagry-heritage-day-trip', 2, true);
    const walk = await ctx.prisma.departure.findFirstOrThrow({
      where: {
        operatorId: badagry.operatorId,
        startsAt: new Date(badagry.startsAt.getTime() + 2 * 3_600_000),
      },
    });
    await ctx.prisma.departure.update({ where: { id: badagry.id }, data: { guideId: kemi.id } });
    await expect(
      ctx.prisma.departure.update({ where: { id: walk.id }, data: { guideId: kemi.id } }),
    ).rejects.toThrow(/departures_guide_not_double_booked/);
    // A cancelled departure doesn't hold anyone.
    await ctx.prisma.departure.update({ where: { id: badagry.id }, data: { status: 'cancelled' } });
    await ctx.prisma.departure.update({ where: { id: walk.id }, data: { guideId: kemi.id } });
  });

  it('only this business’s staff and vans; a cancelled departure can’t be assigned', async () => {
    const { manager, departureOf } = await setup();
    const other = await ctx.seedOperator();
    const walk = await departureOf('lagos-island-heritage-walk');
    const theirGuide = other.guides[0];
    expect(
      (await manager.put(`/api/departures/${walk.id}/assignment`).send({ guideId: theirGuide.id }))
        .status,
    ).toBe(404);
    await ctx.prisma.departure.update({ where: { id: walk.id }, data: { status: 'cancelled' } });
    expect(
      (await manager.put(`/api/departures/${walk.id}/assignment`).send({ notes: 'x' })).body.error
        .code,
    ).toBe('DEPARTURE_CANCELLED');
  });
});

describe('the manifest (OPS-07, screen O3)', () => {
  it('travellers, unnamed ones, dietary needs, money owed, a cancelled booking struck through', async () => {
    const { manager, asKemi, asChinedu, kemi, departureOf, book } = await setup();
    const walk = await departureOf('lagos-island-heritage-walk');
    await manager.put(`/api/departures/${walk.id}/assignment`).send({ guideId: kemi.id });
    const paid = await book(walk, {
      travellers: [
        { name: 'Adaeze Okafor', age: 34 },
        { name: 'Kamsi Okafor', age: 8, dietaryNeeds: 'No peanuts' },
      ],
    });
    // As a WhatsApp booking would have it: the second traveller has no name yet.
    await ctx.prisma.traveller.updateMany({
      where: { bookingId: paid, position: 2 },
      data: { name: '' },
    });
    const owing = await book(walk, {
      name: 'Kunle Ade',
      travellers: [{ name: 'Kunle Ade', age: 45 }],
      payLater: true,
    });
    const gone = await book(walk, {
      name: 'Tola Bello',
      travellers: [{ name: 'Tola Bello', age: 30 }],
    });
    await manager
      .post(`/api/bookings/${gone}/cancel`)
      .send({ initiatedBy: 'guest', reason: 'Asked to' });

    const res = await asKemi.get(`/api/departures/${walk.id}/manifest`);
    expect(res.status).toBe(200);
    const m = res.body.manifest;
    expect(m).toMatchObject({
      tour: { title: 'Lagos Island Heritage Walk', meetingPoint: { name: 'Tinubu Square' } },
      guide: { name: 'Kemi Adeyemi' },
      counts: { travellers: 3, pending: 3, present: 0, late: 0, noShow: 0 },
    });
    const byId = Object.fromEntries(m.bookings.map((/** @type {any} */ b) => [b.id, b]));
    expect(
      byId[paid].travellers.map((/** @type {any} */ t) => [
        t.displayName,
        t.category.name,
        t.dietaryNeeds,
      ]),
    ).toEqual([
      ['Adaeze Okafor', 'Adult (13+)', ''],
      ['Guest 2 of Adaeze Okafor’s booking', 'Child (3–12)', 'No peanuts'],
    ]);
    expect(byId[paid].money.label).toBe('Paid');
    expect(byId[owing].money).toMatchObject({ owedKobo: 2_500_000, label: '₦25,000 still to pay' });
    expect(byId[gone]).toMatchObject({ status: 'cancelled', endedAt: expect.any(String) });

    // Chinedu isn't on it: to him it doesn't exist. The manager sees any departure.
    expect((await asChinedu.get(`/api/departures/${walk.id}/manifest`)).status).toBe(404);
    expect((await manager.get(`/api/departures/${walk.id}/manifest`)).status).toBe(200);

    // Printable (or "Save as PDF"): every row, escaped, the cancelled one struck through.
    const page = await asKemi.get(`/api/departures/${walk.id}/manifest/print`);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    // (The A4 design, 15c-4.)
    expect(page.text).toContain('Ìrìn Lagos Tours · Manifest');
    expect(page.text).toContain('<strong>3</strong>travellers · 2 adults, 1 child');
    expect(page.text).toContain('<strong>1</strong>dietary: no peanuts');
    expect(page.text).toContain('<strong>₦25,000</strong>still owed (1 booking)');
    expect(page.text).toContain('Guest 2 (name: ____________)');
    expect(page.text).toContain('NO PEANUTS');
    expect(page.text).toContain('owes ₦25,000');
    expect(page.text).toMatch(
      /Cancelled, don’t check in:<\/strong> Tola Bello · [A-Z]+-\w+ · 1 guest \(cancelled /,
    );
    expect(page.text).toContain('No-show: write NS in the box. Late: write the time.');
  });

  it('printed: a pickup tour’s rows grouped by stop, in the van’s order, with their times', () => {
    const t = (
      /** @type {string} */ id,
      /** @type {string} */ name,
      /** @type {number} */ position,
    ) => ({
      id,
      name,
      position,
      age: null,
      dietaryNeeds: '',
      checkInStatus: 'pending',
      checkedInAt: null,
      category: { key: 'adult', name: 'Adult (13+)' },
    });
    const b = (
      /** @type {string} */ ref,
      /** @type {string} */ lead,
      /** @type {string} */ stop,
      /** @type {any[]} */ travellers,
    ) => ({
      id: ref,
      reference: ref,
      status: 'paid',
      endedAt: null,
      lead: { name: lead, phone: '+2348020000000' },
      pickupPoint: { name: stop },
      addOns: [],
      money: { owedKobo: 0, label: 'Paid' },
      travellers,
    });
    const html = printableManifest(
      {
        business: { name: 'Ìrìn Lagos Tours', timeZone: 'Africa/Lagos' },
        departure: {
          startsAt: '2026-12-05T07:00:00Z',
          endsAt: '2026-12-05T12:00:00Z',
          localDate: '2026-12-05',
          localTime: '08:00',
          notes: 'Driver: Sola',
        },
        tour: {
          title: 'Lekki Nature and Craft Half-Day',
          meetingPoint: { name: 'the Conservation Centre' },
          pickupPoints: [
            { name: 'Victoria Island', address: 'Eko Hotel main gate', time: '07:15' },
            { name: 'Ikoyi', address: 'Falomo roundabout', time: '07:30' },
          ],
        },
        guide: { name: 'Segun' },
        resource: { name: 'Van 2', seats: 10 },
        bookings: [
          b('ILT-IKOYI1', 'Tola Johnson', 'Ikoyi', [t('a', 'Tola Johnson', 1), t('b', '', 2)]),
          b('ILT-VI0001', 'Kelechi <Okoro>', 'Victoria Island', [t('c', 'Kelechi Okoro', 1)]),
        ],
      },
      new Date('2026-12-05T05:35:00Z'),
    );
    const vi = html.indexOf('07:15 · Victoria Island · Eko Hotel main gate');
    const ikoyi = html.indexOf('07:30 · Ikoyi · Falomo roundabout');
    expect(vi).toBeGreaterThan(0);
    expect(ikoyi).toBeGreaterThan(vi); // the van's order, not the bookings'
    expect(html.indexOf('ILT-VI0001')).toBeGreaterThan(vi);
    expect(html.indexOf('ILT-VI0001')).toBeLessThan(ikoyi);
    expect(html.indexOf('ILT-IKOYI1')).toBeGreaterThan(ikoyi);
    // Each booking once, under its own stop.
    expect(html.split('ILT-VI0001').length - 1).toBe(1);
    expect(html.split('ILT-IKOYI1').length - 1).toBe(1);
    expect(html).toContain('Guest 2 (name: ____________)');
    expect(html).toContain('Kelechi &lt;Okoro&gt;'); // escaped
    expect(html).toContain('<strong>Van 2</strong> · 10 seats · Driver: Sola');
    expect(html).toContain('Printed Sat 5 Dec, 06:35');
    expect(html).toContain('Sat 5 Dec 2026 · 08:00 · back about 13:00 · the Conservation Centre');
  });
});

describe('check-in (OPS-08)', () => {
  it('by ticket: everyone present, once; again says when; another departure’s or a forged ticket is refused', async () => {
    const { manager, asKemi, kemi, departureOf, book } = await setup();
    const walk = await departureOf('lagos-island-heritage-walk');
    const later = await departureOf('lagos-island-heritage-walk', 6);
    await manager.put(`/api/departures/${walk.id}/assignment`).send({ guideId: kemi.id });
    const id = await book(walk, {
      travellers: [
        { name: 'Adaeze Okafor', age: 34 },
        { name: 'Chidi Okafor', age: 36 },
      ],
    });
    const code = ticketCode(TEST_AUTH_SECRET, id);

    const first = await asKemi.post(`/api/departures/${walk.id}/check-ins`).send({ code });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.checkIn.travellers.map((/** @type {any} */ t) => t.checkInStatus)).toEqual([
      'present',
      'present',
    ]);
    expect(first.body.checkIn.already).toBeNull();
    const row = await ctx.prisma.traveller.findFirstOrThrow({ where: { bookingId: id } });
    expect(row.checkedInById).toBe(kemi.id);

    const again = await asKemi.post(`/api/departures/${walk.id}/check-ins`).send({ code });
    expect(again.body.checkIn.already).toBe(first.body.checkIn.travellers[0].checkedInAt);
    expect(
      await ctx.prisma.bookingEvent.count({ where: { bookingId: id, type: 'checked_in' } }),
    ).toBe(1);
    // …and the first check-in time stays (a second scan doesn't move it).
    const after = await ctx.prisma.traveller.findFirstOrThrow({ where: { id: row.id } });
    expect(after.checkedInAt?.toISOString()).toBe(row.checkedInAt?.toISOString());

    // Kemi is assigned to this departure only; the manager tries the ticket on the other one.
    const wrong = await manager.post(`/api/departures/${later.id}/check-ins`).send({ code });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('OTHER_DEPARTURE');
    expect(wrong.body.error.message).toMatch(/^This ticket is for \w{3} \d+ \w{3}, 09:00\.$/);
    const forged = await asKemi
      .post(`/api/departures/${walk.id}/check-ins`)
      .send({ code: `${code.slice(0, -2)}xx` });
    expect(forged.body.error.code).toBe('NOT_OUR_TICKET');
  });

  it('by name: some travellers, late, or back to pending; a cancelled booking is refused', async () => {
    const { manager, asKemi, kemi, departureOf, book } = await setup();
    const walk = await departureOf('lagos-island-heritage-walk');
    await manager.put(`/api/departures/${walk.id}/assignment`).send({ guideId: kemi.id });
    const id = await book(walk, {
      travellers: [
        { name: 'Adaeze Okafor', age: 34 },
        { name: 'Chidi Okafor', age: 36 },
      ],
    });
    // (Booked now: nobody can book once the walk has started, below.)
    const gone = await book(walk, {
      name: 'Tola Bello',
      travellers: [{ name: 'Tola Bello', age: 30 }],
    });
    const [, chidi] = await ctx.prisma.traveller.findMany({
      where: { bookingId: id },
      orderBy: { position: 'asc' },
    });
    // Late (and one traveller's no-show) unlock at the start time (designs: O3 states).
    const early = await asKemi
      .post(`/api/departures/${walk.id}/check-ins`)
      .send({ bookingId: id, travellerIds: [chidi.id], status: 'late' });
    expect(early.body.error.code).toBe('NOT_STARTED');
    expect(early.body.error.message).toMatch(/^Late can only be marked from \d\d:\d\d\.$/);
    await ctx.prisma.departure.update({
      where: { id: walk.id },
      data: { startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000) },
    });
    const late = await asKemi
      .post(`/api/departures/${walk.id}/check-ins`)
      .send({ bookingId: id, travellerIds: [chidi.id], status: 'late' });
    expect(late.body.checkIn.travellers.map((/** @type {any} */ t) => t.checkInStatus)).toEqual([
      'pending',
      'late',
    ]);
    // One traveller not here, the other came: a no-show for that person only. The booking
    // stays as it was (no policy: only noShow() for the whole booking applies that).
    const absent = await asKemi
      .post(`/api/departures/${walk.id}/check-ins`)
      .send({ bookingId: id, travellerIds: [chidi.id], status: 'no_show' });
    expect(absent.body.checkIn.travellers[1].checkInStatus).toBe('no_show');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('paid');
    const undo = await asKemi
      .post(`/api/departures/${walk.id}/check-ins`)
      .send({ bookingId: id, travellerIds: [chidi.id], status: 'pending' });
    expect(undo.body.checkIn.travellers[1]).toMatchObject({
      checkInStatus: 'pending',
      checkedInAt: null,
    });

    await manager
      .post(`/api/bookings/${gone}/cancel`)
      .send({ initiatedBy: 'guest', reason: 'Asked to' });
    const refused = await asKemi
      .post(`/api/departures/${walk.id}/check-ins`)
      .send({ bookingId: gone });
    expect(refused.body.error).toMatchObject({
      code: 'BOOKING_CANCELLED',
      message: 'This booking was cancelled: don’t check it in.',
    });
  });

  it('money still owed: asks first (decided), then checks in when confirmed', async () => {
    const { manager, asKemi, kemi, departureOf, book } = await setup();
    const walk = await departureOf('lagos-island-heritage-walk');
    await manager.put(`/api/departures/${walk.id}/assignment`).send({ guideId: kemi.id });
    const id = await book(walk, {
      name: 'Kunle Ade',
      travellers: [{ name: 'Kunle Ade', age: 45 }],
      payLater: true,
    });
    const asked = await asKemi.post(`/api/departures/${walk.id}/check-ins`).send({ bookingId: id });
    expect(asked.status).toBe(409);
    expect(asked.body.error).toMatchObject({
      code: 'BALANCE_OWED',
      message: 'They still owe ₦25,000. Check in anyway?',
      owedKobo: 2_500_000,
    });
    const ok = await asKemi
      .post(`/api/departures/${walk.id}/check-ins`)
      .send({ bookingId: id, confirmOwed: true });
    expect(ok.body.checkIn.travellers[0].checkInStatus).toBe('present');

    // Marking someone NOT here doesn't ask about money (15c-2): nobody is being let in.
    await ctx.prisma.departure.update({
      where: { id: walk.id },
      data: { startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000) },
    });
    const absent = await asKemi
      .post(`/api/departures/${walk.id}/check-ins`)
      .send({ bookingId: id, status: 'no_show' });
    expect(absent.status).toBe(200);
    expect(absent.body.checkIn.travellers[0].checkInStatus).toBe('no_show');
  });
});

describe('no-shows and names (decided: the guide marks it; names optional)', () => {
  it('not before the start; after it, the booking is a no-show and its travellers too; then no check-in', async () => {
    const { manager, asKemi, kemi, departureOf, book } = await setup();
    const walk = await departureOf('lagos-island-heritage-walk');
    await manager.put(`/api/departures/${walk.id}/assignment`).send({ guideId: kemi.id });
    const id = await book(walk);
    const early = await asKemi.post(`/api/departures/${walk.id}/no-shows`).send({ bookingId: id });
    expect(early.body.error.code).toBe('NOT_STARTED');

    // Tour time: move the departure to an hour ago.
    const length = walk.endsAt.getTime() - walk.startsAt.getTime();
    const start = new Date(Date.now() - 3_600_000);
    await ctx.prisma.departure.update({
      where: { id: walk.id },
      data: { startsAt: start, endsAt: new Date(start.getTime() + length) },
    });
    expect(
      (await asKemi.post(`/api/departures/${walk.id}/no-shows`).send({ bookingId: id })).body
        .noShow,
    ).toEqual({ already: false });
    expect(
      (await asKemi.post(`/api/departures/${walk.id}/no-shows`).send({ bookingId: id })).body
        .noShow,
    ).toEqual({ already: true });
    const b = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id },
      include: { travellers: true },
    });
    expect(b.status).toBe('no_show');
    expect(b.travellers.map((t) => t.checkInStatus)).toEqual(['no_show']);
    const late = await asKemi.post(`/api/departures/${walk.id}/check-ins`).send({ bookingId: id });
    expect(late.body.error.code).toBe('NO_SHOW_MARKED');
  });

  it('a name typed at check-in; only on your departure; 2 to 80 characters', async () => {
    const { manager, asKemi, asChinedu, kemi, departureOf, book } = await setup();
    const walk = await departureOf('lagos-island-heritage-walk');
    await manager.put(`/api/departures/${walk.id}/assignment`).send({ guideId: kemi.id });
    const id = await book(walk, {
      travellers: [
        { name: 'Adaeze Okafor', age: 34 },
        { name: 'Chidi Okafor', age: 36 },
      ],
    });
    const t = await ctx.prisma.traveller.findFirstOrThrow({
      where: { bookingId: id, position: 2 },
    });
    await ctx.prisma.traveller.update({ where: { id: t.id }, data: { name: '' } });
    expect(
      (await asKemi.patch(`/api/travellers/${t.id}`).send({ name: '  Chidi   Okafor ' })).body
        .traveller.name,
    ).toBe('Chidi Okafor');
    expect((await asKemi.patch(`/api/travellers/${t.id}`).send({ name: 'C' })).status).toBe(400);
    expect(
      (await asChinedu.patch(`/api/travellers/${t.id}`).send({ name: 'Someone' })).status,
    ).toBe(404);
  });
});

describe('a departure called off (weather)', () => {
  it('every guest is told why, with their full refund', async () => {
    const { operator, manager, departureOf, book } = await setup();
    const tarkwa = await departureOf('tarkwa-bay-beach-and-lagoon', 6);
    const id = await book(tarkwa, { travellers: [{ name: 'Adaeze Okafor', age: 34 }] });
    const res = await manager
      .post(`/api/departures/${tarkwa.id}/cancel`)
      .send({ reason: 'Bad weather at sea.' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await sendGuestMessages({
      prisma: ctx.prisma,
      authSecret: TEST_AUTH_SECRET,
      webPublicUrl: 'http://localhost:4000',
      channels: createChannels(),
      operatorId: operator.id,
    });
    const c = await ctx.prisma.conversation.findFirstOrThrow({
      where: { operatorId: operator.id, guestPhone: '+2348031234567' },
      include: { messages: { orderBy: { seq: 'asc' } } },
    });
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(/** @type {any} */ (c.messages.at(-1)?.body)?.text).toMatch(
      new RegExp(
        `is cancelled\\.\\n\\nWe’re sorry: we had to cancel this trip \\(Bad weather at sea\\)\\. You’ll get a full refund of ₦${(b.amountPaidKobo / 100).toLocaleString('en-NG')}, back to the card or account you paid with\\.`,
      ),
    );
  });
});
