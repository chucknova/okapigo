/**
 * Stage 18a-2: "Ask a question" on the trip page (designs C1–C2): the card's states and words
 * (lib/ask.js), and the card itself with a fake API: tap a suggestion, an answer with its
 * source, "Looking in Ìrìn's notes…", passed to the team and the reply, the day's limit, not
 * available, no signal (saved answers), closed.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { AskCard } from '../src/screens/trip/AskCard.jsx';
import {
  askField,
  askFailure,
  askItems,
  askMode,
  askNotice,
  leftWords,
  savedAsk,
  saveAsk,
} from '../src/lib/ask.js';
import { saveTrip } from '../src/lib/trip-copy.js';
import { ApiError } from '../src/lib/api.js';

const T = 'T'.repeat(44);
const B = { operator: { timeZone: 'Africa/Lagos', whatsapp: '+2348090000123', phone: null } };
const STATE = (over = {}) => ({
  available: true,
  reason: null,
  left: 20,
  suggestions: ['What should I wear?', 'Is the walk suitable for children?'],
  messages: [],
  ...over,
});
const WEAR = {
  id: 'm1',
  question: 'What should I wear?',
  answer: 'Light clothes and walking shoes.',
  outcome: 'answered',
  source: 'What should I wear?',
  createdAt: '2026-11-22T15:00:00Z',
  reply: null,
};
const DRONE = {
  id: 'm2',
  question: 'Can I fly my drone?',
  answer: null,
  outcome: 'handed_over',
  source: null,
  createdAt: '2026-11-22T15:01:00Z',
  reply: { text: 'No drones, sorry.', at: '2026-11-22T16:05:00Z', by: 'Tunde' },
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('askMode: which state', () => {
  const open = STATE();
  it.each([
    [{ state: open, offline: false, phase: 'upcoming' }, 'open'],
    [{ state: open, offline: false, phase: 'cancelled' }, 'closed'],
    [{ state: open, offline: true, phase: 'no_show' }, 'closed'],
    [{ state: STATE({ reason: 'closed' }), offline: false, phase: 'after' }, 'closed'],
    [{ state: open, offline: false, phase: 'today', refused: 'closed' }, 'closed'],
    [{ state: STATE({ reason: 'limit' }), offline: true, phase: 'today' }, 'offline'],
    [{ state: STATE({ reason: 'limit' }), offline: false, phase: 'today' }, 'limit'],
    [{ state: open, offline: false, phase: 'today', refused: 'limit' }, 'limit'],
    [{ state: STATE({ reason: 'paused' }), offline: false, phase: 'after' }, 'paused'],
    [{ state: open, offline: false, phase: 'today', refused: 'paused' }, 'paused'],
    [{ state: null, offline: false, phase: 'upcoming' }, 'open'],
  ])('%o → %s', (input, mode) => {
    expect(askMode(/** @type {any} */ (input))).toBe(mode);
  });

  it('the field: shown, greyed while paused, gone otherwise; kept after a failed send', () => {
    expect(askField('open', null)).toBe('show');
    expect(askField('paused', null)).toBe('disabled');
    expect(askField('limit', null)).toBe('hidden');
    expect(askField('closed', null)).toBe('hidden');
    expect(askField('offline', null)).toBe('hidden');
    expect(askField('offline', 'offline')).toBe('show');
  });
});

