/**
 * Stage 16c-2: the money at the bookings desk (designs: O8 "every status", "phone and states").
 *   - a guide's cash: confirmed (a real payment, in the ledger as Cash; the balance closes),
 *     a different amount (the rest still owed), not received (still owed; the owner alerted);
 *     cash from a guest who'd also paid by link: owed back
 *   - a refund sent by bank transfer: recorded, from the Bank, the guest told, "refunded"
 *   - cancelling: the policy's refund in words, or another amount with a reason; the refund
 *     started right away
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { bookingIdFromGuestToken, markRefundFailed, policyWords, tripIn } from '@okapigo/db';
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
});

async function setup() {
  const seeded = await ctx.seedOperator();
  const { operator } = seeded;
  const manager = as(await ctx.tokenFor(seeded.manager.id));
  const femi = seeded.guides.find((/** @type {any} */ g) => g.name === 'Femi Ogunleye');
  const asFemi = as(await ctx.tokenFor(femi.id));
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
  /** A website booking paid in full by card; returns its id. */
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
  /** Makes a paid booking a deposit booking: `paid` of its total, the payment a deposit. */
  const onlyDeposit = async (/** @type {string} */ id, /** @type {number} */ paid) => {
    await ctx.prisma.booking.update({
      where: { id },
      data: { status: 'part_paid', amountPaidKobo: paid },
    });
    await ctx.prisma.payment.updateMany({
      where: { bookingId: id },
      data: { purpose: 'deposit', amountKobo: paid },
    });
  };
  const cashFrom = (/** @type {string} */ bookingId, /** @type {number} */ amountKobo) =>
    ctx.prisma.cashReport.create({
      data: {
        operatorId: operator.id,
        bookingId,
        reportedById: femi.id,
        amountKobo,
        reportedAt: new Date(Date.now() - HOUR),
      },
    });
  const page = async (/** @type {string} */ id) =>
    (await manager.get(`/api/desk/bookings/${id}`)).body.booking;
  const balance = async (/** @type {string} */ code) =>
    (await manager.get('/api/ledger/accounts')).body.accounts.find(
      (/** @type {any} */ a) => a.code === code,
    ).balanceKobo;
  const moveTo = (/** @type {any} */ d, /** @type {number} */ fromNow) =>
    ctx.prisma.departure.update({
      where: { id: d.id },
      data: {
        startsAt: new Date(Date.now() + fromNow),
        endsAt: new Date(Date.now() + fromNow + 3 * HOUR),
      },
    });
  return {
    ...seeded,
    manager,
    femi,
    asFemi,
    departureOf,
    book,
    onlyDeposit,
    cashFrom,
    page,
    balance,
    moveTo,
  };
}

describe('a guide’s cash', () => {
  it('confirmed: a cash payment, in the ledger as Cash; the balance closes', async () => {
    const s = await setup();
    const badagry = await s.departureOf('badagry-heritage-day-trip');
    const id = await s.book(badagry);
    await s.onlyDeposit(id, 1_950_000);
    const report = await s.cashFrom(id, 4_550_000);

    const before = await s.page(id);
    expect(before.banner).toMatchObject({
      kind: 'cash',
      cashReportId: report.id,
      amountKobo: 4_550_000,
    });
    const res = await s.manager.post(`/api/cash-reports/${report.id}/confirm`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.cash).toMatchObject({ amountKobo: 4_550_000, owedBack: null });

    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(b).toMatchObject({ status: 'paid', amountPaidKobo: 6_500_000 });
    expect(
      await ctx.prisma.payment.findFirstOrThrow({ where: { bookingId: id, provider: 'cash' } }),
    ).toMatchObject({
      method: 'cash',
      status: 'succeeded',
      amountKobo: 4_550_000,
      purpose: 'balance',
    });
    expect(await s.balance('1000')).toBe(4_550_000);
    expect(
      (await ctx.prisma.cashReport.findUniqueOrThrow({ where: { id: report.id } })).status,
    ).toBe('confirmed');

    const after = await s.page(id);
    expect(after.chip.text).toBe('Paid');
    expect(after.banner).toBeNull();
    expect(after.money).toContainEqual(
      expect.objectContaining({
        label: expect.stringMatching(/^Balance · cash · /),
        value: '₦45,500 paid',
      }),
    );
    expect(after.timeline.at(-1)).toMatch(/ · cash ₦45,500 confirmed received by \w+$/);
    // Only the card deposit could go back through Paystack; the cash can't.
    expect(after.sums.byCardKobo).toBe(1_950_000);
    // Twice: refused.
    const again = await s.manager.post(`/api/cash-reports/${report.id}/confirm`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({
      code: 'CASH_ALREADY_SETTLED',
      message: 'This cash was already confirmed.',
    });
  });

  it('a different amount: that much paid, the rest still owed', async () => {
    const s = await setup();
    const badagry = await s.departureOf('badagry-heritage-day-trip');
    const id = await s.book(badagry);
    await s.onlyDeposit(id, 1_950_000);
    const report = await s.cashFrom(id, 4_550_000);
    await s.manager.post(`/api/cash-reports/${report.id}/confirm`).send({ amountKobo: 2_000_000 });
    const after = await s.page(id);
    expect(after.chip.text).toBe('Owes ₦25,500');
    expect(after.timeline.at(-1)).toMatch(
      / · cash ₦20,000 received of ₦45,500 reported · confirmed by \w+$/,
    );
    expect(await s.balance('1000')).toBe(2_000_000);
  });

  it('they’d paid by link as well: the cash is owed back', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk);
    const report = await ctx.prisma.cashReport.update({
      where: { id: (await s.cashFrom(id, 2_500_000)).id },
      data: { status: 'possible_double' },
    });
    const res = await s.manager.post(`/api/cash-reports/${report.id}/confirm`).send({});
    expect(res.body.cash.owedBack).toBe('NOTHING_OWED');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id } })).refundDueKobo).toBe(
      2_500_000,
    );
  });

  it('not received: still owed, the owner alerted on Today', async () => {
    const s = await setup();
    const badagry = await s.departureOf('badagry-heritage-day-trip');
    const id = await s.book(badagry);
    await s.onlyDeposit(id, 1_950_000);
    const report = await s.cashFrom(id, 4_550_000);
    expect((await s.manager.post(`/api/cash-reports/${report.id}/not-received`)).status).toBe(200);
    const after = await s.page(id);
    expect(after.chip.text).toBe('Owes ₦45,500');
    expect(after.timeline.at(-1)).toMatch(
      / · cash ₦45,500 not received from Femi · marked by \w+ · the owner was alerted$/,
    );
    const today = (await s.manager.get('/api/today')).body.today;
    expect(today.needs).toContainEqual(
      expect.objectContaining({
        kind: 'cash_missing',
        tone: 'urgent',
        title: 'Cash not handed in: ₦45,500',
        detail: 'Funmi Adeyemi · reported by Femi',
        href: `/bookings/${id}`,
      }),
    );
    expect(await s.balance('1000')).toBe(0);
    // A guide can't settle cash.
    const other = await s.cashFrom(id, 100_000);
    expect((await s.asFemi.post(`/api/cash-reports/${other.id}/confirm`).send({})).status).toBe(
      403,
    );
  });
});

