/**
 * Stage 14a: the guest messages (OPS-11), with your wording from design file 02.
 *   - decided ONCE, with what caused them: paid → confirmation; deposit → deposit received;
 *     cancelled → cancellation (with the policy's refund); refund left → refund sent; staff
 *     send a link → payment link; balance due → reminder. One row per channel.
 *   - sent into the guest's chat (the simulator), in the business's own wording if it has
 *     one; email waits for 14b
 *   - a WhatsApp booking's chat already has its ticket: no second confirmation there
 *   - the templates API: list, edit (checked), preview, reset; who may
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import {
  bookingIdFromGuestToken,
  markRefundProcessed,
  queueBalanceNotices,
  planGuestMessage,
} from '@okapigo/db';
import { addDays, localDate } from '@okapigo/shared/time';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';
import { sendGuestMessages } from '../src/messages/send.js';
import { createChannels } from '../src/whatsapp/channels.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
// Senders only look at THIS test's business: other test files run at the same time on the
// same database, and their messages are theirs to send.
/** @type {string | undefined} */
let scope;
afterEach(() => {
  scope = undefined;
});
const seedOperator = async () => {
  const seeded = await ctx.seedOperator();
  scope ??= seeded.operator.id;
  return seeded;
};
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const TZ = 'Africa/Lagos';
const today = () => localDate(new Date(), TZ);
const send = (now) =>
  sendGuestMessages({
    operatorId: scope,
    prisma: ctx.prisma,
    authSecret: TEST_AUTH_SECRET,
    webPublicUrl: 'http://localhost:4000',
    channels: createChannels(),
    ...(now && { now: () => now }),
  });

/** @param {string} token */
function as(token) {
  const withAuth =
    (/** @type {'get' | 'post' | 'put' | 'delete'} */ m) => (/** @type {string} */ url) =>
      request(ctx.app)[m](url).set('Authorization', `Bearer ${token}`);
  return {
    get: withAuth('get'),
    post: withAuth('post'),
    put: withAuth('put'),
    delete: withAuth('delete'),
  };
}

/**
 * A website booking (held), the way a guest makes one.
 * @param {string} slug @param {{ tour?: string, daysAhead?: number, lead?: object }} [o]
 */
