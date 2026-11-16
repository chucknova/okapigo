/**
 * Cancellation policies, cancelling, no-shows and calling off departures (BKG-26), via the API.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { buildPermissions } from '@okapigo/shared/permissions';
import { secureBookingInTx } from '@okapigo/db';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

function as(token) {
  const withAuth = (method) => (url) =>
    request(ctx.app)[method](url).set('Authorization', `Bearer ${token}`);
  return { get: withAuth('get'), post: withAuth('post'), patch: withAuth('patch') };
}

/** Seeds an operator; returns clients and a Heritage Walk departure at least 2 days away. */
async function setup() {
  const seeded = await ctx.seedOperator();
  const owner = as(await ctx.tokenFor(seeded.owner.id));
  const manager = as(await ctx.tokenFor(seeded.manager.id));
  const guide = as(await ctx.tokenFor(seeded.guides[0].id));
  const { body } = await owner.get('/api/products');
  const tours = Object.fromEntries(body.products.map((p) => [p.slug, p]));
  const walkDeps = (
    await owner.get(`/api/products/${tours['lagos-island-heritage-walk'].id}/availability`)
  ).body.departures;
  // Far enough ahead that a guest cancellation gets the 100% tier (48 h or more).
  const farDeparture = walkDeps.find((d) => new Date(d.startsAt) - Date.now() > 72 * 3_600_000);
  return { ...seeded, owner, manager, guide, tours, farDeparture };
}

/** Creates a 2-adult booking and makes it "paid" (₦50,000), as session 10's payments will. */
async function paidBooking(client, departureId) {
  const { booking } = (
    await client.post('/api/bookings').send({
      departureId,
      lead: { name: 'Amara Eze', email: 'amara@guest.example', acceptTerms: true },
      travellers: [
        { name: 'Amara Eze', age: 34 },
        { name: 'Obi Eze', age: 36 },
      ],
    })
  ).body;
  const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
  await ctx.prisma.$transaction((tx) =>
    secureBookingInTx(tx, { booking: row, to: 'paid', actor: { type: 'system' } }),
  );
  await ctx.prisma.booking.update({
    where: { id: booking.id },
    data: { amountPaidKobo: row.totalKobo },
  });
  return booking;
}

