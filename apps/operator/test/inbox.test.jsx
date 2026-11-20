/**
 * The inbox's chats (O9), stage 16d-1: the words in lib/inbox.js, then the screen against a
 * fake server: the list, a chat taken over (reply, hand back), a colleague's chat, WhatsApp's
 * 24-hour rule, a failed message.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '../src/App.jsx';
import { EngineContext } from '../src/lib/engine.jsx';
import { createSyncEngine } from '../src/lib/sync.js';
import { createMemoryStore } from '../src/lib/store.js';
import { request } from '../src/lib/api.js';
import { clearLive } from '../src/lib/live.js';
import {
  boldParts,
  chatActions,
  chatsTab,
  deliveryWord,
  takeOverQuestion,
} from '../src/lib/inbox.js';

afterEach(() => {
  cleanup();
  clearLive();
  vi.unstubAllGlobals();
});

const ME = {
  user: { name: 'Kunle Bello', role: { key: 'manager', name: 'Manager' } },
  operator: { name: 'Ìrìn Lagos Tours', timeZone: 'Africa/Lagos' },
  permissions: { bookings: 'edit', operations: 'edit' },
  owner: { name: 'Bisola Adeyemi' },
};

const LIST = {
  needs: [
    {
      id: 'c1',
      name: 'Yemi Ojo',
      last: 'Is the lunch on the Badagry trip halal?',
      wait: 'waiting 3 min',
      waiting: true,
      state: 'Waiting for a person',
      mode: 'bot',
    },
  ],
  bot: [
    {
      id: 'c2',
      name: 'Bayo Adewale',
      last: 'Choosing a date',
      wait: '10:51',
      waiting: false,
      state: null,
      mode: 'bot',
    },
  ],
  needsCount: 1,
};

const CHAT = {
  id: 'c1',
  name: 'Yemi Ojo',
  phone: '0813 902 4417',
  sub: '0813 902 4417 · WhatsApp · last message 10:47',
  mode: 'mine',
  holder: 'Kunle Bello',
  stateLine: 'You’re replying · bot paused',
  theirsNote: null,
  window: { open: true },
  messages: [
    {
      id: 'm1',
      side: 'in',
      who: 'Yemi Ojo',
      text: 'Is the lunch halal?',
      buttons: [],
      time: '10:47',
      delivery: null,
      failed: false,
      failedWhy: null,
    },
    {
      id: 'm2',
      side: 'notice',
      who: 'Bot',
      text: 'Kunle from Ìrìn joined · the assistant is paused',
      buttons: [],
      time: '10:48',
      delivery: null,
      failed: false,
      failedWhy: null,
    },
    {
      id: 'm3',
      side: 'out',
      who: 'Kunle · Ìrìn team',
      text: 'Yes, *halal*.',
      buttons: [],
      time: '10:49',
      delivery: 'read',
      failed: false,
      failedWhy: null,
    },
  ],
  booking: {
    id: 'b1',
    reference: 'ILT-2LW9DK',
    chip: { key: 'owes', text: 'Owes ₦45,500', tone: 'warning', expiresAt: null },
    tour: 'Badagry Day Trip',
    when: 'Sat 12 Dec, 07:00',
    people: '1 traveller',
    total: '₦65,000',
    hasEmail: true,
  },
};

/** @param {Record<string, (body: any) => [number, any]>} routes */
function fakeFetch(routes) {
  /** @type {{ method: string, path: string, body: any }[]} */
  const sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body) : undefined;
      sent.push({ method, path, body });
      const route = routes[`${method} ${path}`];
      if (!route)
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: path } }), {
          status: 404,
        });
      const [status, json] = route(body);
      return new Response(JSON.stringify(json), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return sent;
}

/** @param {string} path */
async function show(path) {
  const engine = createSyncEngine({
    request,
    store: createMemoryStore({
      session: { token: 'tok', user: ME.user, contact: 'x' },
      meta: { firstRunDone: true },
      me: ME,
    }),
  });
  await engine.load();
  const { hook } = memoryLocation({ path });
  render(
    <EngineContext.Provider value={engine}>
      <Router hook={hook}>
        <App base="" />
      </Router>
    </EngineContext.Provider>,
  );
}

