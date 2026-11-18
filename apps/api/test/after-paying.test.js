/**
 * Stage 12e (API side): what the "after paying" pages need.
 *   - a guest's payment returns to /trip/:token/confirm (the simulator follows it, like Paystack)
 *   - the guest view lists payment attempts; "check" settles or fails one at once
 *   - Add to calendar (.ics)
 *   - private pages: never indexed, no referrer, no booking data in the HTML
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { addDays, localDate } from '@okapigo/shared/time';
import { createTestContext, buildApp } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

const WEB = 'http://web.example';
const lead = { name: 'Adaeze Okafor', email: 'adaeze@guest.example', acceptTerms: true };

/** A held Heritage Walk booking for one adult, through the public checkout. */
async function heldBooking(app) {
  const { operator } = await ctx.seedOperator();
  const today = localDate(new Date(), 'Africa/Lagos');
  const deps = (
    await request(app).get(
      `/public/${operator.slug}/tours/lagos-island-heritage-walk/departures?to=${addDays(today, 14)}`,
    )
  ).body.departures;
  const res = await request(app)
    .post(`/public/${operator.slug}/bookings`)
    .send({
      lead,
      departureId: deps[0].id,
      travellers: [{ name: 'Adaeze Okafor', age: 34 }],
      addOns: [],
    });
  return { operator, token: res.body.token };
}

describe('paying from the checkout', () => {
  it('returns the guest to /trip/:token/confirm, and the simulator follows it like Paystack', async () => {
    const app = buildApp({ prisma: ctx.prisma, provider: ctx.provider, webPublicUrl: WEB });
    const { token } = await heldBooking(app);

    const pay = await request(app).post(`/public/bookings/${token}/pay`).send({ option: 'full' });
    const reference = pay.body.payment.reference;
    const click = await request(app).post(`/simulator/checkout/${reference}/pay`);

    expect(click.status).toBe(303);
    expect(click.headers.location).toBe(
      `${WEB}/trip/${token}/confirm?reference=${reference}&trxref=${reference}`,
    );
  });

  it('lists the payment in the guest view; "check" knows a decline at once', async () => {
    const app = buildApp({ prisma: ctx.prisma, provider: ctx.provider, webPublicUrl: WEB });
    const { token } = await heldBooking(app);
    const { reference } = (
      await request(app).post(`/public/bookings/${token}/pay`).send({ option: 'full' })
    ).body.payment;

    let view = (await request(app).get(`/public/bookings/${token}`)).body.booking;
    expect(view.payments).toEqual([
      { reference, status: 'initiated', purpose: 'full', amountKobo: 2_500_000, paidAt: null },
    ]);

    // The guest's card is declined at the provider; no webhook comes for a decline.
    await request(app).post(`/simulator/checkout/${reference}/decline`);
    const check = await request(app).post(`/public/bookings/${token}/payments/${reference}/check`);

    expect(check.body).toEqual({ status: 'failed' });
    view = (await request(app).get(`/public/bookings/${token}`)).body.booking;
    expect(view.payments[0].status).toBe('failed');
    expect(view.status).toBe('held'); // the seats are still held: the guest can try again
  });

  it('"check" settles a payment whose webhook hasn\'t come yet, the normal way', async () => {
    const app = buildApp({ prisma: ctx.prisma, provider: ctx.provider, webPublicUrl: WEB });
    const { token } = await heldBooking(app);
    const { reference } = (
      await request(app).post(`/public/bookings/${token}/pay`).send({ option: 'full' })
    ).body.payment;
    await ctx.provider.complete(reference); // paid at the provider; our webhook not processed

    const check = await request(app).post(`/public/bookings/${token}/payments/${reference}/check`);

    expect(check.body).toEqual({ status: 'succeeded' });
    expect((await request(app).get(`/public/bookings/${token}`)).body.booking.status).toBe('paid');
  });

  it('"check" also settles a webhook that arrived but was never processed (worker down)', async () => {
    const app = buildApp({ prisma: ctx.prisma, provider: ctx.provider, webPublicUrl: WEB });
    const { token } = await heldBooking(app);
    const { reference } = (
      await request(app).post(`/public/bookings/${token}/pay`).send({ option: 'full' })
    ).body.payment;
    // The simulator's "Pay": the webhook is recorded and queued, but no worker processes it.
    await request(app).post(`/simulator/checkout/${reference}/pay`);
    expect((await request(app).get(`/public/bookings/${token}`)).body.booking.status).toBe('held');

    const check = await request(app).post(`/public/bookings/${token}/payments/${reference}/check`);

    expect(check.body).toEqual({ status: 'succeeded' });
    expect((await request(app).get(`/public/bookings/${token}`)).body.booking.status).toBe('paid');
  });

  it("can't check someone else's payment", async () => {
    const app = buildApp({ prisma: ctx.prisma, provider: ctx.provider });
    const mine = await heldBooking(app);
    const theirs = await heldBooking(app);
    const { reference } = (
      await request(app).post(`/public/bookings/${theirs.token}/pay`).send({ option: 'full' })
    ).body.payment;

    const res = await request(app).post(
      `/public/bookings/${mine.token}/payments/${reference}/check`,
    );
    expect(res.status).toBe(404);
  });
});

describe('Add to calendar', () => {
  it('is an .ics event at the tour time and place, linking to the trip page', async () => {
    const app = buildApp({ prisma: ctx.prisma, webPublicUrl: WEB });
    const { token } = await heldBooking(app);

    const res = await request(app).get(`/public/bookings/${token}/calendar.ics`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/calendar/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="[A-Z]+-[A-Z0-9]{6}\.ics"$/,
    );
    expect(res.text).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(res.text).toMatch(/\r\nDTSTART:\d{8}T080000Z\r\n/); // 09:00 Lagos = 08:00 UTC
    expect(res.text).toContain('SUMMARY:Lagos Island Heritage Walk (Ìrìn Lagos Tours)');
    expect(res.text).toContain('LOCATION:Tinubu Square\\, Broad Street\\, Lagos Island');
    expect(res.text).toContain(`URL:${WEB}/trip/${token}`);
  });
});

describe('private pages', () => {
  it('serve the app with no booking data, never indexed, no referrer', async () => {
    const app = buildApp({ prisma: ctx.prisma });
    const { token } = await heldBooking(app);

    for (const path of [
      `/trip/${token}`,
      `/trip/${token}/confirm`,
      `/trip/${token}/pay`,
      `/pay/${'a'.repeat(32)}`,
      `/pay/${'a'.repeat(32)}/done`,
    ]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.text).toContain('<meta name="robots" content="noindex">');
      expect(res.text).not.toContain('Adaeze');
      expect(res.text).not.toContain('og:');
    }
    expect((await request(app).get(`/trip/${token}/nonsense`)).status).toBe(404);
  });
});