describe('the words', () => {
  it('each state’s box (designs: C2 states)', () => {
    expect(askNotice('open', 'Ìrìn', 'upcoming')).toBeNull();
    expect(askNotice('limit', 'Ìrìn', 'today')).toEqual({
      tone: 'neutral',
      title: 'That’s all the questions for today',
      body: 'You can ask again tomorrow. For anything now, message Ìrìn.',
    });
    expect(askNotice('paused', 'Ìrìn', 'today')).toMatchObject({
      tone: 'warning',
      title: 'The assistant isn’t available right now',
    });
    expect(askNotice('offline', 'Ìrìn', 'today')).toMatchObject({
      tone: 'dark',
      title: 'No signal',
    });
    expect(askNotice('closed', 'Ìrìn', 'cancelled')?.body).toBe(
      'This booking is cancelled, so the assistant is closed. For anything about your refund, message Ìrìn.',
    );
    expect(askNotice('closed', 'Ìrìn', 'no_show')?.body).toBe(
      'Questions are closed for this booking. For anything else, message Ìrìn.',
    );
  });

  it('questions left: only from 5 down, so it doesn’t nag', () => {
    expect(leftWords(20)).toBeNull();
    expect(leftWords(6)).toBeNull();
    expect(leftWords(5)).toBe('5 questions left today');
    expect(leftWords(1)).toBe('1 question left today');
  });

  it('the conversation: an answer and its source, passed to the team, the reply', () => {
    const items = askItems(
      [
        WEAR,
        { ...WEAR, id: 'm0', source: null },
        DRONE,
        { ...DRONE, id: 'm3', outcome: 'unsure', reply: null },
        { ...DRONE, id: 'm4', reply: { ...DRONE.reply, by: null } },
      ],
      'Ìrìn',
      'Africa/Lagos',
    );
    expect(items.map((i) => i.type)).toEqual([
      'question',
      'answer',
      'question',
      'answer',
      'question',
      'handed',
      'reply',
      'question',
      'unsure',
      'question',
      'handed',
      'reply',
    ]);
    expect(items[1]).toMatchObject({
      text: 'Light clothes and walking shoes.',
      source: 'From Ìrìn’s notes: “What should I wear?”',
    });
    expect(items[3]).toMatchObject({ source: null });
    expect(items[5]).toMatchObject({ title: 'Passed to Ìrìn’s team' });
    // 16:05 UTC is 17:05 in Lagos.
    expect(items[6]).toMatchObject({
      title: 'Reply from Ìrìn',
      meta: 'Tunde · Sun 22 Nov, 17:05',
      text: 'No drones, sorry.',
    });
    expect(items[8]).toMatchObject({ title: 'I’m not sure about that' });
    expect(items[11]).toMatchObject({ meta: 'Sun 22 Nov, 17:05' });
  });

  it('a refused question: limit, closed, paused (503), no signal; else the server’s words', () => {
    expect(askFailure(new ApiError('offline', 'x'))).toBe('offline');
    expect(askFailure(new ApiError('timeout', 'x'))).toBe('offline');
    expect(askFailure(new ApiError('api', 'x', { status: 429, code: 'COMPANION_LIMIT' }))).toBe(
      'limit',
    );
    expect(askFailure(new ApiError('api', 'x', { status: 409, code: 'COMPANION_CLOSED' }))).toBe(
      'closed',
    );
    expect(askFailure(new ApiError('server', 'x', { status: 503 }))).toBe('paused');
    expect(askFailure(new ApiError('server', 'x', { status: 500 }))).toBeNull();
    expect(askFailure(new ApiError('api', 'x', { status: 400, code: 'VALIDATION' }))).toBeNull();
    expect(askFailure(new Error('x'))).toBeNull();
  });
});

describe('saved on this phone', () => {
  it('round trip; blocked storage is no error', () => {
    saveAsk(T, STATE({ messages: [WEAR] }));
    expect(savedAsk(T)?.messages).toEqual([WEAR]);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(savedAsk(T)).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveAsk(T, STATE())).not.toThrow();
  });

  it('cleared with the trip, two weeks after it ends', () => {
    const ended = { reference: 'ILT-1', departure: { endsAt: '2026-11-01T11:00:00Z' } };
    saveTrip(T, ended, Date.parse('2026-11-02T00:00:00Z'));
    saveAsk(T, STATE({ messages: [WEAR] }));
    // Another trip saved 15 days after that one ended clears it, and its conversation.
    saveTrip(
      'U'.repeat(44),
      { reference: 'ILT-2', departure: { endsAt: '2026-12-30T11:00:00Z' } },
      Date.parse('2026-11-16T12:00:00Z'),
    );
    expect(savedAsk(T)).toBeNull();
  });
});

/**
 * A fake API: GET the card → `state`; POST a question → `post(body)` (a Response, or a
 * promise of one).
 * @param {{ state?: any, post?: (body: any) => any }} f
 */