describe('inbox.js: the words', () => {
  it('what a chat lets you do', () => {
    const open = { open: true };
    const shut = { open: false };
    expect(chatActions({ mode: 'bot', window: open })).toEqual({
      takeOver: true,
      takeOverFrom: null,
      handBack: false,
      reply: false,
      followUp: false,
    });
    expect(chatActions({ mode: 'mine', window: open })).toMatchObject({
      handBack: true,
      reply: true,
      followUp: false,
    });
    // Outside the 24 hours: no reply box; the approved message instead.
    expect(chatActions({ mode: 'mine', window: shut })).toMatchObject({
      reply: false,
      followUp: true,
    });
    expect(chatActions({ mode: 'bot', window: shut }).followUp).toBe(true);
    expect(chatActions({ mode: 'theirs', holder: 'Ngozi Eze', window: shut })).toEqual({
      takeOver: false,
      takeOverFrom: 'Ngozi',
      handBack: false,
      reply: false,
      followUp: false,
    });
  });

  it('the tick, the question, the tab, WhatsApp’s bold', () => {
    expect(deliveryWord('read')).toBe('read');
    expect(deliveryWord('delivered')).toBe('delivered');
    expect(deliveryWord('sent')).toBe('');
    expect(deliveryWord(null)).toBe('');
    expect(takeOverQuestion('Ngozi Eze')).toBe(
      'Take over from Ngozi? They’ll see you have the chat, and only you can reply.',
    );
    expect(chatsTab(2)).toBe('Chats · 2');
    expect(chatsTab(0)).toBe('Chats');
    expect(boldParts('*Street Food Crawl* tonight')).toEqual([
      { bold: true, text: 'Street Food Crawl' },
      { bold: false, text: ' tonight' },
    ]);
    expect(boldParts('a *b* c')).toEqual([
      { bold: false, text: 'a ' },
      { bold: true, text: 'b' },
      { bold: false, text: ' c' },
    ]);
    expect(boldParts('2 * 3')).toEqual([{ bold: false, text: '2 * 3' }]);
  });
});

