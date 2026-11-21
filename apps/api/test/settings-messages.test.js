/**
 * Stage 16e-2: what Settings › Messages and › WhatsApp need from the server.
 *   - the messages: each with its WhatsApp-approved version; the approved-only one
 *   - the preview with one of the business's own bookings ("With a real booking: …")
 *   - "Send a test to my WhatsApp": the preview, to the signed-in person's own phone (or why not)
 *   - WhatsApp in words: not connected · waiting for Meta · connected (last message); a test
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { randomInt } from 'node:crypto';
import { createTestContext, buildApp } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

/** @param {string} token */
const as = (token) => ({
  get: (/** @type {string} */ url) =>
    request(ctx.app).get(url).set('Authorization', `Bearer ${token}`),
  post: (/** @type {string} */ url) =>
    request(ctx.app).post(url).set('Authorization', `Bearer ${token}`),
  patch: (/** @type {string} */ url) =>
    request(ctx.app).patch(url).set('Authorization', `Bearer ${token}`),
});

async function setup() {
  const seeded = await ctx.seedOperator();
  // The owner's own phone, for test messages (unique per test: chats are per phone).
  await ctx.prisma.user.update({
    where: { id: seeded.owner.id },
    data: { phone: `+234809${String(randomInt(10 ** 6, 10 ** 7))}` },
  });
  const owner = as(await ctx.tokenFor(seeded.owner.id));
  const manager = as(await ctx.tokenFor(seeded.manager.id));
  return { ...seeded, ownerApi: owner, managerApi: manager };
}

/** A website booking (held is enough to be "real"); returns nothing. @param {any} s */
async function aBooking(s) {
  const product = await ctx.prisma.product.findFirstOrThrow({
    where: { operatorId: s.operator.id, slug: 'lagos-island-heritage-walk' },
  });
  const d = await ctx.prisma.departure.findFirstOrThrow({
    where: { productId: product.id, startsAt: { gt: new Date(Date.now() + 2 * 86_400_000) } },
    orderBy: { startsAt: 'asc' },
  });
  const res = await request(ctx.app)
    .post(`/public/${s.operator.slug}/bookings`)
    .send({
      lead: {
        name: 'Funmi Adeyemi',
        email: 'funmi@guest.example',
        phone: '0805 987 6543',
        acceptTerms: true,
      },
      departureId: d.id,
      travellers: [{ name: 'Funmi Adeyemi', age: 30 }],
      addOns: [],
    });
  const b = await ctx.prisma.booking.findFirstOrThrow({ where: { operatorId: s.operator.id } });
  await ctx.prisma.booking.update({ where: { id: b.id }, data: { status: 'confirmed' } });
  return { reference: b.reference, token: res.body.token };
}

