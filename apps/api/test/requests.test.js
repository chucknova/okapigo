/**
 * Stage 16d-2: guest requests in the inbox, and moving a booking to another date (designs: O9
 * requests and alerts, Inbox gaps; decided 2026-11-21: build moving).
 *   - the Requests tab in words: open oldest first; Done with who dealt with it and how
 *   - a reply: by WhatsApp and email, kept, on the trip page instead of "Your request was sent"
 *   - answered without replying, with a note
 *   - moving: the tour's other dates and their seats; moved (seats, the guest told "Date
 *     changed", the request says "moved to…"); the rules
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { bookingIdFromGuestToken } from '@okapigo/db';
import { requestNotice } from '@okapigo/shared/trip-hub';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';
import { sendGuestMessages } from '../src/messages/send.js';
import { createChannels } from '../src/whatsapp/channels.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const DAY = 86_400_000;

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
  const departures = async (/** @type {string} */ slug) => {
    const product = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug },
    });
    return ctx.prisma.departure.findMany({
      where: { productId: product.id, startsAt: { gt: new Date(Date.now() + 2 * DAY) } },
      orderBy: { startsAt: 'asc' },
      take: 4,
    });
  };
  /** A paid website booking; its id and the guest's token. */
  const book = async (/** @type {any} */ d, travellers = 1, { pay = true } = {}) => {
    const res = await request(ctx.app)
      .post(`/public/${operator.slug}/bookings`)
      .send({
        lead: {
          name: 'Adaeze Okafor',
          email: 'adaeze@guest.example',
          phone: '0803 123 4567',
          acceptTerms: true,
        },
        departureId: d.id,
        travellers: Array.from({ length: travellers }, (_, i) => ({
          name: `Guest ${i + 1}`,
          age: 30,
        })),
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
    return { id: /** @type {string} */ (bookingIdFromGuestToken(TEST_AUTH_SECRET, token)), token };
  };
  const ask = (/** @type {string} */ token, /** @type {any} */ body) =>
    request(ctx.app).post(`/public/bookings/${token}/requests`).send(body);
  const tab = async (/** @type {string} */ t = 'open') =>
    (await manager.get(`/api/inbox/requests?tab=${t}`)).body.requests;
  return { ...seeded, manager, departures, book, ask, tab };
}

describe('the Requests tab', () => {
  it('open ones in words; a reply by WhatsApp and email, kept, and on the trip page', async () => {
    const s = await setup();
    const [walk] = await s.departures('lagos-island-heritage-walk');
    const g = await s.book(walk);
    expect(
      (await s.ask(g.token, { kind: 'other', message: 'Can we bring a buggy for the baby?' }))
        .status,
    ).toBe(201);

    const open = await s.tab();
    expect(open.openCount).toBe(1);
    expect(open.rows[0]).toMatchObject({
      kindLabel: 'A question',
      lead: 'Adaeze Okafor',
      message: 'Can we bring a buggy for the baby?',
      sent: expect.stringMatching(
        /^Sent \w{3} \d+ \w{3}, \d\d:\d\d from their trip page · 0803 123 4567$/,
      ),
      waiting: expect.stringMatching(/^waiting \d+ min$/),
      reach: 'WhatsApp and email',
      replied: null,
      booking: {
        tour: 'Heritage Walk',
        paid: 'Paid ₦25,000',
        people: '1 traveller',
        canMove: true,
      },
    });

    const id = open.rows[0].id;
    const reply = 'Buggies can’t go on the walk, but a baby carrier works well.';
    const res = await s.manager.post(`/api/guest-requests/${id}/reply`).send({ text: reply });
    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe('answered');
    // Sent both ways, as the business's own message.
    const sent = await ctx.prisma.notification.findMany({
      where: { bookingId: g.id, kind: 'staff_message' },
    });
    expect(sent.map((n) => n.channel).sort()).toEqual(['email', 'whatsapp']);
    // The trip page: the reply instead of "sent".
    const trip = (await request(ctx.app).get(`/public/bookings/${g.token}`)).body.booking;
    expect(trip.openRequests).toEqual([]);
    expect(trip.lastReply).toMatchObject({ reply, message: 'Can we bring a buggy for the baby?' });
    expect(requestNotice(trip)).toMatchObject({ kind: 'reply', reply });

    const done = await s.tab('done');
    expect(done.rows[0].done).toMatch(/^\w+ · \d\d:\d\d · replied by WhatsApp and email$/);
    expect((await s.tab()).openCount).toBe(0);
  });

  it('a reply without marking answered stays open, saying it was replied', async () => {
    const s = await setup();
    const [walk] = await s.departures('lagos-island-heritage-walk');
    const g = await s.book(walk);
    await s.ask(g.token, { kind: 'other', message: 'Parking?' });
    const id = (await s.tab()).rows[0].id;
    await s.manager
      .post(`/api/guest-requests/${id}/reply`)
      .send({ text: 'Checking.', markAnswered: false });
    const row = (await s.tab()).rows[0];
    expect(row.replied).toMatchObject({ text: 'Checking.' });
    expect(
      (await s.manager.post(`/api/guest-requests/${id}/reply`).send({ text: '  ' })).status,
    ).toBe(400);
  });

  it('answered without replying: a note, under Done', async () => {
    const s = await setup();
    const [walk] = await s.departures('lagos-island-heritage-walk');
    const g = await s.book(walk);
    await s.ask(g.token, { kind: 'other', message: 'Parking at the office?' });
    const id = (await s.tab()).rows[0].id;
    await s.manager
      .post(`/api/guest-requests/${id}/answer`)
      .send({ note: 'Called her, told her about the side street.' });
    expect((await s.tab('done')).rows[0].done).toMatch(
      /^\w+ · \d\d:\d\d · note: “Called her, told her about the side street\.”$/,
    );
    // No reply: the trip page has none to show.
    const trip = (await request(ctx.app).get(`/public/bookings/${g.token}`)).body.booking;
    expect(trip.lastReply).toBeNull();
  });
});

describe('moving a booking', () => {
  it('the other dates and their seats; moved: seats, the guest told, the request says so', async () => {
    const s = await setup();
    const [now, later] = await s.departures('lagos-island-heritage-walk');
    const g = await s.book(now, 2);
    await s.ask(g.token, { kind: 'change_date', message: 'Can we move to the next walk?' });
    const requestId = (await s.tab()).rows[0].id;

    const o = (await s.manager.get(`/api/bookings/${g.id}/move-options`)).body.options;
    expect(o.travellers).toBe(2);
    expect(o.dates.map((/** @type {any} */ d) => d.id)).not.toContain(now.id);
    const target = o.dates.find((/** @type {any} */ d) => d.id === later.id);
    expect(target).toMatchObject({ fits: true, text: expect.stringMatching(/^\d+ seats free$/) });

    const [beforeFrom, beforeTo] = await Promise.all(
      [now, later].map((d) => ctx.prisma.departure.findUniqueOrThrow({ where: { id: d.id } })),
    );
    const res = await s.manager
      .post(`/api/bookings/${g.id}/move`)
      .send({ departureId: later.id, requestId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.moved).toMatchObject({
      from: expect.stringMatching(/^\w{3} \d+ \w{3}, 09:00$/),
      to: expect.stringMatching(/^\w{3} \d+ \w{3}, 09:00$/),
    });
    const [afterFrom, afterTo] = await Promise.all(
      [now, later].map((d) => ctx.prisma.departure.findUniqueOrThrow({ where: { id: d.id } })),
    );
    expect(afterFrom.seatsSold).toBe(beforeFrom.seatsSold - 2);
    expect(afterTo.seatsSold).toBe(beforeTo.seatsSold + 2);
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: g.id } })).departureId).toBe(
      later.id,
    );
    // The guest is told, both ways.
    const told = await ctx.prisma.notification.findMany({
      where: { bookingId: g.id, kind: 'booking_moved' },
    });
    expect(told.map((n) => n.channel).sort()).toEqual(['email', 'whatsapp']);
    // The timeline, and the request (once answered).
    const page = (await s.manager.get(`/api/desk/bookings/${g.id}`)).body.booking;
    expect(page.timeline.at(-1)).toMatch(
      / · moved from \w{3} \d+ \w{3}, 09:00 to \w{3} \d+ \w{3}, 09:00 by \w+$/,
    );
    await s.manager.post(`/api/guest-requests/${requestId}/reply`).send({ text: 'Done!' });
    expect((await s.tab('done')).rows[0].done).toMatch(
      /^\w+ · \d\d:\d\d · moved to \w{3} \d+ \w{3}, 09:00 · replied by WhatsApp and email$/,
    );

    // The email the guest gets.
    /** @type {any[]} */
    const mails = [];
    await sendGuestMessages({
      operatorId: s.operator.id,
      prisma: ctx.prisma,
      authSecret: TEST_AUTH_SECRET,
      webPublicUrl: 'http://localhost:4000',
      channels: createChannels(),
      mailer: {
        name: 'fake',
        async send(/** @type {any} */ e) {
          mails.push(e);
          return { id: `mail-${mails.length}` };
        },
      },
      emailFrom: 'bookings@okapigo.example',
    });
    const mail = mails.find((m) => m.subject.startsWith('New date'));
    expect(mail.subject).toMatch(
      /^New date: Heritage Walk, \w{3} \d+ \w{3} \([A-Z]+-[A-Z0-9]{6}\)$/,
    );
    expect(mail.text).toMatch(/Now on \w{3} \d+ \w{3}, 09:00 \(was \w{3} \d+ \w{3}\)/);
  });

  it('the rules: seats must fit; not the same date; only this tour’s; only a booked booking', async () => {
    const s = await setup();
    const [now, later] = await s.departures('lagos-island-heritage-walk');
    const g = await s.book(now, 2);
    const move = (/** @type {string} */ departureId) =>
      s.manager.post(`/api/bookings/${g.id}/move`).send({ departureId });

    // The later walk has 1 seat left.
    await ctx.prisma.departure.update({
      where: { id: later.id },
      data: { seatsSold: later.capacity - 1 },
    });
    const o = (await s.manager.get(`/api/bookings/${g.id}/move-options`)).body.options;
    expect(o.dates.find((/** @type {any} */ d) => d.id === later.id)).toMatchObject({
      fits: false,
      text: 'Only 1 free',
    });
    const full = await move(later.id);
    expect(full.status).toBe(409);
    expect(full.body.error).toMatchObject({
      code: 'SEATS',
      message: expect.stringMatching(/ has 1 seat free; this booking needs 2\.$/),
    });
    expect((await move(now.id)).body.error.code).toBe('SAME_DATE');
    // A date that has passed.
    const [, , third] = await s.departures('lagos-island-heritage-walk');
    await ctx.prisma.departure.update({
      where: { id: third.id },
      data: {
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });
    expect((await move(third.id)).body.error.code).toBe('DEPARTURE_STARTED');
    const [badagry] = await s.departures('badagry-heritage-day-trip');
    expect((await move(badagry.id)).body.error.code).toBe('NOT_FOUND');
    const held = await s.book(now, 1, { pay: false });
    expect((await s.manager.get(`/api/bookings/${held.id}/move-options`)).body.error).toMatchObject(
      { code: 'CANNOT_MOVE', message: 'This booking isn’t booked yet.' },
    );
  });
});

describe('the trip page’s request banner', () => {
  it('the reply, unless the guest asked something newer', () => {
    const at = (/** @type {number} */ h) => new Date(Date.UTC(2026, 11, 1, h)).toISOString();
    expect(requestNotice({})).toBeNull();
    expect(requestNotice({ openRequests: [{ message: 'Q', createdAt: at(9) }] })).toMatchObject({
      kind: 'sent',
      message: 'Q',
    });
    const reply = { message: 'Q', reply: 'A', repliedAt: at(10) };
    expect(requestNotice({ openRequests: [], lastReply: reply })).toMatchObject({
      kind: 'reply',
      reply: 'A',
    });
    // A new question after the reply: "sent".
    expect(
      requestNotice({ openRequests: [{ message: 'Q2', createdAt: at(11) }], lastReply: reply }),
    ).toMatchObject({ kind: 'sent', message: 'Q2' });
  });
});