async function book(slug, { tour = 'lagos-island-heritage-walk', daysAhead = 3, lead } = {}) {
  const deps = (
    await request(ctx.app).get(
      `/public/${slug}/tours/${tour}/departures?to=${addDays(today(), 40)}`,
    )
  ).body.departures;
  const departure = deps.find((/** @type {any} */ d) => d.localDate >= addDays(today(), daysAhead));
  const res = await request(ctx.app)
    .post(`/public/${slug}/bookings`)
    .send({
      lead: lead ?? {
        name: 'Adaeze Okafor',
        email: 'adaeze@guest.example',
        phone: '0803 123 4567',
        acceptTerms: true,
      },
      departureId: departure.id,
      travellers: [{ name: 'Adaeze Okafor', age: 34 }],
      addOns: [],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const token = res.body.token;
  return {
    token,
    bookingId: /** @type {string} */ (bookingIdFromGuestToken(TEST_AUTH_SECRET, token)),
  };
}

/** Pays (in full or the deposit) on the simulated checkout, as the guest does. */
async function pay(/** @type {string} */ token, option = 'full') {
  const res = await request(ctx.app).post(`/public/bookings/${token}/pay`).send({ option });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const { reference } = res.body.payment;
  await ctx.provider.complete(reference);
  await request(ctx.app).post(`/public/bookings/${token}/payments/${reference}/check`);
}

const outbox = (/** @type {string} */ bookingId) =>
  ctx.prisma.notification.findMany({
    where: { bookingId, audience: 'guest' },
    orderBy: [{ createdAt: 'asc' }, { key: 'asc' }],
  });

/** What the guest's chat (the simulator) received, as text. */
async function chat(/** @type {string} */ operatorId, phone = '+2348031234567') {
  const c = await ctx.prisma.conversation.findFirst({
    where: { operatorId, guestPhone: phone },
    include: { messages: { orderBy: { seq: 'asc' } } },
  });
  return (c?.messages ?? []).map((m) => /** @type {any} */ (m.body).text);
}

describe('paid in full: the confirmation (design file 02)', () => {
  it('decided with the payment, one row per channel; sent to the chat once, in your words', async () => {
    const { operator } = await seedOperator();
    const { token, bookingId } = await book(operator.slug);
    expect(await outbox(bookingId)).toEqual([]); // held: nothing yet

    await pay(token);
    expect((await outbox(bookingId)).map((n) => [n.key, n.channel, n.status])).toEqual([
      ['booking_confirmed:email', 'email', 'pending'],
      ['booking_confirmed:whatsapp', 'whatsapp', 'pending'],
    ]);

    expect(await send()).toMatchObject({ sent: 1, failed: 0 });
    expect(await send()).toMatchObject({ sent: 0 }); // never twice
    const [text] = await chat(operator.id);
    const booking = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(text).toMatch(
      new RegExp(
        [
          '^Hi Adaeze, your booking is confirmed!',
          '',
          'Lagos Island Heritage Walk',
          '\\w{3} \\d+ \\w{3}, 09:00',
          'Meet at Tinubu Square, .+',
          `1 traveller · Ref ${booking.reference}`,
          '',
          'Your ticket and map:',
          `http://localhost:4000/trip/${token}$`,
        ].join('\\n'),
      ),
    );
    // The email waits for its sender (14b).
    const email = (await outbox(bookingId)).find((n) => n.channel === 'email');
    expect(email?.status).toBe('pending');
  });

  it('two senders at once (two API processes) still send it once', async () => {
    const { operator } = await seedOperator();
    const { token } = await book(operator.slug);
    await pay(token);
    const runs = await Promise.all([send(), send(), send()]);
    expect(runs.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(await chat(operator.id)).toHaveLength(1);
  });

  it('a phone only: WhatsApp only; an email only: email only', async () => {
    const { operator } = await seedOperator();
    const a = await book(operator.slug, {
      lead: { name: 'Tunde Bakare', phone: '0802 555 0101', acceptTerms: true },
    });
    await pay(a.token);
    expect((await outbox(a.bookingId)).map((n) => n.channel)).toEqual(['whatsapp']);
    const b = await book(operator.slug, {
      lead: { name: 'Ngozi Eze', email: 'ngozi@guest.example', acceptTerms: true },
    });
    await pay(b.token);
    expect((await outbox(b.bookingId)).map((n) => n.channel)).toEqual(['email']);
  });

  it('a hold that runs out, or is given back, isn’t a booking: no message', async () => {
    const { operator } = await seedOperator();
    const { token, bookingId } = await book(operator.slug);
    await request(ctx.app).post(`/public/bookings/${token}/release`);
    expect(await outbox(bookingId)).toEqual([]);
  });
});

describe('a deposit (design: deposit received)', () => {
  it('the deposit paid, the balance, its due date and the pay link', async () => {
    const { operator } = await seedOperator();
    const { token, bookingId } = await book(operator.slug, {
      tour: 'badagry-heritage-day-trip',
      daysAhead: 15,
      lead: { name: 'Funmi Adeyemi', phone: '0805 987 6543', acceptTerms: true },
    });
    await pay(token, 'deposit');
    expect((await outbox(bookingId)).map((n) => n.key)).toEqual(['deposit_received:whatsapp']);
    await send();
    const [text] = await chat(operator.id, '+2348059876543');
    expect(text).toMatch(
      new RegExp(
        `^Hi Funmi, we got your deposit of ₦19,500 for the Badagry Heritage Day Trip on \\w{3} \\d+ \\w{3}\\. You’re booked!\\n\\nBalance: ₦45,500, due by \\w{3} \\d+ \\w{3}\\.\\nPay any time here:\\nhttp://localhost:4000/trip/${token}/pay$`,
      ),
    );
  });
});

describe('cancelled, then refunded (design: cancellation, refund sent)', () => {
  it('the policy’s refund in the cancellation; "refund sent" in Ìrìn’s own words', async () => {
    const { operator } = await seedOperator();
    const { token, bookingId } = await book(operator.slug, { daysAhead: 6 });
    await pay(token);
    await send();
    const res = await request(ctx.app)
      .post(`/public/bookings/${token}/cancel`)
      .send({ expectRefundKobo: 2_500_000 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await send();
    const booking = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect((await chat(operator.id)).at(-1)).toMatch(
      new RegExp(
        `^Hi Adaeze, your booking ${booking.reference} \\(Heritage Walk, \\w{3} \\d+ \\w{3}\\) is cancelled\\.\\n\\nRefund: ₦25,000 \\(100%, cancelled \\d+ days before\\)\\.\\nIt goes back to the card or account you paid with\\. We’ll message you when it’s sent\\.$`,
      ),
    );

    // The provider confirms the refund left.
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId } });
    await markRefundProcessed(ctx.prisma, refund.id);
    expect(
      (await outbox(bookingId)).filter((n) => n.kind === 'refund_sent').map((n) => n.key),
    ).toContain(`refund_sent:${refund.id}:whatsapp`);
    await send();
    expect((await chat(operator.id)).at(-1)).toBe(
      `Hi Adaeze, your refund of ₦25,000 for ${booking.reference} has been sent.\n\nIt may take 5–10 working days to show in your account, depending on your bank.\n\nWe hope to walk Lagos with you another time.`,
    );
  });

  it('no refund due: says so, with how close to the trip it was', async () => {
    const { refundLine } = await import('../src/messages/compose.js');
    expect(refundLine({ refundKobo: 0, refundBasisPoints: 0, hoursBefore: 10 }, 2_500_000)).toBe(
      'No refund is due under the booking terms (cancelled 10 hours before).',
    );
    expect(refundLine(null, 0)).toBe('Nothing was paid, so there’s nothing to refund.');
    expect(
      refundLine({ refundKobo: 1_000_000, overridden: true, hoursBefore: 5 }, 2_500_000),
    ).toMatch(/^Refund: ₦10,000\.\n/);
  });
});

describe('staff send a payment link (design: payment link)', () => {
  it('the amount, what it’s for, until when, the link; the outbox forgets the link once sent', async () => {
    const { operator, manager } = await seedOperator();
    const { token, bookingId } = await book(operator.slug, {
      tour: 'badagry-heritage-day-trip',
      daysAhead: 15,
      lead: { name: 'Funmi Adeyemi', phone: '0805 987 6543', acceptTerms: true },
    });
    await pay(token, 'deposit');
    await send();
    const staff = as(await ctx.tokenFor(manager.id));
    const made = await staff.post(`/api/bookings/${bookingId}/payment-links`).send({});
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    await send();
    expect((await chat(operator.id, '+2348059876543')).at(-1)).toMatch(
      new RegExp(
        `^Hi Funmi, here’s your payment link from Ìrìn Lagos Tours\\.\\n\\nBalance for Badagry Heritage Day Trip, \\w{3} \\d+ \\w{3}\\n₦45,500\\nValid until \\w{3} \\d+ \\w{3}\\n\\n${made.body.url.replace(/[.]/g, '\\.')}$`,
      ),
    );
    const row = (await outbox(bookingId)).find((n) => n.kind === 'payment_link');
    expect(row?.status).toBe('sent');
    expect(/** @type {any} */ (row ?? {}).data?.url).toBeUndefined();

    // "send": false: just make the link, tell nobody.
    await staff.post(`/api/bookings/${bookingId}/payment-links`).send({ send: false });
    expect((await outbox(bookingId)).filter((n) => n.kind === 'payment_link')).toHaveLength(1);
  });
});

describe('balance reminders (stage 11d’s outbox, now sent)', () => {
  it('7 days before the due date: the amount, the due date, the pay link', async () => {
    const { operator, manager } = await seedOperator();
    const staff = as(await ctx.tokenFor(manager.id));
    const walk = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug: 'lagos-island-heritage-walk' },
    });
    const departure = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: walk.id, startsAt: { gt: new Date(Date.now() + 20 * 86_400_000) } },
      orderBy: { startsAt: 'asc' },
    });
    const created = await staff.post('/api/bookings').send({
      departureId: departure.id,
      lead: { name: 'Kunle Ade', phone: '0803 555 0101', acceptTerms: true },
      travellers: [{ name: 'Kunle Ade', age: 45 }],
    });
    const id = created.body.booking.id;
    await staff.post(`/api/bookings/${id}/confirm`).send({}); // pay later
    const due = addDays(localDate(departure.startsAt, TZ), -7);
    const morning = new Date(`${addDays(due, -7)}T08:00:00Z`);
    await queueBalanceNotices(ctx.prisma, { now: morning, operatorId: operator.id });
    await send(); // written for that morning, sent now (it's fresh)
    expect((await chat(operator.id, '+2348035550101')).at(-1)).toMatch(
      /^Hi Kunle, a reminder: ₦25,000 is due by \w{3} \d+ \w{3} for your Heritage Walk on \w{3} \d+ \w{3} \([A-Z]+-[A-Z0-9]+\)\.\n\nPay here:\nhttp:\/\/localhost:4000\/trip\/[\w-]{44}\/pay\n\nCan’t make it\? Just reply and we’ll help\.$/,
    );
  });
});

