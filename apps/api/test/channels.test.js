/**
 * Sessions 17c and 17c-2: the channel manager, as designed (O11 · Settings › Channels).
 *   - each channel as a card, in words; one channel's page (tours, latest bookings, money,
 *     connection); owners change things, managers look
 *   - connecting one (its key shown once; every published tour on), changing it, its tours one
 *     by one, a new key, switching it off and on
 *   - a payment from the OTA: its oldest bookings paid off first, and the ledger
 *   - "via Sojourna" on the bookings desk, the booking's page and the departure
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { accountBalances } from '@okapigo/db';
import { createTestContext } from './helpers.js';
import { bookingMoney, owedWords, tourNote, whoShort } from '../src/routes/channels.js';

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

const TIME = /^\d\d:\d\d$/;
const DAY = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}$/;
const lagosToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());

async function setup() {
  const s = await ctx.seedOperator();
  const owner = as(await ctx.tokenFor(s.owner.id));
  const manager = as(await ctx.tokenFor(s.manager.id));
  const guide = as(await ctx.tokenFor(s.guides[0].id));
  const sojourna = await ctx.prisma.channel.findFirstOrThrow({
    where: { operatorId: s.operator.id },
  });
  const api = octo(`octo_dev_${s.operator.slug}`);
  const tour = (/** @type {string} */ slug) =>
    ctx.prisma.product.findFirstOrThrow({ where: { operatorId: s.operator.id, slug } });
  const tarkwa = await tour('tarkwa-bay-beach-and-lagoon');
  /** An OTA sale of two adults on a Tarkwa Bay departure; returns the booking. @param {string} uuid */
  const sale = async (uuid, through = api) => {
    const d = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: tarkwa.id, startsAt: { gt: new Date(Date.now() + 4 * 86_400_000) } },
      orderBy: { startsAt: 'asc' },
    });
    const r = await through.post('/octo/bookings').send({
      uuid,
      productId: tarkwa.id,
      optionId: 'DEFAULT',
      availabilityId: d.id,
      unitItems: [{ unitId: 'adult' }, { unitId: 'adult' }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const c = await through
      .post(`/octo/bookings/${uuid}/confirm`)
      .send({ contact: { fullName: 'Ada Eze', emailAddress: 'ada@guest.example' } });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    return ctx.prisma.booking.findFirstOrThrow({ where: { channelBooking: { uuid } } });
  };
  const card = async () => (await owner.get('/api/channels')).body.channels[0];
  const page = async (id = sojourna.id) => (await owner.get(`/api/channels/${id}`)).body.channel;
  return {
    ...s,
    ownerId: s.owner.id,
    owner,
    manager,
    guide,
    sojourna,
    api,
    tour,
    tarkwa,
    sale,
    card,
    page,
  };
}

describe('the channels, in words', () => {
  it('the seeded Sojourna; owners and managers see it, guides don’t; never its key', async () => {
    const s = await setup();
    const res = await s.owner.get('/api/channels');
    expect(res.status).toBe(200);
    expect(res.body.octoEndpoint).toBe('http://localhost:4000/octo');
    expect(res.body.channels).toEqual([
      {
        id: s.sojourna.id,
        name: 'Sojourna',
        isActive: true,
        status: 'Connected',
        commissionBasisPoints: 2000,
        commission: '20%',
        summary: '20% commission · 5 of 5 tours · no bookings yet',
        month: { lead: 'This month:', strong: 'no sales yet' },
        owedKobo: 0,
        owedLine: '₦0 owed',
      },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(`octo_dev_${s.operator.slug}`);
    expect((await s.manager.get('/api/channels')).status).toBe(200);
    expect((await s.manager.get(`/api/channels/${s.sojourna.id}`)).status).toBe(200);
    const patch = await s.manager.patch(`/api/channels/${s.sojourna.id}`).send({ isActive: false });
    expect(patch.status).toBe(403);
    expect((await s.guide.get('/api/channels')).status).toBe(403);
  });

  it('a sale, a hold, last month’s sale and a half refund: the card, and the desk', async () => {
    const s = await setup();
    await s.sale('c-1');
    expect(await s.card()).toMatchObject({
      summary: expect.stringMatching(/^20% commission · 5 of 5 tours · last booking \d\d:\d\d$/),
      month: { lead: 'This month:', strong: '1 booking · ₦80,000' },
      owedKobo: 6_400_000,
      owedLine: '₦64,000 owed',
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
    expect(await s.card()).toMatchObject({
      month: { strong: '1 booking · ₦80,000' },
      owedKobo: 6_400_000,
    });
    // Sold last month: not this month's sales, still owed.
    await ctx.prisma.channelBooking.update({
      where: { channelId_uuid: { channelId: s.sojourna.id, uuid: 'c-1' } },
      data: { confirmedAt: new Date(Date.now() - 40 * 86_400_000) },
    });
    expect(await s.card()).toMatchObject({
      month: { strong: 'no sales yet' },
      owedKobo: 6_400_000,
    });
    // Its last booking another day: the day, not the time.
    expect((await s.card()).summary.split(' · last booking ')[1]).toMatch(DAY);
    // Cancelled 30 hours before: half back to the guest; it owes the other half's net.
    const b = await ctx.prisma.booking.findFirstOrThrow({
      where: { channelBooking: { uuid: 'c-1' } },
    });
    await ctx.prisma.departure.update({
      where: { id: b.departureId },
      data: { startsAt: new Date(Date.now() + 30 * 3_600_000) },
    });
    expect((await s.api.post('/octo/bookings/c-1/cancel').send({})).status).toBe(200);
    expect(await s.card()).toMatchObject({ owedKobo: 3_200_000, owedLine: '₦32,000 owed' });
    const desk = (await s.owner.get(`/api/desk/bookings/${b.id}`)).body.booking;
    expect(desk.money).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Sojourna owes you',
          value: '₦32,000 (₦40,000 less 20%)',
        }),
      ]),
    );
  });

  it('one channel’s page: its tours, its own latest bookings, the money, the connection', async () => {
    const s = await setup();
    const booking = await s.sale('c-2');
    // Another channel's sale isn't this one's.
    const other = await s.owner
      .post('/api/channels')
      .send({ name: 'Tripwell', commissionPercent: 15 });
    await s.sale('t-1', octo(other.body.apiKey));
    // A tour taken off sale: off, and it can't be switched on.
    const street = await s.tour('lagos-street-food-crawl');
    await ctx.prisma.product.update({ where: { id: street.id }, data: { status: 'draft' } });

    const c = await s.page();
    expect(c.tours).toHaveLength(5);
    const tourOf = (/** @type {string} */ id) =>
      c.tours.find((/** @type {any} */ t) => t.id === id);
    expect(tourOf(s.tarkwa.id)).toEqual({
      id: s.tarkwa.id,
      title: s.tarkwa.title,
      on: true,
      canSwitch: true,
      note: 'On sale on Sojourna',
    });
    expect(tourOf((await s.tour('lekki-nature-and-craft')).id).note).toBe(
      'On sale · pickup points shared',
    );
    expect(tourOf((await s.tour('badagry-heritage-day-trip')).id).note).toBe(
      'On sale · full price only (no deposit on OTAs)',
    );
    expect(tourOf(street.id)).toMatchObject({
      on: false,
      canSwitch: false,
      note: 'Draft: only published tours can be on',
    });
    // Tours it can sell: on it AND on sale.
    expect(c.summary).toMatch(/^20% commission · 4 of 4 tours · last booking /);

    expect(c.bookings).toEqual([
      {
        id: booking.id,
        reference: booking.reference,
        who: 'Ada Eze · 2A',
        tour: expect.stringMatching(/^Tarkwa Bay Beach Day · (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d/),
        price: '₦80,000',
        state: 'Owes ₦64,000',
        tone: 'owes',
      },
    ]);
    expect(c.money).toEqual({
      salesLabel: 'Sales this month (1)',
      sales: '₦80,000',
      shareLabel: 'Sojourna’s 20%',
      share: '− ₦16,000',
      owedLabel: `Sojourna owes ${s.operator.name}`,
      owed: '₦64,000',
      lastPayment: null,
    });
    // The key: its last four, when it was made, and when Sojourna last used it (just now).
    const hint = `octo_dev_${s.operator.slug}`.slice(-4);
    expect(c.connection.octoEndpoint).toBe('http://localhost:4000/octo');
    expect(c.connection.keyHint).toBe(hint);
    const [ending, made, used] = c.connection.keyLine.split(' · ');
    expect(ending).toBe(`ending ••••${hint}`);
    expect(made.replace('made ', '')).toMatch(DAY);
    expect(used.replace('last used ', '')).toMatch(TIME);
    expect(c.keptLine).toBe(
      '1 upcoming booking from Sojourna stays as it is; its guests can still come. Sojourna still owes ₦64,000.',
    );

    const theirs = await ctx.seedOperator();
    const theirChannel = await ctx.prisma.channel.findFirstOrThrow({
      where: { operatorId: theirs.operator.id },
    });
    expect((await s.owner.get(`/api/channels/${theirChannel.id}`)).status).toBe(404);
  });
});

describe('connecting and changing a channel', () => {
  it('connect: every published tour on; the key shown once, never stored, works with OCTO', async () => {
    const s = await setup();
    const street = await s.tour('lagos-street-food-crawl');
    await ctx.prisma.product.update({ where: { id: street.id }, data: { status: 'draft' } });
    const res = await s.owner
      .post('/api/channels')
      .send({ name: '  Tripwell ', commissionPercent: 17.5 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.apiKey).toMatch(/^octo_[A-Za-z0-9_-]{43}$/);
    expect(res.body.octoEndpoint).toBe('http://localhost:4000/octo');
    expect(res.body.channel).toMatchObject({
      name: 'Tripwell',
      commission: '17.5%',
      summary: '17.5% commission · 4 of 4 tours · no bookings yet',
    });
    expect(res.body.channel.connection.keyLine).toMatch(/ · not used yet$/);
    expect(res.body.channel.tours.filter((/** @type {any} */ t) => t.on)).toHaveLength(4);
    expect((await octo(res.body.apiKey).get('/octo/products')).body).toHaveLength(4);
    // The key isn't kept: only its hash. Seen again: no key.
    const row = await ctx.prisma.channel.findUniqueOrThrow({ where: { id: res.body.channel.id } });
    expect(JSON.stringify(row)).not.toContain(res.body.apiKey);
    expect(JSON.stringify((await s.owner.get('/api/channels')).body)).not.toContain(
      res.body.apiKey,
    );
    // Put back on sale later: not on this channel until switched on.
    await ctx.prisma.product.update({ where: { id: street.id }, data: { status: 'published' } });
    expect((await s.page(res.body.channel.id)).summary).toMatch(/ · 4 of 5 tours · /);
    // Switched off before selling anything.
    const off = await s.owner
      .patch(`/api/channels/${res.body.channel.id}`)
      .send({ isActive: false });
    expect(off.body.channel.month).toEqual({ lead: 'No past bookings', strong: null });
  });

  it('refused: a name already used, a bad commission', async () => {
    const s = await setup();
    const dup = await s.owner
      .post('/api/channels')
      .send({ name: 'Sojourna', commissionPercent: 10 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('NAME_TAKEN');
    for (const commissionPercent of [-1, 101, 12.345]) {
      const r = await s.owner.post('/api/channels').send({ name: 'X Tours', commissionPercent });
      expect(r.status).toBe(400);
    }
    const tripwell = await s.owner
      .post('/api/channels')
      .send({ name: 'Tripwell', commissionPercent: 10 });
    const clash = await s.owner
      .patch(`/api/channels/${tripwell.body.channel.id}`)
      .send({ name: 'Sojourna' });
    expect(clash.body.error.code).toBe('NAME_TAKEN');
  });

  it('tours one by one: off, on again; a draft can’t go on; another business’s is unknown', async () => {
    const s = await setup();
    const url = `/api/channels/${s.sojourna.id}/tours/${s.tarkwa.id}`;
    const off = await s.owner.put(url).send({ on: false });
    expect(off.status).toBe(200);
    const tarkwaRow = off.body.channel.tours.find((/** @type {any} */ t) => t.id === s.tarkwa.id);
    expect(tarkwaRow).toMatchObject({ on: false, note: 'Not on Sojourna' });
    expect((await s.api.get('/octo/products')).body).toHaveLength(4);
    expect((await s.owner.put(url).send({ on: true })).status).toBe(200);
    expect((await s.owner.put(url).send({ on: true })).status).toBe(200); // twice: still on
    expect((await s.api.get('/octo/products')).body).toHaveLength(5);

    const street = await s.tour('lagos-street-food-crawl');
    await s.owner.put(`/api/channels/${s.sojourna.id}/tours/${street.id}`).send({ on: false });
    await ctx.prisma.product.update({ where: { id: street.id }, data: { status: 'draft' } });
    const draft = await s.owner
      .put(`/api/channels/${s.sojourna.id}/tours/${street.id}`)
      .send({ on: true });
    expect(draft.status).toBe(409);
    expect(draft.body.error.code).toBe('NOT_ON_SALE');

    const theirs = await ctx.seedOperator();
    const theirTour = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: theirs.operator.id },
    });
    const foreign = await s.owner
      .put(`/api/channels/${s.sojourna.id}/tours/${theirTour.id}`)
      .send({ on: true });
    expect(foreign.status).toBe(404);
    expect((await s.manager.put(url).send({ on: false })).status).toBe(403);
  });

  it('commission for new sales only; switched off: its key stops, its bookings stay', async () => {
    const s = await setup();
    const old = await s.sale('c-3');
    const res = await s.owner
      .patch(`/api/channels/${s.sojourna.id}`)
      .send({ commissionPercent: 25 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.channel.commission).toBe('25%');
    // The old sale keeps its 20%; a new one owes at 25%.
    const frozen = await ctx.prisma.channelBooking.findUniqueOrThrow({
      where: { bookingId: old.id },
    });
    expect(frozen.commissionBasisPoints).toBe(2000);
    await s.sale('c-4');
    const c = await s.page();
    expect(c.owedKobo).toBe(6_400_000 + 6_000_000);
    expect(c.money.shareLabel).toBe('Sojourna’s commission'); // two shares this month
    expect(c.money.share).toBe('− ₦36,000');

    // Their day has passed (both are on one departure): not upcoming any more.
    await ctx.prisma.departure.update({
      where: { id: old.departureId },
      data: { startsAt: new Date(Date.now() - 3 * 86_400_000 + 7_777) },
    });
    const switched = await s.owner
      .patch(`/api/channels/${s.sojourna.id}`)
      .send({ isActive: false });
    expect(switched.body.channel).toMatchObject({
      status: 'Switched off',
      summary: '25% · can’t see or sell anything',
      month: { lead: '2 past bookings kept', strong: null },
      keptLine: 'No upcoming bookings from Sojourna. Sojourna still owes ₦124,000.',
    });
    expect((await s.api.get('/octo/supplier')).status).toBe(403);
    // The list: connected ones first.
    await s.owner.post('/api/channels').send({ name: 'Tripwell', commissionPercent: 10 });
    const names = (await s.owner.get('/api/channels')).body.channels.map(
      (/** @type {any} */ x) => x.name,
    );
    expect(names).toEqual(['Tripwell', 'Sojourna']);
    await s.owner.patch(`/api/channels/${s.sojourna.id}`).send({ isActive: true });
    expect((await s.api.get('/octo/supplier')).status).toBe(200);
  });

  it('a new key: the old one stops at once; made now, not used yet', async () => {
    const s = await setup();
    // Used two days ago: the next request says "last used" now (at most one write a minute).
    await ctx.prisma.channel.update({
      where: { id: s.sojourna.id },
      data: { apiKeyLastUsedAt: new Date(Date.now() - 2 * 86_400_000) },
    });
    expect((await s.page()).connection.keyLine).toMatch(
      / · last used (Mon|Tue|Wed|Thu|Fri|Sat|Sun) /,
    );
    await s.api.get('/octo/supplier');
    expect((await s.page()).connection.keyLine).toMatch(/ · last used \d\d:\d\d$/);
    const res = await s.owner.post(`/api/channels/${s.sojourna.id}/key`);
    expect(res.status).toBe(200);
    expect(res.body.octoEndpoint).toBe('http://localhost:4000/octo');
    expect(res.body.channel.connection.keyHint).toBe(res.body.apiKey.slice(-4));
    expect(res.body.channel.connection.keyLine).toMatch(/ · not used yet$/);
    expect((await s.api.get('/octo/supplier')).status).toBe(403);
    expect((await octo(res.body.apiKey).get('/octo/supplier')).status).toBe(200);
    expect((await s.page()).connection.keyLine).toMatch(/ · last used \d\d:\d\d$/);
  });
});

describe('a payment from the OTA', () => {
  it('pays off the oldest bookings first; the ledger; the words', async () => {
    const s = await setup();
    const first = await s.sale('p-1');
    const second = await s.sale('p-2');
    await ctx.prisma.channelBooking.update({
      where: { bookingId: first.id },
      data: { confirmedAt: new Date(Date.now() - 60_000) },
    });
    const res = await s.owner
      .post(`/api/channels/${s.sojourna.id}/payments`)
      .send({ amountKobo: 7_000_000, receivedOn: lagosToday(), reference: ' SOJ-PAYOUT-0193 ' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const c = res.body.channel;
    expect(c.owedKobo).toBe(12_800_000 - 7_000_000);
    expect(c.money.owed).toBe('₦58,000');
    const row = (/** @type {string} */ id) =>
      c.bookings.find((/** @type {any} */ b) => b.id === id);
    expect(row(first.id)).toMatchObject({ state: 'Settled', tone: 'ok' });
    expect(row(second.id)).toMatchObject({ state: 'Owes ₦58,000', tone: 'owes' });
    const month = new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      timeZone: 'Africa/Lagos',
    }).format(new Date());
    expect(c.money.lastPayment).toMatch(
      new RegExp(
        `^Last payment from Sojourna: ₦70,000 on \\w{3} \\d{1,2} \\w{3} \\(${month}’s sales\\)\\.$`,
      ),
    );
    const saved = await ctx.prisma.channelPayment.findFirstOrThrow({
      where: { channelId: s.sojourna.id },
    });
    expect(saved).toMatchObject({
      amountKobo: 7_000_000,
      reference: 'SOJ-PAYOUT-0193',
      recordedById: s.ownerId,
    });
    // The ledger: into the bank, off what OTAs owe.
    const balances = await accountBalances(ctx.prisma, s.operator.id);
    const balance = (/** @type {string} */ key) =>
      balances.find((/** @type {any} */ a) => a.key === key)?.balanceKobo;
    expect(balance('BANK')).toBe(7_000_000);
    expect(balance('OTA_RECEIVABLE')).toBe(12_800_000 - 7_000_000);

    // A refund after it was paid: owed back.
    await ctx.prisma.departure.update({
      where: { id: first.departureId },
      data: { startsAt: new Date(Date.now() + 100 * 3_600_000) },
    });
    expect((await s.api.post('/octo/bookings/p-1/cancel').send({})).status).toBe(200);
    const after = await s.page();
    expect(after.bookings.find((/** @type {any} */ b) => b.id === first.id)).toMatchObject({
      state: 'Refunded after paying: owed ₦64,000 back',
      tone: 'owes',
    });
    expect(after.owedKobo).toBe(5_800_000 - 6_400_000);
    expect(after.owedLine).toBe('You owe ₦6,000 back');
    // A cancelled sale isn't one of this month's sales any more.
    expect(after.money).toMatchObject({ salesLabel: 'Sales this month (1)', sales: '₦80,000' });
    expect(after.money).toMatchObject({
      owedLabel: `${s.operator.name} owes Sojourna`,
      owed: '₦6,000',
    });
  });

  it('refused: more than it owes, a day not come yet, too little; managers can’t', async () => {
    const s = await setup();
    const today = lagosToday();
    const url = `/api/channels/${s.sojourna.id}/payments`;
    const none = await s.owner.post(url).send({ amountKobo: 100_000, receivedOn: today });
    expect(none.status).toBe(409);
    expect(none.body.error).toMatchObject({
      code: 'MORE_THAN_OWED',
      message: 'Sojourna owes nothing right now.',
    });
    // An older sale refunded in full (owes nothing): the payment passes it by.
    const refunded = await s.sale('p-0');
    await ctx.prisma.departure.update({
      where: { id: refunded.departureId },
      data: { startsAt: new Date(Date.now() + 100 * 3_600_000) },
    });
    expect((await s.api.post('/octo/bookings/p-0/cancel').send({})).status).toBe(200);
    await s.sale('p-3');
    const more = await s.owner.post(url).send({ amountKobo: 6_400_100, receivedOn: today });
    expect(more.body.error.message).toBe('Sojourna owes ₦64,000: record up to that.');
    const later = await s.owner.post(url).send({ amountKobo: 100_000, receivedOn: '2099-01-01' });
    expect(later.status).toBe(400);
    expect(later.body.error.code).toBe('IN_THE_FUTURE');
    expect((await s.owner.post(url).send({ amountKobo: 50, receivedOn: today })).status).toBe(400);
    const manager = await s.manager.post(url).send({ amountKobo: 100_000, receivedOn: today });
    expect(manager.status).toBe(403);
    // Exactly what it owes: all settled.
    const all = await s.owner.post(url).send({ amountKobo: 6_400_000, receivedOn: today });
    expect(all.body.channel).toMatchObject({ owedKobo: 0, owedLine: '₦0 owed' });
    expect(all.body.channel.bookings[0]).toMatchObject({ state: 'Settled' });
  });

  it('the words, on their own', () => {
    const people = [{ categoryKey: 'adult' }, { categoryKey: 'adult' }, { categoryKey: 'child' }];
    expect(whoShort(people)).toBe('2A 1C');
    expect(owedWords(0)).toBe('₦0 owed');
    expect(owedWords(-150_000)).toBe('You owe ₦1,500 back');
    const plain = { status: 'published', pickupPoints: [], depositBasisPoints: null };
    expect(tourNote(plain, true, 'X')).toBe('On sale on X');
    expect(tourNote(plain, false, 'X')).toBe('Not on X');
    expect(tourNote({ status: 'archived' }, true, 'X')).toBe(
      'Draft: only published tours can be on',
    );
    const cb = (/** @type {string} */ status, /** @type {number[]} */ allocated) => ({
      commissionBasisPoints: 2000,
      allocations: allocated.map((amountKobo) => ({ amountKobo })),
      booking: {
        status,
        payments: [
          { provider: 'ota', status: 'succeeded', amountKobo: 1_000_000 },
          { provider: 'paystack', status: 'succeeded', amountKobo: 999_999 },
          { provider: 'ota', status: 'failed', amountKobo: 999_999 },
        ],
        refunds:
          status === 'cancelled'
            ? [{ provider: 'ota', status: 'processed', amountKobo: 1_000_000 }]
            : [],
      },
    });
    expect(bookingMoney(cb('paid', []))).toEqual({ text: 'Owes ₦8,000', tone: 'owes' });
    expect(bookingMoney(cb('paid', [800_000]))).toEqual({ text: 'Settled', tone: 'ok' });
    expect(bookingMoney(cb('cancelled', []))).toEqual({
      text: 'Cancelled · owes ₦0',
      tone: 'muted',
    });
  });
});

describe('"via Sojourna"', () => {
  it('on the bookings desk, the booking’s page and the departure', async () => {
    const s = await setup();
    const booking = await s.sale('c-5');
    const list = await s.owner.get('/api/desk/bookings?filter=all');
    expect(list.body.list.rows.find((/** @type {any} */ r) => r.id === booking.id).via).toBe(
      'via Sojourna',
    );
    const page = (await s.owner.get(`/api/desk/bookings/${booking.id}`)).body.booking;
    expect(page.refLine).toContain(' · SOJOURNA · ');
    expect(page.money).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringMatching(/^Paid by Sojourna · /),
          value: '₦80,000 paid',
        }),
        expect.objectContaining({
          label: 'Sojourna owes you',
          value: '₦64,000 (₦80,000 less 20%)',
        }),
      ]),
    );
    expect(page.timeline[0]).toMatch(/ · booked through Sojourna$/);
    const dep = (await s.owner.get(`/api/departures/${booking.departureId}/overview`)).body;
    const row = dep.departure.rows.find((/** @type {any} */ r) => r.id === booking.id);
    expect(row).toMatchObject({ via: 'via Sojourna', pay: 'Paid by Sojourna', payTone: 'paid' });
  });
});
