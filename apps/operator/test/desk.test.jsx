/**
 * The bookings desk (O8), stage 16c-1: the words in lib/desk.js, then the screen against a
 * fake server: the list, a booking's page, releasing held seats, a note, no-shows.
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
  actionButtons,
  chipText,
  heldLeft,
  listPath,
  noMatch,
  noShowLabel,
  resultsLine,
} from '../src/lib/desk.js';

afterEach(() => {
  cleanup();
  clearLive();
  vi.unstubAllGlobals();
});

const ME = {
  user: { name: 'Tunde Bakare', role: { key: 'manager', name: 'Manager' } },
  operator: { name: 'Ìrìn Lagos Tours', timeZone: 'Africa/Lagos' },
  permissions: { bookings: 'edit', operations: 'edit' },
  owner: { name: 'Bisola Adeyemi' },
};

const on = { enabled: true, why: '' };
const off = (/** @type {string} */ why) => ({ enabled: false, why });

const ROWS = [
  {
    id: 'b1',
    lead: 'Funmi Adeyemi',
    reference: 'ILT-3MZ8RB',
    tour: 'Badagry Day Trip · Sat 5 Dec',
    phone: '0805 987 6543',
    chip: { key: 'cash', text: 'Cash to confirm', tone: 'info', expiresAt: null },
  },
  {
    id: 'b2',
    lead: 'Ifeoma Eze',
    reference: 'ILT-8CV2QA',
    tour: 'Heritage Walk · Sun 6 Dec',
    phone: '0816 220 9031',
    chip: {
      key: 'held',
      text: 'Held',
      tone: 'held',
      expiresAt: new Date(Date.now() + 760_000).toISOString(),
    },
  },
];

const OWES = {
  id: 'b3',
  reference: 'ILT-2LW9DK',
  status: 'part_paid',
  departureId: 'd1',
  holdId: 'h3',
  refLine: 'ILT-2LW9DK · WHATSAPP · BOOKED FRI 20 NOV',
  lead: 'Yemi Ojo',
  phone: '0813 902 4417',
  sub: '0813 902 4417 · no email · Badagry Heritage Day Trip · Sat 12 Dec, 07:00 · 2 adults',
  chip: { key: 'owes', text: 'Owes ₦45,500', tone: 'warning', expiresAt: null },
  banner: {
    kind: 'owes',
    tone: 'warning',
    title: 'Balance of ₦45,500 is due today',
    text: 'Deposit paid on 20 Nov. Nothing is cancelled automatically: send a link, call them, or cancel.',
    call: '0813 902 4417',
  },
  money: [
    { label: '1 adult ₦65,000', value: '₦65,000', tone: 'ink' },
    { label: 'Deposit · card · 20 Nov', value: '₦19,500 paid', tone: 'ok' },
    { label: 'Still owed · due Sat 5 Dec', value: '₦45,500', tone: 'warning', total: true },
  ],
  travellers: [
    {
      id: 't1',
      name: 'Yemi Ojo',
      kind: 'Adult · lead',
      checkInStatus: 'present',
      state: { text: 'Present 07:05', tone: 'ok' },
    },
    {
      id: 't2',
      name: 'Guest 2',
      kind: 'Adult',
      checkInStatus: 'pending',
      state: { text: '', tone: 'muted' },
    },
  ],
  checkedInBy: 'Checked in by Femi',
  messages: [
    { id: 'n1', date: '20 Nov', what: 'Deposit received', text: 'WhatsApp · read', tone: 'ok' },
    {
      id: 'n2',
      date: '4 Dec',
      what: 'Balance reminder (1 day)',
      text: 'WhatsApp · failed: number unreachable',
      tone: 'urgent',
    },
  ],
  timeline: ['Fri 20 Nov 21:03 · booked on WhatsApp', 'Fri 20 Nov 21:04 · part paid ₦19,500'],
  actions: {
    paymentLink: on,
    changeTravellers: on,
    addNote: on,
    noShow: on,
    cancel: on,
    release: off('Only while seats are held'),
  },
  noShowLine: 'Policy: no refund for a no-show.',
  trip: { started: true, date: '2026-12-12' },
};

const HELD = {
  ...OWES,
  id: 'b2',
  status: 'held',
  holdId: 'h2',
  lead: 'Ifeoma Eze',
  chip: ROWS[1].chip,
  banner: {
    kind: 'held',
    tone: 'held',
    title: 'Seats held until 17:58',
    expiresAt: ROWS[1].chip.expiresAt,
    text: 'The guest is paying right now (on the website).',
  },
  messages: [],
  actions: {
    paymentLink: off('Not booked yet'),
    changeTravellers: off('Not booked yet'),
    addNote: on,
    noShow: off('Not booked yet'),
    cancel: off('Nothing to cancel yet'),
    release: on,
  },
};

