/**
 * Stage 16d-3: the inbox's Alerts tab (designs: O9 Inbox — requests and alerts).
 *   - each kind, in words, with its action: cash to confirm, cash not handed in, a refund that
 *     failed or was never sent, a balance overdue, a departure without a guide
 *   - each clears by itself when its cause is fixed (no dismiss for money)
 *   - "Done this week": who dealt with what, and when
 *   - the Inbox badge counts them
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { bookingIdFromGuestToken, markRefundFailed } from '@okapigo/db';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

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
  const femi = seeded.guides.find((/** @type {any} */ g) => g.name === 'Femi Ogunleye');
  const departureOf = async (/** @type {string} */ slug, n = 0) => {
    const product = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug },
    });
    return (
      await ctx.prisma.departure.findMany({
        where: { productId: product.id, startsAt: { gt: new Date(Date.now() + 2 * DAY) } },
        orderBy: { startsAt: 'asc' },
        take: n + 1,
      })
    )[n];
  };
  const book = async (/** @type {any} */ d, name = 'Funmi Adeyemi') => {
    const res = await request(ctx.app)
      .post(`/public/${operator.slug}/bookings`)
      .send({
        lead: { name, email: 'funmi@guest.example', phone: '0805 987 6543', acceptTerms: true },
        departureId: d.id,
        travellers: [{ name, age: 34 }],
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
  const alerts = async () => (await manager.get('/api/inbox/alerts')).body;
  const find = async (/** @type {string} */ kind) =>
    (await alerts()).alerts.filter((/** @type {any} */ a) => a.kind === kind);
  return { ...seeded, manager, femi, departureOf, book, alerts, find };
}

describe('done this week', () => {
  it('only what the office did: not a guest’s own refund, nor a guide’s tour-day link', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk', 2);
    const res = await request(ctx.app)
      .post(`/public/${s.operator.slug}/bookings`)
      .send({
        lead: {
          name: 'Bayo Adewale',
          email: 'bayo@guest.example',
          phone: '0812 555 0192',
          acceptTerms: true,
        },
        departureId: walk.id,
        travellers: [{ name: 'Bayo Adewale', age: 40 }],
        addOns: [],
      });
    const { token } = res.body;
    const { reference } = (
      await request(ctx.app).post(`/public/bookings/${token}/pay`).send({ option: 'full' })
    ).body.payment;
    await ctx.provider.complete(reference);
    await request(ctx.app).post(`/public/bookings/${token}/payments/${reference}/check`);
    const id = /** @type {string} */ (bookingIdFromGuestToken(TEST_AUTH_SECRET, token));
    // The guest cancels on their trip page (over 48 hours ahead: all back); a refund starts.
    const cancelled = await request(ctx.app)
      .post(`/public/bookings/${token}/cancel`)
      .send({ expectRefundKobo: 2_500_000 });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(await ctx.prisma.refund.count({ where: { bookingId: id } })).toBe(1);
    // A guide's tour-day payment link (15c-4).
    await ctx.prisma.bookingEvent.create({
      data: {
        operatorId: s.operator.id,
        bookingId: id,
        type: 'payment_link_created',
        actorType: 'user',
        actorUserId: s.femi.id,
        data: { amountKobo: 100, tourDay: true },
      },
    });
    expect((await s.alerts()).done).toEqual([]);
  });
});

describe('the alerts', () => {
  it('cash to confirm: shown until confirmed; then under Done', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk);
    await ctx.prisma.booking.update({
      where: { id },
      data: { status: 'part_paid', amountPaidKobo: 500_000 },
    });
    const report = await ctx.prisma.cashReport.create({
      data: {
        operatorId: s.operator.id,
        bookingId: id,
        reportedById: s.femi.id,
        amountKobo: 2_000_000,
        reportedAt: new Date(),
      },
    });
    expect(await s.find('cash')).toEqual([
      expect.objectContaining({
        tone: 'info',
        icon: '₦',
        title: 'Cash to confirm: ₦20,000 from Femi',
        detail: expect.stringMatching(
          /^Funmi Adeyemi · [A-Z]+-[A-Z0-9]{6} · reported \w{3} \d+ \w{3}, \d\d:\d\d$/,
        ),
        action: 'Open booking',
        href: `/bookings/${id}`,
      }),
    ]);
    await s.manager.post(`/api/cash-reports/${report.id}/confirm`).send({});
    const after = await s.alerts();
    expect(after.alerts.filter((/** @type {any} */ a) => a.kind === 'cash')).toEqual([]);
    expect(after.done[0]).toMatchObject({
      text: expect.stringMatching(/^Cash ₦20,000 confirmed by \w+, \w{3} \d+ \w{3} \d\d:\d\d$/),
      detail: expect.stringMatching(/^Funmi Adeyemi · /),
      href: `/bookings/${id}`,
    });
  });

  it('cash not handed in: shown while the guest still owes', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk);
    await ctx.prisma.booking.update({
      where: { id },
      data: { status: 'part_paid', amountPaidKobo: 500_000 },
    });
    const report = await ctx.prisma.cashReport.create({
      data: {
        operatorId: s.operator.id,
        bookingId: id,
        reportedById: s.femi.id,
        amountKobo: 2_000_000,
        reportedAt: new Date(),
      },
    });
    await s.manager.post(`/api/cash-reports/${report.id}/not-received`);
    expect(await s.find('cash_missing')).toEqual([
      expect.objectContaining({
        tone: 'urgent',
        title: 'Cash not handed in: ₦20,000 from Femi',
        detail: expect.stringMatching(/ · still owes ₦20,000$/),
      }),
    ]);
    // Paid since (by link, say): it clears.
    await ctx.prisma.booking.update({
      where: { id },
      data: { status: 'paid', amountPaidKobo: 2_500_000 },
    });
    expect(await s.find('cash_missing')).toEqual([]);
  });

  it('refunds: never sent; failed; cleared once sent (bank transfer), and Done says so', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk);
    await s.manager
      .post(`/api/bookings/${id}/cancel`)
      .send({ initiatedBy: 'operator', reason: 'Guide unwell' });
    expect(await s.find('refund_due')).toEqual([
      expect.objectContaining({ title: 'Refund to send: ₦25,000', action: 'Sort it out' }),
    ]);
    await s.manager.post(`/api/bookings/${id}/refunds`).send({ reason: 'Guide unwell' });
    // Sending: nothing to do, so no alert at all for it.
    expect(
      (await s.alerts()).alerts.filter((/** @type {any} */ x) => x.href === `/bookings/${id}`),
    ).toEqual([]);
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: id } });
    await markRefundFailed(ctx.prisma, refund.id, 'the card has expired');
    expect(await s.find('refund_failed')).toEqual([
      expect.objectContaining({
        tone: 'urgent',
        title: 'Refund failed: ₦25,000',
        detail: expect.stringMatching(/ · the card has expired$/),
      }),
    ]);
    await s.manager.post(`/api/bookings/${id}/refunds/bank-transfer`).send({
      amountKobo: 2_500_000,
      sentOn: new Date().toISOString().slice(0, 10),
      reference: 'GTB-1',
    });
    const after = await s.alerts();
    // Nothing at all for that booking once the money's back (not even "cancelled").
    expect(after.alerts.filter((/** @type {any} */ a) => a.href === `/bookings/${id}`)).toEqual([]);
    expect(after.done.map((/** @type {any} */ d) => d.text)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Refund of ₦25,000 recorded as a bank transfer by \w+, /),
        expect.stringMatching(/^Refund of ₦25,000 sent by \w+, /),
      ]),
    );
  });

  it('a balance overdue: what, when it was due, reminders that failed; cleared when paid', async () => {
    const s = await setup();
    const badagry = await s.departureOf('badagry-heritage-day-trip');
    const id = await s.book(badagry, 'Yemi Ojo');
    await ctx.prisma.booking.update({
      where: { id },
      data: { status: 'part_paid', amountPaidKobo: 1_950_000 },
    });
    // The trip is in 3 days: the balance was due 4 days ago (7 days before).
    await ctx.prisma.departure.update({
      where: { id: badagry.id },
      data: {
        startsAt: new Date(Date.now() + 3 * DAY),
        endsAt: new Date(Date.now() + 3 * DAY + 10 * HOUR),
      },
    });
    await ctx.prisma.notification.create({
      data: {
        operatorId: s.operator.id,
        bookingId: id,
        audience: 'guest',
        kind: 'balance_reminder',
        key: 'balance_reminder:1:whatsapp',
        channel: 'whatsapp',
        status: 'failed',
        data: {},
      },
    });
    expect(await s.find('balance')).toEqual([
      expect.objectContaining({
        tone: 'warning',
        title: 'Balance overdue: ₦45,500',
        detail: expect.stringMatching(
          /^Yemi Ojo · Badagry Day Trip \w{3} \d+ \w{3} · due \w{3} \d+ \w{3} · 1 reminder failed$/,
        ),
        action: 'Send a link',
      }),
    ]);
    await ctx.prisma.booking.update({
      where: { id },
      data: { status: 'paid', amountPaidKobo: 6_500_000 },
    });
    expect(await s.find('balance')).toEqual([]);
    // A deposit whose balance isn't due yet (the trip is 20 days away): no alert.
    const later = await s.departureOf('badagry-heritage-day-trip', 1);
    const notYet = await s.book(later, 'Tola Bello');
    await ctx.prisma.booking.update({
      where: { id: notYet },
      data: { status: 'part_paid', amountPaidKobo: 1_950_000 },
    });
    await ctx.prisma.departure.update({
      where: { id: later.id },
      data: {
        startsAt: new Date(Date.now() + 20 * DAY),
        endsAt: new Date(Date.now() + 20 * DAY + 10 * HOUR),
      },
    });
    expect(await s.find('balance')).toEqual([]);
  });

  it('a departure soon with guests and no guide; cleared when one is assigned, and Done says who', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    await s.book(walk);
    const [a] = await s.find('no_guide');
    expect(a).toMatchObject({
      tone: 'urgent',
      icon: '?',
      title: 'Departure without a guide',
      detail: expect.stringMatching(/^Heritage Walk · \w{3} \d+ \w{3}, 09:00 · 1 booked$/),
      action: 'Assign a guide',
      href: `/departures/${walk.id}`,
    });
    await s.manager.put(`/api/departures/${walk.id}/assignment`).send({ guideId: s.femi.id });
    const after = await s.alerts();
    expect(after.alerts.filter((/** @type {any} */ x) => x.kind === 'no_guide')).toEqual([]);
    expect(after.done[0]).toMatchObject({
      text: expect.stringMatching(/^Guide assigned by \w+, \w{3} \d+ \w{3} \d\d:\d\d$/),
      detail: expect.stringMatching(/^Heritage Walk · .* · Femi$/),
      href: `/departures/${walk.id}`,
    });
  });

  it('most urgent first; the Inbox badge counts them; for the office only', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk);
    await ctx.prisma.cashReport.create({
      data: {
        operatorId: s.operator.id,
        bookingId: id,
        reportedById: s.femi.id,
        amountKobo: 100_000,
        reportedAt: new Date(),
      },
    });
    const { alerts } = await s.alerts();
    expect(alerts.map((/** @type {any} */ a) => a.kind)).toEqual(['no_guide', 'cash']);
    const today = (await s.manager.get('/api/today')).body.today;
    expect(today.badges.inbox).toBe(2);
    const kemi = s.guides.find((/** @type {any} */ g) => g.name === 'Kemi Adeyemi');
    expect((await as(await ctx.tokenFor(kemi.id)).get('/api/inbox/alerts')).status).toBe(403);
  });
});
