/**
 * Starting payments (PAY-02, stage 10b), with the simulator playing Paystack.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { ProviderError } from '@okapigo/payments';
import { createTestContext, buildApp } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

function as(token, app = ctx.app) {
  const withAuth = (method) => (url) =>
    request(app)[method](url).set('Authorization', `Bearer ${token}`);
  return { get: withAuth('get'), post: withAuth('post') };
}

/** Seeds an operator and creates a held Heritage Walk booking for two adults (₦50,000). */
async function setup({ app = ctx.app, lead } = {}) {
  const seeded = await ctx.seedOperator();
  const manager = as(await ctx.tokenFor(seeded.manager.id), app);
  const guide = as(await ctx.tokenFor(seeded.guides[0].id), app);
  const { body } = await manager.get('/api/products');
  const walk = body.products.find((p) => p.slug === 'lagos-island-heritage-walk');
  const [departure] = (await manager.get(`/api/products/${walk.id}/availability`)).body.departures;
  const { booking } = (
    await manager.post('/api/bookings').send({
      departureId: departure.id,
      lead: lead ?? { name: 'Amara Eze', email: 'amara@guest.example', acceptTerms: true },
      travellers: [
        { name: 'Amara Eze', age: 34 },
        { name: 'Obi Eze', age: 36 },
      ],
    })
  ).body;
  return { ...seeded, manager, guide, booking };
}

describe('starting a card payment', () => {
  it('records the attempt, then returns the checkout URL', async () => {
    const { manager, booking } = await setup();

    const res = await manager.post(`/api/bookings/${booking.id}/payments`).send({ method: 'card' });

    expect(res.status).toBe(201);
    const p = res.body.payment;
    expect(p).toMatchObject({
      status: 'initiated',
      provider: 'simulator',
      method: 'card',
      purpose: 'full',
      amountKobo: 5_000_000,
    });
    expect(p.reference).toMatch(/^OKG-[0-9A-HJKMNP-TV-Z]{20}$/);
    expect(p.authorizationUrl).toBe(`http://localhost:4000/simulator/checkout/${p.reference}`);
    // The "provider" received our reference, amount and the guest's email.
    expect(ctx.provider.store.map.get(p.reference)).toMatchObject({
      amountKobo: 5_000_000,
      email: 'amara@guest.example',
    });
  });

  it('a second click reuses the open checkout instead of making another', async () => {
    const { manager, booking } = await setup();
    const first = await manager.post(`/api/bookings/${booking.id}/payments`).send({});
    const second = await manager.post(`/api/bookings/${booking.id}/payments`).send({});

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      reused: true,
      payment: { reference: first.body.payment.reference },
    });
  });

  it('RACE: five clicks at once create ONE payment (the booking row is locked)', async () => {
    const { manager, booking } = await setup();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        manager.post(`/api/bookings/${booking.id}/payments`).send({}),
      ),
    );

    expect(new Set(responses.map((r) => r.body.payment.reference)).size).toBe(1);
    expect(await ctx.prisma.payment.count({ where: { bookingId: booking.id } })).toBe(1);
  });

  it('a guest who gave only a phone gets a placeholder email Paystack accepts but that receives no mail', async () => {
    const { manager, booking } = await setup({
      lead: { name: 'Bayo', phone: '08035550199', acceptTerms: true },
    });
    const { payment } = (await manager.post(`/api/bookings/${booking.id}/payments`).send({})).body;
    expect(ctx.provider.store.map.get(payment.reference).email).toBe(
      `guest-${booking.reference.toLowerCase()}@example.com`,
    );
  });

  it('if the provider refuses, the attempt is kept as failed and staff get a 502', async () => {
    const broken = {
      name: 'simulator',
      initializeTransaction: async () => {
        throw new ProviderError('PROVIDER_REJECTED', 'Invalid key');
      },
      verifyTransaction: async () => ({}),
    };
    const app = buildApp({ prisma: ctx.prisma, provider: broken });
    const { manager, booking } = await setup({ app });

    const res = await manager.post(`/api/bookings/${booking.id}/payments`).send({});

    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({
      code: 'PROVIDER_REJECTED',
      message: 'The payment provider said: Invalid key',
    });
    const [attempt] = await ctx.prisma.payment.findMany({ where: { bookingId: booking.id } });
    expect(attempt).toMatchObject({ status: 'failed', failureReason: 'Invalid key' });
  });
});

