/**
 * Stage 11c: the guest pays in full, a deposit, or the balance (BKG-06, PAY-02).
 *
 * Badagry allows a 30% deposit, with the balance due 7 days before the trip. Guests booking
 * later than that pay in full (decided 2026-11-17). The guest always picks an OPTION, never
 * an amount: the server works the amount out.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { processWebhookEvent } from '@okapigo/db';
import { addDays, localDate } from '@okapigo/shared/time';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

const api = () => request(ctx.app);
const today = () => localDate(new Date(), 'Africa/Lagos');
const lead = { name: 'Bisi Adeyemi', email: 'bisi@guest.example', acceptTerms: true };

/**
 * Seeds an operator. `bookTour(slug, pick)` books one adult on the departure `pick` chooses
 * from the next 5 weeks and returns { token, booking }.
 */
async function setup() {
  const seeded = await ctx.seedOperator();
  const slug = seeded.operator.slug;
  const bookTour = async (tourSlug, pick = (deps) => deps[0]) => {
    const deps = (
      await api().get(`/public/${slug}/tours/${tourSlug}/departures?to=${addDays(today(), 35)}`)
    ).body.departures;
    const res = await api()
      .post(`/public/${slug}/bookings`)
      .send({ lead, departureId: pick(deps).id, travellers: [{ name: 'Bisi Adeyemi', age: 41 }] });
    expect(res.status).toBe(201);
    return res.body;
  };
  return { ...seeded, slug, bookTour };
}

/** A Badagry Saturday more than 7 days away, so a deposit is on offer. */
const farEnough = (deps) => deps.find((d) => d.localDate > addDays(today(), 7));
/** The nearest Badagry Saturday: always within 7 days, so its due date has passed. */
const tooSoon = (deps) => deps[0];

/** Delivers Paystack's signed "charge.success" for a reference and processes it. */
async function webhookFor(reference) {
  const body = JSON.stringify(await ctx.provider.chargeSuccessEvent(reference));
  await api()
    .post('/webhooks/paystack')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', ctx.provider.sign(body))
    .send(body);
  return processWebhookEvent(ctx.prisma, ctx.provider, ctx.jobs.webhooks.at(-1));
}

const pay = (token, body) => api().post(`/public/bookings/${token}/pay`).send(body);
const view = async (token) => (await api().get(`/public/bookings/${token}`)).body.booking;

describe('the tour page', () => {
  it('says Badagry takes a 30% deposit and deposits are non-refundable', async () => {
    const { slug } = await setup();

    const { tour } = (await api().get(`/public/${slug}/tours/badagry-heritage-day-trip`)).body;
    const walk = (await api().get(`/public/${slug}/tours/lagos-island-heritage-walk`)).body.tour;

    expect(tour.depositBasisPoints).toBe(3000);
    expect(tour.cancellationPolicy.depositRefundable).toBe(false);
    expect(walk.depositBasisPoints).toBeNull();
  });
});

