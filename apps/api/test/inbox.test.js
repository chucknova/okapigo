/**
 * Stage 16d-1: the inbox's chats (designs: O9 Inbox — chats, phone and states, gaps).
 *   - the list: needs a person first (waiting, or taken over: by you, or "Kunle is replying"),
 *     then with the bot
 *   - one chat in words: who has it, the messages (bot, staff, notices, failed ones), the
 *     booking beside it
 *   - one person at a time: only whoever took it over replies; a colleague takes over on
 *     purpose ("Take over from Ngozi?")
 *   - WhatsApp's 24-hour rule: the approved "Can we help you finish booking?"
 *   - a message that failed: retry, or by email
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { bookingIdFromGuestToken } from '@okapigo/db';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';
import { chatHelpers } from './whatsapp-chat.js';
import { waited, textOf, holderOf } from '../src/routes/inbox.js';
import { sendGuestMessages } from '../src/messages/send.js';
import { createChannels } from '../src/whatsapp/channels.js';

const ctx = createTestContext();
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
const { guest, toSummary } = chatHelpers(ctx);

/** @param {string} token */
const as = (token) => ({
  get: (/** @type {string} */ url) =>
    request(ctx.app).get(url).set('Authorization', `Bearer ${token}`),
  post: (/** @type {string} */ url) =>
    request(ctx.app).post(url).set('Authorization', `Bearer ${token}`),
});

async function setup() {
  const seeded = await ctx.seedOperator();
  const manager = as(await ctx.tokenFor(seeded.manager.id));
  // A second member of the office: the owner.
  const owner = as(await ctx.tokenFor(seeded.owner.id));
  const kemi = seeded.guides.find((/** @type {any} */ g) => g.name === 'Kemi Adeyemi');
  const asKemi = as(await ctx.tokenFor(kemi.id));
  const chat = async (/** @type {string} */ id) =>
    (await manager.get(`/api/inbox/chats/${id}`)).body.chat;
  const list = async () => (await manager.get('/api/inbox/chats')).body.chats;
  return { ...seeded, manager, owner, asKemi, chat, list };
}

describe('words', () => {
  it('how long, a message in a line, who has it', () => {
    expect(waited(30_000)).toBe('1 min');
    expect(waited(3 * 60_000)).toBe('3 min');
    expect(waited(2 * 3_600_000)).toBe('2 h');
    expect(waited(26 * 3_600_000)).toBe('1 day');
    expect(waited(50 * 3_600_000)).toBe('2 days');
    expect(textOf({ kind: 'buttons', text: 'Pick a date' })).toBe('Pick a date');
    expect(textOf({ kind: 'image', caption: 'Your ticket' })).toBe('Photo: Your ticket');
    expect(textOf({ kind: 'image' })).toBe('Photo');
    expect(textOf({ kind: 'reply', title: 'Talk to a person' })).toBe('Talk to a person');
    expect(textOf(null)).toBe('');
    expect(holderOf({ handledBy: 'bot' }, 'me', null)).toEqual({ mode: 'bot', holder: null });
    expect(holderOf({ handledBy: 'staff', handledById: 'me' }, 'me', 'Kunle')).toMatchObject({
      mode: 'mine',
    });
    // Taken over before 16d (no holder recorded): treated as anyone's.
    expect(holderOf({ handledBy: 'staff', handledById: null }, 'me', null).mode).toBe('mine');
    expect(holderOf({ handledBy: 'staff', handledById: 'ngozi' }, 'me', 'Ngozi Eze')).toEqual({
      mode: 'theirs',
      holder: 'Ngozi Eze',
    });
  });
});

