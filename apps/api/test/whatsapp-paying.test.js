/**
 * Sessions 13b–13c: paying on WhatsApp, and what the assistant says on its own (designs:
 * happy path 7–9, branches).
 *   - "Pay" sends the website's own /pay link, for the whole price; on a deposit tour far enough
 *     away the summary offers "Pay in full" or "Pay 30%"
 *   - paid: "✓ Booking confirmed", the ticket image, the trip link, "Tell us about allergies…",
 *     once; after that, anything typed goes to the team
 *   - a failed payment: "Your payment didn't go through…" [Try again] → a new link, the old one
 *     stops working
 *   - out of time: "Your 30 minutes are up…" [Hold them again] → held again, with a fresh link
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { guestToken, releaseHold } from '@okapigo/db';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';
import { chatHelpers } from './whatsapp-chat.js';
import { fitsWhatsApp } from '../src/whatsapp/messages.js';
import { sendChatNotices } from '../src/whatsapp/notices.js';

const ctx = createTestContext();
// Each test is a whole scripted chat (10+ messages, each a booking-engine turn): more time
// than the usual 20 s, for full runs on a busy machine. A stuck test still fails, later.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
const { guest, options, words, toSummary } = chatHelpers(ctx);

/** The /pay/<token> in the bot's replies. @param {any[]} replies */
const linkIn = (replies) => words(replies).match(/https?:\/\/\S+\/pay\/([\w-]+)/)?.[1] ?? null;

/** One pass of the dispatcher, as the API runs it every few seconds. */
const notices = () =>
  sendChatNotices({
    prisma: ctx.prisma,
    authSecret: TEST_AUTH_SECRET,
    apiPublicUrl: 'http://localhost:4000',
    webPublicUrl: 'http://localhost:4000',
    channels: { simulator: { send: async () => [] } },
  });
const NONE = { tickets: 0, holdsOver: 0, declined: 0 };

/** The guest opens the link and pays (or is declined) on the simulator's checkout. */
async function onCheckout(/** @type {string} */ token, outcome = 'pay') {
  const started = await request(ctx.app).post(`/public/payment-links/${token}/pay`);
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const payment = await ctx.prisma.payment.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  await request(ctx.app).post(`/simulator/checkout/${payment.reference}/${outcome}`);
  // The link page checks with the provider when the guest comes back.
  await request(ctx.app).post(`/public/payment-links/${token}/check`);
  return payment;
}

/** Makes the hold run out, as the expiry job does 30 minutes later. @param {string} operatorId */
async function expire(operatorId) {
  const b = await ctx.prisma.booking.findFirstOrThrow({
    where: { operatorId, status: 'held' },
    include: { hold: true },
  });
  await releaseHold(ctx.prisma, b.holdId, {
    reason: 'expired',
    now: new Date(b.hold.expiresAt.getTime() + 1000),
  });
  return b;
}

describe('Pay: the link', () => {
  it('no deposit on this tour: the whole price, with a preview and the hold time', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    const replies = await g.tap('pay');
    expect(replies).toHaveLength(1);
    const token = /** @type {string} */ (linkIn(replies));
    expect(replies[0].text).toMatch(
      new RegExp(
        `^Here’s your secure payment link\\. Pay by card or bank transfer\\.\\nhttp://localhost:4000/pay/${token}\\n\\nThe link works while your seats are held, until \\d\\d:\\d\\d\\. I’ll message you here as soon as the payment arrives\\.$`,
      ),
    );
    expect(replies[0].link).toMatchObject({
      url: `http://localhost:4000/pay/${token}`,
      title: 'Pay ₦50,000 · Ìrìn Lagos Tours',
      description: expect.stringMatching(/^Heritage Walk · \w{3} \d+ \w{3}$/),
    });
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    const link = await ctx.prisma.paymentLink.findFirstOrThrow({
      where: { bookingId: booking.id },
    });
    expect(link).toMatchObject({ purpose: 'full', amountKobo: 5_000_000 });
    expect((await request(ctx.app).get(`/public/payment-links/${token}`)).status).toBe(200);
  });

  it('a deposit tour far enough away: the summary offers both; the deposit link says when the rest is due', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    const summary = await toSummary(g, {
      tour: 'badagry-heritage-day-trip',
      adults: 1,
      pickDate: (rows) => rows.at(-1),
    });
    expect(words(summary)).toMatch(
      /\n\nPay in full now, or pay a 30% deposit now and the rest \(₦45,500\) by \w{3} \d+ \w{3}\. Deposits are non-refundable\.\n\n/,
    );
    expect(options(summary).map((/** @type {any} */ b) => b.title)).toEqual([
      'Pay in full ₦65,000',
      'Pay 30% · ₦19,500',
      'Change something',
    ]);
    const replies = await g.tap('pay_deposit');
    expect(words(replies)).toMatch(
      /^Here’s your link for the ₦19,500 deposit\. I’ll remind you about the balance before \w{3} \d+ \w{3}\.\nhttp/,
    );
    const link = await ctx.prisma.paymentLink.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(link).toMatchObject({ purpose: 'deposit', amountKobo: 1_950_000 });
  });

  it('out of time before tapping Pay: no link; hold again, another date, or cancel', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    const b = await expire(operator.id);
    const replies = await g.tap('pay');
    expect(words(replies)).toBe('Sorry, the 30 minutes to pay are up, so the seats were released.');
    expect(options(replies).map((/** @type {any} */ x) => x.id)).toEqual([
      'hold_again',
      'other_date',
      'cancel',
    ]);
    expect(await ctx.prisma.paymentLink.count({ where: { bookingId: b.id } })).toBe(0);
  });
});