describe('WhatsApp bookings', () => {
  it('the chat already has the ticket: no second confirmation there; the email receipt goes', async () => {
    // Which channels is a decision on the booking alone: checked with a stand-in for the
    // database (the real one is used everywhere else in this file).
    const booking = {
      id: crypto.randomUUID(),
      operatorId: crypto.randomUUID(),
      channel: 'whatsapp',
      leadPhone: '+2348031234567',
      leadEmail: 'a@guest.example',
    };
    /** @type {any[]} */
    const rows = [];
    const tx = /** @type {any} */ ({
      notification: {
        createMany: async (/** @type {any} */ { data }) => (
          rows.push(...data),
          { count: data.length }
        ),
      },
    });
    await planGuestMessage(tx, { booking, kind: 'booking_confirmed', key: 'booking_confirmed' });
    await planGuestMessage(tx, { booking, kind: 'deposit_received', key: 'deposit_received' });
    await planGuestMessage(tx, { booking, kind: 'booking_cancelled', key: 'booking_cancelled' });
    expect(rows.map((r) => r.key)).toEqual([
      'booking_confirmed:email',
      'deposit_received:email',
      'booking_cancelled:whatsapp',
      'booking_cancelled:email',
    ]);
  });
});

describe('sending: what can go wrong', () => {
  it('a message nobody could send for 3 days is dropped, not sent late', async () => {
    const { operator } = await seedOperator();
    const { token, bookingId } = await book(operator.slug);
    await pay(token);
    const later = new Date(Date.now() + 4 * 86_400_000);
    expect(await send(later)).toMatchObject({ sent: 0, stale: 2 });
    expect((await outbox(bookingId)).map((n) => n.status)).toEqual(['cancelled', 'cancelled']);
  });

  it('the guest’s chat is on WhatsApp, but this server isn’t connected to it: failed, with why', async () => {
    const { operator } = await seedOperator();
    // The guest chatted on real WhatsApp long ago; this server has no WhatsApp connection.
    // (Connected, it would go as the approved template: whatsapp-templates.test.js.)
    const c = await ctx.prisma.conversation.create({
      data: { operatorId: operator.id, channel: 'whatsapp', guestPhone: '+2348031234567' },
    });
    await ctx.prisma.chatMessage.create({
      data: {
        operatorId: operator.id,
        conversationId: c.id,
        direction: 'in',
        author: 'guest',
        body: { kind: 'text', text: 'Hi' },
        createdAt: new Date(Date.now() - 3 * 86_400_000),
      },
    });
    const { token, bookingId } = await book(operator.slug);
    await pay(token);
    expect(await send()).toMatchObject({ sent: 0, failed: 1 });
    const row = (await outbox(bookingId)).find((n) => n.channel === 'whatsapp');
    expect(row).toMatchObject({ status: 'failed', sentAt: null });
    expect(/** @type {any} */ (row ?? {}).data?.error).toMatch(/^NO_CHANNEL/);
  });
});

