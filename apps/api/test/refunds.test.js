/**
 * Refunds (PAY-08) and reconciliation, stage 10e.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { processWebhookEvent, reconcile, verifyLedger } from '@okapigo/db';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

function as(token) {
  const withAuth = (method) => (url) =>
    request(ctx.app)[method](url).set('Authorization', `Bearer ${token}`);
  return { get: withAuth('get'), post: withAuth('post') };
}

/** Seeds an operator; books 2 adults (₦50,000) on a Heritage Walk at least 3 days away. */
async function setup() {
  const seeded = await ctx.seedOperator();
  const manager = as(await ctx.tokenFor(seeded.manager.id));
  const guide = as(await ctx.tokenFor(seeded.guides[0].id));
  const { body } = await manager.get('/api/products');
  const walk = body.products.find((p) => p.slug === 'lagos-island-heritage-walk');
  const deps = (await manager.get(`/api/products/${walk.id}/availability`)).body.departures;
  const far = deps.find((d) => new Date(d.startsAt) - Date.now() > 72 * 3_600_000);
  const { booking } = (
    await manager.post('/api/bookings').send({
      departureId: far.id,
      lead: { name: 'Amara Eze', email: 'amara@guest.example', acceptTerms: true },
      travellers: [
        { name: 'Amara Eze', age: 34 },
        { name: 'Obi Eze', age: 36 },
      ],
    })
  ).body;
  return { ...seeded, manager, guide, booking };
}

/** Delivers a signed body to the webhook route and processes the event it stored. */
async function deliver(body) {
  const before = ctx.jobs.webhooks.length;
  await request(ctx.app)
    .post('/webhooks/paystack')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', ctx.provider.sign(body))
    .send(body);
  const eventId = ctx.jobs.webhooks.length > before ? ctx.jobs.webhooks.at(-1) : null;
  return eventId ? processWebhookEvent(ctx.prisma, ctx.provider, eventId) : { duplicate: true };
}

/** Pays `amountKobo` (default: the balance) on a booking, end to end through the webhook. */
async function pay(manager, bookingId, amountKobo) {
  const { payment } = (
    await manager.post(`/api/bookings/${bookingId}/payments`).send({ amountKobo })
  ).body;
  await ctx.provider.complete(payment.reference);
  await deliver(JSON.stringify(await ctx.provider.chargeSuccessEvent(payment.reference)));
  return payment;
}

/** The provider finishes a refund and sends its webhook; we process it. */
async function providerProcesses(providerRefundId, outcome = 'processed') {
  if (outcome === 'processed') await ctx.provider.processRefund(providerRefundId);
  else await ctx.provider.failRefund(providerRefundId);
  return deliver(JSON.stringify(await ctx.provider.refundEvent(providerRefundId)));
}

const providerIdOf = async (refundId) =>
  (await ctx.prisma.refund.findUnique({ where: { id: refundId } })).providerRefundId;
const bookingRow = (id) => ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
const balances = async (client) =>
  Object.fromEntries(
    (await client.get('/api/ledger/accounts')).body.accounts.map((a) => [a.key, a.balanceKobo]),
  );

