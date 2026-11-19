/**
 * Stage 13c-3: the real WhatsApp, through Meta's Cloud API, against a FAKE Meta (no network).
 *   - Meta's webhook check (GET) and signed webhooks (POST): a wrong signature changes nothing
 *   - a guest's message → the same conversation as the simulator → replies sent to Meta in
 *     WhatsApp's own formats (buttons, lists, pictures, text)
 *   - the same message delivered twice is answered once
 *   - delivery receipts: sent → delivered → read, never backwards; failed, with why
 *   - the 24-hour rule: staff can't write first after a day; notices are marked failed
 *   - the business's number (staff API), and what Meta's message shapes turn into
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createHmac, randomInt } from 'node:crypto';
import { createTestContext, buildApp } from './helpers.js';
import { toGraph, readWebhook, verifySignature } from '../src/whatsapp/cloud-api.js';
import { fitsWhatsApp, say } from '../src/whatsapp/messages.js';
import { sendChatNotices } from '../src/whatsapp/notices.js';
import { createChannels } from '../src/whatsapp/channels.js';

const ctx = createTestContext();
// Each test is a whole scripted chat (10+ messages, each a booking-engine turn): more time
// than the usual 20 s, for full runs on a busy machine. A stuck test still fails, later.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

const APP_SECRET = 'meta-app-secret-for-tests-only';
const VERIFY = 'my-own-verify-token-123456';

/** A pretend Meta: records each message we send, answers with a wamid (or an error). */
function fakeMeta() {
  /** @type {Array<{ url: string, auth: string, body: any }>} */
  const sent = [];
  let refuse = null;
  let n = 0;
  const fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
    sent.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) });
    if (refuse) return { ok: false, status: 400, json: async () => ({ error: refuse }) };
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.out${++n}` }] }) };
  };
  return { sent, fetch, refuse: (/** @type {any} */ e) => (refuse = e) };
}

/** An app connected to the fake Meta, and a seeded business with its WhatsApp number. */
async function setup() {
  const meta = fakeMeta();
  const whatsapp = {
    accessToken: 'test-access-token-not-real',
    appSecret: APP_SECRET,
    verifyToken: VERIFY,
    graphVersion: 'v23.0',
    fetch: /** @type {any} */ (meta.fetch),
  };
  const app = buildApp({ prisma: ctx.prisma, whatsapp });
  const seeded = await ctx.seedOperator();
  const phoneNumberId = String(randomInt(10 ** 9, 10 ** 10)); // unique per test
  const operator = await ctx.prisma.operator.update({
    where: { id: seeded.operator.id },
    data: { whatsappPhoneNumberId: phoneNumberId },
  });
  let wamid = 0;
  /** Meta's webhook for one guest message, signed (or not). */
  const guestSays = (/** @type {any} */ message, { from = '2348031234567', sign = true } = {}) => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15550000000', phone_number_id: phoneNumberId },
                contacts: [{ wa_id: from, profile: { name: 'Adaeze' } }],
                messages: [
                  { from, id: message.id ?? `wamid.in${++wamid}`, timestamp: '1', ...message },
                ],
              },
            },
          ],
        },
      ],
    });
    return post(app, body, sign);
  };
  return { app, meta, operator, phoneNumberId, guestSays, whatsapp, seeded };
}

/** @param {any} app @param {string} body */
function post(app, body, sign = true) {
  const req = request(app).post('/webhooks/whatsapp').set('Content-Type', 'application/json');
  if (sign) {
    req.set(
      'X-Hub-Signature-256',
      `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`,
    );
  }
  return req.send(body);
}

/** @param {string} status @param {string} id @param {any} [errors] */
const receipt = (phoneNumberId, id, status, errors) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: phoneNumberId },
              statuses: [{ id, status, recipient_id: '2348031234567', ...(errors && { errors }) }],
            },
          },
        ],
      },
    ],
  });

describe('connecting the webhook', () => {
  it('answers Meta’s check with the challenge only for our verify token', async () => {
    const { app } = await setup();
    const ok = await request(app).get(
      `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444`,
    );
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('1158201444');
    const bad = await request(app).get(
      '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1',
    );
    expect(bad.status).toBe(403);
  });

  it('without WhatsApp configured, there is no webhook at all', async () => {
    const app = buildApp({ prisma: ctx.prisma });
    expect((await request(app).post('/webhooks/whatsapp').send('{}')).status).toBe(404);
  });
});

describe('a guest writes on WhatsApp', () => {
  it('a wrong or missing signature: 401, nothing stored, nothing sent', async () => {
    const { meta, operator, guestSays } = await setup();
    expect((await guestSays({ type: 'text', text: { body: 'Hi' } }, { sign: false })).status).toBe(
      401,
    );
    expect(await ctx.prisma.conversation.count({ where: { operatorId: operator.id } })).toBe(0);
    expect(meta.sent).toHaveLength(0);
  });

  it('"Hi" → the bot’s hello, sent to Meta as reply buttons; recorded as sent', async () => {
    const { meta, operator, phoneNumberId, guestSays } = await setup();
    const res = await guestSays({ type: 'text', text: { body: 'Hi' } });
    expect(res.status).toBe(200);

    expect(meta.sent).toHaveLength(1);
    const [call] = meta.sent;
    expect(call.url).toBe(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`);
    expect(call.auth).toBe('Bearer test-access-token-not-real');
    expect(call.body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '2348031234567', // no "+"
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: expect.stringContaining('booking assistant') },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'tours', title: 'See tours' } },
            { type: 'reply', reply: { id: 'person', title: 'Talk to a person' } },
          ],
        },
      },
    });

    const c = await ctx.prisma.conversation.findFirstOrThrow({
      where: { operatorId: operator.id },
      include: { messages: { orderBy: { seq: 'asc' } } },
    });
    expect(c).toMatchObject({
      channel: 'whatsapp',
      guestPhone: '+2348031234567',
      guestName: 'Adaeze',
    });
    expect(c.messages.map((m) => [m.direction, m.delivery, m.providerMessageId])).toEqual([
      ['in', null, 'wamid.in1'],
      ['out', 'sent', 'wamid.out1'],
    ]);
  });

  it('a tapped button and a chosen list row carry their ids; a list goes to Meta as a list', async () => {
    const { meta, guestSays } = await setup();
    await guestSays({ type: 'text', text: { body: 'Hi' } });
    await guestSays({
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'tours', title: 'See tours' } },
    });
    const list = meta.sent.at(-1).body;
    expect(list.interactive.type).toBe('list');
    expect(list.interactive.action.button).toBe('Choose a tour');
    expect(list.interactive.action.sections[0].rows[0]).toMatchObject({
      id: expect.stringMatching(/^tour:/),
      title: expect.any(String),
    });
    await guestSays({
      type: 'interactive',
      interactive: {
        type: 'list_reply',
        list_reply: { id: 'tour:lagos-street-food-crawl', title: 'Street Food Crawl' },
      },
    });
    expect(meta.sent.at(-1).body.interactive.body.text).toContain('*Lagos Street Food Crawl*');
  });

  it('the same message delivered twice is answered once', async () => {
    const { meta, operator, guestSays } = await setup();
    const hi = { id: 'wamid.same', type: 'text', text: { body: 'Hi' } };
    expect((await guestSays(hi)).status).toBe(200);
    expect((await guestSays(hi)).status).toBe(200);
    expect(meta.sent).toHaveLength(1);
    expect(
      await ctx.prisma.chatMessage.count({ where: { operatorId: operator.id, direction: 'in' } }),
    ).toBe(1);
  });

  it('a photo or a voice note: "Sorry, I didn’t catch that" (and staff see what it was)', async () => {
    const { meta, operator, guestSays } = await setup();
    await guestSays({ type: 'image', image: { id: 'media1' } });
    expect(meta.sent[0].body.interactive.body.text).toMatch(/^Sorry, I didn’t catch that/);
    const inbound = await ctx.prisma.chatMessage.findFirstOrThrow({
      where: { operatorId: operator.id, direction: 'in' },
    });
    expect(inbound.body).toEqual({ kind: 'text', text: '[image]' });
  });

  it('a message to a number no business here uses: 200 (so Meta stops), nothing done', async () => {
    const { app, meta } = await setup();
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '999' },
                messages: [
                  { from: '2348031234567', id: 'wamid.x', type: 'text', text: { body: 'Hi' } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect((await post(app, body)).status).toBe(200);
    expect(meta.sent).toHaveLength(0);
  });

  it('Meta refuses a message: it is still in the chat, marked failed with Meta’s reason', async () => {
    const { meta, operator, guestSays } = await setup();
    meta.refuse({ code: 131026, message: 'Message undeliverable' });
    await guestSays({ type: 'text', text: { body: 'Hi' } });
    const out = await ctx.prisma.chatMessage.findFirstOrThrow({
      where: { operatorId: operator.id, direction: 'out' },
    });
    expect(out).toMatchObject({
      delivery: 'failed',
      deliveryError: '131026: Message undeliverable',
      providerMessageId: null,
    });
  });
});