describe('the templates (staff API)', () => {
  it('lists all six with the default and the business’s own; an edit is used; reset goes back', async () => {
    const { operator, owner } = await seedOperator();
    const staff = as(await ctx.tokenFor(owner.id));
    const list = (await staff.get('/api/message-templates')).body.templates;
    expect(list.map((/** @type {any} */ t) => t.kind)).toHaveLength(6);
    expect(list.find((/** @type {any} */ t) => t.kind === 'refund_sent').custom.body).toContain(
      'walk Lagos',
    );
    const confirmed = list.find((/** @type {any} */ t) => t.kind === 'booking_confirmed');
    expect(confirmed.custom).toBeNull();
    expect(
      confirmed.placeholders.find((/** @type {any} */ p) => p.name === 'trip_url'),
    ).toMatchObject({
      required: true,
    });

    const body = 'Ẹ káàbọ̀ {first_name}! {tour}, {date} at {time}. Ref {reference}.\n{trip_url}';
    const put = await staff.put('/api/message-templates/booking_confirmed').send({
      subject: 'See you on {date}!',
      body,
    });
    expect(put.status).toBe(200);
    const { token } = await book(operator.slug);
    await pay(token);
    await send();
    expect((await chat(operator.id))[0]).toMatch(/^Ẹ káàbọ̀ Adaeze! Lagos Island Heritage Walk, /);

    expect((await staff.delete('/api/message-templates/booking_confirmed')).status).toBe(204);
    const after = (await staff.get('/api/message-templates')).body.templates;
    expect(after.find((/** @type {any} */ t) => t.kind === 'booking_confirmed').custom).toBeNull();
  });

  it('refuses an edit that would drop the link or use the wrong placeholder; preview shows the words', async () => {
    const { owner } = await seedOperator();
    const staff = as(await ctx.tokenFor(owner.id));
    const bad = await staff
      .put('/api/message-templates/balance_reminder')
      .send({ subject: 'Reminder', body: 'Hi {first_name}, {balance} by {due_date}. {refund}' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('TEMPLATE_INVALID');
    expect(bad.body.error.problems).toEqual([
      '{refund} can’t be used in this message.',
      'The message must include {pay_url}.',
    ]);

    const preview = await staff
      .post('/api/message-templates/balance_reminder/preview')
      .send({ body: 'Hi {first_name}: {balance} by {due_date}. {pay_url}' });
    expect(preview.body).toEqual({
      preview: {
        subject: 'Reminder: ₦45,500 due by Sat 28 Nov',
        body: 'Hi Adaeze: ₦45,500 by Sat 28 Nov. https://okapigo.example/trip/…/pay',
      },
      problems: [],
    });
    expect(
      (await staff.put('/api/message-templates/nonsense').send({ subject: 'a', body: 'b' })).status,
    ).toBe(404); // an unknown message: an address that doesn’t exist;
  });

  it('the owner edits; a manager and a guide can’t (settings)', async () => {
    const { manager, guides } = await seedOperator();
    for (const user of [manager, guides[0]]) {
      const staff = as(await ctx.tokenFor(user.id));
      expect((await staff.get('/api/message-templates')).status).toBe(403);
    }
  });
});