describe('the inbox', () => {
  it('the list: needs a person, then with the bot', async () => {
    fakeFetch({ 'GET /api/inbox/chats': () => [200, { chats: LIST }] });
    await show('/inbox');
    expect(await screen.findByText('Chats · 1')).toBeTruthy();
    const waiting = screen.getByRole('link', { name: /Yemi Ojo/ });
    expect(waiting.getAttribute('href')).toBe('/inbox/c1');
    expect(within(waiting).getByText('waiting 3 min').className).toContain('tone--urgent');
    expect(screen.getByRole('heading', { name: 'With the bot' })).toBeTruthy();
    expect(screen.getByText('Choose a chat to see it here.')).toBeTruthy();
  });

  it('nothing needs you: says so', async () => {
    fakeFetch({
      'GET /api/inbox/chats': () => [200, { chats: { ...LIST, needs: [], needsCount: 0 } }],
    });
    await show('/inbox');
    expect(await screen.findByText('Nothing needs you right now')).toBeTruthy();
    expect(screen.getByText('The bot is handling 1 chat.')).toBeTruthy();
  });

  it('a chat taken over: the messages, the booking beside it; reply; hand back', async () => {
    const sent = fakeFetch({
      'GET /api/inbox/chats': () => [200, { chats: LIST }],
      'GET /api/inbox/chats/c1': () => [200, { chat: CHAT }],
      'POST /api/conversations/c1/messages': () => [201, { message: {} }],
      'POST /api/conversations/c1/hand-back': () => [200, { conversation: {} }],
    });
    await show('/inbox/c1');
    expect(await screen.findByText('You’re replying · bot paused')).toBeTruthy();
    expect(screen.getByText('halal', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText('10:49 · read')).toBeTruthy();
    expect(
      screen.getByText('Kunle from Ìrìn joined · the assistant is paused · 10:48'),
    ).toBeTruthy();
    const booking = screen.getByRole('complementary', { name: 'Booking from this chat' });
    expect(within(booking).getByText('Owes ₦45,500')).toBeTruthy();
    expect(within(booking).getByRole('link', { name: 'Open booking' }).getAttribute('href')).toBe(
      '/bookings/b1',
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Reply as Kunle' }), {
      target: { value: ' Yes, from a halal kitchen. ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await vi.waitFor(() =>
      expect(sent.find((x) => x.path.endsWith('/messages'))?.body).toEqual({
        text: 'Yes, from a halal kitchen.',
      }),
    );
    // Sent: the box empties (and the buttons work again).
    await vi.waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Reply as Kunle' })).toHaveProperty('value', ''),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hand back to the bot' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Handed back. The bot tells the guest where things were.',
    );
  });

  it('a colleague’s chat: no reply box; take over on purpose', async () => {
    const sent = fakeFetch({
      'GET /api/inbox/chats': () => [200, { chats: LIST }],
      'GET /api/inbox/chats/c1': () => [
        200,
        {
          chat: {
            ...CHAT,
            mode: 'theirs',
            holder: 'Ngozi Eze',
            stateLine: 'Ngozi is replying · bot paused',
            theirsNote: 'Only Ngozi can reply while they have this chat (since 10:52).',
          },
        },
      ],
      'POST /api/conversations/c1/take-over': () => [200, { conversation: {} }],
    });
    await show('/inbox/c1');
    expect(
      await screen.findByText('Only Ngozi can reply while they have this chat (since 10:52).'),
    ).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Reply as/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Take over from Ngozi' }));
    expect(
      screen.getByRole('heading', {
        name: 'Take over from Ngozi? They’ll see you have the chat, and only you can reply.',
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    await vi.waitFor(() =>
      expect(sent.find((x) => x.path.endsWith('/take-over'))?.body).toEqual({
        fromColleague: true,
      }),
    );
  });

  it('outside the 24 hours: the reason, the approved message, a call; no reply box', async () => {
    const sent = fakeFetch({
      'GET /api/inbox/chats': () => [200, { chats: LIST }],
      'GET /api/inbox/chats/c1': () => [
        200,
        {
          chat: {
            ...CHAT,
            window: {
              open: false,
              text: 'Yemi last wrote 2 days ago. WhatsApp only lets you send approved messages until they write again.',
              followUp: 'Hi Yemi…',
            },
          },
        },
      ],
      'POST /api/conversations/c1/follow-up': () => [201, { message: {} }],
    });
    await show('/inbox/c1');
    expect(await screen.findByText(/^Yemi last wrote 2 days ago\./)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Reply as/ })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Call 0813 902 4417 instead' }).getAttribute('href'),
    ).toBe('tel:08139024417');
    fireEvent.click(screen.getByRole('button', { name: 'Send “Can we help you finish booking?”' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Sent. When they reply, you can write freely again.',
    );
    expect(sent.some((x) => x.method === 'POST' && x.path.endsWith('/follow-up'))).toBe(true);
  });

  it('a message that failed: retry, or by email (only with an email)', async () => {
    const failed = {
      ...CHAT.messages[2],
      id: 'm9',
      delivery: 'failed',
      failed: true,
      failedWhy: 'number unreachable',
    };
    const sent = fakeFetch({
      'GET /api/inbox/chats': () => [200, { chats: LIST }],
      'GET /api/inbox/chats/c1': () => [200, { chat: { ...CHAT, messages: [failed] } }],
      'POST /api/conversations/c1/messages/m9/retry': () => [201, { message: {} }],
      'POST /api/conversations/c1/messages/m9/email': () => [202, { queued: true }],
    });
    await show('/inbox/c1');
    expect(await screen.findByText('Not delivered: number unreachable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect((await screen.findByRole('status')).textContent).toBe('Sent again.');
    fireEvent.click(screen.getByRole('button', { name: 'Send by email' }));
    expect((await screen.findByRole('status')).textContent).toBe('It’ll go by email in a moment.');
    expect(sent.filter((x) => x.method === 'POST').map((x) => x.path)).toEqual([
      '/api/conversations/c1/messages/m9/retry',
      '/api/conversations/c1/messages/m9/email',
    ]);
  });

  it('no email for the guest: no "Send by email"', async () => {
    const failed = { ...CHAT.messages[2], failed: true, failedWhy: 'x', delivery: 'failed' };
    fakeFetch({
      'GET /api/inbox/chats': () => [200, { chats: LIST }],
      'GET /api/inbox/chats/c1': () => [
        200,
        { chat: { ...CHAT, messages: [failed], booking: { ...CHAT.booking, hasEmail: false } } },
      ],
    });
    await show('/inbox/c1');
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send by email' })).toBeNull();
  });
});
