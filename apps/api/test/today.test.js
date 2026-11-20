/**
 * Stage 16a: the manager's Today (designs: "Manager’s Today", desktop and phone).
 *   - Needs you, most urgent first: no guide soon (and who's free), chats waiting for a
 *     person, a failed refund, a balance due today, cash with a guide
 *   - today's departures: who, what, "n of m checked in", and where each is at
 *   - guides' phones: synced when (a phone behind by over an hour flagged)
 *   - for the office only; a guide gets 403
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { bookingIdFromGuestToken } from '@okapigo/db';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const HOUR = 3_600_000;

/** @param {string} token */
const as = (token) => ({
  get: (/** @type {string} */ url) =>
    request(ctx.app).get(url).set('Authorization', `Bearer ${token}`),
  post: (/** @type {string} */ url) =>
    request(ctx.app).post(url).set('Authorization', `Bearer ${token}`),
  put: (/** @type {string} */ url) =>
    request(ctx.app).put(url).set('Authorization', `Bearer ${token}`),
});

async function setup() {
  const seeded = await ctx.seedOperator();
  const { operator } = seeded;
  const manager = as(await ctx.tokenFor(seeded.manager.id));
  const guide = (/** @type {string} */ n) =>
    seeded.guides.find((/** @type {any} */ g) => g.name === n);
  const kemi = guide('Kemi Adeyemi');
  const asKemi = as(await ctx.tokenFor(kemi.id));

  const departureOf = async (/** @type {string} */ slug, n = 0) => {
    const product = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug },
    });
    return (
      await ctx.prisma.departure.findMany({
        where: { productId: product.id, startsAt: { gt: new Date(Date.now() + 2 * 86_400_000) } },
        orderBy: { startsAt: 'asc' },
        take: n + 1,
      })
    )[n];
  };
  /** A paid website booking; returns its id. */
  const book = async (
    /** @type {any} */ d,
    name = 'Adaeze Okafor',
    travellers = [{ name, age: 34 }],
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
        departureId: d.id,
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
  /** Moves a departure to start `fromNow` ms from now, lasting 3 hours. */
  const moveTo = (/** @type {any} */ d, /** @type {number} */ fromNow) =>
    ctx.prisma.departure.update({
      where: { id: d.id },
      data: {
        startsAt: new Date(Date.now() + fromNow),
        endsAt: new Date(Date.now() + fromNow + 3 * HOUR),
      },
    });
  return { ...seeded, manager, kemi, asKemi, departureOf, book, moveTo };
}

