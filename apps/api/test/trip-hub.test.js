/**
 * Stage 12f-1 (API side): what the trip hub needs from GET /public/bookings/:token.
 *   - a signed TICKET code (not the guest link) with its QR drawing, only while there's a trip
 *   - the operator's Call / WhatsApp, the route, "arrive N minutes early", when the trip ends
 *   - after a cancellation: who cancelled, staff's reason, and no ticket
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { addDays, localDate } from '@okapigo/shared/time';
import { bookingIdFromTicketCode, bookingIdFromGuestToken, cancelBooking } from '@okapigo/db';
import { createTestContext, buildApp, TEST_AUTH_SECRET } from './helpers.js';
import { qrPath } from '../src/lib/qr.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

/** A PAID Heritage Walk booking for one adult, through the public checkout. */
async function paidBooking(app) {
  const { operator } = await ctx.seedOperator();
  const today = localDate(new Date(), 'Africa/Lagos');
  const deps = (
    await request(app).get(
      `/public/${operator.slug}/tours/lagos-island-heritage-walk/departures?to=${addDays(today, 14)}`,
    )
  ).body.departures;
  const { token } = (
    await request(app)
      .post(`/public/${operator.slug}/bookings`)
      .send({
        lead: { name: 'Adaeze Okafor', email: 'adaeze@guest.example', acceptTerms: true },
        departureId: deps[0].id,
        travellers: [{ name: 'Adaeze Okafor', age: 34 }],
        addOns: [],
      })
  ).body;
  const { reference } = (
    await request(app).post(`/public/bookings/${token}/pay`).send({ option: 'full' })
  ).body.payment;
  await ctx.provider.complete(reference);
  await request(app).post(`/public/bookings/${token}/payments/${reference}/check`);
  return { operator, token };
}

const view = async (app, token) =>
  (await request(app).get(`/public/bookings/${token}`)).body.booking;

describe('the trip hub’s data', () => {
  it('a ticket the guide can scan, which is NOT the private link', async () => {
    const app = buildApp({ prisma: ctx.prisma, provider: ctx.provider });
    const { token } = await paidBooking(app);
    const b = await view(app, token);

    const bookingId = bookingIdFromGuestToken(TEST_AUTH_SECRET, token);
    expect(bookingIdFromTicketCode(TEST_AUTH_SECRET, b.ticket.code)).toBe(bookingId);
    expect(b.ticket.code).not.toContain(token);
    // The drawing is the code's QR, as one path, ready to save for offline use.
    expect(b.ticket.qr).toEqual(qrPath(b.ticket.code));
    expect(b.ticket.qr.size).toBe(29);
    expect(b.ticket.qr.path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
  });

  it('the operator’s Call and WhatsApp, the route, arrive-early and the end time', async () => {
    const app = buildApp({ prisma: ctx.prisma, provider: ctx.provider });
    const { token } = await paidBooking(app);
    const b = await view(app, token);

    expect(b.operator).toMatchObject({ phone: '+2348090000123', whatsapp: '+2348090000123' });
    expect(b.tour.stops).toEqual([
      'Tinubu Square',
      'Brazilian Quarter (Popo Aguda)',
      'Cathedral Church of Christ',
      'Freedom Park',
      'National Museum, Onikan',
    ]);
    expect(b.tour.arriveMinutesEarly).toBe(10);
    expect(new Date(b.departure.endsAt) - new Date(b.departure.startsAt)).toBe(3 * 3_600_000);
    expect(b).toMatchObject({ depositPaidKobo: 0, cancellation: null, refunds: [] });
  });

  it('cancelled by the operator: the reason staff gave, the refund, and no ticket', async () => {
    const app = buildApp({ prisma: ctx.prisma, provider: ctx.provider });
    const { operator, token } = await paidBooking(app);
    const bookingId = /** @type {string} */ (bookingIdFromGuestToken(TEST_AUTH_SECRET, token));
    await cancelBooking(ctx.prisma, {
      operatorId: operator.id,
      bookingId,
      initiatedBy: 'operator',
      reason: 'Storm warning for Lagos Island',
      actor: { type: 'system' },
    });

    const b = await view(app, token);
    expect(b.status).toBe('cancelled');
    expect(b.ticket).toBeNull();
    expect(b.cancellation).toMatchObject({
      by: 'operator',
      reason: 'Storm warning for Lagos Island',
      refundKobo: 2_500_000, // everything back when the operator cancels
    });
  });

  it('cancelled by the guest: no reason echoed back', async () => {
    const app = buildApp({ prisma: ctx.prisma, provider: ctx.provider });
    const { operator, token } = await paidBooking(app);
    await cancelBooking(ctx.prisma, {
      operatorId: operator.id,
      bookingId: /** @type {string} */ (bookingIdFromGuestToken(TEST_AUTH_SECRET, token)),
      initiatedBy: 'guest',
      reason: 'Phoned to cancel',
      actor: { type: 'system' },
    });
    expect((await view(app, token)).cancellation).toMatchObject({ by: 'guest', reason: null });
  });
});
