/**
 * Stage 11d: balance reminders (7, 3 and 1 days before the due date) and overdue alerts for
 * staff. Nothing is cancelled automatically (decided 2026-11-17).
 *
 * The job is run with a chosen `now`, so one booking can be walked through its whole
 * timeline in a few lines. Bookings here are staff "pay later" bookings (confirmed, nothing
 * paid): the quickest way to a booking that owes its full balance.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { queueBalanceNotices } from '@okapigo/db';
import { addDays, localDate, zonedTimeToUtc } from '@okapigo/shared/time';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

const TZ = 'Africa/Lagos';
const today = () => localDate(new Date(), TZ);
/** 10:00 Lagos on a local date: when "the job ran that morning". */
const morningOf = (date) => zonedTimeToUtc(date, '10:00', TZ);

function as(token) {
  const withAuth = (method) => (url) =>
    request(ctx.app)[method](url).set('Authorization', `Bearer ${token}`);
  return { get: withAuth('get'), post: withAuth('post') };
}

/**
 * Seeds an operator; `payLater(daysAhead)` books one adult on the first Heritage Walk at
 * least `daysAhead` days from today and confirms it unpaid. Returns the booking and its
 * dates. ("At least": the walk is daily but skips 25 December, so an exact day could be
 * missing when these tests run in early December.)
 */
async function setup() {
  const seeded = await ctx.seedOperator();
  const staff = as(await ctx.tokenFor(seeded.manager.id));
  const walk = await ctx.prisma.product.findFirstOrThrow({
    where: { operatorId: seeded.operator.id, slug: 'lagos-island-heritage-walk' },
  });
  const run = (date) =>
    queueBalanceNotices(ctx.prisma, { now: morningOf(date), operatorId: seeded.operator.id });

  const payLater = async (daysAhead) => {
    const departure = await ctx.prisma.departure.findFirstOrThrow({
      where: {
        productId: walk.id,
        startsAt: { gte: zonedTimeToUtc(addDays(today(), daysAhead), '00:00', TZ) },
      },
      orderBy: { startsAt: 'asc' },
    });
    const tripDate = localDate(departure.startsAt, TZ);
    const created = await staff.post('/api/bookings').send({
      departureId: departure.id,
      lead: { name: 'Kunle Ade', phone: '0803 555 0101', acceptTerms: true },
      travellers: [{ name: 'Kunle Ade', age: 45 }],
    });
    expect(created.status).toBe(201);
    const id = created.body.booking.id;
    expect((await staff.post(`/api/bookings/${id}/confirm`).send({})).status).toBe(200);
    return { id, departureId: departure.id, tripDate, dueDate: addDays(tripDate, -7) };
  };

  // The balance notices only (a pay-later booking also gets its confirmation, stage 14a).
  const notices = (bookingId) =>
    ctx.prisma.notification.findMany({
      where: { bookingId, kind: { in: ['balance_reminder', 'balance_overdue'] } },
      orderBy: { createdAt: 'asc' },
      select: { key: true, audience: true, status: true, data: true },
    });

  return { ...seeded, staff, run, payLater, notices };
}