describe('refunding a cancelled booking', () => {
  it('cancel → refund requested → provider confirms → booking refunded, books balanced', async () => {
    const { manager, booking, operator } = await setup();
    await pay(manager, booking.id);
    await manager
      .post(`/api/bookings/${booking.id}/cancel`)
      .send({ initiatedBy: 'guest', reason: 'Plans changed' });
    expect((await bookingRow(booking.id)).refundDueKobo).toBe(5_000_000); // 72 h+ before: 100%

    const res = await manager
      .post(`/api/bookings/${booking.id}/refunds`)
      .send({ reason: 'Cancelled in time' });
    expect(res.status).toBe(201);
    expect(res.body.refunds).toEqual([
      expect.objectContaining({ amountKobo: 5_000_000, status: 'pending' }),
    ]);
    expect((await bookingRow(booking.id)).status).toBe('cancelled'); // not yet: money hasn't left

    expect(await providerProcesses(await providerIdOf(res.body.refunds[0].id))).toEqual({
      status: 'processed',
      outcome: 'REFUND_PROCESSED',
    });

    expect((await bookingRow(booking.id)).status).toBe('refunded');
    const books = await balances(manager);
    expect(books).toMatchObject({
      REFUNDS_PAYABLE: 0,
      SALES_REFUNDS: 5_000_000,
      TOUR_SALES: 5_000_000,
    });
    // Paystack keeps its ₦850 fee on a refunded payment: the operator bears it.
    expect(books.PROVIDER_CLEARING).toBe(-85_000);
    expect((await verifyLedger(ctx.prisma, { operatorId: operator.id })).ok).toBe(true);
    const detail = (await manager.get(`/api/bookings/${booking.id}`)).body.booking;
    expect(detail).toMatchObject({ refundedKobo: 5_000_000 });
  });

  it('paid in two parts → refunded in two parts, newest first, each to its own payment', async () => {
    const { manager, booking } = await setup();
    const deposit = await pay(manager, booking.id, 1_500_000);
    const balance = await pay(manager, booking.id);
    await manager
      .post(`/api/bookings/${booking.id}/cancel`)
      .send({ initiatedBy: 'operator', reason: 'Guide ill' });

    const { refunds } = (
      await manager
        .post(`/api/bookings/${booking.id}/refunds`)
        .send({ reason: 'Operator cancelled' })
    ).body;

    expect(refunds.map((r) => [r.paymentId, r.amountKobo])).toEqual([
      [balance.id, 3_500_000],
      [deposit.id, 1_500_000],
    ]);
    for (const r of refunds) await providerProcesses(await providerIdOf(r.id));
    expect((await bookingRow(booking.id)).status).toBe('refunded');
  });

  it('a failed refund frees the amount; staff can try again', async () => {
    const { manager, booking } = await setup();
    await pay(manager, booking.id);
    await manager
      .post(`/api/bookings/${booking.id}/cancel`)
      .send({ initiatedBy: 'guest', reason: 'x y z' });
    const [first] = (
      await manager.post(`/api/bookings/${booking.id}/refunds`).send({ reason: 'try 1' })
    ).body.refunds;

    expect((await providerProcesses(await providerIdOf(first.id), 'failed')).outcome).toBe(
      'REFUND_FAILED',
    );
    expect((await bookingRow(booking.id)).status).toBe('cancelled'); // still owed

    const retry = await manager
      .post(`/api/bookings/${booking.id}/refunds`)
      .send({ reason: 'try 2' });
    expect(retry.status).toBe(201);
    await providerProcesses(await providerIdOf(retry.body.refunds[0].id));
    expect((await bookingRow(booking.id)).status).toBe('refunded');
  });

  it('RACE: the same refund.processed delivered five times at once pays out once', async () => {
    const { manager, booking, operator } = await setup();
    await pay(manager, booking.id);
    await manager
      .post(`/api/bookings/${booking.id}/cancel`)
      .send({ initiatedBy: 'guest', reason: 'x y z' });
    const [refund] = (
      await manager
        .post(`/api/bookings/${booking.id}/refunds`)
        .send({ reason: 'Cancelled in time' })
    ).body.refunds;
    const providerRefundId = await providerIdOf(refund.id);
    await ctx.provider.processRefund(providerRefundId);
    // Five copies slipping past dedup (different keys), processed in parallel.
    const ids = await Promise.all(
      Array.from(
        { length: 5 },
        async (_, i) =>
          (
            await ctx.prisma.webhookEvent.create({
              data: {
                provider: 'simulator',
                eventType: 'refund.processed',
                dedupKey: `race-${refund.id}-${i}`,
                payload: { data: { id: providerRefundId } },
              },
            })
          ).id,
      ),
    );

    const results = await Promise.all(
      ids.map((id) => processWebhookEvent(ctx.prisma, ctx.provider, id)),
    );

    expect(results.filter((r) => r.outcome === 'REFUND_PROCESSED')).toHaveLength(1);
    expect(
      await ctx.prisma.ledgerTransaction.count({
        where: { operatorId: operator.id, type: 'refund_paid' },
      }),
    ).toBe(1);
  });
});

describe('staff refunds (PAY-08: amounts set by staff)', () => {
  it('a ₦5,000 goodwill refund on a paid booking: owed then paid; the booking stays paid', async () => {
    const { manager, booking } = await setup();
    await pay(manager, booking.id);

    const { refunds } = (
      await manager
        .post(`/api/bookings/${booking.id}/refunds`)
        .send({ amountKobo: 500_000, reason: 'Rain delayed the start' })
    ).body;
    await providerProcesses(await providerIdOf(refunds[0].id));

    expect(await bookingRow(booking.id)).toMatchObject({ status: 'paid', refundDueKobo: 500_000 });
    expect(await balances(manager)).toMatchObject({ SALES_REFUNDS: 500_000, REFUNDS_PAYABLE: 0 });
  });

  it('never more than was paid, and nothing when nothing is owed', async () => {
    const { manager, booking } = await setup();
    await pay(manager, booking.id);

    const tooMuch = await manager
      .post(`/api/bookings/${booking.id}/refunds`)
      .send({ amountKobo: 6_000_000, reason: 'oops' });
    const nothingOwed = await manager
      .post(`/api/bookings/${booking.id}/refunds`)
      .send({ reason: 'no amount' });

    expect(tooMuch.body.error).toMatchObject({
      code: 'REFUND_TOO_HIGH',
      refundableKobo: 5_000_000,
    });
    expect(nothingOwed.body.error.code).toBe('NOTHING_TO_REFUND');
  });

  it('guides cannot refund (payments: none)', async () => {
    const { guide, booking } = await setup();
    expect(
      (await guide.post(`/api/bookings/${booking.id}/refunds`).send({ reason: 'x y z' })).status,
    ).toBe(403);
  });
});