/**
 * A fake server: routes by "METHOD path".
 * @param {Record<string, (body: any) => [number, any]>} routes
 */
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
      return new Response(status === 204 ? null : JSON.stringify(json), {
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

const list = (/** @type {any} */ o = {}) => ({
  filter: 'today',
  q: '',
  rows: ROWS,
  more: false,
  ...o,
});

describe('desk.js: the words', () => {
  it('the list’s address, the countdown, the results line, nothing found', () => {
    expect(listPath('today', '')).toBe('/api/desk/bookings?filter=today');
    expect(listPath('all', ' 0805 987 ')).toBe('/api/desk/bookings?filter=all&q=0805+987');
    const now = Date.parse('2026-12-05T16:45:20Z');
    expect(heldLeft('2026-12-05T16:58:00Z', now)).toBe('12:40');
    expect(heldLeft('2026-12-05T16:45:25Z', now)).toBe('0:05');
    expect(heldLeft('2026-12-05T16:40:00Z', now)).toBe('0:00');
    expect(heldLeft(null, now)).toBe('');
    expect(chipText({ key: 'held', text: 'Held', expiresAt: '2026-12-05T16:58:00Z' }, now)).toBe(
      'Held · 12:40',
    );
    expect(chipText({ key: 'paid', text: 'Paid' }, now)).toBe('Paid');
    expect(resultsLine(3, '0805')).toBe('3 results for “0805”');
    expect(resultsLine(1, 'Ojo ')).toBe('1 result for “Ojo”');
    expect(resultsLine(3, '')).toBe('');
    expect(noMatch('upcoming', 'Okonkwo')).toBe('No upcoming bookings match “Okonkwo”');
    expect(noMatch('cash', '')).toBe('No bookings with cash to confirm.');
  });

  it('the buttons built so far, in order; no-shows counted from who’s not checked in', () => {
    expect(actionButtons(OWES.actions).map((b) => b.label)).toEqual(['Add note', 'Mark no-show']);
    expect(actionButtons(HELD.actions).find((b) => b.key === 'noShow')).toMatchObject({
      enabled: false,
      why: 'Not booked yet',
    });
    expect(noShowLabel(OWES.travellers, [])).toBe('Choose who didn’t come');
    expect(noShowLabel(OWES.travellers, ['t2'])).toBe('Mark 1 no-show');
    // Someone already present doesn't count.
    expect(noShowLabel(OWES.travellers, ['t1', 't2'])).toBe('Mark 1 no-show');
    const three = [1, 2, 3].map((n) => ({ id: `x${n}`, checkInStatus: 'pending' }));
    expect(noShowLabel(three, ['x1', 'x2', 'x3'])).toBe('Mark 3 no-shows');
  });
});

describe('the desk', () => {
  it('the list: rows with their status, a filter, a search', async () => {
    const sent = fakeFetch({
      'GET /api/desk/bookings?filter=today': () => [200, { list: list() }],
      'GET /api/desk/bookings?filter=owes': () => [
        200,
        { list: list({ filter: 'owes', rows: [] }) },
      ],
      'GET /api/desk/bookings?filter=owes&q=okonkwo': () => [
        200,
        { list: list({ filter: 'owes', q: 'okonkwo', rows: [] }) },
      ],
      'GET /api/desk/bookings?filter=all&q=okonkwo': () => [
        200,
        { list: list({ filter: 'all', q: 'okonkwo', rows: [ROWS[0]] }) },
      ],
      'GET /api/desk/bookings?filter=all&q=zzz': () => [
        200,
        { list: list({ filter: 'all', q: 'zzz', rows: [] }) },
      ],
    });
    await show('/bookings');
    const row = await screen.findByRole('link', { name: /Funmi Adeyemi/ });
    expect(row.getAttribute('href')).toBe('/bookings/b1');
    expect(within(row).getByText('Cash to confirm').className).toContain('status-chip--info');
    expect(screen.getByText(/^Held · 1[23]:\d\d$/)).toBeTruthy();
    expect(screen.getByText('Choose a booking to see it here.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Owes money' }));
    expect(await screen.findByText('No bookings owing money.')).toBeTruthy();
    // Typed letter by letter: one search, once typing pauses.
    for (const typed of ['o', 'ok', 'oko', 'okon', 'okonk', 'okonkw', 'okonkwo'])
      fireEvent.change(screen.getByRole('searchbox', { name: /Search/ }), {
        target: { value: typed },
      });
    expect(await screen.findByText('No bookings owing money match “okonkwo”')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Search all bookings (past and cancelled)' }),
    );
    expect(await screen.findByText('1 result for “okonkwo”')).toBeTruthy();
    // Nothing found among all bookings: nowhere wider to look.
    fireEvent.change(screen.getByRole('searchbox', { name: /Search/ }), {
      target: { value: 'zzz' },
    });
    expect(await screen.findByText('No bookings match “zzz”')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Search all bookings/ })).toBeNull();
    // One request per search, not one per letter.
    expect(sent.filter((x) => /q=o/.test(x.path)).map((x) => x.path)).toEqual([
      '/api/desk/bookings?filter=owes&q=okonkwo',
      '/api/desk/bookings?filter=all&q=okonkwo',
    ]);
  });

  it('a booking: the banner, money, travellers, messages, timeline; actions and why not', async () => {
    fakeFetch({
      'GET /api/desk/bookings?filter=today': () => [200, { list: list() }],
      'GET /api/desk/bookings/b3': () => [200, { booking: OWES }],
    });
    await show('/bookings/b3');
    expect(await screen.findByRole('heading', { name: 'Yemi Ojo' })).toBeTruthy();
    const banner = screen.getByRole('region', { name: 'Balance of ₦45,500 is due today' });
    expect(
      within(banner).getByRole('link', { name: 'Call 0813 902 4417' }).getAttribute('href'),
    ).toBe('tel:08139024417');
    expect(screen.getByText('₦19,500 paid').className).toContain('tone--ok');
    expect(screen.getByText('Still owed · due Sat 5 Dec').closest('tr')?.className).toBe(
      'money-total',
    );
    expect(screen.getByText('WhatsApp · failed: number unreachable').className).toContain(
      'tone--urgent',
    );
    expect(screen.getByText('Checked in by Femi')).toBeTruthy();
    expect(screen.getByText('Fri 20 Nov 21:03 · booked on WhatsApp')).toBeTruthy();
    expect(screen.getByRole('link', { name: '‹ Bookings' }).getAttribute('href')).toBe('/bookings');
  });

  it('held: counting down; releasing the seats', async () => {
    let released = false;
    const sent = fakeFetch({
      'GET /api/desk/bookings?filter=today': () => [200, { list: list() }],
      'GET /api/desk/bookings/b2': () => [
        200,
        {
          booking: released
            ? {
                ...HELD,
                banner: null,
                chip: { key: 'cancelled', text: 'Cancelled', tone: 'muted' },
              }
            : HELD,
        },
      ],
      'DELETE /api/holds/h2': () => ((released = true), [204, null]),
    });
    await show('/bookings/b2');
    expect(await screen.findByText(/^Seats held until 17:58 \(1[23]:\d\d left\)$/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark no-show' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Release the seats now' }));
    expect((await screen.findByRole('status')).textContent).toBe('Seats released.');
    expect(sent.some((x) => x.method === 'DELETE' && x.path === '/api/holds/h2')).toBe(true);
    expect(await screen.findByText('Cancelled', { selector: '.status-chip--big' })).toBeTruthy();
  });

  it('a note: written, on the manifest if ticked, then saved', async () => {
    const sent = fakeFetch({
      'GET /api/desk/bookings?filter=today': () => [200, { list: list() }],
      'GET /api/desk/bookings/b3': () => [200, { booking: OWES }],
      'POST /api/bookings/b3/notes': () => [201, { note: { id: 'e1' } }],
    });
    await show('/bookings/b3');
    fireEvent.click(await screen.findByRole('button', { name: 'Add note' }));
    const save = screen.getByRole('button', { name: 'Save note' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Halal lunch for Yemi and Tobi.' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show on the guide’s manifest' }));
    fireEvent.click(save);
    expect((await screen.findByRole('status')).textContent).toBe(
      'Note saved, and on the guide’s manifest.',
    );
    expect(sent.find((x) => x.method === 'POST')?.body).toEqual({
      text: 'Halal lunch for Yemi and Tobi.',
      onManifest: true,
    });
  });

  it('no-shows: the ones not checked in, ticked; the policy; a refusal in the server’s words', async () => {
    const sent = fakeFetch({
      'GET /api/desk/bookings?filter=today': () => [200, { list: list() }],
      'GET /api/desk/bookings/b3': () => [200, { booking: OWES }],
      'POST /api/departures/d1/check-ins': () => [
        409,
        { error: { code: 'CHANGED_FIRST', message: 'Femi checked them in a moment ago.' } },
      ],
    });
    await show('/bookings/b3');
    fireEvent.click(await screen.findByRole('button', { name: 'Mark no-show' }));
    expect(screen.getByText('Yemi Ojo · present 07:05')).toBeTruthy();
    const guest2 = screen.getByRole('checkbox', { name: 'Guest 2 · not checked in' });
    expect(guest2).toHaveProperty('checked', true);
    expect(screen.getByText('Policy: no refund for a no-show.')).toBeTruthy();
    fireEvent.click(guest2);
    expect(screen.getByRole('button', { name: 'Choose who didn’t come' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(guest2);
    fireEvent.click(screen.getByRole('button', { name: 'Mark 1 no-show' }));
    expect((await screen.findAllByRole('alert'))[0].textContent).toBe(
      'Femi checked them in a moment ago.',
    );
    expect(sent.find((x) => x.method === 'POST')?.body).toEqual({
      bookingId: 'b3',
      travellerIds: ['t2'],
      status: 'no_show',
    });
  });
});
