/**
 * Webhooks and settlement (stage 10c): signed charge.success events in, money in the books.
 *
 * Each test drives the real route (POST /webhooks/paystack) with a body signed exactly as
 * the provider would, then runs the processor the workers would run.
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

/** A held 2-adult Heritage Walk booking (₦50,000) with a card payment started. */
async function setup() {
  const seeded = await ctx.seedOperator();
  const manager = as(await ctx.tokenFor(seeded.manager.id));
  const { body } = await manager.get('/api/products');
  const walk = body.products.find((p) => p.slug === 'lagos-island-heritage-walk');
  const [departure] = (await manager.get(`/api/products/${walk.id}/availability`)).body.departures;
  const { booking } = (
    await manager.post('/api/bookings').send({
      departureId: departure.id,
      lead: { name: 'Amara Eze', email: 'amara@guest.example', acceptTerms: true },
      travellers: [
        { name: 'Amara Eze', age: 34 },
        { name: 'Obi Eze', age: 36 },
      ],
    })
  ).body;
  const { payment } = (await manager.post(`/api/bookings/${booking.id}/payments`).send({})).body;
  return { ...seeded, manager, booking, payment, departureId: departure.id };
}

/** Sends a body to the webhook route, signed with `signature` (default: the real one). */
function deliver(body, signature = ctx.provider.sign(body)) {
  return request(ctx.app)
    .post('/webhooks/paystack')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', signature)
    .send(body);
}

/** The guest pays at the "provider", and its charge.success webhook is delivered. */
async function guestPays(reference) {
  await ctx.provider.complete(reference);
  const body = JSON.stringify(await ctx.provider.chargeSuccessEvent(reference));
  const res = await deliver(body);
  return { res, body, eventId: ctx.jobs.webhooks.at(-1) };
}

const uniqueId = () => Math.floor(Math.random() * 1e15);
const process = (eventId) => processWebhookEvent(ctx.prisma, ctx.provider, eventId);
const bookingRow = (id) => ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
const departureRow = (id) => ctx.prisma.departure.findUniqueOrThrow({ where: { id } });

async function ledgerBalances(operatorId) {
  const res = await ctx.prisma.$queryRaw`
    SELECT a.key, COALESCE(SUM(e.debit_kobo), 0)::int AS d, COALESCE(SUM(e.credit_kobo), 0)::int AS c
      FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
     WHERE a.operator_id = ${operatorId}::uuid GROUP BY a.key`;
  return Object.fromEntries(res.map((r) => [r.key, { d: r.d, c: r.c }]));
}

describe('the webhook route', () => {
  it('rejects a bad signature with 401 and stores nothing', async () => {
    const { payment } = await setup();
    const body = JSON.stringify(await ctx.provider.chargeSuccessEvent(payment.reference));

    const forged = await deliver(body, 'f'.repeat(128));
    const tampered = await deliver(body.replace('5000000', '9000000'), ctx.provider.sign(body));

    expect(forged.status).toBe(401);
    expect(tampered.status).toBe(401);
    expect(
      await ctx.prisma.webhookEvent.count({
        where: { payload: { path: ['data', 'reference'], equals: payment.reference } },
      }),
    ).toBe(0);
  });

  it('stores a valid event once and queues it; a redelivery is acknowledged but not re-queued', async () => {
    const { payment } = await setup();
    const { res, body } = await guestPays(payment.reference);
    const again = await deliver(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, duplicate: false });
    expect(again.status).toBe(200); // "we have it": Paystack stops retrying
    expect(again.body.duplicate).toBe(true);
    expect(ctx.jobs.webhooks).toHaveLength(1);
  });

  it('answers 400 to a signed body that is not a webhook', async () => {
    const body = '{"hello":"world"}';
    expect((await deliver(body)).status).toBe(400);
  });
});