describe('a refund sent by bank transfer', () => {
  it('after a card refund failed: recorded, from the Bank, the guest told, refunded', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk);
    const cancel = await s.manager
      .post(`/api/bookings/${id}/cancel`)
      .send({ initiatedBy: 'operator', reason: 'Guide unwell', startRefund: true });
    expect(cancel.body.refundStart).toEqual({ started: true });
    const card = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: id } });
    await markRefundFailed(ctx.prisma, card.id, 'the card has expired');
    const due = await s.page(id);
    expect(due.chip.key).toBe('refund_failed');
    expect(due.sums).toMatchObject({ owedBackKobo: 2_500_000, byCardKobo: 2_500_000 });

    const send = (/** @type {any} */ body) =>
      s.manager.post(`/api/bookings/${id}/refunds/bank-transfer`).send(body);
    const today = new Date().toISOString().slice(0, 10);
    expect(
      (await send({ amountKobo: 3_000_000, sentOn: today, reference: 'GTB-55102' })).body.error,
    ).toMatchObject({ code: 'REFUND_TOO_HIGH', message: 'Only ₦25,000 is owed back.' });
    const tomorrow = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
    expect(
      (await send({ amountKobo: 2_500_000, sentOn: tomorrow, reference: 'GTB-55102' })).body.error
        .code,
    ).toBe('DATE_IN_FUTURE');
    expect((await send({ amountKobo: 2_500_000, sentOn: today, reference: 'x' })).status).toBe(400);

    const res = await send({ amountKobo: 2_500_000, sentOn: today, reference: 'GTB-55102' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(b.status).toBe('refunded');
    expect(
      await ctx.prisma.refund.findFirstOrThrow({
        where: { bookingId: id, provider: 'bank_transfer' },
      }),
    ).toMatchObject({ status: 'processed', providerRefundId: 'GTB-55102', amountKobo: 2_500_000 });
    expect(await s.balance('1200')).toBe(-2_500_000); // money left the bank
    expect(
      await ctx.prisma.notification.count({ where: { bookingId: id, kind: 'refund_sent' } }),
    ).toBeGreaterThan(0);
    const after = await s.page(id);
    expect(after.chip.text).toBe('Cancelled · refunded');
    expect(after.timeline).toContainEqual(
      expect.stringMatching(
        / · refund of ₦25,000 paid by bank transfer \(ref GTB-55102\) · recorded by \w+$/,
      ),
    );
    // Nothing more owed back.
    expect(
      (await send({ amountKobo: 100, sentOn: today, reference: 'GTB-55103' })).body.error.message,
    ).toBe('Nothing is owed back on this booking.');
  });
});