describe('the clock, not just the expiry job', () => {
  it('Pay after 30 minutes, before the expiry job ran: still no link', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    const b = await ctx.prisma.booking.findFirstOrThrow({ where: { operatorId: operator.id } });
    await ctx.prisma.hold.update({
      where: { id: b.holdId },
      data: { expiresAt: new Date(Date.now() - 1000) }, // still "active": the job is late
    });
    // No promise of seats that are no longer held.
    expect(words(await g.tap('person'))).not.toMatch(/seats stay held/);
    expect(words(await g.tap('pay'))).toBe(
      'Sorry, the 30 minutes to pay are up, so the seats were released.',
    );
  });

  it('"Yes, stop" after a link was sent: the link stops working', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    const token = /** @type {string} */ (linkIn(await g.tap('pay')));
    await g.say('cancel');
    await g.tap('stop');
    expect((await request(ctx.app).post(`/public/payment-links/${token}/pay`)).status).toBe(409);
    const link = await ctx.prisma.paymentLink.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(link.status).toBe('cancelled'); // stopped on purpose, not just unpayable
  });
});

describe('paid: the ticket (design: happy path 9)', () => {
  it('confirmed, the ticket image, the trip link, "Tell us about allergies"; once', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, {
      tour: 'lagos-street-food-crawl',
      extras: [['Palm wine sampler', 1]],
    });
    const token = /** @type {string} */ (linkIn(await g.tap('pay')));
    expect(await notices()).toEqual(NONE); // not paid yet: nothing

    await onCheckout(token);
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    expect(booking.status).toBe('paid');
    expect(await notices()).toEqual({ ...NONE, tickets: 1 });
    expect(await notices()).toEqual(NONE); // never twice

    const sent = (await g.chat()).slice(-4).map((m) => m.body);
    for (const m of sent) expect(fitsWhatsApp(m), JSON.stringify(m)).toBe(true);
    expect(sent[0].text.split('\n')).toEqual([
      '*✓ Booking confirmed*',
      `Booking ${booking.reference}`,
      'Lagos Street Food Crawl',
      expect.stringMatching(/^\w{3} \d+ \w{3} · 18:30$/),
      'Meet at Yaba Tech main gate',
      '2 adults · 1 palm wine sampler',
      'Paid ₦74,000',
    ]);
    expect(sent[1]).toMatchObject({
      kind: 'image',
      caption: 'Your ticket. Show it to the guide at the start.',
    });
    expect(sent[2].text).toMatch(
      /^Your trip page has the map, what to bring and this ticket:\nhttp:\/\/localhost:4000\/trip\/[\w-]{44}$/,
    );
    expect(sent[2].link).toMatchObject({
      title: 'Your trip · Lagos Street Food Crawl',
      description: expect.stringMatching(/ · 18:30 · Yaba Tech main gate$/),
    });
    expect(sent[3].text).toBe('Tell us about allergies any time by replying here. Enjoy the trip!');
    expect(sent[3].buttons.map((/** @type {any} */ b) => b.title)).toEqual([
      'Book another tour',
      'Talk to a person',
    ]);

    // The image is a real PNG, behind the guest's own token.
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

    // After paying, anything typed goes to the team (decided 2026-11-19).
    expect(words(await g.say('We are vegetarian, please'))).toBe(
      'Thanks, I’ve passed that on to the Ìrìn team. They’ll reply here.',
    );
    const c = await ctx.prisma.conversation.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    expect(c.needsPersonSince).not.toBeNull();
  });

  it('a deposit paid: "Deposit paid … · balance … due by …"', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'badagry-heritage-day-trip', adults: 1, pickDate: (r) => r.at(-1) });
    await onCheckout(/** @type {string} */ (linkIn(await g.tap('pay_deposit'))));
    expect(await notices()).toEqual({ ...NONE, tickets: 1 });
    const confirmed = (await g.chat()).at(-4).body.text;
    expect(confirmed).toMatch(/\nDeposit paid ₦19,500 · balance ₦45,500 due by \w{3} \d+ \w{3}$/);
  });

  it('two dispatchers at once (two API processes) still send the ticket once', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    await onCheckout(/** @type {string} */ (linkIn(await g.tap('pay'))));
    const passes = await Promise.all([notices(), notices(), notices()]);
    expect(passes.reduce((n, p) => n + p.tickets, 0)).toBe(1);
    const tickets = (await g.chat()).filter((m) =>
      /^\*✓ Booking confirmed\*/.test(m.body.text ?? ''),
    );
    expect(tickets).toHaveLength(1);
  });

  it('"menu" after the link was sent keeps the seats held; the ticket still arrives', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    const token = /** @type {string} */ (linkIn(await g.tap('pay')));
    expect(words(await g.say('menu'))).toContain('Here are our 5 tours');
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    expect(booking.status).toBe('held');
    await onCheckout(token);
    expect(await notices()).toEqual({ ...NONE, tickets: 1 });
  });

  it('"menu" before any link gives the seats back', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    await g.say('menu');
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    expect(booking.status).toBe('cancelled');
  });

  it('no ticket image for a booking that isn’t paid', async () => {
    const { operator } = await ctx.seedOperator();
    await toSummary(guest(operator.slug), { tour: 'lagos-island-heritage-walk' });
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    const res = await request(ctx.app).get(
      `/public/bookings/${guestToken(TEST_AUTH_SECRET, booking.id)}/ticket.png`,
    );
    expect(res.status).toBe(404);
  });
});