describe('delivery receipts', () => {
  it('sent → delivered → read, never backwards; a failure says why', async () => {
    const { app, operator, phoneNumberId, guestSays } = await setup();
    await guestSays({ type: 'text', text: { body: 'Hi' } });
    const delivery = async () =>
      (
        await ctx.prisma.chatMessage.findFirstOrThrow({
          where: { operatorId: operator.id, direction: 'out' },
        })
      ).delivery;

    await post(app, receipt(phoneNumberId, 'wamid.out1', 'delivered'));
    expect(await delivery()).toBe('delivered');
    await post(app, receipt(phoneNumberId, 'wamid.out1', 'read'));
    expect(await delivery()).toBe('read');
    await post(app, receipt(phoneNumberId, 'wamid.out1', 'delivered')); // late, out of order
    expect(await delivery()).toBe('read');

    await post(
      app,
      receipt(phoneNumberId, 'wamid.out1', 'failed', [
        { code: 131047, title: 'Re-engagement message' },
      ]),
    );
    const failed = await ctx.prisma.chatMessage.findFirstOrThrow({
      where: { operatorId: operator.id, direction: 'out' },
    });
    expect(failed).toMatchObject({
      delivery: 'failed',
      deliveryError: '131047: Re-engagement message',
    });
  });
});

