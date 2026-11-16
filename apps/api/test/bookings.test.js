/**
 * The bookings API (BKG-23, BKG-25) against the real database.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

function as(token) {
  const withAuth = (method) => (url) =>
    request(ctx.app)[method](url).set('Authorization', `Bearer ${token}`);
  return {
    get: withAuth('get'),
    post: withAuth('post'),
    patch: withAuth('patch'),
    delete: withAuth('delete'),
  };
}

/** Seeds an operator; returns clients and the first upcoming Heritage Walk departure. */
async function setup() {
  const seeded = await ctx.seedOperator();
  const manager = as(await ctx.tokenFor(seeded.manager.id));
  const guide = as(await ctx.tokenFor(seeded.guides[0].id));
  const { body } = await manager.get('/api/products');
  const walk = body.products.find((p) => p.slug === 'lagos-island-heritage-walk');
  const [departure] = (await manager.get(`/api/products/${walk.id}/availability`)).body.departures;
  // `manager` is the API client; `managerUser` is the database row (for checking the timeline).
  return { ...seeded, managerUser: seeded.manager, manager, guide, walk, departure };
}

/** A family of four on the Heritage Walk. */
const FAMILY = (departureId) => ({
  departureId,
  lead: {
    name: 'Bisi Adeyemi',
    phone: '0803 555 0101', // local format: stored as +2348035550101
    acceptTerms: true,
    marketingConsent: true,
  },
  travellers: [
    { name: 'Bisi Adeyemi', age: 41 },
    { name: 'Tayo Adeyemi', age: 38, dietaryNeeds: 'no pork' },
    { name: 'Dami Adeyemi', age: 9 },
    { name: 'Ife Adeyemi', age: 1 },
  ],
});

describe('POST /api/bookings', () => {
  it('creates a held booking with priced travellers, a reference and a timeline', async () => {
    const { manager, managerUser, departure } = await setup();

    const res = await manager.post('/api/bookings').send(FAMILY(departure.id));

    expect(res.status).toBe(201);
    const b = res.body.booking;
    // Test slugs are "test-<hex>", so the prefix is "T", or "TA"–"TF" when the hex starts with a letter.
    expect(b.reference).toMatch(/^T[A-F]?-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(b).toMatchObject({
      status: 'held',
      channel: 'staff',
      totalKobo: 6_250_000, // 2 × ₦25,000 + ₦12,500 + infant free
      amountPaidKobo: 0,
      balanceDueKobo: 6_250_000,
      lead: { name: 'Bisi Adeyemi', phone: '+2348035550101', marketingConsent: true },
    });
    expect(b.travellers.map((t) => [t.name, t.categoryKey])).toEqual([
      ['Bisi Adeyemi', 'adult'],
      ['Tayo Adeyemi', 'adult'],
      ['Dami Adeyemi', 'child'],
      ['Ife Adeyemi', 'infant'],
    ]);
    expect(b.holdExpiresAt).toBeTruthy();
    expect(b.timeline).toEqual([
      expect.objectContaining({
        type: 'created',
        toStatus: 'held',
        actor: { type: 'user', userId: managerUser.id },
      }),
    ]);
    expect(ctx.jobs.scheduled).toHaveLength(1);
  });

  it('requires accepted terms and a way to reach the lead booker', async () => {
    const { manager, departure } = await setup();
    const body = FAMILY(departure.id);

    const noTerms = await manager
      .post('/api/bookings')
      .send({ ...body, lead: { ...body.lead, acceptTerms: false } });
    const noContact = await manager
      .post('/api/bookings')
      .send({ ...body, lead: { name: 'X', acceptTerms: true } });

    expect(noTerms.status).toBe(400);
    expect(noTerms.body.error.issues[0].path).toBe('lead.acceptTerms');
    expect(noContact.status).toBe(400);
    expect(noContact.body.error.issues[0].path).toBe('lead.email');
  });

  it('says when there are not enough seats', async () => {
    const { manager, departure } = await setup();
    const big = {
      ...FAMILY(departure.id),
      travellers: Array.from({ length: 16 }, (_, i) => ({ name: `P${i}`, age: 30 })),
    };

    const res = await manager.post('/api/bookings').send(big); // 16 > 15 seats

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'SOLD_OUT', seatsAvailable: 15 });
  });
});

