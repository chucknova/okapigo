/**
 * Stage 12f-2 (API side): a guest cancels from the trip hub, or asks the operator.
 *   POST /public/bookings/:token/cancel     the refund shown must still be right; not on the day
 *   POST /public/bookings/:token/requests   "Ask Ìrìn": change date · cancel · other
 *   GET  /api/guest-requests, POST …/answer  the staff side
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { addDays, localDate } from '@okapigo/shared/time';
import { bookingIdFromGuestToken, guestCancelBooking } from '@okapigo/db';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

/** @param {string} token */
function as(token) {
  const withAuth = (/** @type {'get' | 'post'} */ method) => (/** @type {string} */ url) =>
    request(ctx.app)[method](url).set('Authorization', `Bearer ${token}`);
  return { get: withAuth('get'), post: withAuth('post') };
}

/**
 * A PAID one-adult Heritage Walk (₦25,000) at least `daysAhead` days away.
 * @param {number} daysAhead
 */
async function paidBooking(daysAhead = 5) {
  const seeded = await ctx.seedOperator();
  const { operator } = seeded;
  const today = localDate(new Date(), 'Africa/Lagos');
  const deps = (
    await request(ctx.app).get(
      `/public/${operator.slug}/tours/lagos-island-heritage-walk/departures?to=${addDays(today, 20)}`,
    )
  ).body.departures;
  const departure = deps.find((/** @type {any} */ d) => d.localDate >= addDays(today, daysAhead));
  const { token } = (
    await request(ctx.app)
      .post(`/public/${operator.slug}/bookings`)
      .send({
        lead: { name: 'Adaeze Okafor', email: 'adaeze@guest.example', acceptTerms: true },
        departureId: departure.id,
        travellers: [{ name: 'Adaeze Okafor', age: 34 }],
        addOns: [],
      })
  ).body;
  const { reference } = (
    await request(ctx.app).post(`/public/bookings/${token}/pay`).send({ option: 'full' })
  ).body.payment;
  await ctx.provider.complete(reference);
  await request(ctx.app).post(`/public/bookings/${token}/payments/${reference}/check`);
  const bookingId = /** @type {string} */ (bookingIdFromGuestToken(TEST_AUTH_SECRET, token));
  return { ...seeded, token, bookingId };
}

const cancel = (/** @type {string} */ token, /** @type {number} */ expectRefundKobo) =>
  request(ctx.app).post(`/public/bookings/${token}/cancel`).send({ expectRefundKobo });
const ask = (/** @type {string} */ token, /** @type {object} */ body) =>
  request(ctx.app).post(`/public/bookings/${token}/requests`).send(body);

describe('cancel yourself', () => {
  it('days ahead: everything back, the refund is sent to the provider, the ticket goes', async () => {
    const { token, bookingId } = await paidBooking(5);
    const res = await cancel(token, 2_500_000);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ refundKobo: 2_500_000, refundStarted: true });
    expect(res.body.booking).toMatchObject({
      status: 'cancelled',
      ticket: null,
      cancellation: { by: 'guest', reason: null, refundKobo: 2_500_000 },
    });
    const refunds = await ctx.prisma.refund.findMany({ where: { bookingId } });
    expect(refunds.map((r) => r.amountKobo)).toEqual([2_500_000]);
    // The timeline says the guest did it.
    const event = await ctx.prisma.bookingEvent.findFirst({
      where: { bookingId, toStatus: 'cancelled' },
    });
    expect(event?.actorType).toBe('guest');
  });

  it('the refund changed since the guest looked: nothing is cancelled, the new amount comes back', async () => {
    const { token, bookingId } = await paidBooking(5);
    const res = await cancel(token, 1_250_000); // they saw 50%; it's actually 100% now

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'REFUND_CHANGED', refundKobo: 2_500_000 });
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe(
      'paid',
    );
  });

  it('a second tap: already cancelled, nothing twice', async () => {
    const { token, bookingId } = await paidBooking(5);
    await cancel(token, 2_500_000);
    const again = await cancel(token, 0);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NOT_CANCELLABLE');
    expect(await ctx.prisma.refund.count({ where: { bookingId } })).toBe(1);
  });

  it('not on the day of the trip, in Lagos time (contact the operator then)', async () => {
    const { bookingId } = await paidBooking(5);
    const b = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { departure: true },
    });
    // 07:30 Lagos on the trip day (06:30 UTC): the start (09:00) is still ahead, but it's the day.
    const morning = new Date(b.departure.startsAt.getTime() - 90 * 60_000);
    await expect(
      guestCancelBooking(ctx.prisma, { bookingId, expectRefundKobo: 0, now: morning }),
    ).rejects.toMatchObject({ code: 'TOO_LATE_TO_CANCEL' });
    // 23:30 the evening before is still fine (less than 24 h: nothing back, but allowed).
    const eve = new Date(b.departure.startsAt.getTime() - 9.5 * 3_600_000);
    await expect(
      guestCancelBooking(ctx.prisma, { bookingId, expectRefundKobo: 0, now: eve }),
    ).resolves.toMatchObject({ refundKobo: 0 });
  });
});