describe('payment didn’t go through (design: branches)', () => {
  it('says so once, seats still held; "Try again" sends a new link and the old one stops working', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    const oldToken = /** @type {string} */ (linkIn(await g.tap('pay')));
    const payment = await onCheckout(oldToken, 'decline');
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'failed',
    );

    expect(await notices()).toEqual({ ...NONE, declined: 1 });
    expect(await notices()).toEqual(NONE);
    const said = (await g.chat()).at(-1).body;
    expect(said.text).toMatch(
      /^Your payment didn’t go through, so no money was taken\. Your seats are still held until \d\d:\d\d\.$/,
    );
    expect(said.buttons.map((/** @type {any} */ b) => b.title)).toEqual([
      'Try again',
      'Talk to a person',
    ]);

    const again = await g.tap('retry');
    expect(words(again)).toMatch(
      /^Here’s a new link\. You can choose bank transfer instead of a card\.\nhttp/,
    );
    const newToken = linkIn(again);
    expect(newToken).not.toBe(oldToken);
    expect((await request(ctx.app).post(`/public/payment-links/${oldToken}/pay`)).status).toBe(409);
  });
});

describe('declined, then out of time', () => {
  it('a failed payment after the hold ran out: no "Try again" (nothing is held)', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    await onCheckout(/** @type {string} */ (linkIn(await g.tap('pay'))), 'decline');
    const b = await ctx.prisma.booking.findFirstOrThrow({ where: { operatorId: operator.id } });
    await ctx.prisma.hold.update({
      where: { id: b.holdId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await notices()).toEqual(NONE);
    expect((await g.chat()).at(-1).body.text).not.toMatch(/didn’t go through/);
  });
});

describe('out of time (design: hold expired)', () => {
  it('"Your 30 minutes are up", once; "Hold them again" holds the same seats with a fresh link', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    const first = await expire(operator.id);

    expect(await notices()).toEqual({ ...NONE, holdsOver: 1 });
    expect(await notices()).toEqual(NONE);
    const last = (await g.chat()).at(-1).body;
    expect(last.text).toBe(
      'Your 30 minutes are up, so the seats were released. They’re still free, and I can hold them again with the same details.',
    );
    expect(last.buttons.map((/** @type {any} */ b) => b.title)).toEqual([
      'Hold them again',
      'Choose another date',
      'Cancel',
    ]);

    const again = await g.tap('hold_again');
    expect(words(again)).toMatch(
      /^Done\. Your 2 seats are held until \d\d:\d\d\. Here’s a fresh link for ₦50,000\.\nhttp/,
    );
    const second = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id, status: 'held' },
    });
    expect(second.id).not.toBe(first.id);
    expect(second.departureId).toBe(first.departureId);
    expect(await ctx.prisma.paymentLink.count({ where: { bookingId: second.id } })).toBe(1);
  });

  it('if the seats have gone meanwhile: "Choose another date" instead', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    const b = await expire(operator.id);
    await ctx.prisma.departure.update({
      where: { id: b.departureId },
      data: { seatsSold: 14 }, // 1 left; they were 2
    });
    expect(await notices()).toEqual({ ...NONE, holdsOver: 1 });
    const last = (await g.chat()).at(-1).body;
    expect(last.buttons.map((/** @type {any} */ x) => x.title)).toEqual([
      'Choose another date',
      'Cancel',
    ]);
    expect(words(await g.tap('other_date'))).toBe('No problem, I’ll keep your other answers.');
  });

  it('a hold that runs out after the guest moved on gets no message', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    await g.tap('pay'); // a link: "menu" now keeps the seats…
    await g.say('menu'); // …but the chat has moved on
    const b = await expire(operator.id);
    expect(await notices()).toEqual(NONE);
    const notice = await ctx.prisma.notification.findFirstOrThrow({ where: { bookingId: b.id } });
    expect(notice).toMatchObject({ kind: 'chat_hold_over', status: 'cancelled', sentAt: null });
  });

  it('a hold the guest gave back themselves gets no message', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    await g.tap('cancel');
    await g.tap('stop');
    expect(await notices()).toEqual(NONE);
  });
});