describe('lifecycle through the API', () => {
  it('held → confirmed (pay later) → completed, each step on the timeline', async () => {
    const { manager, departure } = await setup();
    const { booking } = (await manager.post('/api/bookings').send(FAMILY(departure.id))).body;

    const confirmed = await manager.post(`/api/bookings/${booking.id}/confirm`);
    const completed = await manager
      .post(`/api/bookings/${booking.id}/status`)
      .send({ status: 'completed' });

    expect(confirmed.body.booking).toMatchObject({ status: 'confirmed', holdExpiresAt: null });
    expect(completed.body.booking.status).toBe('completed');
    expect(completed.body.booking.timeline.map((e) => e.toStatus)).toEqual([
      'held',
      'confirmed',
      'completed',
    ]);
  });

  it('refuses moves the lifecycle forbids', async () => {
    const { manager, departure } = await setup();
    const { booking } = (await manager.post('/api/bookings').send(FAMILY(departure.id))).body;

    const res = await manager
      .post(`/api/bookings/${booking.id}/status`)
      .send({ status: 'completed' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_TRANSITION',
      from: 'held',
      to: 'completed',
    });
  });

  it('releasing the hold cancels the booking that was waiting on it', async () => {
    const { manager, departure } = await setup();
    const { booking } = (await manager.post('/api/bookings').send(FAMILY(departure.id))).body;
    const { holdId } = await ctx.prisma.booking.findUnique({ where: { id: booking.id } });

    await manager.delete(`/api/holds/${holdId}`);
    const after = (await manager.get(`/api/bookings/${booking.id}`)).body.booking;

    expect(after.status).toBe('cancelled');
    expect(after.timeline.at(-1)).toMatchObject({
      toStatus: 'cancelled',
      data: { reason: 'hold_released' },
    });
  });
});

describe('finding bookings', () => {
  it('lists newest first and searches by reference or lead name', async () => {
    const { manager, departure } = await setup();
    const first = (await manager.post('/api/bookings').send(FAMILY(departure.id))).body.booking;
    const second = (
      await manager.post('/api/bookings').send({
        ...FAMILY(departure.id),
        lead: { name: 'Kunle Ade', email: 'Kunle@Guest.example', acceptTerms: true },
        travellers: [{ name: 'Kunle Ade', age: 50 }],
      })
    ).body.booking;

    const all = (await manager.get('/api/bookings')).body;
    expect(all.bookings.map((b) => b.id)).toEqual([second.id, first.id]);
    expect(all.total).toBe(2);

    const byRef = (await manager.get(`/api/bookings?q=${first.reference.slice(0, 5)}`)).body
      .bookings;
    expect(byRef.map((b) => b.id)).toContain(first.id);
    const byName = (await manager.get('/api/bookings?q=kunle')).body.bookings;
    expect(byName.map((b) => b.id)).toEqual([second.id]);
    expect(byName[0].lead.email).toBe('kunle@guest.example'); // stored lowercased
  });
});

describe('travellers', () => {
  it('corrects a traveller and records old → new on the timeline', async () => {
    const { manager, departure } = await setup();
    const { booking } = (await manager.post('/api/bookings').send(FAMILY(departure.id))).body;
    const dami = booking.travellers.find((t) => t.name === 'Dami Adeyemi');

    const res = await manager
      .patch(`/api/bookings/${booking.id}/travellers/${dami.id}`)
      .send({ name: 'Damilola Adeyemi', dietaryNeeds: 'nut allergy' });

    expect(res.status).toBe(200);
    expect(res.body.booking.timeline.at(-1)).toMatchObject({
      type: 'traveller_updated',
      data: {
        changed: { name: ['Dami Adeyemi', 'Damilola Adeyemi'], dietaryNeeds: ['', 'nut allergy'] },
      },
    });
  });

  it('does not allow changing a traveller age (that changes the price)', async () => {
    const { manager, departure } = await setup();
    const { booking } = (await manager.post('/api/bookings').send(FAMILY(departure.id))).body;

    const res = await manager
      .patch(`/api/bookings/${booking.id}/travellers/${booking.travellers[0].id}`)
      .send({ age: 12 });

    expect(res.status).toBe(400); // "age" isn't an accepted field, so nothing valid was sent
  });
});

describe('permissions and tenants', () => {
  it('guides can view bookings but not create or change them', async () => {
    const { manager, guide, departure } = await setup();
    const { booking } = (await manager.post('/api/bookings').send(FAMILY(departure.id))).body;

    expect((await guide.get(`/api/bookings/${booking.id}`)).status).toBe(200);
    expect((await guide.post('/api/bookings').send(FAMILY(departure.id))).status).toBe(403);
    expect((await guide.post(`/api/bookings/${booking.id}/confirm`)).status).toBe(403);
  });

  it("cannot see or touch another operator's bookings", async () => {
    const mine = await setup();
    const theirs = await setup();
    const { booking } = (
      await theirs.manager.post('/api/bookings').send(FAMILY(theirs.departure.id))
    ).body;

    expect((await mine.manager.get(`/api/bookings/${booking.id}`)).status).toBe(404);
    expect((await mine.manager.post(`/api/bookings/${booking.id}/confirm`)).status).toBe(404);
    expect((await mine.manager.get('/api/bookings')).body.total).toBe(0);
    expect(
      (await mine.manager.post('/api/bookings').send(FAMILY(theirs.departure.id))).status,
    ).toBe(404);
  });
});