describe('ask the operator', () => {
  it('the guest asks; the trip hub shows it; staff see it with how to reach the guest', async () => {
    const { token, manager } = await paidBooking(5);
    const res = await ask(token, { kind: 'change_date', message: 'Can we move to Sun 6 Dec?' });

    expect(res.status).toBe(201);
    expect(res.body.booking.openRequests).toEqual([
      { kind: 'change_date', message: 'Can we move to Sun 6 Dec?', createdAt: expect.any(String) },
    ]);
    expect(res.body.booking.status).toBe('paid'); // asking changes nothing

    const staff = as(await ctx.tokenFor(manager.id));
    const list = (await staff.get('/api/guest-requests')).body.requests;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: 'change_date',
      message: 'Can we move to Sun 6 Dec?',
      status: 'open',
      booking: { lead: { name: 'Adaeze Okafor', email: 'adaeze@guest.example' } },
    });

    // Staff replied on WhatsApp: answered, off the open list and off the trip hub.
    const answered = await staff
      .post(`/api/guest-requests/${list[0].id}/answer`)
      .send({ note: 'Moved to Sun 6 Dec' });
    expect(answered.body.request).toMatchObject({
      status: 'answered',
      staffNote: 'Moved to Sun 6 Dec',
    });
    expect((await staff.get('/api/guest-requests')).body.requests).toEqual([]);
    expect(
      (await staff.get('/api/guest-requests?status=answered')).body.requests[0].staffNote,
    ).toBe('Moved to Sun 6 Dec');
    expect(
      (await request(ctx.app).get(`/public/bookings/${token}`)).body.booking.openRequests,
    ).toEqual([]);
    expect(
      (await staff.post(`/api/guest-requests/${list[0].id}/answer`).send({})).body.error.code,
    ).toBe('ALREADY_ANSWERED');
  });

  it('an empty message, an unknown kind, and more than three waiting are refused', async () => {
    const { token } = await paidBooking(5);
    expect((await ask(token, { kind: 'other', message: '   ' })).status).toBe(400);
    expect((await ask(token, { kind: 'refund_me', message: 'Hi' })).status).toBe(400);
    for (let i = 0; i < 3; i++) {
      expect((await ask(token, { kind: 'other', message: `Question ${i}` })).status).toBe(201);
    }
    const fourth = await ask(token, { kind: 'other', message: 'One more' });
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('another business can’t see or answer the request', async () => {
    const { token } = await paidBooking(5);
    await ask(token, { kind: 'other', message: 'Is there parking?' });
    const other = await ctx.seedOperator();
    const theirs = as(await ctx.tokenFor(other.manager.id));
    expect((await theirs.get('/api/guest-requests')).body.requests).toEqual([]);

    const [mine] = await ctx.prisma.guestRequest.findMany({
      where: { message: 'Is there parking?' },
    });
    const res = await theirs.post(`/api/guest-requests/${mine.id}/answer`).send({});
    expect(res.status).toBe(404);
  });

  it('a guide (bookings: view) can read the list but not answer', async () => {
    const { token, guides } = await paidBooking(5);
    await ask(token, { kind: 'other', message: 'Is there parking?' });
    const guide = as(await ctx.tokenFor(guides[0].id));
    const list = await guide.get('/api/guest-requests');
    expect(list.status).toBe(200);
    expect(
      (await guide.post(`/api/guest-requests/${list.body.requests[0].id}/answer`).send({})).status,
    ).toBe(403);
  });
});