describe('refunding an unmatched receipt', () => {
  it('sends money we never applied back; it leaves the unmatched list', async () => {
    const { manager, operator } = await setup();
    const reference = await ctx.provider.createUnmatchedTransfer(operator.id, 2_000_000);
    await deliver(JSON.stringify(await ctx.provider.chargeSuccessEvent(reference)));
    const [receipt] = (await manager.get('/api/payments/unmatched')).body.receipts;

    const { refunds } = (
      await manager.post(`/api/payments/${receipt.id}/refund`).send({ reason: 'Unknown sender' })
    ).body;
    expect((await manager.get('/api/payments/unmatched')).body.receipts).toHaveLength(0);
    await providerProcesses(await providerIdOf(refunds[0].id));

    expect((await balances(manager)).UNALLOCATED_RECEIPTS).toBe(0);
    expect((await verifyLedger(ctx.prisma, { operatorId: operator.id })).ok).toBe(true);
  });
});

describe('reconciliation: catching what webhooks missed', () => {
  it('a payment whose webhook never came is settled through the normal path; a late webhook is a duplicate', async () => {
    const { manager, booking } = await setup();
    const { payment } = (await manager.post(`/api/bookings/${booking.id}/payments`).send({})).body;
    await ctx.provider.complete(payment.reference); // paid… but no webhook arrives
    await ctx.prisma.payment.update({
      where: { id: payment.id },
      data: { createdAt: new Date(Date.now() - 31 * 60_000) },
    });

    const summary = await reconcile(ctx.prisma, ctx.provider);
    expect(summary.settled).toBeGreaterThanOrEqual(1);
    expect((await bookingRow(booking.id)).status).toBe('paid');

    // The real webhook finally shows up: recognised, nothing happens twice.
    const late = await deliver(
      JSON.stringify(await ctx.provider.chargeSuccessEvent(payment.reference)),
    );
    expect(late).toEqual({ duplicate: true });
    expect((await bookingRow(booking.id)).amountPaidKobo).toBe(5_000_000);
  });

  it('a checkout nobody finished for a day is marked abandoned', async () => {
    const { manager, booking } = await setup();
    const { payment } = (await manager.post(`/api/bookings/${booking.id}/payments`).send({})).body;
    await ctx.prisma.payment.update({
      where: { id: payment.id },
      data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
    });

    await reconcile(ctx.prisma, ctx.provider);
    expect((await ctx.prisma.payment.findUnique({ where: { id: payment.id } })).status).toBe(
      'abandoned',
    );
  });

  it('a refund whose webhook never came is finished too', async () => {
    const { manager, booking } = await setup();
    await pay(manager, booking.id);
    await manager
      .post(`/api/bookings/${booking.id}/cancel`)
      .send({ initiatedBy: 'guest', reason: 'x y z' });
    const [refund] = (
      await manager
        .post(`/api/bookings/${booking.id}/refunds`)
        .send({ reason: 'Cancelled in time' })
    ).body.refunds;
    await ctx.provider.processRefund(await providerIdOf(refund.id)); // done at the provider, no webhook
    await ctx.prisma
      .$executeRaw`UPDATE refunds SET updated_at = now() - interval '2 hours' WHERE id = ${refund.id}::uuid`;

    await reconcile(ctx.prisma, ctx.provider);
    expect((await bookingRow(booking.id)).status).toBe('refunded');
  });

  it('a refund the provider can’t finish ("needs attention") stays pending and alerts staff once', async () => {
    const { manager, booking } = await setup();
    await pay(manager, booking.id);
    await manager
      .post(`/api/bookings/${booking.id}/cancel`)
      .send({ initiatedBy: 'guest', reason: 'x y z' });
    const [refund] = (
      await manager.post(`/api/bookings/${booking.id}/refunds`).send({ reason: 'Cancelled' })
    ).body.refunds;
    await ctx.prisma
      .$executeRaw`UPDATE refunds SET updated_at = now() - interval '2 hours' WHERE id = ${refund.id}::uuid`;
    // Paystack: "needs-attention" (e.g. it needs the guest's bank details for a transfer).
    const stuck = {
      ...ctx.provider,
      fetchRefund: async (/** @type {string} */ id) => ({
        providerRefundId: id,
        status: 'needs_attention',
        amountKobo: refund.amountKobo,
        transaction: null,
      }),
    };

    const first = await reconcile(ctx.prisma, stuck);
    await reconcile(ctx.prisma, stuck); // the next run, 10 minutes later

    expect(first.refundsNeedingAttention).toBe(1);
    expect((await ctx.prisma.refund.findUnique({ where: { id: refund.id } })).status).toBe(
      'pending',
    );
    const alerts = (await manager.get('/api/alerts')).body.alerts.filter(
      (/** @type {any} */ a) => a.kind === 'refund_needs_attention',
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].booking.id).toBe(booking.id);
  });
});