describe('settling a payment', () => {
  it('payment succeeded, booking paid, seats held → sold, and the books updated', async () => {
    const { payment, booking, departureId, operator } = await setup();
    const { eventId } = await guestPays(payment.reference);

    expect(await process(eventId)).toEqual({ status: 'processed', outcome: 'SETTLED' });

    const paid = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paid).toMatchObject({ status: 'succeeded', feeKobo: 85_000, channel: 'card' });
    expect(await bookingRow(booking.id)).toMatchObject({
      status: 'paid',
      amountPaidKobo: 5_000_000,
    });
    expect(await departureRow(departureId)).toMatchObject({ seatsHeld: 0, seatsSold: 2 });

    const books = await ledgerBalances(operator.id);
    expect(books.PROVIDER_CLEARING).toEqual({ d: 5_000_000, c: 85_000 }); // in, minus the fee
    expect(books.TOUR_SALES).toEqual({ d: 0, c: 5_000_000 });
    expect(books.PAYMENT_FEES).toEqual({ d: 85_000, c: 0 });
    expect((await verifyLedger(ctx.prisma, { operatorId: operator.id })).ok).toBe(true);
  });

  it('processing the same event again changes nothing', async () => {
    const { payment, booking, operator } = await setup();
    const { eventId } = await guestPays(payment.reference);
    await process(eventId);

    // The event is already done; even forcing it back to "received" can't double-count.
    await ctx.prisma.webhookEvent.update({ where: { id: eventId }, data: { status: 'received' } });
    expect(await process(eventId)).toEqual({ status: 'processed', outcome: 'ALREADY_SETTLED' });

    expect((await bookingRow(booking.id)).amountPaidKobo).toBe(5_000_000);
    expect(await ctx.prisma.ledgerTransaction.count({ where: { operatorId: operator.id } })).toBe(
      2,
    );
  });

  it('RACE: five workers process the same payment at once; it settles exactly once', async () => {
    const { payment, booking, departureId, operator } = await setup();
    await guestPays(payment.reference);
    // Five copies of the event, as if several deliveries slipped past deduplication.
    const ids = await Promise.all(
      Array.from(
        { length: 5 },
        async (_, i) =>
          (
            await ctx.prisma.webhookEvent.create({
              data: {
                provider: 'simulator',
                eventType: 'charge.success',
                dedupKey: `race-${payment.id}-${i}`,
                payload: { data: { reference: payment.reference } },
              },
            })
          ).id,
      ),
    );

    const results = await Promise.all(ids.map(process));

    expect(results.filter((r) => r.outcome === 'SETTLED')).toHaveLength(1);
    expect((await bookingRow(booking.id)).amountPaidKobo).toBe(5_000_000);
    expect((await departureRow(departureId)).seatsSold).toBe(2);
    expect(await ctx.prisma.ledgerTransaction.count({ where: { operatorId: operator.id } })).toBe(
      2,
    );
  });

  it('staff confirmed "pay later" while the guest was paying: confirmed → paid, seats not double-sold', async () => {
    const { manager, payment, booking, departureId } = await setup();
    await manager.post(`/api/bookings/${booking.id}/confirm`); // seats held → sold now
    const { eventId } = await guestPays(payment.reference);

    expect((await process(eventId)).outcome).toBe('SETTLED');
    expect(await bookingRow(booking.id)).toMatchObject({
      status: 'paid',
      amountPaidKobo: 5_000_000,
    });
    expect(await departureRow(departureId)).toMatchObject({ seatsHeld: 0, seatsSold: 2 });
  });
});

