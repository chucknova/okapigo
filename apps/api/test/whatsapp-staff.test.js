/**
 * Session 13b: staff and WhatsApp chats (flow brief screen H; the screen comes later, the API
 * now). "Talk to a person" puts the chat at the top of the list; staff take over (the bot
 * goes quiet and says who joined), reply, and hand back (the bot answers again).
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';
import { chatHelpers } from './whatsapp-chat.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
const { guest, words } = chatHelpers(ctx);

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

describe('taking over a chat', () => {
  it('who needs a person comes first; take over → reply → hand back, and the guest sees it all', async () => {
    const { operator, manager } = await ctx.seedOperator();
    const staff = as(await ctx.tokenFor(manager.id));

    const browsing = guest(operator.slug, '0803 000 0001');
    await browsing.say('Hi');
    const asking = guest(operator.slug, '0803 000 0002');
    await asking.say('Hi');
    await asking.say('Can I talk to a person?');
    await browsing.tap('tours'); // the browsing guest wrote LAST, but isn't waiting

    const list = (await staff.get('/api/conversations')).body.conversations;
    expect(list.map((/** @type {any} */ c) => c.guest.phone)).toEqual([
      '+2348030000002',
      '+2348030000001',
    ]);
    expect(list[0]).toMatchObject({ handledBy: 'bot', needsPersonSince: expect.any(String) });
    expect(list[1].needsPersonSince).toBeNull();
    expect(list[0].lastMessage.body.text).toContain('team to join');

    // Take over: the guest is told who joined; the chat is no longer waiting.
    const id = list[0].id;
    const taken = await staff.post(`/api/conversations/${id}/take-over`);
    expect(taken.status).toBe(200);
    expect(taken.body.conversation).toMatchObject({ handledBy: 'staff', needsPersonSince: null });
    expect((await seen(asking)).at(-1).body.text).toMatch(
      / from the Ìrìn team has joined the chat\.$/,
    );
    // Twice is harmless: no second "has joined".
    await staff.post(`/api/conversations/${id}/take-over`);
    expect((await seen(asking)).filter((m) => /has joined/.test(m.body.text ?? ''))).toHaveLength(
      1,
    );

    // While staff answer, the bot stays quiet, even for "menu".
    expect(await asking.say('Is there parking at the start?')).toEqual([]);
    expect(await asking.say('menu')).toEqual([]);
    const reply = await staff
      .post(`/api/conversations/${id}/messages`)
      .send({ text: 'Yes, at Tafawa Balewa Square.' });
    expect(reply.status).toBe(201);
    expect(reply.body.message).toMatchObject({ author: 'staff', authorUserId: manager.id });
    expect((await seen(asking)).at(-1)).toMatchObject({
      author: 'staff',
      body: { kind: 'text', text: 'Yes, at Tafawa Balewa Square.' },
    });

    // Hand back: the bot says so, and answers again.
    const back = await staff.post(`/api/conversations/${id}/hand-back`);
    expect(back.body.conversation.handledBy).toBe('bot');
    expect((await seen(asking)).at(-1).body.text).toContain("I'm here if you need anything else");
    expect(words(await asking.tap('tours'))).toContain('Here are our tours');

    // The whole chat, for staff, oldest first.
    const chat = (await staff.get(`/api/conversations/${id}`)).body.conversation;
    expect(chat.messages.map((/** @type {any} */ m) => m.author)).toEqual([
      'guest',
      'bot', // Hi
      'guest',
      'bot', // a person please
      'bot', // has joined
      'guest',
      'guest', // parking? menu (no answer from the bot)
      'staff',
      'bot', // handed back
      'guest',
      'bot', // tours
    ]);
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