describe('the manager’s Today', () => {
  it('a departure soon with no guide: urgent, how soon, and who’s free', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    await s.book(walk);
    await s.moveTo(walk, 2 * HOUR + 20 * 60_000);
    const t = (await s.manager.get('/api/today')).body.today;
    const need = t.needs.find((/** @type {any} */ n) => n.kind === 'no_guide');
    expect(need).toMatchObject({
      tone: 'urgent',
      key: expect.stringMatching(/^IN 2 H (19|20) MIN$/),
      title: 'Heritage Walk has no guide',
      // After 21:40 the departure is tomorrow: then its date comes first ("Sat 21 Nov, 00:08").
      detail: expect.stringMatching(/^(\w{3} \d+ \w{3}, )?\d\d:\d\d · 1 booked · \w+ is free$/),
      action: 'Assign',
      href: `/departures/${walk.id}`,
    });
    // Under "departures today" only if it IS today in Lagos (late in the evening, it's tomorrow's).
    const row = t.departures.find((/** @type {any} */ d) => d.id === walk.id);
    const lagosDay = (/** @type {number} */ ms) =>
      new Date(ms).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' });
    if (lagosDay(Date.now() + 2 * HOUR + 20 * 60_000) === lagosDay(Date.now())) {
      expect(row).toMatchObject({
        guide: 'No guide yet',
        hasGuide: false,
        progress: '1 booked of 15',
        state: { text: 'Needs a guide', tone: 'urgent' },
      });
    } else {
      expect(row).toBeUndefined();
    }
    expect(t.badges.schedule).toBe(1);

    // A guide busy at the same time isn't the one suggested. Guides are offered in name
    // order: Chinedu first, while he's free; once he's busy then, the next one, Femi.
    const need0 = (await s.manager.get('/api/today')).body.today.needs.find(
      (/** @type {any} */ n) => n.kind === 'no_guide',
    );
    expect(need0.detail).toMatch(/Chinedu is free$/);
    const chinedu = s.guides.find((/** @type {any} */ g) => g.name === 'Chinedu Eze');
    const taken = await s.departureOf('lagos-street-food-crawl');
    const walkNow = await ctx.prisma.departure.findUniqueOrThrow({ where: { id: walk.id } });
    await ctx.prisma.departure.update({
      where: { id: taken.id },
      data: { startsAt: walkNow.startsAt, endsAt: walkNow.endsAt, guideId: chinedu.id },
    });
    const again = (await s.manager.get('/api/today')).body.today.needs.find(
      (/** @type {any} */ n) => n.kind === 'no_guide',
    );
    expect(again.detail).toMatch(/Femi is free$/);
  });

  it('a departure under way: progress, the guide and van, synced when; the guide’s phone', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk, 'Adaeze Okafor', [
      { name: 'Adaeze Okafor', age: 34 },
      { name: 'Chidi Okafor', age: 36 },
    ]);
    await s.moveTo(walk, -10 * 60_000);
    await s.manager.put(`/api/departures/${walk.id}/assignment`).send({ guideId: s.kemi.id });
    await s.asKemi
      .post(`/api/departures/${walk.id}/check-ins`)
      .send({ bookingId: id, travellerIds: [], status: 'present' });
    // Kemi's phone syncs, saying 2 changes are waiting.
    await s.asKemi.get('/api/sync/package').set('X-Outbox-Waiting', '2');

    const t = (await s.manager.get('/api/today')).body.today;
    const row = t.departures.find((/** @type {any} */ d) => d.id === walk.id);
    expect(row).toMatchObject({
      guide: 'Kemi · on foot',
      progress: '2 of 2 checked in',
      pct: 100,
      state: { text: expect.stringMatching(/^Under way · synced \d\d:\d\d$/), tone: 'ok' },
    });
    expect(t.phones).toEqual([
      {
        name: 'Kemi',
        trip: expect.stringMatching(/^Heritage Walk, \d\d:\d\d$/),
        status: expect.stringMatching(/^Synced \d\d:\d\d · 2 waiting$/),
        tone: 'ok',
      },
    ]);
    expect(t.summary).toBe('1 departure · 2 guests · 1 guide out');

    // Not heard from for over an hour: flagged.
    await ctx.prisma.user.update({
      where: { id: s.kemi.id },
      data: { lastSyncedAt: new Date(Date.now() - 2 * HOUR) },
    });
    const later = (await s.manager.get('/api/today')).body.today.phones[0];
    expect(later).toMatchObject({
      status: expect.stringMatching(/^Not seen since /),
      tone: 'warning',
    });
  });

  it('chats waiting for a person, a failed refund, a balance due today, cash with a guide; most urgent first', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const paid = await s.book(walk);
    // A guest asked for a person 3 minutes ago.
    const chat = await ctx.prisma.conversation.create({
      data: {
        operatorId: s.operator.id,
        channel: 'whatsapp',
        guestPhone: `+234803${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
        guestName: 'Yemi Ojo',
        needsPersonSince: new Date(Date.now() - 3 * 60_000),
      },
    });
    await ctx.prisma.chatMessage.create({
      data: {
        operatorId: s.operator.id,
        conversationId: chat.id,
        direction: 'in',
        author: 'guest',
        body: { text: 'Is the lunch halal?' },
      },
    });
    // A refund the bank refused.
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { bookingId: paid } });
    await ctx.prisma.refund.create({
      data: {
        operatorId: s.operator.id,
        bookingId: paid,
        paymentId: payment.id,
        provider: 'simulator',
        amountKobo: 6_250_000,
        status: 'failed',
        reason: 'Guest cancelled',
        failureReason: 'card expired',
      },
    });
    // A deposit booking whose balance is due today: its trip is 7 days away.
    const badagry = await s.departureOf('badagry-heritage-day-trip');
    const dep = await s.book(badagry, 'Funmi Adeyemi');
    await ctx.prisma.booking.update({
      where: { id: dep },
      data: { status: 'part_paid', amountPaidKobo: 1_950_000 },
    });
    await s.moveTo(badagry, 7 * 86_400_000);
    // Cash Kemi took on the day.
    await ctx.prisma.cashReport.create({
      data: {
        operatorId: s.operator.id,
        bookingId: paid,
        reportedById: s.kemi.id,
        amountKobo: 4_550_000,
        reportedAt: new Date(),
      },
    });
    // A deposit booking whose balance isn't due yet (its trip is 20 days away): not listed.
    const later = await s.departureOf('badagry-heritage-day-trip', 1);
    const notYet = await s.book(later, 'Tola Bello');
    await ctx.prisma.booking.update({
      where: { id: notYet },
      data: { status: 'part_paid', amountPaidKobo: 1_950_000 },
    });
    await s.moveTo(later, 20 * 86_400_000);

    const t = (await s.manager.get('/api/today')).body.today;
    const by = (/** @type {string} */ k) => t.needs.find((/** @type {any} */ n) => n.kind === k);
    expect(by('chats')).toMatchObject({
      tone: 'urgent',
      key: 'WAITING 3 MIN',
      title: '1 chat needs a person',
      detail: 'Yemi Ojo: “Is the lunch halal?”',
      action: 'Reply',
    });
    expect(by('refund')).toMatchObject({
      tone: 'urgent',
      title: 'Refund failed: ₦62,500',
      detail: 'Adaeze Okafor · card expired',
    });
    expect(by('balance')).toMatchObject({
      tone: 'soon',
      key: 'DUE TODAY',
      title: expect.stringMatching(/^Balance ₦[\d,]+ due$/),
      action: 'Send link',
    });
    expect(by('cash')).toMatchObject({
      tone: 'info',
      key: 'CASH',
      title: '₦45,500 cash with Kemi',
      detail: 'Confirm when it’s handed in',
    });
    expect(t.needs.filter((/** @type {any} */ n) => n.kind === 'balance')).toHaveLength(1);
    expect(t.needs.some((/** @type {any} */ n) => n.detail.startsWith('Tola Bello'))).toBe(false);

    // Kemi's cash turns out to be a possible double payment: urgent, so above the balance due.
    await ctx.prisma.cashReport.updateMany({
      where: { bookingId: paid },
      data: { status: 'possible_double' },
    });
    const t2 = (await s.manager.get('/api/today')).body.today;
    const kinds = t2.needs.map((/** @type {any} */ n) => n.kind);
    expect(t2.needs.find((/** @type {any} */ n) => n.kind === 'cash')).toMatchObject({
      tone: 'urgent',
      key: 'PAID TWICE?',
    });
    expect(kinds.indexOf('cash')).toBeLessThan(kinds.indexOf('balance'));
    // Urgent ones first, then soon, then for information.
    const tones = t.needs.map((/** @type {any} */ n) => n.tone);
    expect(tones).toEqual(
      [...tones].sort(
        (a, b) => ['urgent', 'soon', 'info'].indexOf(a) - ['urgent', 'soon', 'info'].indexOf(b),
      ),
    );
    expect(t.badges.inbox).toBeGreaterThanOrEqual(1);
  });

  it('for the office only: a guide gets 403; /api/me names the owner', async () => {
    const s = await setup();
    expect((await s.asKemi.get('/api/today')).status).toBe(403);
    const me = (await s.asKemi.get('/api/me')).body;
    expect(me.owner).toEqual({ name: s.owner.name });
  });
});
