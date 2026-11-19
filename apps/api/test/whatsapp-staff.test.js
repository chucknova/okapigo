/**
 * Session 13b: staff and WhatsApp chats (flow brief screen H; the screen comes later, the API
 * now). "Talk to a person" puts the chat at the top of the list; staff take over (the bot
 * goes quiet and says who joined), reply, and hand back (the bot answers again).
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';
import { chatHelpers } from './whatsapp-chat.js';

const ctx = createTestContext();
// Each test is a whole scripted chat (10+ messages, each a booking-engine turn): more time
// than the usual 20 s, for full runs on a busy machine. A stuck test still fails, later.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
const { guest, words, options, toSummary } = chatHelpers(ctx);

/** @param {string} token */
function as(token) {
  const withAuth = (/** @type {'get' | 'post'} */ method) => (/** @type {string} */ url) =>
    request(ctx.app)[method](url).set('Authorization', `Bearer ${token}`);
  return { get: withAuth('get'), post: withAuth('post') };
}

/** What the guest sees: every message in their chat, as the simulator shows it. */
async function seen(/** @type {any} */ g) {
  const res = await request(ctx.app).get(`/simulator/whatsapp/conversations/${g.token()}/messages`);
  return /** @type {any[]} */ (res.body.messages);
}

describe('taking over a chat (design: talk to a person, then back to the bot)', () => {
  it('who needs a person comes first; take over → reply → hand back, and the guest sees it all', async () => {
    const { operator, manager } = await ctx.seedOperator();
    const staff = as(await ctx.tokenFor(manager.id));
    const first = manager.name.trim().split(/\s+/)[0];

    const browsing = guest(operator.slug, '0803 000 0001');
    await browsing.say('Hi');
    const asking = guest(operator.slug, '0803 000 0002');
    await toSummary(asking, { tour: 'lagos-island-heritage-walk' });
    expect(words(await asking.tap('person'))).toMatch(
      /^I’ve asked the Ìrìn team to join\. They usually reply within a few minutes, 08:00–20:00\. Your seats stay held until \d\d:\d\d\. Until they reply, you can still type menu\.$|^The team is away now and back at 08:00\. I’ve passed on your message\. Your seats stay held until \d\d:\d\d; after that I can hold them again\.$/,
    );
    await browsing.tap('tours'); // the browsing guest wrote LAST, but isn't waiting

    const list = (await staff.get('/api/conversations')).body.conversations;
    expect(list.map((/** @type {any} */ c) => c.guest.phone)).toEqual([
      '+2348030000002',
      '+2348030000001',
    ]);
    expect(list[0]).toMatchObject({ handledBy: 'bot', needsPersonSince: expect.any(String) });
    expect(list[1].needsPersonSince).toBeNull();

    // Take over: an event line, not a message ("the assistant is paused").
    const id = list[0].id;
    const taken = await staff.post(`/api/conversations/${id}/take-over`);
    expect(taken.status).toBe(200);
    expect(taken.body.conversation).toMatchObject({ handledBy: 'staff', needsPersonSince: null });
    expect((await asking.chat()).at(-1).body).toEqual({
      kind: 'notice',
      text: `${first} from Ìrìn joined · the assistant is paused`,
    });
    // Twice is harmless: no second "joined".
    await staff.post(`/api/conversations/${id}/take-over`);
    expect((await asking.chat()).filter((m) => /joined/.test(m.body.text ?? ''))).toHaveLength(1);

    // While staff answer, the bot stays quiet, even for "menu".
    expect(await asking.say('Can you do a vegetarian version?')).toEqual([]);
    expect(await asking.say('menu')).toEqual([]);
    const reply = await staff
      .post(`/api/conversations/${id}/messages`)
      .send({ text: 'Yes, every stop. Shall I note it on your booking?' });
    expect(reply.status).toBe(201);
    expect(reply.body.message).toMatchObject({ author: 'staff', authorUserId: manager.id });
    // The guest sees a first name only ("Tolu · Ìrìn team").
    expect((await asking.chat()).at(-1)).toMatchObject({
      author: 'staff',
      authorName: first,
      body: { kind: 'text', text: 'Yes, every stop. Shall I note it on your booking?' },
    });

    // Hand back: an event line, then where we were, with the summary's buttons.
    const back = await staff.post(`/api/conversations/${id}/hand-back`);
    expect(back.body.conversation.handledBy).toBe('bot');
    const [left, welcome] = (await asking.chat()).slice(-2).map((m) => m.body);
    expect(left).toEqual({ kind: 'notice', text: `${first} handed back to the assistant` });
    expect(welcome.text).toMatch(
      /^Welcome back, Adaeze\. Here’s where we were: 2 seats on \w{3} \d+ \w{3} held until \d\d:\d\d, total ₦50,000\.$/,
    );
    expect(welcome.buttons.map((/** @type {any} */ b) => b.title)).toEqual([
      'Pay ₦50,000',
      'Change something',
      'Cancel',
    ]);
    expect(words(await asking.tap('pay'))).toContain('Here’s your secure payment link.');

    // For staff: the whole chat oldest first, staff messages with their full name.
    const chat = (await staff.get(`/api/conversations/${id}`)).body.conversation;
    const mine = chat.messages.find((/** @type {any} */ m) => m.author === 'staff');
    expect(mine.authorName).toBe(manager.name);
  });

  it('handed back mid-booking: “Here’s where we were:” and the question the guest was on', async () => {
    const { operator, manager } = await ctx.seedOperator();
    const staff = as(await ctx.tokenFor(manager.id));
    const g = guest(operator.slug);
    await g.say('Hi');
    await g.tap('tours');
    const dates = await g.tap('tour:lagos-island-heritage-walk');
    await g.tap(options(dates)[0].id);
    await g.tap('person');
    const [c] = (await staff.get('/api/conversations')).body.conversations;
    await staff.post(`/api/conversations/${c.id}/take-over`);
    await staff.post(`/api/conversations/${c.id}/hand-back`);
    const [where, question] = (await g.chat()).slice(-2).map((m) => m.body.text);
    expect(where).toBe('Welcome back, Adaeze. Here’s where we were:');
    expect(question).toMatch(/How many adults \(13 or over\)\?$/);
  });

  it('staff reply only after taking over (one voice at a time)', async () => {
    const { operator, manager } = await ctx.seedOperator();
    const staff = as(await ctx.tokenFor(manager.id));
    await guest(operator.slug).say('Hi');
    const [c] = (await staff.get('/api/conversations')).body.conversations;
    const res = await staff.post(`/api/conversations/${c.id}/messages`).send({ text: 'Hello!' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_TAKEN_OVER');
  });

  it('a guide can read chats but not take over; another business sees nothing', async () => {
    const { operator, guides } = await ctx.seedOperator();
    await guest(operator.slug).say('Hi');
    const guide = as(await ctx.tokenFor(guides[0].id));
    const [c] = (await guide.get('/api/conversations')).body.conversations;
    expect((await guide.get(`/api/conversations/${c.id}`)).status).toBe(200);
    expect((await guide.post(`/api/conversations/${c.id}/take-over`)).status).toBe(403);

    const other = await ctx.seedOperator();
    const theirs = as(await ctx.tokenFor(other.manager.id));
    expect((await theirs.get('/api/conversations')).body.conversations).toEqual([]);
    expect((await theirs.get(`/api/conversations/${c.id}`)).status).toBe(404);
    expect((await theirs.post(`/api/conversations/${c.id}/take-over`)).status).toBe(404);
    expect((await request(ctx.app).get('/api/conversations')).status).toBe(401);
  });

  it('messages show in the order they were written, even when they share a timestamp', async () => {
    // A guest's message and the bot's replies are written in one transaction, and Postgres'
    // now() is the transaction's start: same created_at. The order is `seq`.
    const { operator, manager } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await g.say('Hi');
    const c = await ctx.prisma.conversation.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    const at = new Date();
    const base = {
      operatorId: operator.id,
      conversationId: c.id,
      direction: 'out',
      author: 'bot',
      createdAt: at,
    };
    // Stored first, but numbered after: the order shown must follow the numbers.
    await ctx.prisma.chatMessage.create({
      data: { ...base, body: { kind: 'text', text: 'second' }, seq: 9_000_000_001n },
    });
    await ctx.prisma.chatMessage.create({
      data: { ...base, body: { kind: 'text', text: 'first' }, seq: 9_000_000_000n },
    });

    const texts = (/** @type {any[]} */ list) => list.slice(-2).map((m) => m.body.text);
    expect(texts(await seen(g))).toEqual(['first', 'second']);
    const staff = as(await ctx.tokenFor(manager.id));
    const chat = (await staff.get(`/api/conversations/${c.id}`)).body.conversation;
    expect(texts(chat.messages)).toEqual(['first', 'second']);
  });
});

describe('the simulator’s own limit', () => {
  it('more messages a minute than allowed from one address: 429', async () => {
    const { buildApp } = await import('./helpers.js');
    const app = buildApp({ prisma: ctx.prisma, simulatorLimit: 2 });
    const { operator } = await ctx.seedOperator();
    const send = () =>
      request(app)
        .post(`/simulator/whatsapp/${operator.slug}/messages`)
        .send({ phone: '0803 123 4567', text: 'hi' });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(429);
  });
});
