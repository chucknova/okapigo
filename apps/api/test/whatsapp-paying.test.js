/**
 * Session 13b: paying on WhatsApp, and what the assistant says on its own.
 *   - "Pay" sends the website's own /pay link: the whole price, or (on a deposit tour, far
 *     enough away) a choice of full or deposit
 *   - once the money settles, the ticket arrives in the chat: the booking, the QR image, the
 *     trip link (decided 2026-11-18), once
 *   - out of time: "Your 30 minutes are up", and "Hold them again" holds the same seats
 *   - "menu" after a link was sent keeps the seats (the bot promised "held until…")
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { guestToken, releaseHold } from '@okapigo/db';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';
import { chatHelpers } from './whatsapp-chat.js';
import { fitsWhatsApp } from '../src/whatsapp/messages.js';
import { sendChatNotices } from '../src/whatsapp/notices.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
const { guest, options, words } = chatHelpers(ctx);

describe('paying, the ticket, and running out of time', () => {
  /** @param {string} slug @param {string} tour @param {(rows: any[]) => any} pickDate */
  async function toSummaryOf(slug, tour, pickDate) {
    const g = guest(slug);
    await g.say('Hi');
    await g.tap('tours');
    const dates = await g.tap(`tour:${tour}`);
    const row = pickDate(options(dates).filter((r) => r.id.startsWith('dep:')));
    await g.tap(row.id);
    let replies = await g.tap('n:2');
    // Any more categories ("Any children…?"): none. Extras: no thanks. Pickup: the first.
    for (let i = 0; i < 12; i++) {
      const last = replies.at(-1);
      if (last.text === 'What name should the booking be under?') break;
      if (last.kind === 'list') replies = await g.tap(last.rows[0].id);
      else replies = await g.tap('n:0');
    }
    await g.say('Adaeze Okafor');
    const summary = await g.tap('skip');
    return { g, summary };
  }
  const linkIn = (/** @type {any[]} */ replies) =>
    words(replies).match(/https?:\/\/\S+\/pay\/([\w-]+)/)?.[1] ?? null;

  it('no deposit on this tour: Pay sends a link for the whole price, the hold time with it', async () => {
    const { operator } = await ctx.seedOperator();
    const { g } = await toSummaryOf(operator.slug, 'lagos-island-heritage-walk', (r) => r[0]);
    const replies = await g.tap('pay');
    expect(words(replies)).toMatch(/^Pay ₦[\d,]+ here: http/);
    expect(words(replies)).toMatch(/held until \d\d:\d\d/);
    const token = linkIn(replies);
    expect(token).toBeTruthy();

    // The link is the website's own /pay page, for the full price.
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    const res = await request(ctx.app).get(`/public/payment-links/${token}`);
    expect(res.status).toBe(200);
    const link = await ctx.prisma.paymentLink.findFirstOrThrow({
      where: { bookingId: booking.id },
    });
    expect(link).toMatchObject({ purpose: 'full', amountKobo: booking.totalKobo });

    // Tapping Pay again just sends a fresh link (the old one stays valid too).
    expect(linkIn(await g.say('pay'))).toBeTruthy();
  });

  it('a deposit tour, far enough away: full or deposit? then the deposit link', async () => {
    const { operator } = await ctx.seedOperator();
    const { g } = await toSummaryOf(operator.slug, 'badagry-heritage-day-trip', (r) => r.at(-1));
    const choice = await g.tap('pay');
    expect(words(choice)).toMatch(
      /^Pay it all now, or pay a deposit now and the rest by \w{3} \d+ \w{3}\?$/,
    );
    expect(options(choice).map((b) => b.id)).toEqual(['pay_full', 'pay_deposit', 'cancel']);

    expect(words(await g.say('maybe'))).toContain("Sorry, I didn't get that");
    const replies = await g.tap('pay_deposit');
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    const link = await ctx.prisma.paymentLink.findFirstOrThrow({
      where: { bookingId: booking.id },
    });
    expect(link.purpose).toBe('deposit');
    expect(link.amountKobo).toBe(Math.round((booking.totalKobo * 0.3) / 100) * 100); // 30%, whole naira
    expect(linkIn(replies)).toBeTruthy();
  });

  /** One pass of the dispatcher, as the API runs it every few seconds. */
  const notices = () =>
    sendChatNotices({
      prisma: ctx.prisma,
      authSecret: TEST_AUTH_SECRET,
      apiPublicUrl: 'http://localhost:4000',
      webPublicUrl: 'http://localhost:4000',
      channels: { simulator: { send: async () => {} } },
    });
  /** The guest pays the link on the simulator's checkout; the link page's check settles it. */
  async function payLink(/** @type {string} */ token) {
    const started = await request(ctx.app).post(`/public/payment-links/${token}/pay`);
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const payment = await ctx.prisma.payment.findFirstOrThrow({
      where: { paymentLink: { tokenHash: { not: '' } } },
      orderBy: { createdAt: 'desc' },
    });
    await request(ctx.app).post(`/simulator/checkout/${payment.reference}/pay`);
    await request(ctx.app).post(`/public/payment-links/${token}/check`);
  }
  /** Everything the bot said, from the guest's side of the chat. */
  async function chat(/** @type {any} */ g) {
    const res = await request(ctx.app).get(
      `/simulator/whatsapp/conversations/${g.token()}/messages`,
    );
    return /** @type {any[]} */ (res.body.messages);
  }

  it('paid: the ticket arrives in the chat (booking, QR image, trip link), once', async () => {
    const { operator } = await ctx.seedOperator();
    const { g } = await toSummaryOf(operator.slug, 'lagos-island-heritage-walk', (r) => r[0]);
    const token = linkIn(await g.tap('pay'));
    expect(await notices()).toEqual({ tickets: 0, holdsOver: 0 }); // not paid yet: nothing

    await payLink(/** @type {string} */ (token));
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    expect(booking.status).toBe('paid');
    expect(await notices()).toEqual({ tickets: 1, holdsOver: 0 });
    expect(await notices()).toEqual({ tickets: 0, holdsOver: 0 }); // never twice

    const sent = (await chat(g)).slice(-3).map((m) => m.body);
    for (const m of sent) expect(fitsWhatsApp(m), JSON.stringify(m)).toBe(true);
    expect(sent[0].text).toMatch(new RegExp(`^✓ Booking confirmed · ${booking.reference}\n`));
    expect(sent[0].text).toContain('*Lagos Island Heritage Walk*');
    expect(sent[0].text).toContain('2 travellers');
    expect(sent[0].text).toContain(`Paid ${'₦'}`);
    expect(sent[1]).toMatchObject({ kind: 'image', caption: expect.stringContaining('check-in') });
    expect(sent[2].text).toMatch(/^Your trip page .*: http:\/\/localhost:4000\/trip\/[\w-]{44}\n/);

    // The image is a real PNG of the ticket's QR, behind the guest's own token.
    const png = await request(ctx.app)
      .get(new URL(sent[1].url).pathname)
      .buffer(true)
      .parse((res, done) => {
        /** @type {Buffer[]} */ const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.body.subarray(1, 4).toString()).toBe('PNG');
  });

  it('"menu" after the link was sent keeps the seats held: the link still works, the ticket follows', async () => {
    const { operator } = await ctx.seedOperator();
    const { g } = await toSummaryOf(operator.slug, 'lagos-island-heritage-walk', (r) => r[0]);
    const token = linkIn(await g.tap('pay'));
    expect(words(await g.say('menu'))).toContain('booking assistant');
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    expect(booking.status).toBe('held'); // "held until 14:35" was a promise

    await payLink(/** @type {string} */ (token));
    expect(await notices()).toEqual({ tickets: 1, holdsOver: 0 });
  });

  it('"menu" BEFORE any link gives the seats back, as in 13a', async () => {
    const { operator } = await ctx.seedOperator();
    const { g } = await toSummaryOf(operator.slug, 'lagos-island-heritage-walk', (r) => r[0]);
    await g.say('menu');
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    expect(booking.status).toBe('cancelled');
  });

  it('no ticket image for a booking that isn’t paid', async () => {
    const { operator } = await ctx.seedOperator();
    await toSummaryOf(operator.slug, 'lagos-island-heritage-walk', (r) => r[0]);
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    const res = await request(ctx.app).get(
      `/public/bookings/${guestToken(TEST_AUTH_SECRET, booking.id)}/ticket.png`,
    );
    expect(res.status).toBe(404);
  });

  it('out of time: "Your 30 minutes are up", once; "Hold them again" holds the same seats', async () => {
    const { operator } = await ctx.seedOperator();
    const { g } = await toSummaryOf(operator.slug, 'lagos-island-heritage-walk', (r) => r[0]);
    const first = await ctx.prisma.booking.findFirstOrThrow({ where: { operatorId: operator.id } });
    const hold = await ctx.prisma.hold.findUniqueOrThrow({ where: { id: first.holdId } });
    // What the expiry job does, 30 minutes later.
    await releaseHold(ctx.prisma, first.holdId, {
      reason: 'expired',
      now: new Date(hold.expiresAt.getTime() + 1000),
    });

    expect(await notices()).toEqual({ tickets: 0, holdsOver: 1 });
    expect(await notices()).toEqual({ tickets: 0, holdsOver: 0 });
    const last = (await chat(g)).at(-1).body;
    expect(last.text).toContain('Your 30 minutes are up');
    expect(last.buttons.map((/** @type {any} */ b) => b.id)).toEqual(['hold_again', 'tours']);

    const again = await g.tap('hold_again');
    expect(words(again)).toContain("I'm holding your seats for 30 minutes.");
    const second = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id, status: 'held' },
    });
    expect(second.id).not.toBe(first.id);
    expect(second.departureId).toBe(first.departureId);
    expect(second.totalKobo).toBe(first.totalKobo);
  });

  it('two dispatchers at once (two API processes) still send the ticket once', async () => {
    const { operator } = await ctx.seedOperator();
    const { g } = await toSummaryOf(operator.slug, 'lagos-island-heritage-walk', (r) => r[0]);
    await payLink(/** @type {string} */ (linkIn(await g.tap('pay'))));
    const passes = await Promise.all([notices(), notices(), notices()]);
    expect(passes.reduce((n, p) => n + p.tickets, 0)).toBe(1);
    const tickets = (await chat(g)).filter((m) => /^✓ Booking confirmed/.test(m.body.text ?? ''));
    expect(tickets).toHaveLength(1);
  });

  it('a hold that runs out after the guest moved on gets no "30 minutes" message', async () => {
    const { operator } = await ctx.seedOperator();
    const { g } = await toSummaryOf(operator.slug, 'lagos-island-heritage-walk', (r) => r[0]);
    await g.tap('pay'); // a link: "menu" now keeps the seats…
    await g.say('menu'); // …but the chat has moved on
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    const hold = await ctx.prisma.hold.findUniqueOrThrow({ where: { id: booking.holdId } });
    await releaseHold(ctx.prisma, booking.holdId, {
      reason: 'expired',
      now: new Date(hold.expiresAt.getTime() + 1000),
    });
    expect(await notices()).toEqual({ tickets: 0, holdsOver: 0 });
    expect((await chat(g)).at(-1).body.text).toContain('booking assistant'); // nothing new
    // Recorded as "nobody to tell", so it isn't looked at again.
    const notice = await ctx.prisma.notification.findFirstOrThrow({
      where: { bookingId: booking.id },
    });
    expect(notice).toMatchObject({ kind: 'chat_hold_over', status: 'cancelled', sentAt: null });
  });

  it('a hold the guest gave back themselves gets no "30 minutes" message', async () => {
    const { operator } = await ctx.seedOperator();
    const { g } = await toSummaryOf(operator.slug, 'lagos-island-heritage-walk', (r) => r[0]);
    await g.tap('cancel');
    expect(await notices()).toEqual({ tickets: 0, holdsOver: 0 });
  });

  it('the 30 minutes ran out: no link, the seats are gone, start again', async () => {
    const { operator } = await ctx.seedOperator();
    const { g } = await toSummaryOf(operator.slug, 'lagos-island-heritage-walk', (r) => r[0]);
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    await ctx.prisma.hold.update({
      where: { id: booking.holdId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const replies = await g.tap('pay');
    expect(words(replies)).toContain('the 30 minutes to pay are up');
    expect(await ctx.prisma.paymentLink.count({ where: { bookingId: booking.id } })).toBe(0);
  });
});