describe('the daily balance job', () => {
  it('reminds 7, 3, 1 days before, then alerts staff; each once; older unsent ones are replaced', async () => {
    const { run, payLater, notices } = await setup();
    const { id, dueDate, tripDate } = await payLater(20); // due in 13 days

    expect(await run(addDays(dueDate, -8))).toMatchObject({ checked: 1, reminders: 0 });
    expect(await notices(id)).toEqual([]);

    // 7 days before: the first reminder, with what the message needs.
    expect(await run(addDays(dueDate, -7))).toMatchObject({ reminders: 1 });
    expect(await notices(id)).toEqual([
      {
        // One row per channel the guest gave (stage 14a): this one gave a phone only.
        key: 'balance_reminder:7:whatsapp',
        audience: 'guest',
        status: 'pending',
        data: { daysBefore: 7, balanceKobo: 2_500_000, departureLocalDate: tripDate },
      },
    ]);

    // Run again the same day, and the next: nothing new.
    expect(await run(addDays(dueDate, -7))).toMatchObject({ reminders: 0 });
    expect(await run(addDays(dueDate, -6))).toMatchObject({ reminders: 0 });

    // 3 days before: a new reminder; the 7-day one nobody sent (here: no sender is running)
    // is cancelled so the guest never gets both.
    await run(addDays(dueDate, -3));
    await run(addDays(dueDate, -1));
    // The day after the due date: a staff alert; the unsent "1 day left" is withdrawn.
    expect(await run(addDays(dueDate, 1))).toMatchObject({ overdue: 1 });
    expect(await run(addDays(dueDate, 2))).toMatchObject({ overdue: 0 });

    expect((await notices(id)).map((n) => [n.key, n.audience, n.status])).toEqual([
      ['balance_reminder:7:whatsapp', 'guest', 'cancelled'],
      ['balance_reminder:3:whatsapp', 'guest', 'cancelled'],
      ['balance_reminder:1:whatsapp', 'guest', 'cancelled'],
      ['balance_overdue', 'staff', 'pending'],
    ]);
    // …and the booking itself is untouched: nothing is cancelled automatically.
    const booking = await ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(booking.status).toBe('confirmed');
  });

  it('catches up a missed day, and skips milestones that passed before the booking', async () => {
    const { run, payLater, notices } = await setup();
    // Trip in 12 days → due in 5: the 7-day milestone was 2 days ago, before booking.
    const { id, dueDate } = await payLater(12);

    expect(await run(today())).toMatchObject({ reminders: 0 });
    // The job didn't run on the 3-day milestone; the next morning it catches up.
    expect(await run(addDays(dueDate, -2))).toMatchObject({ reminders: 1 });

    expect((await notices(id)).map((n) => n.key)).toEqual(['balance_reminder:3:whatsapp']);
  });

  it('cancels waiting notices once the balance is paid or the trip is called off', async () => {
    const { run, payLater, notices } = await setup();
    const paid = await payLater(20);
    const calledOff = await payLater(21);
    await run(addDays(paid.dueDate, -7));
    await run(addDays(calledOff.dueDate, -7));

    // Paid in full (the payment flow itself is tested in session 10's tests).
    await ctx.prisma.booking.update({
      where: { id: paid.id },
      data: { amountPaidKobo: 2_500_000, status: 'paid' },
    });
    await ctx.prisma.departure.update({
      where: { id: calledOff.departureId },
      data: { status: 'cancelled' },
    });
    const result = await run(addDays(paid.dueDate, -6));

    expect(result.cancelled).toBe(2);
    expect((await notices(paid.id))[0].status).toBe('cancelled');
    expect((await notices(calledOff.id))[0].status).toBe('cancelled');
  });

  it('cancels them when nothing is owed any more, even if the status still says owing', async () => {
    // An amendment lowered the total to exactly what was already paid: status "amended"
    // (an owing status), but the balance is ₦0. The money check alone must catch it.
    const { run, payLater, notices } = await setup();
    const { id, dueDate } = await payLater(20);
    await run(addDays(dueDate, -7));
    await ctx.prisma.booking.update({
      where: { id },
      data: { status: 'amended', amountPaidKobo: 1_000_000, totalKobo: 1_000_000 },
    });

    expect(await run(addDays(dueDate, -3))).toMatchObject({ cancelled: 1, reminders: 0 });
    expect((await notices(id)).map((n) => n.status)).toEqual(['cancelled']);
  });

  it('ignores held bookings (they are still in checkout)', async () => {
    const { run, operator } = await setup();
    const walk = (
      await request(ctx.app).get(
        `/public/${operator.slug}/tours/lagos-island-heritage-walk/departures?to=${addDays(today(), 30)}`,
      )
    ).body.departures;
    await request(ctx.app)
      .post(`/public/${operator.slug}/bookings`)
      .send({
        departureId: walk.at(-1).id,
        lead: { name: 'Ada', phone: '0803 123 4567', acceptTerms: true },
        travellers: [{ name: 'Ada', age: 30 }],
        addOns: [],
      });

    expect(await run(addDays(walk.at(-1).localDate, -14))).toMatchObject({ checked: 0 });
  });
});

describe('GET /api/alerts and POST /api/alerts/:id/dismiss', () => {
  it('shows staff the overdue balance with what they need to act; dismissing clears it', async () => {
    const { run, payLater, staff } = await setup();
    const { id, dueDate, tripDate } = await payLater(20);
    await run(addDays(dueDate, 1));

    const { alerts } = (await staff.get('/api/alerts')).body;

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'balance_overdue',
      booking: {
        id,
        status: 'confirmed',
        lead: { name: 'Kunle Ade', phone: '+2348035550101' },
        tour: 'Lagos Island Heritage Walk',
        departure: { localDate: tripDate, localTime: '09:00' },
        balanceKobo: 2_500_000,
        balanceDueDate: dueDate,
      },
    });

    expect((await staff.post(`/api/alerts/${alerts[0].id}/dismiss`)).status).toBe(204);
    expect((await staff.get('/api/alerts')).body.alerts).toEqual([]);
    expect((await staff.post(`/api/alerts/${alerts[0].id}/dismiss`)).status).toBe(404);
  });

  it('an alert disappears by itself once the balance is paid', async () => {
    const { run, payLater, staff } = await setup();
    const { id, dueDate } = await payLater(20);
    await run(addDays(dueDate, 1));
    await ctx.prisma.booking.update({
      where: { id },
      data: { amountPaidKobo: 2_500_000, status: 'paid' },
    });

    expect((await staff.get('/api/alerts')).body.alerts).toEqual([]);
  });

  it("keeps each operator's alerts to itself, and guides can't dismiss", async () => {
    const a = await setup();
    const b = await setup();
    const { dueDate } = await a.payLater(20);
    await a.run(addDays(dueDate, 1));
    const [alert] = (await a.staff.get('/api/alerts')).body.alerts;
    const guide = as(await ctx.tokenFor(a.guides[0].id));

    expect((await b.staff.get('/api/alerts')).body.alerts).toEqual([]);
    expect((await b.staff.post(`/api/alerts/${alert.id}/dismiss`)).status).toBe(404);
    expect((await guide.get('/api/alerts')).status).toBe(200); // bookings: view
    expect((await guide.post(`/api/alerts/${alert.id}/dismiss`)).status).toBe(403);
  });
});