describe('deposits and balances (stage 10d)', () => {
  it('a held booking can take a deposit; the purpose says so', async () => {
    const { manager, booking } = await setup();
    const res = await manager
      .post(`/api/bookings/${booking.id}/payments`)
      .send({ amountKobo: 1_500_000 });
    expect(res.status).toBe(201);
    expect(res.body.payment).toMatchObject({ amountKobo: 1_500_000, purpose: 'deposit' });
  });

  it('a confirmed ("pay later") booking can pay its balance, by transfer', async () => {
    const { manager, booking } = await setup();
    await manager.post(`/api/bookings/${booking.id}/confirm`);
    const res = await manager
      .post(`/api/bookings/${booking.id}/payments`)
      .send({ method: 'bank_transfer' });
    expect(res.body.payment).toMatchObject({
      amountKobo: 5_000_000,
      purpose: 'balance',
      method: 'bank_transfer',
    });
  });
});

describe('what cannot be paid', () => {
  it('a cancelled booking', async () => {
    const { manager, booking } = await setup();
    await manager
      .post(`/api/bookings/${booking.id}/cancel`)
      .send({ initiatedBy: 'guest', reason: 'Not coming' });

    const res = await manager.post(`/api/bookings/${booking.id}/payments`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_PAYABLE');
  });

  it('more than is owed', async () => {
    const { manager, booking } = await setup();
    const res = await manager
      .post(`/api/bookings/${booking.id}/payments`)
      .send({ amountKobo: 6_000_000 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'AMOUNT_TOO_HIGH',
      balanceKobo: 5_000_000,
      message: 'Only ₦50,000 is owed on this booking.',
    });
  });

  it('a booking whose hold has run out', async () => {
    const { manager, booking } = await setup();
    const { holdId } = await ctx.prisma.booking.findUnique({ where: { id: booking.id } });
    await ctx.prisma.hold.update({
      where: { id: holdId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await manager.post(`/api/bookings/${booking.id}/payments`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HOLD_EXPIRED');
  });
});

describe('the return page after paying', () => {
  it('changes nothing: only a verified webhook can (stage 10c)', async () => {
    const { manager, booking } = await setup();
    const { payment } = (await manager.post(`/api/bookings/${booking.id}/payments`).send({})).body;
    await ctx.provider.complete(payment.reference); // the "guest" paid at the provider…

    const page = await request(ctx.app).get(`/payments/callback?reference=${payment.reference}`);

    expect(page.status).toBe(200);
    expect(page.text).toContain("We're confirming your payment");
    // …but arriving at this page is NOT proof. Nothing moved.
    const row = await ctx.prisma.payment.findUnique({ where: { reference: payment.reference } });
    expect(row.status).toBe('initiated');
    expect((await ctx.prisma.booking.findUnique({ where: { id: booking.id } })).status).toBe(
      'held',
    );
  });

  it('escapes whatever is in the URL (no cross-site scripting)', async () => {
    const page = await request(ctx.app).get(
      '/payments/callback?reference=<script>alert(1)</script>',
    );
    expect(page.text).not.toContain('<script>alert(1)</script>');
    expect(page.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('the simulator has its own checkout page, only for real payments', async () => {
    const { manager, booking } = await setup();
    const { payment } = (await manager.post(`/api/bookings/${booking.id}/payments`).send({})).body;

    const page = await request(ctx.app).get(`/simulator/checkout/${payment.reference}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Simulated checkout');
    expect((await request(ctx.app).get('/simulator/checkout/OKG-MADE-UP')).status).toBe(404);
  });
});

describe('seeing payments', () => {
  it('appear on the booking and in its payment list; guides can view but not start', async () => {
    const { manager, guide, booking } = await setup();
    await manager.post(`/api/bookings/${booking.id}/payments`).send({});

    expect((await manager.get(`/api/bookings/${booking.id}`)).body.booking.payments).toHaveLength(
      1,
    );
    expect((await guide.get(`/api/bookings/${booking.id}/payments`)).body.payments).toHaveLength(1);
    expect((await guide.post(`/api/bookings/${booking.id}/payments`).send({})).status).toBe(403);
  });

  it("cannot start or see payments on another operator's booking", async () => {
    const mine = await setup();
    const theirs = await setup();
    expect(
      (await mine.manager.post(`/api/bookings/${theirs.booking.id}/payments`).send({})).status,
    ).toBe(404);
    expect((await mine.manager.get(`/api/bookings/${theirs.booking.id}/payments`)).status).toBe(
      404,
    );
  });
});
