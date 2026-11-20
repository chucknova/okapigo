/**
 * Stage 16c-1: the bookings desk (designs: O8 Bookings, desktop, phone and "every status").
 *   - find a booking: filters (today · upcoming · owes · cash · cancelled · all) and search
 *     (reference, name, a phone as Nigerians write it), each row with its status chip
 *   - one booking's page: who, the chip and the banner that says what needs doing, the money
 *     as a ledger, travellers, messages sent and whether they arrived, the timeline, and which
 *     actions make sense now (and why not)
 *   - notes: on the timeline; "show on the guide's manifest" puts them there too
 *   - for the office only
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import {
  addNote,
  bookingIdFromGuestToken,
  deskBooking,
  deskStatus,
  markRefundFailed,
  markRefundProcessed,
  searchTerms,
} from '@okapigo/db';
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
  delete: (/** @type {string} */ url) =>
    request(ctx.app).delete(url).set('Authorization', `Bearer ${token}`),
});

async function setup() {
  const seeded = await ctx.seedOperator();
  const { operator } = seeded;
  const manager = as(await ctx.tokenFor(seeded.manager.id));
  const kemi = seeded.guides.find((/** @type {any} */ g) => g.name === 'Kemi Adeyemi');
  const asKemi = as(await ctx.tokenFor(kemi.id));
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
  /** A website booking, paid in full unless `pay` is false (then it's held); returns its id. */
  const book = async (
    /** @type {any} */ d,
    { name = 'Adaeze Okafor', phone = '0803 123 4567', pay = true } = {},
  ) => {
    const res = await request(ctx.app)
      .post(`/public/${operator.slug}/bookings`)
      .send({
        lead: {
          name,
          email: `${name.split(' ')[0].toLowerCase()}@guest.example`,
          phone,
          acceptTerms: true,
        },
        departureId: d.id,
        travellers: [{ name, age: 34 }],
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
  /** Moves a departure to start `fromNow` ms from now. */
  const moveTo = (/** @type {any} */ d, /** @type {number} */ fromNow) =>
    ctx.prisma.departure.update({
      where: { id: d.id },
      data: {
        startsAt: new Date(Date.now() + fromNow),
        endsAt: new Date(Date.now() + fromNow + 3 * HOUR),
      },
    });
  const page = async (/** @type {string} */ id) =>
    (await manager.get(`/api/desk/bookings/${id}`)).body.booking;
  const list = async (/** @type {string} */ query = '') =>
    (await manager.get(`/api/desk/bookings${query}`)).body.list;
  return { ...seeded, manager, kemi, asKemi, departureOf, book, moveTo, page, list };
}

describe('search words', () => {
  it('a phone as Nigerians write it matches the stored +234; a reference in any case', () => {
    expect(searchTerms(' 0805 987 ')).toEqual({
      text: '0805 987',
      reference: '0805 987',
      phone: '805987',
    });
    expect(searchTerms('+234 805').phone).toBe('805');
    expect(searchTerms('ilt-3mz').reference).toBe('ILT-3MZ');
    expect(searchTerms('Ada').phone).toBeNull();
    expect(searchTerms('08').phone).toBeNull();
  });

  it('the chip: the thing to do first', () => {
    const b = (/** @type {any} */ o) => ({
      status: 'paid',
      totalKobo: 100,
      amountPaidKobo: 100,
      refundDueKobo: 0,
      refunds: [],
      cashReports: [],
      ...o,
    });
    expect(deskStatus(b({}))).toMatchObject({ key: 'paid', text: 'Paid', tone: 'ok' });
    expect(deskStatus(b({ status: 'part_paid', amountPaidKobo: 40 }))).toMatchObject({
      key: 'owes',
      tone: 'warning',
    });
    // Cash waiting comes before what's owed (it may be what's owed).
    expect(
      deskStatus(
        b({ status: 'part_paid', amountPaidKobo: 40, cashReports: [{ status: 'reported' }] }),
      ),
    ).toMatchObject({ key: 'cash', text: 'Cash to confirm' });
    expect(deskStatus(b({ cashReports: [{ status: 'confirmed' }] })).key).toBe('paid');
    expect(deskStatus(b({ status: 'no_show' }))).toMatchObject({ key: 'no_show', tone: 'muted' });
    const failed = [{ status: 'failed', amountKobo: 50 }];
    const cancelled = (/** @type {any} */ o) => b({ status: 'cancelled', refundDueKobo: 50, ...o });
    // Owed back, never started: to send.
    expect(deskStatus(cancelled({}))).toMatchObject({
      key: 'refund_due',
      text: 'Refund to send',
      tone: 'urgent',
    });
    expect(deskStatus(cancelled({ refunds: failed }))).toMatchObject({
      key: 'refund_failed',
      tone: 'urgent',
    });
    // Tried again, and sending: no longer failed.
    expect(
      deskStatus(cancelled({ refunds: [...failed, { status: 'requested', amountKobo: 50 }] })).text,
    ).toBe('Cancelled · refund sending');
    // Part sent, the rest never started: still to send.
    expect(deskStatus(cancelled({ refunds: [{ status: 'processed', amountKobo: 20 }] })).key).toBe(
      'refund_due',
    );
    expect(deskStatus(cancelled({ refundDueKobo: 0, refunds: failed })).text).toBe('Cancelled');
    expect(
      deskStatus(
        b({
          status: 'refunded',
          refundDueKobo: 50,
          refunds: [{ status: 'processed', amountKobo: 50 }],
        }),
      ).text,
    ).toBe('Cancelled · refunded');
    expect(deskStatus(b({ status: 'no_show', refundDueKobo: 10 })).key).toBe('refund_due');
    expect(deskStatus(b({ status: 'held', hold: { expiresAt: new Date(0) } }))).toMatchObject({
      key: 'held',
      tone: 'held',
    });
  });
});

describe('finding a booking', () => {
  it('filters and search; each row says who, which trip, and its status', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const later = await s.departureOf('badagry-heritage-day-trip', 2);
    const today = await s.departureOf('lagos-street-food-crawl');
    const paid = await s.book(walk, { name: 'Adaeze Okafor' });
    const owes = await s.book(later, { name: 'Yemi Ojo', phone: '0813 902 4417' });
    await ctx.prisma.booking.update({
      where: { id: owes },
      data: { status: 'part_paid', amountPaidKobo: 1_950_000 },
    });
    const now = await s.book(today, { name: 'Funmi Adeyemi', phone: '0805 987 6543' });
    await s.moveTo(today, 2 * HOUR);
    const gone = await s.book(walk, { name: 'Bayo Adewale' });
    expect(
      (
        await s.manager
          .post(`/api/bookings/${gone}/cancel`)
          .send({ initiatedBy: 'guest', reason: 'Changed plans' })
      ).status,
    ).toBe(200);

    const ids = (/** @type {any} */ l) => l.rows.map((/** @type {any} */ r) => r.id);
    expect(ids(await s.list())).toEqual([now]); // today, by default
    expect(ids(await s.list('?filter=upcoming'))).toEqual([now, paid, owes]);
    expect(ids(await s.list('?filter=owes'))).toEqual([owes]);
    expect(ids(await s.list('?filter=cancelled'))).toEqual([gone]);
    expect(ids(await s.list('?filter=all'))).toHaveLength(4);
    expect(ids(await s.list('?filter=cash'))).toEqual([]);

    const row = (await s.list('?filter=owes')).rows[0];
    expect(row).toMatchObject({
      lead: 'Yemi Ojo',
      reference: expect.stringMatching(/^[A-Z]+-[A-Z0-9]{6}$/),
      tour: expect.stringMatching(/^Badagry Day Trip · \w{3} \d+ \w{3}$/),
      phone: '0813 902 4417',
      chip: { key: 'owes', text: 'Owes ₦45,500', tone: 'warning' },
    });

    // Search: a phone as written, part of a name, a reference in lower case.
    expect(ids(await s.list('?filter=all&q=0805%20987'))).toEqual([now]);
    expect(ids(await s.list('?filter=all&q=ojo'))).toEqual([owes]);
    // A name anywhere in the lead's name: "Funmi Ade-yemi" too.
    expect(ids(await s.list('?filter=all&q=yemi'))).toHaveLength(2);
    expect(ids(await s.list(`?filter=all&q=${row.reference.toLowerCase()}`))).toEqual([owes]);
    // Within the filter: a cancelled booking isn't "upcoming".
    expect(ids(await s.list('?filter=upcoming&q=bayo'))).toEqual([]);

    expect((await s.manager.get('/api/desk/bookings?filter=nonsense')).status).toBe(400);
  });

  it('for the office only', async () => {
    const s = await setup();
    expect((await s.asKemi.get('/api/desk/bookings')).status).toBe(403);
  });
});

describe('a booking’s page', () => {
  it('paid: the money as a ledger, travellers, messages, timeline; what can be done and why not', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk);
    const b = await s.page(id);
    expect(b).toMatchObject({
      lead: 'Adaeze Okafor',
      refLine: expect.stringMatching(/^[A-Z]+-[A-Z0-9]{6} · WEB · BOOKED \w{3} \d+ \w{3}$/),
      sub: expect.stringMatching(
        /^0803 123 4567 · adaeze@guest\.example · Lagos Island Heritage Walk · \w{3} \d+ \w{3}, \d\d:\d\d · 1 adult$/,
      ),
      chip: { key: 'paid', text: 'Paid' },
      banner: null,
    });
    expect(b.money[0]).toMatchObject({ label: '1 adult ₦25,000', value: '₦25,000' });
    expect(b.money[1]).toMatchObject({ value: '₦25,000 paid', tone: 'ok' });
    expect(b.money.at(-1)).toMatchObject({ label: 'Still owed', value: '₦0', total: true });
    expect(b.travellers).toEqual([
      expect.objectContaining({
        name: 'Adaeze Okafor',
        kind: 'Adult',
        state: { text: '', tone: 'muted' },
      }),
    ]);
    expect(b.timeline).toEqual([
      expect.stringMatching(/ · booked on the website$/),
      expect.stringMatching(/ · paid ₦25,000$/),
    ]);
    expect(b.actions).toMatchObject({
      paymentLink: { enabled: false, why: 'Nothing is owed' },
      addNote: { enabled: true },
      noShow: { enabled: false, why: expect.stringMatching(/^Trip is on \w{3} \d+ \w{3}$/) },
      cancel: { enabled: true },
      release: { enabled: false },
    });

    // On the day, after the start: a no-show can be marked; once checked in, not.
    await s.moveTo(walk, -HOUR);
    expect((await s.page(id)).actions.noShow).toEqual({ enabled: true, why: '' });
    await ctx.prisma.traveller.updateMany({
      where: { bookingId: id },
      data: { checkInStatus: 'present', checkedInAt: new Date(), checkedInById: s.kemi.id },
    });
    const there = await s.page(id);
    expect(there.actions.noShow.why).toBe('Everyone is checked in');
    expect(there.actions.changeTravellers.why).toBe('The trip has started');
    expect(there.travellers[0].state).toEqual({
      text: expect.stringMatching(/^Present \d\d:\d\d$/),
      tone: 'ok',
    });
    expect(there.checkedInBy).toBe('Checked in by Kemi');
  });

  it('held: seats held until when; only notes and releasing the seats', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk, { pay: false });
    const b = await s.page(id);
    expect(b.chip).toMatchObject({ key: 'held', expiresAt: expect.any(String) });
    expect(b.refLine).toMatch(/ · WEB · STARTED \d\d:\d\d$/);
    expect(b.banner).toMatchObject({
      kind: 'held',
      title: expect.stringMatching(/^Seats held until \d\d:\d\d$/),
      text: 'The guest is paying right now (on the website). If they don’t pay in time, the 1 seat is released by themselves and this booking leaves the list.',
    });
    expect(b.money.at(-1)).toMatchObject({ label: 'To pay at checkout', value: '₦25,000' });
    expect(b.actions).toMatchObject({
      paymentLink: { enabled: false, why: 'Not booked yet' },
      changeTravellers: { enabled: false, why: 'Not booked yet' },
      noShow: { enabled: false, why: 'Not booked yet' },
      cancel: { enabled: false, why: 'Nothing to cancel yet' },
      release: { enabled: true },
    });
    // Releasing: through the hold (15a's route); the booking is then cancelled.
    expect((await s.manager.delete(`/api/holds/${b.holdId}`)).status).toBe(204);
    const released = await s.page(id);
    expect(released.chip.text).toBe('Cancelled');
    expect(released.banner).toMatchObject({
      title: expect.stringMatching(/^Seats released( by .+)? on \w{3} \d+ \w{3}, \d\d:\d\d$/),
      text: 'Nothing had been paid.',
    });
    expect(released.timeline.at(-1)).toMatch(/ · seats released/);
  });

  it('owes, due today: the banner says so, and that the last reminder didn’t arrive', async () => {
    const s = await setup();
    const badagry = await s.departureOf('badagry-heritage-day-trip');
    const id = await s.book(badagry, { name: 'Yemi Ojo' });
    await ctx.prisma.booking.update({
      where: { id },
      data: { status: 'part_paid', amountPaidKobo: 1_950_000 },
    });
    await ctx.prisma.payment.updateMany({ where: { bookingId: id }, data: { purpose: 'deposit' } });
    await s.moveTo(badagry, 7 * DAY);
    await ctx.prisma.notification.create({
      data: {
        operatorId: s.operator.id,
        bookingId: id,
        audience: 'guest',
        kind: 'balance_reminder',
        key: 'balance_reminder:1:whatsapp',
        channel: 'whatsapp',
        data: { daysBefore: 1, error: 'number unreachable' },
        status: 'failed',
      },
    });
    const b = await s.page(id);
    expect(b.chip.text).toBe('Owes ₦45,500');
    expect(b.banner).toMatchObject({
      kind: 'owes',
      title: 'Balance of ₦45,500 is due today',
      call: '0803 123 4567',
    });
    expect(b.banner.text).toMatch(
      /^Deposit paid on \d+ \w{3}\. The last reminder didn’t arrive \(number unreachable\)\. Nothing is cancelled automatically/,
    );
    expect(b.messages.at(-1)).toMatchObject({
      what: 'Balance reminder (1 day)',
      text: 'WhatsApp · failed: number unreachable',
      tone: 'urgent',
    });
    expect(b.money.at(-1)).toMatchObject({
      label: expect.stringMatching(/^Still owed · due /),
      value: '₦45,500',
      tone: 'warning',
    });
    expect(b.actions.paymentLink.enabled).toBe(true);

    // Not due yet: no banner.
    await s.moveTo(badagry, 20 * DAY);
    expect((await s.page(id)).banner).toBeNull();
    // Overdue: "was due".
    const overdue = await deskBooking(ctx.prisma, {
      operatorId: s.operator.id,
      bookingId: id,
      now: new Date(Date.now() + 15 * DAY),
    });
    expect(overdue.banner.title).toMatch(/^Balance of ₦45,500 was due \w{3} \d+ \w{3}$/);
  });

  it('cash reported by a guide: to confirm, and not counted as paid yet', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk, { name: 'Funmi Adeyemi' });
    await ctx.prisma.booking.update({
      where: { id },
      data: { status: 'part_paid', amountPaidKobo: 500_000 },
    });
    await ctx.prisma.cashReport.create({
      data: {
        operatorId: s.operator.id,
        bookingId: id,
        reportedById: s.kemi.id,
        amountKobo: 2_000_000,
        reportedAt: new Date(),
      },
    });
    const b = await s.page(id);
    expect(b.chip).toMatchObject({ key: 'cash', text: 'Cash to confirm', tone: 'info' });
    expect(b.banner).toMatchObject({
      kind: 'cash',
      title: 'Cash reported by Kemi: ₦20,000',
      text: expect.stringMatching(
        /at check-in\. Not counted as paid until you confirm Kemi handed it in\.$/,
      ),
    });
    expect(b.money).toContainEqual(
      expect.objectContaining({
        label: expect.stringMatching(/^Cash · reported by Kemi · /),
        value: '₦20,000 pending',
        tone: 'info',
      }),
    );
    expect(b.money.at(-1).value).toBe('₦20,000');
    expect((await s.list('?filter=cash')).rows.map((/** @type {any} */ r) => r.id)).toEqual([id]);
  });

  it('cancelled and the refund failed: red, what failed, and what’s owed back', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk);
    await s.manager
      .post(`/api/bookings/${id}/cancel`)
      .send({ initiatedBy: 'operator', reason: 'Family emergency' });
    // Cancelled with money owed back: a refund to send.
    const due = await s.page(id);
    expect(due.chip).toMatchObject({ key: 'refund_due', text: 'Refund to send' });
    expect(due.banner).toMatchObject({ kind: 'refund_due', title: '₦25,000 to refund' });
    expect(due.money.at(-1)).toMatchObject({ label: 'Owed back to the guest', value: '₦25,000' });
    // Started, and the bank refused it.
    expect(
      (await s.manager.post(`/api/bookings/${id}/refunds`).send({ reason: 'Family emergency' }))
        .status,
    ).toBeLessThan(300);
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: id } });
    await markRefundFailed(ctx.prisma, refund.id, 'the card has expired');
    const b = await s.page(id);
    expect(b.chip).toMatchObject({ key: 'refund_failed', text: 'Refund failed', tone: 'urgent' });
    expect(b.banner).toMatchObject({
      kind: 'refund_failed',
      title: 'Refund of ₦25,000 failed',
      text: 'It couldn’t be sent back: the card has expired. The guest was told a refund is on its way, so please sort it soon.',
    });
    expect(b.money.at(-1)).toMatchObject({
      label: 'Owed back to the guest',
      value: '₦25,000',
      tone: 'urgent',
    });
    expect(b.travellers[0].state.text).toBe('Cancelled');
    expect(b.timeline).toContainEqual(expect.stringMatching(/ · cancelled by .+ · refund ₦25,000/));
    expect(b.actions).toMatchObject({
      cancel: { enabled: false, why: 'Already cancelled' },
      paymentLink: { enabled: false, why: 'Cancelled' },
      addNote: { enabled: true },
    });

    // Once the refund is sent: grey, "sent; it can take 5–10 working days".
    await s.manager.post(`/api/bookings/${id}/refunds`).send({ reason: 'Trying again' });
    const again = await ctx.prisma.refund.findFirstOrThrow({
      where: { bookingId: id, status: { not: 'failed' } },
    });
    expect((await s.page(id)).chip.text).toBe('Cancelled · refund sending');
    await markRefundProcessed(ctx.prisma, again.id);
    const later = await s.page(id);
    expect(later.chip.text).toBe('Cancelled · refunded');
    expect(later.banner.text).toBe(
      'Refund of ₦25,000 sent; it can take 5–10 working days to arrive.',
    );
    expect(later.money.at(-1)).toMatchObject({ label: 'Kept', value: '₦0' });
  });

  it('a WhatsApp message’s receipt: delivered, read', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk);
    const chat = await ctx.prisma.conversation.create({
      data: { operatorId: s.operator.id, channel: 'whatsapp', guestPhone: '+2348031234567' },
    });
    const m = await ctx.prisma.chatMessage.create({
      data: {
        operatorId: s.operator.id,
        conversationId: chat.id,
        direction: 'out',
        author: 'bot',
        body: { kind: 'text', text: 'Confirmed' },
        delivery: 'read',
      },
    });
    await ctx.prisma.notification.deleteMany({ where: { bookingId: id } });
    await ctx.prisma.notification.create({
      data: {
        operatorId: s.operator.id,
        bookingId: id,
        audience: 'guest',
        kind: 'booking_confirmed',
        key: 'booking_confirmed:whatsapp',
        channel: 'whatsapp',
        data: { chatMessageId: m.id },
        status: 'sent',
        sentAt: new Date(),
      },
    });
    expect((await s.page(id)).messages).toEqual([
      expect.objectContaining({
        what: 'Booking confirmation',
        text: 'WhatsApp · read',
        tone: 'ok',
      }),
    ]);
    await ctx.prisma.chatMessage.update({ where: { id: m.id }, data: { delivery: 'delivered' } });
    expect((await s.page(id)).messages[0].text).toBe('WhatsApp · delivered');
  });

  it('another business’s booking: not found', async () => {
    const s = await setup();
    const other = await setup();
    const walk = await other.departureOf('lagos-island-heritage-walk');
    const theirs = await other.book(walk);
    expect((await s.manager.get(`/api/desk/bookings/${theirs}`)).status).toBe(404);
  });
});