describe('payment options on the review screen', () => {
  it('Badagry, more than 7 days away: pay ₦65,000, or ₦19,500 now and ₦45,500 by the due date', async () => {
    const { bookTour } = await setup();

    const { booking } = await bookTour('badagry-heritage-day-trip', farEnough);

    expect(booking.paymentOptions).toEqual([
      { type: 'full', amountKobo: 6_500_000 },
      {
        type: 'deposit',
        amountKobo: 1_950_000,
        balanceKobo: 4_550_000,
        balanceDueDate: addDays(booking.departure.localDate, -7),
      },
    ]);
    expect(booking.balanceDueDate).toBeNull(); // nothing paid yet
  });

  it('Badagry within 7 days: full payment only', async () => {
    const { bookTour } = await setup();

    const { booking } = await bookTour('badagry-heritage-day-trip', tooSoon);

    expect(booking.paymentOptions).toEqual([{ type: 'full', amountKobo: 6_500_000 }]);
  });

  it('a tour without deposits: full payment only', async () => {
    const { bookTour } = await setup();

    const { booking } = await bookTour('lagos-island-heritage-walk');

    expect(booking.paymentOptions).toEqual([{ type: 'full', amountKobo: 2_500_000 }]);
  });

  it('nothing can be paid once the hold has expired', async () => {
    const { bookTour } = await setup();
    const { token, booking } = await bookTour('lagos-island-heritage-walk');
    await ctx.prisma.hold.updateMany({
      where: { booking: { reference: booking.reference } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await view(token)).paymentOptions).toEqual([]);
    const res = await pay(token, { option: 'full' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OPTION_NOT_AVAILABLE');
  });
});

describe('POST /public/bookings/:token/pay', () => {
  it('deposit → part paid, balance due 7 days before → balance → paid', async () => {
    const { bookTour } = await setup();
    const { token, booking } = await bookTour('badagry-heritage-day-trip', farEnough);

    // 1. The deposit.
    const deposit = await pay(token, { option: 'deposit' });
    expect(deposit.status).toBe(201);
    expect(deposit.body.payment).toMatchObject({ amountKobo: 1_950_000, purpose: 'deposit' });
    expect(deposit.body.payment.authorizationUrl).toMatch(/^http/);
    await ctx.provider.complete(deposit.body.payment.reference);
    expect((await webhookFor(deposit.body.payment.reference)).outcome).toBe('SETTLED');

    const afterDeposit = await view(token);
    expect(afterDeposit).toMatchObject({
      status: 'part_paid',
      amountPaidKobo: 1_950_000,
      balanceKobo: 4_550_000,
      balanceDueDate: addDays(booking.departure.localDate, -7),
      paymentOptions: [{ type: 'balance', amountKobo: 4_550_000 }],
      holdExpiresAt: null, // the seats are sold now, not held
    });

    // 2. The balance (from the trip hub or a reminder, later).
    const balance = await pay(token, { option: 'balance', method: 'bank_transfer' });
    expect(balance.body.payment).toMatchObject({ amountKobo: 4_550_000, purpose: 'balance' });
    await ctx.provider.complete(balance.body.payment.reference, { channel: 'bank_transfer' });
    await webhookFor(balance.body.payment.reference);

    expect(await view(token)).toMatchObject({
      status: 'paid',
      balanceKobo: 0,
      balanceDueDate: null,
      paymentOptions: [],
    });
  });

  it('pays in full; a second click reuses the same checkout', async () => {
    const { bookTour } = await setup();
    const { token } = await bookTour('lagos-island-heritage-walk');

    const first = await pay(token, { option: 'full' });
    const second = await pay(token, { option: 'full' });

    expect(first.status).toBe(201);
    expect(first.body.payment).toMatchObject({ amountKobo: 2_500_000, purpose: 'full' });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ reused: true });
    expect(second.body.payment.reference).toBe(first.body.payment.reference);
  });

  it('refuses a deposit where none is offered, and says what is', async () => {
    const { bookTour } = await setup();
    const { token } = await bookTour('badagry-heritage-day-trip', tooSoon);

    const res = await pay(token, { option: 'deposit' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'OPTION_NOT_AVAILABLE',
      message: "A deposit isn't available for this booking. Please pay in full.",
      options: ['full'],
    });
  });

  it('ignores an amount sent by the browser: the option decides', async () => {
    const { bookTour } = await setup();
    const { token } = await bookTour('badagry-heritage-day-trip', farEnough);

    const res = await pay(token, { option: 'deposit', amountKobo: 100 });

    expect(res.body.payment.amountKobo).toBe(1_950_000);
  });

  it('answers 404 for a forged link', async () => {
    const { bookTour } = await setup();
    const { token } = await bookTour('lagos-island-heritage-walk');
    const forged = token.slice(0, 40) + (token[40] === 'A' ? 'B' : 'A') + token.slice(41);

    expect((await pay(forged, { option: 'full' })).status).toBe(404);
  });
});

describe('the deposit setting', () => {
  it('staff can set it; it must be between 0% and 100%', async () => {
    const { owner, operator } = await setup();
    const token = await ctx.tokenFor(owner.id);
    const walk = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug: 'lagos-island-heritage-walk' },
    });
    const patch = (depositBasisPoints) =>
      api()
        .patch(`/api/products/${walk.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ depositBasisPoints });

    expect((await patch(2500)).body.product.depositBasisPoints).toBe(2500);
    expect((await patch(0)).status).toBe(400);
    expect((await patch(10_000)).status).toBe(400);
    expect((await patch(null)).body.product.depositBasisPoints).toBeNull();

    // And the database refuses it even if the API were bypassed.
    await expect(
      ctx.prisma.product.update({ where: { id: walk.id }, data: { depositBasisPoints: 10_000 } }),
    ).rejects.toThrow(/products_deposit_basis_points_check/);
  });
});