describe('policies', () => {
  it("lists Ìrìn's Standard policy, used by all five tours", async () => {
    const { owner } = await setup();

    const { policies } = (await owner.get('/api/cancellation-policies')).body;

    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({
      name: 'Standard',
      productCount: 5,
      current: { version: 1, noShowRefundBasisPoints: 0, depositRefundable: false },
    });
    expect(policies[0].current.rules.map((r) => r.hoursBefore)).toEqual([48, 24, 0]);
  });

  it('changing the rules adds a version and keeps the old one', async () => {
    const { owner } = await setup();
    const [policy] = (await owner.get('/api/cancellation-policies')).body.policies;

    const res = await owner.post(`/api/cancellation-policies/${policy.id}/versions`).send({
      rules: [
        { hoursBefore: 72, refundBasisPoints: 10_000 },
        { hoursBefore: 0, refundBasisPoints: 0 },
      ],
      noShowRefundBasisPoints: 0,
      depositRefundable: false,
    });

    expect(res.status).toBe(201);
    expect(res.body.policy.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(res.body.policy.current.version).toBe(2);
  });

  it('refuses rules that refund MORE the later you cancel', async () => {
    const { owner } = await setup();
    const res = await owner.post('/api/cancellation-policies').send({
      name: 'Backwards',
      rules: [
        { hoursBefore: 48, refundBasisPoints: 0 },
        { hoursBefore: 0, refundBasisPoints: 10_000 },
      ],
      noShowRefundBasisPoints: 0,
      depositRefundable: false,
    });
    expect(res.status).toBe(400);
  });

  it("a product can't use another operator's policy", async () => {
    const mine = await setup();
    const theirs = await setup();
    const [theirPolicy] = (await theirs.owner.get('/api/cancellation-policies')).body.policies;

    const res = await mine.owner
      .patch(`/api/products/${mine.tours['lagos-street-food-crawl'].id}`)
      .send({ cancellationPolicyId: theirPolicy.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_POLICY');
  });
});

describe('cancelling a booking', () => {
  it('previews the refund, then cancels: refund due recorded, seats back on sale', async () => {
    const { manager, farDeparture } = await setup();
    const booking = await paidBooking(manager, farDeparture.id);

    const preview = await manager.get(`/api/bookings/${booking.id}/cancellation-quote`);
    expect(preview.body.refund).toMatchObject({
      refundKobo: 5_000_000,
      outcome: 'full',
      policyVersion: 1,
    });

    const res = await manager
      .post(`/api/bookings/${booking.id}/cancel`)
      .send({ initiatedBy: 'guest', reason: 'Flight changed' });

    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ status: 'cancelled', refundDueKobo: 5_000_000 });
    expect(res.body.booking.timeline.at(-1)).toMatchObject({
      toStatus: 'cancelled',
      data: { reason: 'Flight changed', initiatedBy: 'guest' },
    });
    const dep = (
      await manager.get(
        `/api/departures?from=${farDeparture.localDate}&to=${farDeparture.localDate}`,
      )
    ).body.departures.find((d) => d.id === farDeparture.id);
    expect(dep.seatsAvailable).toBe(15);
  });

  it('setting the refund yourself needs payments: edit', async () => {
    const { owner, manager, farDeparture, guides } = await setup();
    // A "Front desk" role that can handle bookings but not money.
    const role = (
      await owner.post('/api/roles').send({
        name: 'Front desk',
        permissions: buildPermissions('view', { bookings: 'edit', payments: 'none' }),
      })
    ).body.role;
    await owner.patch(`/api/staff/${guides[1].id}`).send({ roleId: role.id });
    const frontDesk = as(await ctx.tokenFor(guides[1].id));
    const booking = await paidBooking(manager, farDeparture.id);
    const body = { initiatedBy: 'guest', reason: 'Goodwill', refundOverrideKobo: 1_000_000 };

    expect((await frontDesk.post(`/api/bookings/${booking.id}/cancel`).send(body)).status).toBe(
      403,
    );
    const byManager = await manager.post(`/api/bookings/${booking.id}/cancel`).send(body);
    expect(byManager.body.refund).toMatchObject({ refundKobo: 1_000_000, overridden: true });
  });

  it('guides cannot cancel bookings', async () => {
    const { manager, guide, farDeparture } = await setup();
    const booking = await paidBooking(manager, farDeparture.id);
    const res = await guide
      .post(`/api/bookings/${booking.id}/cancel`)
      .send({ initiatedBy: 'guest', reason: 'x y' });
    expect(res.status).toBe(403);
  });
});

describe('no-shows', () => {
  it('marks the booking and applies the no-show rate', async () => {
    const { manager, farDeparture } = await setup();
    const booking = await paidBooking(manager, farDeparture.id);

    const res = await manager.post(`/api/bookings/${booking.id}/no-show`);

    expect(res.body.booking).toMatchObject({ status: 'no_show', refundDueKobo: 0 });
    expect(res.body.refund).toMatchObject({ reason: 'NO_SHOW', refundKobo: 0 });
  });
});

describe('calling off a departure', () => {
  it('cancels and fully refunds everyone, in one action', async () => {
    const { manager, tours } = await setup();
    const [tarkwa] = (
      await manager.get(`/api/products/${tours['tarkwa-bay-beach-and-lagoon'].id}/availability`)
    ).body.departures;
    await paidBooking(manager, tarkwa.id);
    await paidBooking(manager, tarkwa.id);

    // The simple PATCH refuses a departure with guests, and points to the right action.
    const patch = await manager.patch(`/api/departures/${tarkwa.id}`).send({ status: 'cancelled' });
    expect(patch.status).toBe(409);
    expect(patch.body.error.code).toBe('HAS_GUESTS');

    const res = await manager
      .post(`/api/departures/${tarkwa.id}/cancel`)
      .send({ reason: 'Rough seas forecast' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      bookingsCancelled: 2,
      refundsDueKobo: 2 * 2 * 4_000_000, // 2 bookings × 2 adults × ₦40,000, all refunded
      departure: { status: 'cancelled', seatsSold: 0, seatsHeld: 0 },
    });
  });
});
