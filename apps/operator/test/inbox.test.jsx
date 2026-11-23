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
  alertsHeading,
  alertsTab,
  movedReply,
  replyLabel,
  requestsTab,
  boldParts,
  chatActions,
  chatsTab,
  deliveryWord,
  takeOverQuestion,
  assistantNote,
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

describe('requests (16d-2)', () => {
  const OPEN = {
    tab: 'open',
    openCount: 1,
    rows: [
      {
        id: 'r1',
        kind: 'change_date',
        kindLabel: 'Change the date',
        lead: 'Adaeze Okafor',
        message: 'Can we move to Sun 6 Dec?',
        sent: 'Sent Tue 1 Dec, 14:20 from their trip page · 0803 123 4567',
        waiting: 'waiting 2 h',
        reach: 'WhatsApp and email',
        replied: null,
        booking: {
          id: 'b7',
          reference: 'ILT-7K4Q2M',
          tour: 'Heritage Walk',
          when: 'Sat 5 Dec, 09:00',
          people: '3 travellers',
          paid: 'Paid ₦62,500',
          chip: { key: 'paid', text: 'Paid', tone: 'ok' },
          canMove: true,
        },
      },
    ],
  };
  const DONE = { tab: 'done', openCount: 1, rows: [] };
  const OPTIONS = {
    from: 'Sat 5 Dec, 09:00',
    travellers: 3,
    dates: [
      { id: 'd6', when: 'Sun 6 Dec, 09:00', free: 4, fits: true, text: '4 seats free' },
      { id: 'd7', when: 'Mon 7 Dec, 09:00', free: 1, fits: false, text: 'Only 1 free' },
    ],
  };
  const routes = (/** @type {any} */ extra = {}) => ({
    'GET /api/inbox/chats': () => [200, { chats: LIST }],
    'GET /api/inbox/requests?tab=open': () => [200, { requests: OPEN }],
    'GET /api/inbox/requests?tab=done': () => [200, { requests: DONE }],
    ...extra,
  });

  it('the words', () => {
    expect(requestsTab(1)).toBe('Requests · 1');
    expect(requestsTab(0)).toBe('Requests');
    expect(movedReply('Sun 6 Dec, 09:00')).toBe(
      'Done! You’re now booked for Sun 6 Dec, 09:00, same meeting point. Your trip page has the new date.',
    );
    expect(replyLabel(true)).toBe('Send and mark answered');
    expect(replyLabel(false)).toBe('Send reply');
  });

  it('asked the assistant (18a-2, C3): what it did, no Move or Cancel, "Add to the FAQs"', async () => {
    const question = {
      ...OPEN.rows[0],
      id: 'r9',
      kind: 'question',
      kindLabel: 'Asked the assistant',
      lead: 'Hannah Weber',
      message: 'Can I fly my drone over Freedom Park?',
      booking: { ...OPEN.rows[0].booking, productId: 'p1' },
    };
    fakeFetch(
      routes({
        'GET /api/inbox/requests?tab=open': () => [
          200,
          { requests: { ...OPEN, rows: [question] } },
        ],
      }),
    );
    await show('/inbox/requests/r9');
    expect(await screen.findByText('“Can I fly my drone over Freedom Park?”')).toBeTruthy();
    expect(screen.getAllByText('Asked the assistant').length).toBeGreaterThan(0);
    expect(screen.getByText('The assistant wasn’t sure')).toBeTruthy();
    expect(
      screen.getByText(
        'Nothing in the Heritage Walk’s notes covers this, so it told Hannah the team would reply. It said nothing else.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Move to another date…' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Cancel with a refund…' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open booking' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add to the FAQs' }).getAttribute('href')).toMatch(
      /\/settings\/tours\/p1$/,
    );
  });

  it('other kinds: no assistant box, no FAQ nudge', () => {
    expect(assistantNote(OPEN.rows[0])).toBeNull();
  });

  it('the tab, a request; moved (the reply ready), then the reply sent', async () => {
    const sent = fakeFetch(
      routes({
        'GET /api/bookings/b7/move-options': () => [200, { options: OPTIONS }],
        'POST /api/bookings/b7/move': () => [200, { moved: {} }],
        'POST /api/guest-requests/r1/reply': () => [201, { request: {} }],
      }),
    );
    await show('/inbox/requests/r1');
    expect(await screen.findByRole('link', { name: 'Requests · 1' })).toBeTruthy();
    expect(await screen.findByText('“Can we move to Sun 6 Dec?”')).toBeTruthy();
    expect(
      screen.getByText('Sent Tue 1 Dec, 14:20 from their trip page · 0803 123 4567'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Move to another date…' }));
    // A date that doesn't fit can't be chosen.
    expect(await screen.findByRole('radio', { name: /Mon 7 Dec/ })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Sun 6 Dec/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to Sun 6 Dec, 09:00' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Moved to Sun 6 Dec, 09:00. Adaeze is told by WhatsApp and email.',
    );
    expect(sent.find((x) => x.path.endsWith('/move'))?.body).toEqual({
      departureId: 'd6',
      requestId: 'r1',
    });
    const box = screen.getByRole('textbox', { name: /^Reply to Adaeze \(WhatsApp and email\)/ });
    expect(box).toHaveProperty('value', movedReply('Sun 6 Dec, 09:00'));

    fireEvent.click(screen.getByRole('button', { name: 'Send and mark answered' }));
    expect((await screen.findByRole('status')).textContent).toBe('Sent, and marked answered.');
    expect(sent.find((x) => x.path.endsWith('/reply'))?.body).toEqual({
      text: movedReply('Sun 6 Dec, 09:00'),
      markAnswered: true,
    });
  });

  it('a reply without marking answered; or answered with a note', async () => {
    const sent = fakeFetch(
      routes({
        'POST /api/guest-requests/r1/reply': () => [201, { request: {} }],
        'POST /api/guest-requests/r1/answer': () => [200, { request: {} }],
      }),
    );
    await show('/inbox/requests/r1');
    fireEvent.change(await screen.findByRole('textbox', { name: /^Reply to Adaeze/ }), {
      target: { value: 'Checking with the guide.' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark answered when sent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    expect((await screen.findByRole('status')).textContent).toBe('Sent.');
    expect(sent.find((x) => x.path.endsWith('/reply'))?.body).toEqual({
      text: 'Checking with the guide.',
      markAnswered: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Mark answered without replying' }));
    const mark = screen.getByRole('button', { name: 'Mark answered' });
    expect(mark).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('textbox', { name: 'What happened' }), {
      target: { value: 'Called her.' },
    });
    fireEvent.click(mark);
    expect((await screen.findByRole('status')).textContent).toBe('Marked answered.');
    expect(sent.find((x) => x.path.endsWith('/answer'))?.body).toEqual({ note: 'Called her.' });
  });

  it('no open requests: where they come from', async () => {
    fakeFetch(
      routes({
        'GET /api/inbox/requests?tab=open': () => [
          200,
          { requests: { ...OPEN, openCount: 0, rows: [] } },
        ],
      }),
    );
    await show('/inbox/requests');
    expect(
      await screen.findByText('No open requests. Guests ask from their trip page.'),
    ).toBeTruthy();
  });
});

describe('alerts (16d-3)', () => {
  const ALERTS = {
    alerts: [
      {
        key: 'refund:b1',
        kind: 'refund_failed',
        tone: 'urgent',
        icon: '!',
        title: 'Refund failed: ₦62,500',
        detail: 'Adaeze Okafor · ILT-7K4Q2M · card expired',
        action: 'Sort it out',
        href: '/bookings/b1',
      },
      {
        key: 'cash:c1',
        kind: 'cash',
        tone: 'info',
        icon: '₦',
        title: 'Cash to confirm: ₦45,500 from Femi',
        detail: 'Funmi Adeyemi · ILT-3MZ8RB · reported Sat 5 Dec, 07:12',
        action: 'Open booking',
        href: '/bookings/b2',
      },
    ],
    done: [
      {
        text: 'Refund of ₦31,250 sent by Kunle, Thu 3 Dec 15:02',
        detail: 'Bayo Adewale · ILT-9GT4VA',
        href: '/bookings/b3',
      },
    ],
  };
  const routes = (/** @type {any} */ alerts = ALERTS) => ({
    'GET /api/inbox/chats': () => [200, { chats: LIST }],
    'GET /api/inbox/requests?tab=open': () => [
      200,
      { requests: { tab: 'open', openCount: 0, rows: [] } },
    ],
    'GET /api/inbox/alerts': () => [200, alerts],
  });

  it('the words', () => {
    expect(alertsTab(4)).toBe('Alerts · 4');
    expect(alertsTab(0)).toBe('Alerts');
    expect(alertsHeading(4)).toBe('4 to deal with');
  });

  it('what to deal with, each with its action; done this week', async () => {
    fakeFetch(routes());
    await show('/inbox/alerts');
    expect(await screen.findByRole('link', { name: 'Alerts · 2' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '2 to deal with' })).toBeTruthy();
    const failed = screen.getByText('Refund failed: ₦62,500').closest('li');
    expect(failed?.className).toContain('alert-row--urgent');
    expect(
      within(/** @type {HTMLElement} */ (failed))
        .getByRole('link', { name: 'Sort it out' })
        .getAttribute('href'),
    ).toBe('/bookings/b1');
    expect(screen.getByRole('heading', { name: 'Done this week (1)' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Refund of ₦31,250 sent by Kunle/ }).getAttribute('href'),
    ).toBe('/bookings/b3');
  });

  it('nothing to deal with: says so', async () => {
    fakeFetch(routes({ alerts: [], done: [] }));
    await show('/inbox/alerts');
    expect(await screen.findByText('Nothing to deal with')).toBeTruthy();
    expect(screen.getByText('Nothing yet this week.')).toBeTruthy();
  });
});