function fakeApi({ state = STATE(), post = () => new Response('{}', { status: 500 }) }) {
  const posted = /** @type {any[]} */ ([]);
  vi.stubGlobal('fetch', async (/** @type {string} */ url, /** @type {any} */ init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body);
      posted.push(body);
      return post(body);
    }
    if (url === `/public/bookings/${T}/companion`) {
      return new Response(JSON.stringify(state), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
  return posted;
}
const json = (/** @type {number} */ status, /** @type {any} */ body) =>
  new Response(JSON.stringify(body), { status });
const card = (props = {}) =>
  render(<AskCard token={T} b={B} op="Ìrìn" phase="upcoming" offline={false} {...props} />);

describe('the card', () => {
  it('C1: the tour’s FAQs to tap; tapping one asks it and shows the answer with its source', async () => {
    const posted = fakeApi({
      post: () => json(201, { message: WEAR, left: 19 }),
    });
    card();
    fireEvent.click(await screen.findByRole('button', { name: 'What should I wear?' }));
    expect(await screen.findByText('Light clothes and walking shoes.')).toBeTruthy();
    expect(screen.getByText('From Ìrìn’s notes: “What should I wear?”')).toBeTruthy();
    expect(posted).toEqual([{ question: 'What should I wear?' }]);
    // The suggestions go once there's a conversation; it's saved on this phone.
    expect(screen.queryByRole('button', { name: 'Is the walk suitable for children?' })).toBeNull();
    expect(savedAsk(T)?.messages).toEqual([WEAR]);
    expect(savedAsk(T)?.left).toBe(19);
  });

  it('asked before the page’s own load came back: the answer shows once, not twice', async () => {
    saveAsk(T, STATE());
    /** @type {(r: Response) => void} */
    let load = () => {};
    vi.stubGlobal('fetch', async (/** @type {string} */ _url, /** @type {any} */ init) => {
      if (init?.method === 'POST') return json(201, { message: WEAR, left: 19 });
      return new Promise((r) => (load = r));
    });
    card();
    fireEvent.click(screen.getByRole('button', { name: 'What should I wear?' }));
    expect(await screen.findByText('Light clothes and walking shoes.')).toBeTruthy();
    load(json(200, STATE({ messages: [WEAR], left: 19 })));
    await waitFor(() => expect(savedAsk(T)?.messages).toEqual([WEAR]));
    expect(screen.getAllByText('Light clothes and walking shoes.')).toHaveLength(1);
  });

  it('C2: "Looking in Ìrìn’s notes…" while it answers; Send waits', async () => {
    /** @type {(r: Response) => void} */
    let answer = () => {};
    fakeApi({ post: () => new Promise((r) => (answer = r)) });
    card();
    await screen.findByRole('button', { name: 'What should I wear?' });
    fireEvent.change(screen.getByLabelText('Your question'), {
      target: { value: '  Can my 4-year-old come? ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Looking in Ìrìn’s notes…')).toBeTruthy();
    expect(screen.getByText('Can my 4-year-old come?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
    answer(
      json(201, { message: { ...WEAR, id: 'k', question: 'Can my 4-year-old come?' }, left: 3 }),
    );
    await waitFor(() => expect(screen.queryByText('Looking in Ìrìn’s notes…')).toBeNull());
    expect(screen.getByText('3 questions left today')).toBeTruthy();
  });

  it('passed to the team, then the reply, from the saved conversation', async () => {
    fakeApi({ state: STATE({ messages: [DRONE], left: 4 }) });
    card();
    expect(await screen.findByText('Passed to Ìrìn’s team')).toBeTruthy();
    expect(screen.getByText('No drones, sorry.')).toBeTruthy();
    expect(screen.getByText('4 questions left today')).toBeTruthy();
    expect(screen.getByPlaceholderText('Ask another question')).toBeTruthy();
  });

  it('the day’s questions used (429): the box, WhatsApp, no field', async () => {
    fakeApi({
      post: () => json(429, { error: { code: 'COMPANION_LIMIT', message: 'That’s all.' } }),
    });
    card();
    fireEvent.click(await screen.findByRole('button', { name: 'What should I wear?' }));
    expect(await screen.findByText('That’s all the questions for today')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Message Ìrìn on WhatsApp' }).getAttribute('href'),
    ).toMatch(/^https:\/\/wa\.me\/2348090000123/);
    expect(screen.queryByLabelText('Your question')).toBeNull();
  });

  it('not available (503): the box, a Call link without WhatsApp, the field greyed out', async () => {
    fakeApi({ post: () => new Response('', { status: 503 }) });
    card({ b: { operator: { ...B.operator, whatsapp: null, phone: '+2348011111111' } } });
    fireEvent.click(await screen.findByRole('button', { name: 'What should I wear?' }));
    expect(await screen.findByText('The assistant isn’t available right now')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Call Ìrìn' }).getAttribute('href')).toBe(
      'tel:+2348011111111',
    );
    expect(screen.getByLabelText('Your question').hasAttribute('disabled')).toBe(true);
  });

  it('the card already paused when it opens', async () => {
    fakeApi({ state: STATE({ available: false, reason: 'paused' }) });
    card();
    expect(await screen.findByText('The assistant isn’t available right now')).toBeTruthy();
  });

  it('no signal: the saved answers, "No signal", no field, no footer', () => {
    saveAsk(T, STATE({ messages: [WEAR] }));
    const posted = fakeApi({});
    card({ offline: true });
    expect(screen.getByText('Light clothes and walking shoes.')).toBeTruthy();
    expect(screen.getByText('No signal')).toBeTruthy();
    expect(screen.queryByLabelText('Your question')).toBeNull();
    expect(screen.queryByText(/^Automated answers/)).toBeNull();
    expect(posted).toEqual([]);
  });

  it('a question that fails for lack of signal keeps its words, to send again', async () => {
    fakeApi({});
    vi.stubGlobal('fetch', async (/** @type {string} */ _url, /** @type {any} */ init) => {
      if (init?.method === 'POST') throw new TypeError('Failed to fetch');
      return json(200, STATE());
    });
    card();
    await screen.findByRole('button', { name: 'What should I wear?' });
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Where?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('No signal')).toBeTruthy();
    expect(/** @type {HTMLInputElement} */ (screen.getByLabelText('Your question')).value).toBe(
      'Where?',
    );
  });

  it('another refusal: the server’s own words, and the question kept', async () => {
    fakeApi({
      post: () =>
        json(400, { error: { code: 'VALIDATION', message: 'Please keep your question shorter.' } }),
    });
    card();
    await screen.findByRole('button', { name: 'What should I wear?' });
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Long…' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Please keep your question shorter.',
    );
    expect(/** @type {HTMLInputElement} */ (screen.getByLabelText('Your question')).value).toBe(
      'Long…',
    );
  });

  it('cancelled: one short card, closed', () => {
    fakeApi({});
    card({ phase: 'cancelled' });
    const region = screen.getByRole('region', { name: 'Questions' });
    expect(within(region).getByText(/This booking is cancelled/)).toBeTruthy();
    expect(screen.queryByLabelText('Your question')).toBeNull();
  });
});
