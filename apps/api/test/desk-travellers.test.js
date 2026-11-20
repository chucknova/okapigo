/**
 * Stage 16c-3: change travellers at the bookings desk (designs: Booking actions).
 *   - the preview: the categories at their booked price, the new total, the extra to pay or
 *     the policy's refund, whether the seats fit
 *   - more travellers: saved, the seats taken, the booking owes the extra (paid → amended), and
 *     a link for it is sent
 *   - an added traveller pays the price from when it was booked (decided 2026-11-20)
 *   - fewer: the policy's refund, confirmed by the office, then started
 *   - the rules: the lead stays, ages fit, seats fit, before the trip, only a live booking
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { bookingIdFromGuestToken } from '@okapigo/db';
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
  /** A website booking, paid in full unless `pay` is false; returns its id. */
  const book = async (
    /** @type {any} */ d,
    travellers = [{ name: 'Yemi Ojo', age: 34 }],
    { pay = true } = {},
  ) => {
    const res = await request(ctx.app)
      .post(`/public/${operator.slug}/bookings`)
      .send({
        lead: {
          name: travellers[0].name,
          email: 'yemi@guest.example',
          phone: '0813 902 4417',
          acceptTerms: true,
        },
        departureId: d.id,
        travellers,
        addOns: [],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { token } = res.body;
    if (pay) {
      const { reference } = (
        await request(ctx.app).post(`/public/bookings/${token}/pay`).send({ option: 'full' })
      ).body.payment;
      await ctx.provider.complete(reference);
      await request(ctx.app).post(`/public/bookings/${token}/payments/${reference}/check`);
    }
    return /** @type {string} */ (bookingIdFromGuestToken(TEST_AUTH_SECRET, token));
  };
  const preview = (/** @type {string} */ id, /** @type {any} */ body) =>
    manager.post(`/api/bookings/${id}/travellers/preview`).send(body);
  const save = (/** @type {string} */ id, /** @type {any} */ body) =>
    manager.post(`/api/bookings/${id}/travellers/change`).send(body);
  const row = (/** @type {string} */ id) =>
    ctx.prisma.booking.findUniqueOrThrow({ where: { id }, include: { travellers: true } });
  return { ...seeded, manager, departureOf, book, preview, save, row };
}

describe('more travellers', () => {
  it('the preview: categories at the booked price, the new total, the extra, the seats', async () => {
    const s = await setup();
    const badagry = await s.departureOf('badagry-heritage-day-trip');
    const id = await s.book(badagry);
    const p = (await s.preview(id, { add: [{ categoryKey: 'child', name: 'Tobi Ojo', age: 9 }] }))
      .body.plan;
    expect(p.categories.map((/** @type {any} */ c) => [c.key, c.booked, c.count])).toEqual([
      ['adult', true, 1],
      ['child', false, 1],
      ['infant', false, 0],
    ]);
    expect(p).toMatchObject({
      oldTotalKobo: 6_500_000,
      newTotalKobo: 10_000_000,
      extraKobo: 3_500_000,
      owedAfterKobo: 3_500_000,
      refund: null,
      seats: { fits: true, delta: 1, text: expect.stringMatching(/^fits \(\d+ of \d+\)$/) },
      changed: true,
    });
    // A preview writes nothing.
    expect((await s.row(id)).travellers).toHaveLength(1);
  });

  it('saved: the traveller added, the seat taken, the extra owed (paid → amended), a link sent', async () => {
    const s = await setup();
    const badagry = await s.departureOf('badagry-heritage-day-trip');
    const id = await s.book(badagry);
    const before = await ctx.prisma.departure.findUniqueOrThrow({ where: { id: badagry.id } });
    const res = await s.save(id, { add: [{ categoryKey: 'child', name: 'Tobi Ojo', age: 9 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.link).toEqual({ sent: true, amountKobo: 3_500_000 });
    expect(res.body.refundStart).toBeNull();

    const b = await s.row(id);
    expect(b).toMatchObject({
      status: 'amended',
      totalKobo: 10_000_000,
      amountPaidKobo: 6_500_000,
    });
    expect(b.travellers.find((t) => t.position === 2)).toMatchObject({
      name: 'Tobi Ojo',
      age: 9,
      categoryKey: 'child',
    });
    const after = await ctx.prisma.departure.findUniqueOrThrow({ where: { id: badagry.id } });
    expect(after.seatsSold).toBe(before.seatsSold + 1);
    expect(
      await ctx.prisma.notification.count({ where: { bookingId: id, kind: 'payment_link' } }),
    ).toBeGreaterThan(0);

    const page = (await s.manager.get(`/api/desk/bookings/${id}`)).body.booking;
    expect(page.chip.text).toBe('Owes ₦35,000');
    expect(page.timeline).toContainEqual(
      expect.stringMatching(/ · travellers changed by \w+: added Tobi Ojo · ₦65,000 → ₦100,000$/),
    );
    expect(page.timeline).toContainEqual(expect.stringMatching(/ · changed: more to pay$/));
    // Paying the extra settles it: amended → paid.
    const owed = await ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(owed.totalKobo - owed.amountPaidKobo).toBe(3_500_000);
  });

  it('the price from when it was booked; a category it never had, today’s', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk);
    // The tour's prices go up after the booking.
    await ctx.prisma.priceCategory.updateMany({
      where: { product: { operatorId: s.operator.id, slug: 'lagos-island-heritage-walk' } },
      data: { amountKobo: { increment: 1_000_000 } },
    });
    const adult = (await s.preview(id, { add: [{ categoryKey: 'adult', name: 'Tola Ojo' }] })).body
      .plan;
    expect(adult.newTotalKobo).toBe(5_000_000); // 2 × the booked ₦25,000
    const child = (await s.preview(id, { add: [{ categoryKey: 'child', name: 'Tobi', age: 9 }] }))
      .body.plan;
    const cat = child.categories.find((/** @type {any} */ c) => c.key === 'child');
    expect(cat).toMatchObject({ booked: false });
    expect(child.newTotalKobo).toBe(2_500_000 + cat.priceKobo);
  });
});

describe('fewer travellers', () => {
  it('the policy’s refund, confirmed, then started; the seat freed', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk', 3);
    const id = await s.book(walk, [
      { name: 'Yemi Ojo', age: 34 },
      { name: 'Tola Ojo', age: 33 },
    ]);
    const tola = (await s.row(id)).travellers.find((t) => t.position === 2);
    const p = (await s.preview(id, { remove: [tola?.id] })).body.plan;
    expect(p).toMatchObject({
      newTotalKobo: 2_500_000,
      extraKobo: 0,
      refund: {
        overpaidKobo: 2_500_000,
        policyKobo: 2_500_000,
        policyText: '₦25,000 of ₦25,000 (full refund, because it’s 48 hours or more before)',
      },
      seats: { fits: true, delta: -1 },
    });
    // Not confirmed (or a different amount): nothing saved.
    const unconfirmed = await s.save(id, { remove: [tola?.id] });
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error).toMatchObject({
      code: 'REFUND_CHANGED',
      message: 'The refund is now ₦25,000. Check it and confirm again.',
    });
    expect((await s.row(id)).travellers).toHaveLength(2);

    const before = await ctx.prisma.departure.findUniqueOrThrow({ where: { id: walk.id } });
    const res = await s.save(id, { remove: [tola?.id], refundKobo: 2_500_000 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.refundStart).toEqual({ started: true });
    expect(res.body.link).toBeNull();
    const b = await s.row(id);
    expect(b).toMatchObject({ status: 'paid', totalKobo: 2_500_000, refundDueKobo: 2_500_000 });
    expect(b.travellers.map((t) => t.name)).toEqual(['Yemi Ojo']);
    const after = await ctx.prisma.departure.findUniqueOrThrow({ where: { id: walk.id } });
    expect(after.seatsSold).toBe(before.seatsSold - 1);
    expect(await ctx.prisma.refund.count({ where: { bookingId: id } })).toBe(1);
    const page = (await s.manager.get(`/api/desk/bookings/${id}`)).body.booking;
    expect(page.timeline).toContainEqual(
      expect.stringMatching(
        / · travellers changed by \w+: removed Tola Ojo · ₦50,000 → ₦25,000 · refund ₦25,000$/,
      ),
    );
  });

  it('a part-paid booking that now owes nothing: paid, nothing back', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk, [
      { name: 'Yemi Ojo', age: 34 },
      { name: 'Tola Ojo', age: 33 },
    ]);
    await ctx.prisma.booking.update({
      where: { id },
      data: { status: 'part_paid', amountPaidKobo: 2_500_000 },
    });
    const tola = (await s.row(id)).travellers.find((t) => t.position === 2);
    const res = await s.save(id, { remove: [tola?.id] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.plan.refund).toBeNull();
    expect(await s.row(id)).toMatchObject({ status: 'paid', totalKobo: 2_500_000 });
  });
});

