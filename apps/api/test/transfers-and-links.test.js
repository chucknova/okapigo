/**
 * Stage 10d: bank transfers (PAY-03), manual matching, and payment links (PAY-05).
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { processWebhookEvent, verifyLedger } from '@okapigo/db';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

function as(token) {
  const withAuth = (method) => (url) =>
    request(ctx.app)[method](url).set('Authorization', `Bearer ${token}`);
  return { get: withAuth('get'), post: withAuth('post') };
}

/** A held 2-adult Heritage Walk booking (₦50,000). */
async function setup() {
  const seeded = await ctx.seedOperator();
  const manager = as(await ctx.tokenFor(seeded.manager.id));
  const guide = as(await ctx.tokenFor(seeded.guides[0].id));
  const { body } = await manager.get('/api/products');
  const walk = body.products.find((p) => p.slug === 'lagos-island-heritage-walk');
  const deps = (await manager.get(`/api/products/${walk.id}/availability`)).body.departures;
  const book = async (departure = deps[0]) =>
    (
      await manager.post('/api/bookings').send({
        departureId: departure.id,
        lead: { name: 'Amara Eze', email: 'amara@guest.example', acceptTerms: true },
        travellers: [
          { name: 'Amara Eze', age: 34 },
          { name: 'Obi Eze', age: 36 },
        ],
      })
    ).body.booking;
  return { ...seeded, manager, guide, book, booking: await book() };
}

/** Delivers the current charge.success for a reference, signed, and processes it. */
async function webhookFor(reference) {
  const body = JSON.stringify(await ctx.provider.chargeSuccessEvent(reference));
  await request(ctx.app)
    .post('/webhooks/paystack')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', ctx.provider.sign(body))
    .send(body);
  return processWebhookEvent(ctx.prisma, ctx.provider, ctx.jobs.webhooks.at(-1));
}

const bookingRow = (id) => ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
const balances = async (client) =>
  Object.fromEntries(
    (await client.get('/api/ledger/accounts')).body.accounts.map((a) => [a.key, a.balanceKobo]),
  );

describe('deposits and balances, end to end', () => {
  it('a 30% deposit makes the booking part-paid; paying the balance makes it paid', async () => {
    const { manager, booking } = await setup();

    const deposit = (
      await manager.post(`/api/bookings/${booking.id}/payments`).send({ amountKobo: 1_500_000 })
    ).body.payment;
    await ctx.provider.complete(deposit.reference);
    expect((await webhookFor(deposit.reference)).outcome).toBe('SETTLED');
    expect(await bookingRow(booking.id)).toMatchObject({
      status: 'part_paid',
      amountPaidKobo: 1_500_000,
    });

    const balance = (
      await manager.post(`/api/bookings/${booking.id}/payments`).send({ method: 'bank_transfer' })
    ).body.payment;
    expect(balance).toMatchObject({ amountKobo: 3_500_000, purpose: 'balance' });
    await ctx.provider.complete(balance.reference, { channel: 'bank_transfer' });
    await webhookFor(balance.reference);

    expect(await bookingRow(booking.id)).toMatchObject({
      status: 'paid',
      amountPaidKobo: 5_000_000,
    });
    const paid = await ctx.prisma.payment.findUnique({ where: { id: balance.id } });
    expect(paid.channel).toBe('bank_transfer');
  });
});