describe('late money: the hold expired before the payment arrived', () => {
  it('before the expiry job ran: seats are released, NOT resold to this guest; full refund owed; flagged', async () => {
    const { payment, booking, departureId, operator } = await setup();
    const { holdId } = await bookingRow(booking.id);
    await ctx.prisma.hold.update({
      where: { id: holdId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const { eventId } = await guestPays(payment.reference);

    expect(await process(eventId)).toEqual({
      status: 'needs_review',
      outcome: 'HOLD_EXPIRED_BEFORE_PAYMENT',
    });

    expect(await bookingRow(booking.id)).toMatchObject({
      status: 'cancelled',
      amountPaidKobo: 5_000_000,
      refundDueKobo: 5_000_000,
    });
    expect(await departureRow(departureId)).toMatchObject({ seatsHeld: 0, seatsSold: 0 });
    expect((await ctx.prisma.payment.findUnique({ where: { id: payment.id } })).reviewReason).toBe(
      'HOLD_EXPIRED_BEFORE_PAYMENT',
    );
    const books = await ledgerBalances(operator.id);
    expect(books.REFUNDS_PAYABLE.c).toBe(5_000_000); // we owe it all back (paid out in 10e)
    expect((await verifyLedger(ctx.prisma, { operatorId: operator.id })).ok).toBe(true);
  });

  it('after the expiry job already cancelled the booking: same outcome', async () => {
    const { manager, payment, booking } = await setup();
    const { holdId } = await bookingRow(booking.id);
    await manager
      .post(`/api/bookings/${booking.id}/cancel`)
      .send({ initiatedBy: 'guest', reason: 'Changed plans' });
    expect((await ctx.prisma.hold.findUnique({ where: { id: holdId } })).status).toBe('released');
    const { eventId } = await guestPays(payment.reference);

    expect((await process(eventId)).outcome).toBe('BOOKING_CANCELLED_BEFORE_PAYMENT');
    expect(await bookingRow(booking.id)).toMatchObject({
      status: 'cancelled',
      refundDueKobo: 5_000_000,
    });
  });
});

describe('events we do not act on', () => {
  it('an unknown reference is ignored (e.g. a smoke-test charge)', async () => {
    await setup();
    // A unique id every run: webhook events aren't tied to a business, so a FIXED id would
    // still be stored from the last run and this delivery would look like a duplicate.
    const body = JSON.stringify({
      event: 'charge.success',
      data: { id: uniqueId(), reference: 'OKG-00000000000000000000', amount: 100 },
    });
    await deliver(body);
    expect(await process(ctx.jobs.webhooks.at(-1))).toEqual({
      status: 'ignored',
      outcome: 'UNKNOWN_REFERENCE',
    });
  });

  it('other event types are ignored', async () => {
    const body = JSON.stringify({ event: 'subscription.create', data: { id: uniqueId() } });
    await deliver(body);
    expect((await process(ctx.jobs.webhooks.at(-1))).outcome).toBe('UNHANDLED_EVENT_TYPE');
  });

  it("if the provider doesn't confirm the charge, a person reviews it and nothing moves", async () => {
    const { payment, booking } = await setup();
    // A signed charge.success, but the provider still says "pending" when asked.
    const body = JSON.stringify(await ctx.provider.chargeSuccessEvent(payment.reference));
    await deliver(body);

    expect(await process(ctx.jobs.webhooks.at(-1))).toEqual({
      status: 'needs_review',
      outcome: 'PROVIDER_SAYS_PENDING',
    });
    expect((await bookingRow(booking.id)).status).toBe('held');
  });

  it('a different amount than we asked for is never settled automatically', async () => {
    const { payment, booking } = await setup();
    await ctx.provider.complete(payment.reference);
    const tx = ctx.provider.store.map.get(payment.reference);
    ctx.provider.store.map.set(payment.reference, { ...tx, amountKobo: 100 }); // ₦1 paid, not ₦50,000
    await deliver(JSON.stringify(await ctx.provider.chargeSuccessEvent(payment.reference)));

    expect((await process(ctx.jobs.webhooks.at(-1))).outcome).toBe('AMOUNT_MISMATCH');
    expect((await bookingRow(booking.id)).status).toBe('held');
  });
});

describe('the simulator checkout, end to end', () => {
  it('clicking "Pay" sends a signed webhook to our own endpoint; processing it pays the booking', async () => {
    // A simulator whose "network" is this very app (in tests nothing listens on port 4000).
    const { createSimulatorProvider } = await import('@okapigo/payments');
    const { buildApp } = await import('./helpers.js');
    let app;
    const sim = createSimulatorProvider({
      baseUrl: 'http://localhost:4000',
      fetch: async (url, init) => {
        const res = await request(app)
          .post(new URL(url).pathname)
          .set(init.headers)
          .send(init.body);
        return { status: res.status };
      },
    });
    app = buildApp({ prisma: ctx.prisma, provider: sim, jobs: ctx.jobs });
    const seeded = await ctx.seedOperator();
    const manager = (method, url) =>
      request(app)[method](url).set('Authorization', `Bearer ${tokenHolder.token}`);
    const tokenHolder = { token: await ctx.tokenFor(seeded.manager.id) };
    const walk = (await manager('get', '/api/products')).body.products.find(
      (p) => p.slug === 'lagos-island-heritage-walk',
    );
    const [dep] = (await manager('get', `/api/products/${walk.id}/availability`)).body.departures;
    const { booking } = (
      await manager('post', '/api/bookings').send({
        departureId: dep.id,
        lead: { name: 'Ife', email: 'ife@guest.example', acceptTerms: true },
        travellers: [{ name: 'Ife', age: 30 }],
      })
    ).body;
    const { payment } = (await manager('post', `/api/bookings/${booking.id}/payments`).send({}))
      .body;

    const page = await request(app).get(new URL(payment.authorizationUrl).pathname);
    expect(page.text).toContain('Pay ₦25,000');

    const click = await request(app).post(`/simulator/checkout/${payment.reference}/pay`);
    expect(click.status).toBe(303);
    expect(click.headers.location).toBe(`/payments/callback?reference=${payment.reference}`);

    // The webhook arrived through the real route and was queued; the workers would now run:
    expect(await processWebhookEvent(ctx.prisma, sim, ctx.jobs.webhooks.at(-1))).toMatchObject({
      outcome: 'SETTLED',
    });
    expect((await bookingRow(booking.id)).status).toBe('paid');
  });

  it('clicking "Decline" sends no webhook and the booking stays held', async () => {
    const { payment, booking } = await setup();
    const before = ctx.jobs.webhooks.length;
    const click = await request(ctx.app).post(`/simulator/checkout/${payment.reference}/decline`);

    expect(click.status).toBe(303);
    expect(ctx.jobs.webhooks.length).toBe(before);
    expect((await bookingRow(booking.id)).status).toBe('held');
    expect(ctx.provider.store.map.get(payment.reference).status).toBe('failed');
  });
});