describe('staff, and the 24-hour rule', () => {
  /** @param {any} app @param {string} token */
  const as = (app, token) => ({
    post: (/** @type {string} */ url) =>
      request(app).post(url).set('Authorization', `Bearer ${token}`),
    get: (/** @type {string} */ url) =>
      request(app).get(url).set('Authorization', `Bearer ${token}`),
  });

  it('a person’s reply is signed in the text; events in italics; staff see each delivery', async () => {
    const { app, meta, operator, guestSays, seeded } = await setup();
    await guestSays({ type: 'text', text: { body: 'Hi' } });
    const staff = as(app, await ctx.tokenFor(seeded.manager.id));
    const c = await ctx.prisma.conversation.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    await staff.post(`/api/conversations/${c.id}/take-over`);
    const first = seeded.manager.name.trim().split(/\s+/)[0];
    expect(meta.sent.at(-1).body.text.body).toBe(
      `_${first} from Ìrìn joined · the assistant is paused_`,
    );
    await staff.post(`/api/conversations/${c.id}/messages`).send({ text: 'Hello! Tolu here.' });
    expect(meta.sent.at(-1).body).toMatchObject({
      type: 'text',
      text: { body: `*${first} · Ìrìn team*\nHello! Tolu here.` },
    });
    const chat = (await staff.get(`/api/conversations/${c.id}`)).body.conversation;
    expect(chat.messages.at(-1)).toMatchObject({ author: 'staff', delivery: 'sent' });
  });

  it('after 24 hours of silence: staff can’t write first; a notice is stored, marked failed, not sent', async () => {
    const { app, meta, operator, guestSays, seeded } = await setup();
    await guestSays({ type: 'text', text: { body: 'Hi' } });
    const c = await ctx.prisma.conversation.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    await ctx.prisma.chatMessage.updateMany({
      where: { conversationId: c.id, direction: 'in' },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    const staff = as(app, await ctx.tokenFor(seeded.manager.id));
    await staff.post(`/api/conversations/${c.id}/take-over`);
    const sentBefore = meta.sent.length;
    const res = await staff
      .post(`/api/conversations/${c.id}/messages`)
      .send({ text: 'Still there?' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OUTSIDE_24H');
    expect(meta.sent).toHaveLength(sentBefore);
    // The "joined" line itself was stored but not sent: marked failed, with why.
    const joined = await ctx.prisma.chatMessage.findFirstOrThrow({
      where: { conversationId: c.id, body: { path: ['kind'], equals: 'notice' } },
    });
    expect(joined).toMatchObject({
      delivery: 'failed',
      deliveryError: expect.stringMatching(/^OUTSIDE_24H/),
    });
  });

  it('a notice after 24 hours of silence ("30 minutes are up") is stored, marked failed, not sent', async () => {
    const { meta, operator, guestSays, whatsapp } = await setup();
    const tap = (/** @type {string} */ id, title = id) =>
      guestSays({ type: 'interactive', interactive: { button_reply: { id, title } } });
    const choose = (/** @type {string} */ id) =>
      guestSays({ type: 'interactive', interactive: { list_reply: { id, title: id } } });
    const type = (/** @type {string} */ body) => guestSays({ type: 'text', text: { body } });

    await type('Hi');
    await tap('tours');
    await choose('tour:lagos-island-heritage-walk');
    const rows = meta.sent.at(-1).body.interactive.action.sections[0].rows;
    await choose(rows.find((/** @type {any} */ r) => r.description !== 'Sold out').id);
    await tap('n:2');
    await tap('no');
    await type('Adaeze Okafor');
    await tap('skip');
    expect(meta.sent.at(-1).body.interactive.body.text).toContain('*Your booking*');

    // The hold runs out a day later, while the guest has been quiet.
    const c = await ctx.prisma.conversation.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    await ctx.prisma.chatMessage.updateMany({
      where: { conversationId: c.id, direction: 'in' },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    const b = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
      include: { hold: true },
    });
    const { releaseHold } = await import('@okapigo/db');
    await releaseHold(ctx.prisma, b.holdId, {
      reason: 'expired',
      now: new Date(b.hold.expiresAt.getTime() + 1000),
    });
    const before = meta.sent.length;
    const { TEST_AUTH_SECRET } = await import('./helpers.js');
    const sent = await sendChatNotices({
      prisma: ctx.prisma,
      authSecret: TEST_AUTH_SECRET,
      apiPublicUrl: 'http://localhost:4000',
      webPublicUrl: 'http://localhost:4000',
      channels: createChannels({ whatsapp }),
    });
    expect(sent.holdsOver).toBe(1); // decided and stored…
    expect(meta.sent).toHaveLength(before); // …but not sent: WhatsApp would refuse it
    const last = await ctx.prisma.chatMessage.findFirstOrThrow({
      where: { conversationId: c.id },
      orderBy: { seq: 'desc' },
    });
    expect(last).toMatchObject({
      delivery: 'failed',
      deliveryError: expect.stringMatching(/^OUTSIDE_24H/),
    });
  });
});

describe('the business’s WhatsApp number (staff API)', () => {
  it('the owner sets it (digits only, one business per number); a manager can only look', async () => {
    const { app, seeded, phoneNumberId } = await setup();
    const owner = request.agent(app);
    const ownerToken = await ctx.tokenFor(seeded.owner.id);
    const get = await owner.get('/api/whatsapp').set('Authorization', `Bearer ${ownerToken}`);
    expect(get.body.whatsapp).toEqual({
      phoneNumberId,
      connected: true,
      webhookUrl: 'http://localhost:4000/webhooks/whatsapp',
    });
    const patch = (/** @type {any} */ body, token = ownerToken) =>
      request(app).patch('/api/whatsapp').set('Authorization', `Bearer ${token}`).send(body);
    expect((await patch({ phoneNumberId: '+234 803' })).status).toBe(400);
    expect((await patch({ phoneNumberId: '1098765432123' })).body.whatsapp.phoneNumberId).toBe(
      '1098765432123',
    );
    expect((await patch({ phoneNumberId: null })).body.whatsapp.phoneNumberId).toBeNull();

    const other = await ctx.seedOperator();
    await ctx.prisma.operator.update({
      where: { id: other.operator.id },
      data: { whatsappPhoneNumberId: '5550001112' },
    });
    const taken = await patch({ phoneNumberId: '5550001112' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('NUMBER_TAKEN');

    const manager = await ctx.tokenFor(seeded.manager.id);
    expect(
      (await request(app).get('/api/whatsapp').set('Authorization', `Bearer ${manager}`)).status,
    ).toBe(200);
    expect((await patch({ phoneNumberId: '1234567' }, manager)).status).toBe(403);
  });
});

describe('Meta’s shapes', () => {
  it('every bot message becomes a valid Meta message (and fits WhatsApp)', () => {
    const who = { operatorName: 'Ìrìn Lagos Tours' };
    const samples = [
      say.hello('Ìrìn Lagos Tours'),
      say.tours([{ id: 'tour:a', title: 'Heritage Walk', description: 'from ₦25,000' }], 'VAT'),
      say.ticketImage('https://example.test/t.png'),
      say.payLink('https://example.test/pay/x', '11:15', { title: 'Pay', description: 'd' }),
      say.staffJoined('Tolu Ade', 'Ìrìn Lagos Tours'),
    ];
    for (const m of samples) expect(fitsWhatsApp(m)).toBe(true);
    expect(toGraph(samples[2], who)).toEqual({
      type: 'image',
      image: {
        link: 'https://example.test/t.png',
        caption: 'Your ticket. Show it to the guide at the start.',
      },
    });
    expect(toGraph(samples[3], who)).toMatchObject({ type: 'text', text: { preview_url: true } });
    expect(toGraph(samples[4], who).text.body).toBe(
      '_Tolu from Ìrìn joined · the assistant is paused_',
    );
  });

  it('reads Meta’s webhook: typed, tapped, chosen, a template button, anything else', () => {
    const m = (/** @type {any} */ x) => ({ from: '2348031234567', id: `w${Math.random()}`, ...x });
    const { messages } = readWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '42' },
                messages: [
                  m({ type: 'text', text: { body: 'Hi' } }),
                  m({
                    type: 'interactive',
                    interactive: { button_reply: { id: 'pay', title: 'Pay ₦50,000' } },
                  }),
                  m({
                    type: 'interactive',
                    interactive: { list_reply: { id: 'dep:1', title: 'Sat 5 Dec' } },
                  }),
                  m({ type: 'button', button: { text: 'Yes' } }),
                  m({ type: 'audio', audio: {} }),
                ],
              },
            },
          ],
        },
      ],
    });
    expect(messages.map((x) => x.input)).toEqual([
      { text: 'Hi' },
      { choice: 'pay', title: 'Pay ₦50,000' },
      { choice: 'dep:1', title: 'Sat 5 Dec' },
      { text: 'Yes' },
      { text: '[audio]' },
    ]);
    expect(messages[0]).toMatchObject({ phoneNumberId: '42', from: '+2348031234567' });
    expect(readWebhook({ object: 'page' }).messages).toEqual([]);
  });

  it('checks the signature over the exact bytes', () => {
    const body = Buffer.from('{"a":1}');
    const sig = `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`;
    expect(verifySignature('secret', body, sig)).toBe(true);
    expect(verifySignature('secret', Buffer.from('{"a": 1}'), sig)).toBe(false);
    expect(verifySignature('other', body, sig)).toBe(false);
    expect(verifySignature('secret', body, undefined)).toBe(false);
  });
});