describe('cancelling from the desk', () => {
  it('the policy’s refund in words; the refund started at once', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk);
    await s.moveTo(walk, 30 * HOUR);
    const b = await s.page(id);
    expect(b.cancel).toMatchObject({
      paidKobo: 2_500_000,
      policyKobo: 1_250_000,
      policyText: '₦12,500 50%, because it’s 24–48 hours before',
      maxKobo: 2_500_000,
      sub: expect.stringMatching(
        /^Heritage Walk, \w{3} \d+ \w{3} \d\d:\d\d · paid ₦25,000 · trip is in (29|30) hours$/,
      ),
    });
    expect(b.actNote).toBe(
      'Cancelling now refunds ₦12,500 (50%, because it’s 24–48 hours before).',
    );

    const res = await s.manager.post(`/api/bookings/${id}/cancel`).send({
      initiatedBy: 'guest',
      reason: 'Cancelled at the guest’s request',
      startRefund: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.refundStart).toEqual({ started: true });
    const after = await s.page(id);
    expect(after.chip.text).toBe('Cancelled · refund sending');
    expect(after.cancel).toBeNull();
  });

  it('without "start the refund": cancelled, the refund owed and not started', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk);
    const res = await s.manager
      .post(`/api/bookings/${id}/cancel`)
      .send({ initiatedBy: 'operator', reason: 'Guide unwell' });
    expect(res.body.refundStart).toBeNull();
    expect(await ctx.prisma.refund.count({ where: { bookingId: id } })).toBe(0);
    expect((await s.page(id)).chip.key).toBe('refund_due');
  });

  it('another amount, with a reason on the timeline', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk);
    await s.manager.post(`/api/bookings/${id}/cancel`).send({
      initiatedBy: 'guest',
      reason: 'Family emergency',
      refundOverrideKobo: 2_500_000,
      startRefund: true,
    });
    expect((await s.page(id)).timeline).toContainEqual(
      expect.stringMatching(/ · cancelled by .+ · refund ₦25,000 \(reason: Family emergency\)$/),
    );
  });

  it('a deposit booking: the deposit isn’t refunded; after the start, nothing by policy', async () => {
    const s = await setup();
    const badagry = await s.departureOf('badagry-heritage-day-trip');
    const id = await s.book(badagry);
    await s.onlyDeposit(id, 1_950_000);
    expect((await s.page(id)).actNote).toBe(
      'Cancelling now: the ₦19,500 deposit isn’t refunded (deposits are non-refundable).',
    );
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const paid = await s.book(walk);
    await s.moveTo(walk, -HOUR);
    const started = await s.page(paid);
    expect(started.actNote).toBe(
      'Cancelling now would refund ₦0: the trip has started (policy). A different amount is possible with a reason.',
    );
    expect(started.cancel.policyText).toBe('₦0 nothing back: the trip has started');
  });
});

describe('words', () => {
  const rules = [
    { hoursBefore: 48, refundBasisPoints: 10_000 },
    { hoursBefore: 24, refundBasisPoints: 5_000 },
  ];
  it('the policy’s reason', () => {
    expect(policyWords({ reason: 'POLICY_TIER', rule: rules[0], hoursBefore: 100 }, rules)).toBe(
      'full refund, because it’s 48 hours or more before',
    );
    expect(policyWords({ reason: 'POLICY_TIER', rule: rules[1], hoursBefore: 30 }, rules)).toBe(
      '50%, because it’s 24–48 hours before',
    );
    expect(policyWords({ reason: 'AFTER_START', rule: null, hoursBefore: 10 }, rules)).toBe(
      'nothing back, because it’s under 24 hours before',
    );
    expect(policyWords({ reason: 'AFTER_START', rule: null, hoursBefore: -2 }, rules)).toBe(
      'nothing back: the trip has started',
    );
    expect(policyWords({ reason: 'NOTHING_PAID' }, rules)).toBe('nothing was paid');
    // A deposit that isn't refundable: named, so "full refund" of ₦0 never shows.
    expect(
      policyWords(
        {
          reason: 'POLICY_TIER',
          rule: rules[0],
          hoursBefore: 100,
          refundKobo: 0,
          keptDepositKobo: 1_950_000,
        },
        rules,
      ),
    ).toBe('nothing back: the ₦19,500 deposit isn’t refundable');
    expect(
      policyWords(
        {
          reason: 'POLICY_TIER',
          rule: rules[0],
          hoursBefore: 100,
          refundKobo: 500_000,
          keptDepositKobo: 1_950_000,
        },
        rules,
      ),
    ).toBe(
      'full refund, because it’s 48 hours or more before; the ₦19,500 deposit isn’t refundable',
    );
    expect(policyWords({ reason: 'OPERATOR_CANCELLED' }, rules)).toBe(
      'full refund, because we called it off',
    );
  });
  it('how soon the trip is', () => {
    const now = new Date('2026-12-04T00:00:00Z');
    expect(tripIn(new Date('2026-12-05T06:00:00Z'), now)).toBe('trip is in 30 hours');
    expect(tripIn(new Date('2026-12-04T01:00:00Z'), now)).toBe('trip is in 1 hour');
    expect(tripIn(new Date('2026-12-13T00:00:00Z'), now)).toBe('trip is in 9 days');
    expect(tripIn(new Date('2026-12-03T23:00:00Z'), now)).toBe('the trip has started');
  });
});