describe('the rules', () => {
  it('the lead stays; ages fit their category; at least someone changes', async () => {
    const s = await setup();
    const badagry = await s.departureOf('badagry-heritage-day-trip');
    const id = await s.book(badagry);
    const lead = (await s.row(id)).travellers[0];
    const err = async (/** @type {any} */ body) => (await s.preview(id, body)).body.error;
    expect(await err({ remove: [lead.id] })).toMatchObject({ code: 'LEAD_STAYS' });
    expect(await err({ add: [{ categoryKey: 'child', name: 'Tobi' }] })).toMatchObject({
      code: 'AGE_NEEDED',
      message: 'Give the age of each child (3–12).',
    });
    expect(await err({ add: [{ categoryKey: 'child', name: 'Tobi', age: 15 }] })).toMatchObject({
      code: 'AGE_OUTSIDE_CATEGORY',
      message: 'Child (3–12) is 3–12; Tobi is 15.',
    });
    expect(await err({ add: [{ categoryKey: 'student' }] })).toMatchObject({
      code: 'UNKNOWN_CATEGORY',
    });
    expect((await s.save(id, {})).body.error.code).toBe('NO_CHANGE');
  });

  it('more than the van can take: shown, and refused', async () => {
    const s = await setup();
    const badagry = await s.departureOf('badagry-heritage-day-trip');
    const id = await s.book(badagry, [
      { name: 'Yemi Ojo', age: 34 },
      { name: 'Tola Ojo', age: 33 },
    ]);
    const minivan = await ctx.prisma.resource.create({
      data: { operatorId: s.operator.id, kind: 'van', name: 'Minivan', seats: 2 },
    });
    await ctx.prisma.departure.update({
      where: { id: badagry.id },
      data: { resourceId: minivan.id },
    });
    const body = { add: [{ categoryKey: 'adult', name: 'Ada Ojo' }] };
    expect((await s.preview(id, body)).body.plan.seats).toEqual({
      fits: false,
      delta: 1,
      text: 'doesn’t fit: 3 of 2 in Minivan. Move to another date, or take fewer.',
    });
    const res = await s.save(id, body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEATS');
  });

  it('not before it’s booked, nor once the trip has started', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const held = await s.book(walk, undefined, { pay: false });
    expect((await s.preview(held, {})).body.error).toMatchObject({
      code: 'CANNOT_CHANGE',
      message: 'This booking isn’t booked yet.',
    });
    const paid = await s.book(walk);
    await ctx.prisma.departure.update({
      where: { id: walk.id },
      data: { startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + 2 * HOUR) },
    });
    expect((await s.preview(paid, {})).body.error.code).toBe('TRIP_STARTED');
  });
});