describe('the chats', () => {
  it('needs a person first, then with the bot; a chat in words', async () => {
    const s = await setup();
    const browsing = guest(s.operator.slug, '0803 000 0001');
    await browsing.say('Hi');
    const asking = guest(s.operator.slug, '0803 000 0002');
    await toSummary(asking, { tour: 'lagos-island-heritage-walk' });
    await asking.tap('person');

    const l = await s.list();
    expect(l.needsCount).toBe(1);
    expect(l.needs[0]).toMatchObject({
      waiting: true,
      state: 'Waiting for a person',
      wait: expect.stringMatching(/^waiting \d+ min$/),
      mode: 'bot',
    });
    // The guest's WhatsApp profile name (the simulator's is "Adaeze"), else their number.
    expect(l.bot.map((/** @type {any} */ c) => c.name)).toEqual(['Adaeze']);

    const id = l.needs[0].id;
    const c = await s.chat(id);
    expect(c).toMatchObject({
      phone: '0803 000 0002',
      sub: expect.stringMatching(
        /^0803 000 0002 · WhatsApp \(simulator\) · last message \d\d:\d\d$/,
      ),
      mode: 'bot',
      stateLine: expect.stringMatching(/^Waiting for a person · \d+ min$/),
      window: { open: true },
    });
    expect(c.messages[0]).toMatchObject({ side: 'in', time: expect.stringMatching(/^\d\d:\d\d$/) });
    expect(c.messages.some((/** @type {any} */ m) => m.side === 'out' && m.who === 'Bot')).toBe(
      true,
    );
    // The booking beside it: the one this chat holds seats for.
    expect(c.booking).toMatchObject({ chip: { key: 'held' }, tour: 'Heritage Walk' });
  });

  it('one person at a time: only the holder replies; a colleague takes over on purpose', async () => {
    const s = await setup();
    const g = guest(s.operator.slug, '0803 000 0003');
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    await g.tap('person');
    const id = (await s.list()).needs[0].id;

    expect((await s.manager.post(`/api/conversations/${id}/take-over`)).status).toBe(200);
    const mine = await s.chat(id);
    expect(mine).toMatchObject({ mode: 'mine', stateLine: 'You’re replying · bot paused' });
    expect((await s.list()).needs[0]).toMatchObject({ state: 'Taken over by you', mode: 'mine' });

    // The owner sees the manager has it, and can't reply…
    const theirs = (await s.owner.get(`/api/inbox/chats/${id}`)).body.chat;
    expect(theirs).toMatchObject({
      mode: 'theirs',
      stateLine: expect.stringMatching(/^\w+ is replying · bot paused$/),
      theirsNote: expect.stringMatching(
        /^Only \w+ can reply while they have this chat \(since \d\d:\d\d\)\.$/,
      ),
    });
    const blocked = await s.owner.post(`/api/conversations/${id}/messages`).send({ text: 'Hi' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('NOT_YOURS');
    // …nor take over by accident.
    const asked = await s.owner.post(`/api/conversations/${id}/take-over`).send({});
    expect(asked.status).toBe(409);
    expect(asked.body.error).toMatchObject({
      code: 'TAKEN_BY_COLLEAGUE',
      message: expect.stringMatching(/^\w+ has this chat\. Take it over from them\?$/),
    });
    // On purpose: now the owner has it, and the manager can't reply.
    expect(
      (await s.owner.post(`/api/conversations/${id}/take-over`).send({ fromColleague: true }))
        .status,
    ).toBe(200);
    expect(
      (await s.owner.post(`/api/conversations/${id}/messages`).send({ text: 'Hi' })).status,
    ).toBe(201);
    expect(
      (await s.manager.post(`/api/conversations/${id}/messages`).send({ text: 'Hi' })).body.error
        .code,
    ).toBe('NOT_YOURS');
    // The guest heard "joined" once, not twice.
    expect(
      (await g.chat()).filter((/** @type {any} */ m) => /joined/.test(m.body.text ?? '')),
    ).toHaveLength(1);
    // Handed back: nobody holds it.
    await s.owner.post(`/api/conversations/${id}/hand-back`);
    const back = await ctx.prisma.conversation.findUniqueOrThrow({ where: { id } });
    expect(back).toMatchObject({ handledBy: 'bot', handledById: null, handledSince: null });
  });

  it('a preview is one plain line: WhatsApp’s *bold* marks dropped', async () => {
    const s = await setup();
    const c = await ctx.prisma.conversation.create({
      data: { operatorId: s.operator.id, channel: 'simulator', guestPhone: '+2348000000009' },
    });
    await ctx.prisma.chatMessage.create({
      data: {
        operatorId: s.operator.id,
        conversationId: c.id,
        direction: 'out',
        author: 'bot',
        body: { kind: 'text', text: '*Lagos Street Food Crawl* tonight' },
      },
    });
    const row = (await s.list()).bot.find((/** @type {any} */ x) => x.id === c.id);
    expect(row).toMatchObject({ name: '0800 000 0009', last: 'Lagos Street Food Crawl tonight' });
  });

  it('for the office only', async () => {
    const s = await setup();
    expect((await s.asKemi.get('/api/inbox/chats')).status).toBe(403);
  });
});

describe('WhatsApp’s 24-hour rule', () => {
  it('outside it: the reason, and the approved follow-up to send', async () => {
    const s = await setup();
    const c = await ctx.prisma.conversation.create({
      data: {
        operatorId: s.operator.id,
        channel: 'whatsapp',
        guestPhone: '+2348125550192',
        guestName: 'Bayo Adewale',
      },
    });
    await ctx.prisma.chatMessage.create({
      data: {
        operatorId: s.operator.id,
        conversationId: c.id,
        direction: 'in',
        author: 'guest',
        body: { kind: 'text', text: 'Sat 12 Dec · 10:00' },
        createdAt: new Date(Date.now() - 50 * 3_600_000),
      },
    });
    const chat = await s.chat(c.id);
    expect(chat.window).toEqual({
      open: false,
      lastWrote: expect.stringMatching(/^\w{3} \d+ \w{3}, \d\d:\d\d$/),
      text: 'Bayo last wrote 2 days ago. WhatsApp only lets you send approved messages until they write again.',
      followUp:
        'Hi Bayo, it’s Ìrìn Lagos Tours on WhatsApp. Can we help you finish booking?\n\nJust reply to this message and we’ll pick up where you left off.',
    });
    // A free reply is refused; the follow-up is the approved template.
    await s.manager.post(`/api/conversations/${c.id}/take-over`);
    expect(
      (await s.manager.post(`/api/conversations/${c.id}/messages`).send({ text: 'Hi' })).body.error
        .code,
    ).toBe('OUTSIDE_24H');
    const sent = await s.manager.post(`/api/conversations/${c.id}/follow-up`);
    expect(sent.status).toBe(201);
    expect(sent.body.message.body.template).toMatchObject({
      name: 'okapigo_chat_followup',
      params: ['Bayo', 'Ìrìn Lagos Tours'],
    });
  });
});

describe('a message that failed', () => {
  it('sent again (a new attempt below it), or by email to the booking’s lead', async () => {
    const s = await setup();
    // A website guest's booking, and a chat on the same number.
    const walk = await ctx.prisma.departure.findFirstOrThrow({
      where: {
        operatorId: s.operator.id,
        product: { slug: 'lagos-island-heritage-walk' },
        startsAt: { gt: new Date(Date.now() + 2 * 86_400_000) },
      },
      orderBy: { startsAt: 'asc' },
    });
    const made = await request(ctx.app)
      .post(`/public/${s.operator.slug}/bookings`)
      .send({
        lead: {
          name: 'Yemi Ojo',
          email: 'yemi@guest.example',
          phone: '0813 902 4417',
          acceptTerms: true,
        },
        departureId: walk.id,
        travellers: [{ name: 'Yemi Ojo', age: 30 }],
        addOns: [],
      });
    const bookingId = bookingIdFromGuestToken(TEST_AUTH_SECRET, made.body.token);
    const c = await ctx.prisma.conversation.create({
      data: {
        operatorId: s.operator.id,
        channel: 'simulator',
        guestPhone: '+2348139024417',
        guestName: 'Yemi Ojo',
      },
    });
    const failed = await ctx.prisma.chatMessage.create({
      data: {
        operatorId: s.operator.id,
        conversationId: c.id,
        direction: 'out',
        author: 'staff',
        authorUserId: s.manager.id,
        body: { kind: 'text', text: 'Your balance link: okapigo.app/pay/abc' },
        delivery: 'failed',
        deliveryError: 'number unreachable',
      },
    });
    const ok = await ctx.prisma.chatMessage.create({
      data: {
        operatorId: s.operator.id,
        conversationId: c.id,
        direction: 'out',
        author: 'bot',
        body: { kind: 'text', text: 'Hi' },
      },
    });
    const shown = (await s.chat(c.id)).messages.find((/** @type {any} */ m) => m.id === failed.id);
    expect(shown).toMatchObject({ failed: true, failedWhy: 'number unreachable', side: 'out' });
    expect((await s.chat(c.id)).booking).toMatchObject({ id: bookingId, hasEmail: true });

    // Only a failed message can be retried.
    expect(
      (await s.manager.post(`/api/conversations/${c.id}/messages/${ok.id}/retry`)).body.error.code,
    ).toBe('NOT_FAILED');
    const retried = await s.manager.post(`/api/conversations/${c.id}/messages/${failed.id}/retry`);
    expect(retried.status).toBe(201);
    expect(retried.body.message.body).toEqual({
      kind: 'text',
      text: 'Your balance link: okapigo.app/pay/abc',
    });

    const emailed = await s.manager.post(`/api/conversations/${c.id}/messages/${failed.id}/email`);
    expect(emailed.status).toBe(202);
    expect(emailed.body).toEqual({ queued: true, to: 'yemi@guest.example' });
    const n = await ctx.prisma.notification.findFirstOrThrow({
      where: { bookingId, kind: 'staff_message' },
    });
    expect(n).toMatchObject({
      channel: 'email',
      data: { text: 'Your balance link: okapigo.app/pay/abc' },
    });
    expect(
      await ctx.prisma.notification.count({ where: { bookingId, kind: 'staff_message' } }),
    ).toBe(1);

    // The sender sends it: the staff member's words, in the business's email, from them.
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
    const mail = mails.find((m) => m.subject.startsWith('A message from'));
    expect(mail).toMatchObject({
      subject: expect.stringMatching(/^A message from \w+ at Ìrìn Lagos Tours$/),
      to: { email: 'yemi@guest.example' },
      from: { name: 'Ìrìn Lagos Tours' },
    });
    expect(mail.text).toContain('Your balance link: okapigo.app/pay/abc');
    expect(mail.html).toContain('A message for you');
  });

  it('no email for the guest: call them instead', async () => {
    const s = await setup();
    const c = await ctx.prisma.conversation.create({
      data: { operatorId: s.operator.id, channel: 'simulator', guestPhone: '+2348120000000' },
    });
    const failed = await ctx.prisma.chatMessage.create({
      data: {
        operatorId: s.operator.id,
        conversationId: c.id,
        direction: 'out',
        author: 'bot',
        body: { kind: 'text', text: 'Hello' },
        delivery: 'failed',
      },
    });
    const res = await s.manager.post(`/api/conversations/${c.id}/messages/${failed.id}/email`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'NO_EMAIL',
      message: 'There’s no email for this guest. Call them instead.',
    });
  });
});