describe('notes', () => {
  it('on the timeline with who wrote it; on the guide’s manifest only if asked', async () => {
    const s = await setup();
    const walk = await s.departureOf('lagos-island-heritage-walk');
    const id = await s.book(walk, { name: 'Yemi Ojo' });
    const add = (/** @type {any} */ body) => s.manager.post(`/api/bookings/${id}/notes`).send(body);
    expect((await add({ text: 'Called about parking.' })).status).toBe(201);
    expect(
      (
        await add({
          text: 'Halal lunch for Yemi and Tobi. Confirmed with the kitchen.',
          onManifest: true,
        })
      ).status,
    ).toBe(201);
    expect((await add({ text: '   ' })).status).toBe(400);

    const timeline = (await s.page(id)).timeline;
    expect(timeline.slice(-2)).toEqual([
      expect.stringMatching(/ · note by \w+: “Called about parking\.”$/),
      expect.stringMatching(
        / · note by \w+: “Halal lunch for Yemi and Tobi\. Confirmed with the kitchen\.” · on the guide’s manifest$/,
      ),
    ]);
    const manifest = (await s.manager.get(`/api/departures/${walk.id}/manifest`)).body.manifest;
    expect(manifest.bookings.find((/** @type {any} */ b) => b.id === id).notes).toEqual([
      'Halal lunch for Yemi and Tobi. Confirmed with the kitchen.',
    ]);
    // The rule itself refuses an empty note, whoever calls it.
    await expect(
      addNote(ctx.prisma, {
        operatorId: s.operator.id,
        bookingId: id,
        userId: s.kemi.id,
        text: '  ',
      }),
    ).rejects.toMatchObject({ code: 'EMPTY_NOTE' });
    // Guides can't write them.
    expect((await s.asKemi.post(`/api/bookings/${id}/notes`).send({ text: 'x' })).status).toBe(403);
  });
});

describe('query strings are checked', () => {
  it('a week that isn’t a date: 400 (16b’s schedule too)', async () => {
    const s = await setup();
    expect((await s.manager.get('/api/schedule/week?start=soon')).status).toBe(400);
  });
});