describe('the messages', () => {
  it('each with its approved WhatsApp version; one that is approved-only', async () => {
    const s = await setup();
    const list = (await s.ownerApi.get('/api/message-templates')).body;
    const reminder = list.templates.find((/** @type {any} */ t) => t.kind === 'balance_reminder');
    expect(reminder.approved).toMatch(
      /^Hi \{first_name\}, a reminder: \{balance\} is due by \{due_date\} for your \{tour_short\}/,
    );
    expect(reminder.approved).not.toMatch(/\{\{/);
    expect(list.approvedOnly).toEqual([
      expect.objectContaining({
        key: 'chat_followup',
        name: 'Can we help you finish booking?',
        text: expect.stringMatching(/^Hi \{first_name\}.*Can we help you finish booking\?/s),
      }),
    ]);
  });

  it('the preview uses one of the business’s own bookings', async () => {
    const s = await setup();
    const { reference } = await aBooking(s);
    const res = await s.ownerApi.post('/api/message-templates/booking_confirmed/preview').send({});
    expect(res.body.example).toBe(`Funmi Adeyemi, ${reference}`);
    expect(res.body.preview.body).toMatch(/^Hi Funmi, your booking is confirmed!/);
    expect(res.body.preview.body).toContain(`Ref ${reference}`);
    // What a booking can't give (a link's amount) comes from the made-up one, never blank.
    const link = await s.ownerApi
      .post('/api/message-templates/payment_link/preview')
      .send({ body: 'Pay {amount}: {link_url}' });
    expect(link.body.preview.body).toMatch(/^Pay ₦45,500: /);
    // A balance reminder needs a booking that still owes: this one doesn't, so the made-up one.
    const owed = await s.ownerApi.post('/api/message-templates/balance_reminder/preview').send({});
    expect(owed.body.example).toBeNull();
    expect(owed.body.preview.body).toMatch(/^Hi Adaeze, a reminder: ₦45,500 is due by Sat 28 Nov/);
    // Once one does (part paid): that one.
    await ctx.prisma.booking.updateMany({
      where: { reference },
      data: { status: 'part_paid' },
    });
    const real = await s.ownerApi.post('/api/message-templates/balance_reminder/preview').send({});
    expect(real.body.example).toBe(`Funmi Adeyemi, ${reference}`);
    expect(real.body.preview.body).not.toMatch(/₦0 is due/);
  });

  it('a test to my own WhatsApp: the words as a guest gets them, marked [Test]', async () => {
    const s = await setup();
    const res = await s.ownerApi
      .post('/api/message-templates/balance_reminder/test')
      .send({ body: 'Hi {first_name}: {balance} by {due_date}. {pay_url}' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const me = await ctx.prisma.user.findUniqueOrThrow({ where: { id: s.owner.id } });
    const m = await ctx.prisma.chatMessage.findFirstOrThrow({
      where: {
        operatorId: s.operator.id,
        conversation: { guestPhone: /** @type {string} */ (me.phone) },
      },
      orderBy: { seq: 'desc' },
    });
    expect(/** @type {any} */ (m.body).text).toMatch(
      /^\[Test\] Hi Adaeze: ₦45,500 by Sat 28 Nov\. /,
    );
    expect(res.body.test.to).toMatch(/^0\d{3} \d{3} \d{4}$/);
    // A wording that's missing what it must keep can't be sent either.
    const bad = await s.ownerApi
      .post('/api/message-templates/balance_reminder/test')
      .send({ body: 'Hi' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('TEMPLATE_INVALID');
    // No phone on the account: said.
    await ctx.prisma.user.update({ where: { id: s.owner.id }, data: { phone: null } });
    expect(
      (await s.ownerApi.post('/api/message-templates/balance_reminder/test').send({})).body.error,
    ).toMatchObject({ code: 'NO_PHONE' });
    // A manager can't change messages (settings: none).
    expect(
      (await s.managerApi.post('/api/message-templates/balance_reminder/test').send({})).status,
    ).toBe(403);
  });
});

describe('WhatsApp, in words', () => {
  it('this server without WhatsApp: not connected, and why', async () => {
    const s = await setup();
    expect((await s.ownerApi.get('/api/whatsapp')).body.whatsapp).toMatchObject({
      state: 'simulator',
      stateText: 'Not connected · using the simulator',
      why: 'WhatsApp isn’t set up on this OkapiGo server yet (its access token is in the server’s settings).',
    });
  });

  it('connected here: no number yet; waiting for Meta; connected with the last message; a test', async () => {
    const s = await setup();
    // A server with WhatsApp (a fake Meta that accepts everything).
    const app = buildApp({
      prisma: ctx.prisma,
      whatsapp: {
        accessToken: 'test-access-token-not-real',
        appSecret: 'test-app-secret',
        verifyToken: 'test-verify',
        graphVersion: 'v23.0',
        fetch: /** @type {any} */ (
          async () => ({
            ok: true,
            status: 200,
            json: async () => ({ messages: [{ id: 'wamid.t1' }] }),
          })
        ),
      },
    });
    const token = await ctx.tokenFor(s.owner.id);
    const call = (/** @type {'get' | 'patch' | 'post'} */ m, /** @type {string} */ url) =>
      request(app)[m](url).set('Authorization', `Bearer ${token}`);
    const get = async () => (await call('get', '/api/whatsapp')).body.whatsapp;
    expect(await get()).toMatchObject({
      state: 'simulator',
      why: 'Add your Phone number ID from Meta to connect your number.',
    });
    const id = String(randomInt(10 ** 9, 10 ** 10));
    await call('patch', '/api/whatsapp').send({ phoneNumberId: id });
    expect(await get()).toMatchObject({
      state: 'waiting',
      stateText: 'Waiting for Meta to call the webhook',
      why: null,
    });
    // A message in the simulator isn't WhatsApp calling: still waiting.
    const sim = await ctx.prisma.conversation.create({
      data: { operatorId: s.operator.id, channel: 'simulator', guestPhone: '+2348125550193' },
    });
    await ctx.prisma.chatMessage.create({
      data: {
        operatorId: s.operator.id,
        conversationId: sim.id,
        direction: 'in',
        author: 'guest',
        body: { kind: 'text', text: 'Hi' },
      },
    });
    expect((await get()).state).toBe('waiting');
    const c = await ctx.prisma.conversation.create({
      data: { operatorId: s.operator.id, channel: 'whatsapp', guestPhone: '+2348125550192' },
    });
    await ctx.prisma.chatMessage.create({
      data: {
        operatorId: s.operator.id,
        conversationId: c.id,
        direction: 'in',
        author: 'guest',
        body: { kind: 'text', text: 'Hi' },
      },
    });
    expect(await get()).toMatchObject({
      state: 'connected',
      stateText: expect.stringMatching(/^Connected · last message \d\d:\d\d$/),
    });
    // The owner has never written to the number: WhatsApp won't let the business write first.
    const refused = await call('post', '/api/whatsapp/test');
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({ code: 'TEST_NOT_SENT', to: expect.any(String) });
    expect(refused.body.error.message).toBe(
      'WhatsApp only lets a business write first to someone who messaged it in the last 24 hours. Send any message to your business number from your phone, then try again.',
    );
    // Once they have: it goes.
    const me = await ctx.prisma.user.findUniqueOrThrow({ where: { id: s.owner.id } });
    const mine = await ctx.prisma.conversation.findFirstOrThrow({
      where: { operatorId: s.operator.id, guestPhone: /** @type {string} */ (me.phone) },
    });
    await ctx.prisma.chatMessage.create({
      data: {
        operatorId: s.operator.id,
        conversationId: mine.id,
        direction: 'in',
        author: 'guest',
        body: { kind: 'text', text: 'Hello' },
      },
    });
    const test = await call('post', '/api/whatsapp/test');
    expect(test.status, JSON.stringify(test.body)).toBe(201);
    expect(test.body.test).toMatchObject({
      to: expect.stringMatching(/^0\d{3} \d{3} \d{4}$/),
    });
  });
});