describe('bank transfers that go wrong (PAY-03)', () => {
  it('₦100 short: recorded as an unmatched receipt, suggested for the booking, nothing applied', async () => {
    const { manager, booking, operator } = await setup();
    const { payment } = (
      await manager.post(`/api/bookings/${booking.id}/payments`).send({ method: 'bank_transfer' })
    ).body;
    await ctx.provider.complete(payment.reference, {
      channel: 'bank_transfer',
      paidAmountKobo: 4_990_000,
    });

    expect(await webhookFor(payment.reference)).toEqual({
      status: 'needs_review',
      outcome: 'AMOUNT_MISMATCH_UNMATCHED',
    });

    expect((await bookingRow(booking.id)).status).toBe('held');
    const original = await ctx.prisma.payment.findUnique({ where: { id: payment.id } });
    expect(original).toMatchObject({
      status: 'failed',
      failureReason: 'AMOUNT_MISMATCH: expected 5000000, received 4990000',
    });

    const { receipts } = (await manager.get('/api/payments/unmatched')).body;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      amountKobo: 4_990_000,
      channel: 'bank_transfer',
      reviewReason: 'AMOUNT_MISMATCH',
      suggestedBookingReference: booking.reference,
    });
    // The money is in the books, as unallocated: in clearing, owed to "someone".
    expect(await balances(manager)).toMatchObject({
      UNALLOCATED_RECEIPTS: 4_990_000,
      TOUR_SALES: 0,
    });
    expect((await verifyLedger(ctx.prisma, { operatorId: operator.id })).ok).toBe(true);
  });

  it('staff match it to the booking: the money becomes a sale and the booking part-paid', async () => {
    const { manager, booking } = await setup();
    const { payment } = (
      await manager.post(`/api/bookings/${booking.id}/payments`).send({ method: 'bank_transfer' })
    ).body;
    await ctx.provider.complete(payment.reference, {
      channel: 'bank_transfer',
      paidAmountKobo: 4_990_000,
    });
    await webhookFor(payment.reference);
    const [receipt] = (await manager.get('/api/payments/unmatched')).body.receipts;

    const res = await manager
      .post(`/api/payments/${receipt.id}/allocate`)
      .send({ bookingId: booking.id });

    expect(res.status).toBe(200);
    expect(res.body.review).toBeNull();
    expect(await bookingRow(booking.id)).toMatchObject({
      status: 'part_paid',
      amountPaidKobo: 4_990_000,
    });
    expect((await manager.get('/api/payments/unmatched')).body.receipts).toHaveLength(0);
    expect(await balances(manager)).toMatchObject({
      UNALLOCATED_RECEIPTS: 0,
      TOUR_SALES: 4_990_000,
    });
    // The guest can now pay the last ₦100 (e.g. with a link).
    const rest = (await manager.post(`/api/bookings/${booking.id}/payments`).send({})).body.payment;
    expect(rest.amountKobo).toBe(10_000);
  });

  it('money with no reference at all lands in unmatched receipts for its operator', async () => {
    const { manager, operator } = await setup();
    const reference = await ctx.provider.createUnmatchedTransfer(operator.id, 2_000_000);

    expect((await webhookFor(reference)).outcome).toBe('UNMATCHED_RECEIPT');
    const { receipts } = (await manager.get('/api/payments/unmatched')).body;
    expect(
      receipts.map((r) => [r.amountKobo, r.reviewReason, r.suggestedBookingReference]),
    ).toEqual([[2_000_000, 'UNMATCHED_RECEIPT', null]]);
  });

  it('matching more than is owed settles the booking and owes the excess back', async () => {
    const { manager, booking, operator } = await setup();
    const reference = await ctx.provider.createUnmatchedTransfer(operator.id, 6_000_000); // ₦60,000 for a ₦50,000 booking
    await webhookFor(reference);
    const [receipt] = (await manager.get('/api/payments/unmatched')).body.receipts;

    const res = await manager
      .post(`/api/payments/${receipt.id}/allocate`)
      .send({ bookingId: booking.id });

    expect(res.body.review).toBe('OVERPAID');
    expect(await bookingRow(booking.id)).toMatchObject({
      status: 'paid',
      refundDueKobo: 1_000_000,
    });
  });

  it('a receipt can be matched once, only to a booking that can take money', async () => {
    const { manager, booking, book, operator } = await setup();
    const other = await book();
    await manager
      .post(`/api/bookings/${other.id}/cancel`)
      .send({ initiatedBy: 'guest', reason: 'Not coming' });
    const reference = await ctx.provider.createUnmatchedTransfer(operator.id, 1_000_000);
    await webhookFor(reference);
    const [receipt] = (await manager.get('/api/payments/unmatched')).body.receipts;

    const toCancelled = await manager
      .post(`/api/payments/${receipt.id}/allocate`)
      .send({ bookingId: other.id });
    expect(toCancelled.body.error.code).toBe('NOT_PAYABLE');
    expect(
      (await manager.post(`/api/payments/${receipt.id}/allocate`).send({ bookingId: booking.id }))
        .status,
    ).toBe(200);
    const again = await manager
      .post(`/api/payments/${receipt.id}/allocate`)
      .send({ bookingId: booking.id });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_ALLOCATED');
  });

  it('RACE: two staff match the same receipt at once; it is applied once', async () => {
    const { manager, booking, book, operator } = await setup();
    const other = await book();
    const reference = await ctx.provider.createUnmatchedTransfer(operator.id, 1_000_000);
    await webhookFor(reference);
    const [receipt] = (await manager.get('/api/payments/unmatched')).body.receipts;

    const results = await Promise.all([
      manager.post(`/api/payments/${receipt.id}/allocate`).send({ bookingId: booking.id }),
      manager.post(`/api/payments/${receipt.id}/allocate`).send({ bookingId: other.id }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const paid =
      (await bookingRow(booking.id)).amountPaidKobo + (await bookingRow(other.id)).amountPaidKobo;
    expect(paid).toBe(1_000_000); // not 2,000,000
  });

  it('guides cannot see or match receipts', async () => {
    const { guide } = await setup();
    expect((await guide.get('/api/payments/unmatched')).status).toBe(403);
  });
});

describe('payment links (PAY-05)', () => {
  it('staff make a link; the guest opens it, pays, and the link is marked paid', async () => {
    const { manager, booking } = await setup();
    const created = await manager
      .post(`/api/bookings/${booking.id}/payment-links`)
      .send({ amountKobo: 1_500_000 });
    expect(created.status).toBe(201);
    expect(created.body.link).toMatchObject({
      amountKobo: 1_500_000,
      purpose: 'deposit',
      status: 'active',
    });
    expect(created.body.url).toMatch(/^http:\/\/localhost:4000\/pay\/[A-Za-z0-9_-]{32}$/);
    const path = new URL(created.body.url).pathname;

    // The public page: tour, amount, reference, and NO personal details.
    const page = await request(ctx.app).get(path);
    expect(page.status).toBe(200);
    expect(page.text).toContain('₦15,000');
    expect(page.text).toContain(booking.reference);
    expect(page.text).not.toContain('Amara');
    expect(page.text).not.toContain('amara@guest.example');

    // Pay → redirected to the provider's checkout.
    const pay = await request(ctx.app).post(path);
    expect(pay.status).toBe(303);
    expect(pay.headers.location).toMatch(/\/simulator\/checkout\/OKG-/);
    const reference = pay.headers.location.split('/').pop();
    await ctx.provider.complete(reference);
    expect((await webhookFor(reference)).outcome).toBe('SETTLED');

    expect(await bookingRow(booking.id)).toMatchObject({
      status: 'part_paid',
      amountPaidKobo: 1_500_000,
    });
    const [link] = (await manager.get(`/api/bookings/${booking.id}/payment-links`)).body.links;
    expect(link.status).toBe('paid');
    expect((await request(ctx.app).get(path)).status).toBe(410); // "already paid"
  });

  it('the URL is shown once; only a hash of the token is stored', async () => {
    const { manager, booking } = await setup();
    const { url, link } = (await manager.post(`/api/bookings/${booking.id}/payment-links`).send({}))
      .body;
    const token = url.split('/').pop();

    const row = await ctx.prisma.paymentLink.findUnique({ where: { id: link.id } });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toContain(token);
    expect(
      JSON.stringify((await manager.get(`/api/bookings/${booking.id}/payment-links`)).body),
    ).not.toContain(token);
  });

  it('links refuse to ask for more than is owed, and re-check when used', async () => {
    const { manager, booking } = await setup();
    const tooMuch = await manager
      .post(`/api/bookings/${booking.id}/payment-links`)
      .send({ amountKobo: 6_000_000 });
    expect(tooMuch.body.error.code).toBe('AMOUNT_TOO_HIGH');

    // A ₦50,000 link made BEFORE a ₦15,000 deposit was paid can't now overcharge.
    const { url } = (await manager.post(`/api/bookings/${booking.id}/payment-links`).send({})).body;
    const deposit = (
      await manager.post(`/api/bookings/${booking.id}/payments`).send({ amountKobo: 1_500_000 })
    ).body.payment;
    await ctx.provider.complete(deposit.reference);
    await webhookFor(deposit.reference);

    const use = await request(ctx.app).post(new URL(url).pathname);
    expect(use.status).toBe(409);
    expect(use.text).toContain('is owed');
  });

  it('cancelled, expired and made-up links say so', async () => {
    const { manager, booking } = await setup();
    const a = (await manager.post(`/api/bookings/${booking.id}/payment-links`).send({})).body;
    const b = (await manager.post(`/api/bookings/${booking.id}/payment-links`).send({})).body;
    expect((await manager.post(`/api/payment-links/${a.link.id}/cancel`)).status).toBe(204);
    await ctx.prisma.paymentLink.update({
      where: { id: b.link.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await request(ctx.app).get(new URL(a.url).pathname)).status).toBe(410);
    expect((await request(ctx.app).post(new URL(b.url).pathname)).status).toBe(409);
    expect((await ctx.prisma.paymentLink.findUnique({ where: { id: b.link.id } })).status).toBe(
      'expired',
    );
    expect((await request(ctx.app).get('/pay/thisisnotarealtokenatall00000000')).status).toBe(404);
  });

  it("cannot make links on another operator's booking", async () => {
    const mine = await setup();
    const theirs = await setup();
    expect(
      (await mine.manager.post(`/api/bookings/${theirs.booking.id}/payment-links`).send({})).status,
    ).toBe(404);
  });
});
