/**
 * The schedule (O6) and a departure's page (O7), stage 16b: the wording in lib/board.js, then
 * the two screens against a fake server.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '../src/App.jsx';
import { EngineContext } from '../src/lib/engine.jsx';
import { createSyncEngine } from '../src/lib/sync.js';
import { createMemoryStore } from '../src/lib/store.js';
import { ApiError, request } from '../src/lib/api.js';
import { clearLive } from '../src/lib/live.js';
import { actionError } from '../src/lib/office.js';
import {
  cardView,
  shortReason,
  filterWeek,
  firstDay,
  departuresText,
  cancelSentence,
  cancelledText,
  assignLabel,
} from '../src/lib/board.js';

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

const card = (/** @type {any} */ o = {}) => ({
  id: 'd1',
  time: '10:00',
  tour: 'Tarkwa Bay Beach Day',
  tourSlug: 'tarkwa',
  sold: 8,
  seats: 12,
  pct: 67,
  guide: null,
  vehicle: null,
  status: 'scheduled',
  cancelReason: null,
  tag: 'NEEDS GUIDE',
  needsGuide: true,
  full: false,
  ...o,
});

const day = (
  /** @type {string} */ date,
  /** @type {string} */ dow,
  cards = /** @type {any[]} */ ([]),
) => ({
  date,
  dow,
  day: `${date.slice(8)} ${date.slice(5, 7) === '11' ? 'Nov' : 'Dec'}`,
  long: `${dow} ${date.slice(8)} ${date.slice(5, 7) === '11' ? 'Nov' : 'Dec'}`,
  isToday: date === '2026-12-05',
  flag: cards.some((c) => c.needsGuide),
  cards,
});

const WEEK = {
  start: '2026-11-30',
  today: '2026-12-05',
  thisWeek: '2026-11-30',
  previous: '2026-11-23',
  next: '2026-12-07',
  label: 'Mon 30 Nov – Sun 06 Dec',
  tours: [
    { slug: 'tarkwa', name: 'Tarkwa Bay Beach Day' },
    { slug: 'badagry', name: 'Badagry Day Trip' },
  ],
  withoutGuide: 1,
  days: [
    day('2026-11-30', 'Mon'),
    day('2026-12-01', 'Tue'),
    day('2026-12-02', 'Wed'),
    day('2026-12-03', 'Thu'),
    day('2026-12-04', 'Fri'),
    day('2026-12-05', 'Sat', [
      card({
        id: 'd0',
        time: '07:00',
        tour: 'Badagry Day Trip',
        tourSlug: 'badagry',
        sold: 12,
        pct: 100,
        guide: 'Femi Ogunleye',
        vehicle: 'Van 1 · 12 seats',
        tag: 'SOLD OUT',
        needsGuide: false,
        full: true,
      }),
      card(),
    ]),
    day('2026-12-06', 'Sun'),
  ],
};

const DEPARTURE = {
  id: 'd1',
  title: 'Tarkwa Bay Beach Day',
  short: 'Tarkwa Bay',
  transport: 'boat',
  status: 'scheduled',
  cancelReason: null,
  dayLabel: 'Sat 5 Dec',
  when: 'Sat 5 Dec · 10:00 – 16:00',
  times: '10:00 – 16:00',
  meetingPoint: 'Falomo jetty',
  numbers: { booked: 8, held: 2, left: 2, seats: 12, seatsLabel: 'boat seats' },
  rows: [
    {
      id: 'b1',
      lead: 'Ada Nwosu',
      people: '2 adults',
      extras: 'Vegetarian',
      pay: 'Paid',
      payTone: 'paid',
    },
    {
      id: 'b2',
      lead: 'Kola Ade',
      people: '1 adult',
      extras: '',
      pay: 'Owes ₦9,000',
      payTone: 'owes',
    },
  ],
  extrasLine: null,
  notes: '',
  guide: null,
  resource: { id: 'r1', name: 'Boat 1', seats: 12 },
  cancel: { bookings: 2, guests: 3, refundKobo: 4500000, refundText: '₦45,000' },
};

const OPTIONS = {
  title: 'Tarkwa Bay, Sat 5 Dec, 10:00',
  vehicleTitle: 'Boat for Tarkwa Bay',
  transport: 'boat',
  guides: [
    { id: 'g1', name: 'Amaka Eze', state: 'free', why: 'Free all day' },
    {
      id: 'g2',
      name: 'Femi Ogunleye',
      state: 'busy',
      why: 'Busy: on the Badagry trip until 17:00',
    },
  ],
  resources: [
    { id: 'r1', label: 'Boat 1 · 12 seats', state: 'assigned', why: 'Assigned' },
    {
      id: 'r2',
      label: 'Boat 2 · 6 seats',
      state: 'small',
      why: 'Too small: 6 seats; 8 are booked',
    },
    { id: 'r3', label: 'Van 1 · 12 seats', state: 'wrong', why: 'A van: this tour goes by boat' },
  ],
};

/**
 * A fake server: routes by "METHOD path"; it remembers what was sent.
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

describe('board.js: the wording', () => {
  it('a card: seats, guide, tag tone; a phone says it shorter', () => {
    const v = cardView(card());
    expect(v).toMatchObject({
      tag: 'NEEDS GUIDE',
      tagTone: 'urgent',
      seats: '8 / 12 seats',
      guide: 'No guide yet',
      guideTone: 'urgent',
      alert: true,
      cancelled: false,
      barTone: 'ok',
    });
    const p = cardView(card(), { phone: true });
    expect(p.seats).toBe('8 / 12');
    expect(p.guide).toBe('No guide yet · assign');
    const full = cardView(card({ tag: 'SOLD OUT', guide: 'Femi', needsGuide: false, full: true }));
    expect(full).toMatchObject({
      tagTone: 'warning',
      guide: 'Femi',
      guideTone: 'ink',
      alert: false,
      barTone: 'warning',
    });
    expect(cardView(card({ guide: 'Femi', needsGuide: false }), { phone: true }).guide).toBe(
      'Guide: Femi',
    );
    // No guide but not needing one (nobody booked): plain, not red.
    const quiet = cardView(card({ needsGuide: false, tag: null }), { phone: true });
    expect(quiet.guide).toBe('No guide yet');
    expect(quiet.guideTone).toBe('ink');
  });

  it('a cancelled card: its reason in a word, guests told, never red', () => {
    const v = cardView(
      card({ status: 'cancelled', tag: 'CANCELLED', cancelReason: 'the weather on the lagoon' }),
    );
    expect(v).toMatchObject({
      tagTone: 'muted',
      seats: 'Cancelled · weather',
      guide: 'Guests told and refunded',
      alert: false,
      guideTone: 'ink',
      cancelled: true,
    });
    expect(cardView(card({ status: 'cancelled', cancelReason: null })).seats).toBe('Cancelled');
    expect(shortReason('Bad weather at sea')).toBe('weather');
    expect(shortReason('An outbreak')).toBe('outbreak');
    expect(shortReason('fuel')).toBe('fuel');
  });

  it('one tour only: other cards gone, flags and the count follow', () => {
    expect(filterWeek(WEEK, null)).toBe(WEEK);
    const b = filterWeek(WEEK, 'badagry');
    expect(b.days[5].cards.map((/** @type {any} */ c) => c.id)).toEqual(['d0']);
    expect(b.days[5].flag).toBe(false);
    expect(b.withoutGuide).toBe(0);
    const t = filterWeek(WEEK, 'tarkwa');
    expect(t.days[5].flag).toBe(true);
    expect(t.withoutGuide).toBe(1);
    expect(t.label).toBe(WEEK.label);
  });

  it('the first day on a phone: today in this week, else the Monday', () => {
    expect(firstDay(WEEK)).toBe('2026-12-05');
    expect(firstDay({ ...WEEK, today: '2026-12-09' })).toBe('2026-11-30');
    expect(departuresText(1)).toBe('1 departure');
    expect(departuresText(0)).toBe('0 departures');
  });

  it('the guests’ sentence, and what cancelling did', () => {
    expect(cancelSentence('The weather on the lagoon. ')).toBe(
      '“We’re sorry: we had to cancel this trip because of the weather on the lagoon.”',
    );
    expect(cancelSentence('  ')).toBe('“We’re sorry: we had to cancel this trip.”');
    expect(cancelledText({ bookingsCancelled: 4, refundsStarted: 4, refundsFailed: 0 })).toBe(
      'Cancelled. 4 refunds started, 4 bookings told. Any refund that fails shows on Today.',
    );
    expect(cancelledText({ bookingsCancelled: 1, refundsStarted: 1, refundsFailed: 1 })).toBe(
      'Cancelled. 1 refund started, 1 booking told. 1 refund didn’t start: see Today.',
    );
    expect(cancelledText({ bookingsCancelled: 3, refundsStarted: 1, refundsFailed: 2 })).toBe(
      'Cancelled. 1 refund started, 3 bookings told. 2 refunds didn’t start: see Today.',
    );
  });

  it('the assign button, and a failed change', () => {
    const amaka = { id: 'g1', name: 'Amaka' };
    expect(assignLabel(undefined, null)).toBe('Choose a guide');
    expect(assignLabel(amaka, null)).toBe('Assign Amaka');
    expect(assignLabel(amaka, { id: 'g1' })).toBe('Amaka is assigned');
    expect(actionError(new ApiError('offline', 'x'))).toMatch(
      /^No connection: nothing was changed/,
    );
    expect(actionError(new ApiError('unreachable', 'x'))).toMatch(/^No connection/);
    expect(actionError(new ApiError('api', 'Amaka was just assigned elsewhere.'))).toBe(
      'Amaka was just assigned elsewhere.',
    );
    expect(actionError(new ApiError('server', 'x'))).toBe('Didn’t save. Try again.');
  });
});

describe('the schedule', () => {
  it('the week: days, cards linking to their page, filters and the count without a guide', async () => {
    fakeFetch({ 'GET /api/schedule/week': () => [200, { week: WEEK }] });
    await show('/schedule');
    expect(await screen.findByRole('heading', { name: 'Schedule' })).toBeTruthy();
    expect(screen.getByText('Mon 30 Nov – Sun 06 Dec')).toBeTruthy();
    expect(screen.getByText('1 departure without a guide')).toBeTruthy();
    const sat = screen.getByRole('region', { name: 'Sat 05 Dec' });
    const links = within(sat).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/departures/d0', '/departures/d1']);
    expect(links[1].className).toContain('dep-card--alert');
    expect(within(sat).getByText('SOLD OUT')).toBeTruthy();
    // A tour chosen: the other tour's cards go.
    fireEvent.click(screen.getByRole('button', { name: 'Badagry Day Trip' }));
    expect(within(sat).getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByText('1 departure without a guide')).toBeNull();
  });

  it('a phone: today’s tab first with its departures; another day; the next week', async () => {
    const sent = fakeFetch({
      'GET /api/schedule/week': () => [200, { week: WEEK }],
      'GET /api/schedule/week?start=2026-12-07': () => [
        200,
        { week: { ...WEEK, start: '2026-12-07', label: 'Mon 07 Dec – Sun 13 Dec' } },
      ],
    });
    await show('/schedule');
    expect(await screen.findByRole('heading', { name: 'Sat 05 Dec · 2 departures' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(7);
    expect(tabs[5].getAttribute('aria-selected')).toBe('true');
    expect(within(tabs[5]).getByLabelText('needs attention')).toBeTruthy();
    expect(screen.getByText('No guide yet · assign')).toBeTruthy();
    fireEvent.click(tabs[0]);
    expect(screen.getByRole('heading', { name: 'Mon 30 Nov · 0 departures' })).toBeTruthy();
    expect(screen.getByText('No departures this day.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next week ›' }));
    expect(await screen.findByText('Mon 07 Dec – Sun 13 Dec')).toBeTruthy();
    expect(sent.at(-1)?.path).toBe('/api/schedule/week?start=2026-12-07');
  });
});

describe('a departure', () => {
  const routes = (/** @type {any} */ extra = {}) => ({
    'GET /api/departures/d1/overview': () => [200, { departure: DEPARTURE }],
    'GET /api/departures/d1/options': () => [200, { options: OPTIONS }],
    ...extra,
  });

  it('the numbers, who’s booked, the pickers saying why some can’t be chosen', async () => {
    fakeFetch(routes());
    await show('/departures/d1');
    expect(await screen.findByRole('heading', { name: 'Tarkwa Bay Beach Day' })).toBeTruthy();
    expect(screen.getByText('boat seats')).toBeTruthy();
    expect(screen.getByText('Owes ₦9,000')).toBeTruthy();
    const guide = await screen.findByRole('group', { name: /Guide/ });
    expect(within(guide).getByRole('radio', { name: /Femi Ogunleye/ })).toHaveProperty(
      'disabled',
      true,
    );
    expect(within(guide).getByText('Busy: on the Badagry trip until 17:00')).toBeTruthy();
    expect(within(guide).getByRole('button', { name: 'Assign Amaka Eze' })).toBeTruthy();
    const boat = screen.getByRole('group', { name: 'Van or boat' });
    expect(within(boat).getByRole('radio', { name: /Boat 1/ })).toHaveProperty('checked', true);
    expect(within(boat).getByRole('radio', { name: /Boat 2/ })).toHaveProperty('disabled', true);
    expect(within(boat).getByRole('radio', { name: /Van 1/ })).toHaveProperty('disabled', true);
    expect(
      screen.getByText('2 bookings refunded in full (₦45,000) and told by WhatsApp and email.'),
    ).toBeTruthy();
  });

  it('assigning a guide: sent, then the page reloads; a refusal shows the server’s words', async () => {
    let assigned = false;
    const sent = fakeFetch(
      routes({
        'PUT /api/departures/d1/assignment': () =>
          assigned
            ? [
                409,
                { error: { code: 'GUIDE_BUSY', message: 'Amaka Eze is on another trip then.' } },
              ]
            : ((assigned = true), [200, { ok: true }]),
      }),
    );
    await show('/departures/d1');
    const guide = await screen.findByRole('group', { name: /Guide/ });
    fireEvent.click(within(guide).getByRole('button', { name: 'Assign Amaka Eze' }));
    await vi.waitFor(() =>
      expect(sent.some((s) => s.method === 'PUT' && s.body?.guideId === 'g1')).toBe(true),
    );
    await vi.waitFor(() =>
      expect(sent.filter((s) => s.path === '/api/departures/d1/overview').length).toBe(2),
    );
    fireEvent.click(within(guide).getByRole('button', { name: 'Assign Amaka Eze' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Amaka Eze is on another trip then.',
    );
  });

  it('notes: Save shows once changed, sends them, says Saved', async () => {
    const sent = fakeFetch(
      routes({ 'PUT /api/departures/d1/assignment': () => [200, { ok: true }] }),
    );
    await show('/departures/d1');
    const notes = await screen.findByRole('textbox', { name: /Notes for the guide/ });
    expect(screen.queryByRole('button', { name: 'Save the notes' })).toBeNull();
    fireEvent.change(notes, { target: { value: 'Life jackets for all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the notes' }));
    await vi.waitFor(() =>
      expect(sent.find((s) => s.method === 'PUT')?.body).toEqual({ notes: 'Life jackets for all' }),
    );
  });

  it('cancelling: the reason needed, the guests’ sentence shown, then what was done', async () => {
    const sent = fakeFetch(
      routes({
        'POST /api/departures/d1/cancel': () => [
          200,
          { bookingsCancelled: 2, refundsStarted: 2, refundsFailed: 0 },
        ],
      }),
    );
    await show('/departures/d1');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel departure' }));
    expect(screen.getByRole('heading', { name: 'Cancel Tarkwa Bay on Sat 5 Dec?' })).toBeTruthy();
    expect(screen.getByText('2 bookings, 3 guests')).toBeTruthy();
    expect(screen.getByText('the boat 1 is freed')).toBeTruthy();
    const go = screen.getByRole('button', { name: 'Cancel and refund everyone' });
    expect(go).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('textbox', { name: /Reason guests will see/ }), {
      target: { value: 'The weather on the lagoon' },
    });
    expect(
      screen.getByText(
        'Ìrìn Lagos Tours: “We’re sorry: we had to cancel this trip because of the weather on the lagoon.”',
      ),
    ).toBeTruthy();
    fireEvent.click(go);
    expect((await screen.findByRole('status')).textContent).toBe(
      'Cancelled. 2 refunds started, 2 bookings told. Any refund that fails shows on Today.',
    );
    expect(sent.find((s) => s.method === 'POST')?.body).toEqual({
      reason: 'The weather on the lagoon',
    });
  });

  it('no vans or boats added yet: says so, where to add them', async () => {
    fakeFetch({
      'GET /api/departures/d1/overview': () => [200, { departure: DEPARTURE }],
      'GET /api/departures/d1/options': () => [200, { options: { ...OPTIONS, resources: [] } }],
    });
    await show('/departures/d1');
    const boat = await screen.findByRole('group', { name: 'Van or boat' });
    expect(within(boat).getByText('No vans or boats yet. Add them in Settings.')).toBeTruthy();
  });

  it('cancelled already: says why; no pickers and no cancel', async () => {
    fakeFetch({
      'GET /api/departures/d1/overview': () => [
        200,
        { departure: { ...DEPARTURE, status: 'cancelled', cancelReason: 'the weather' } },
      ],
      'GET /api/departures/d1/options': () => [200, { options: OPTIONS }],
    });
    await show('/departures/d1');
    expect(
      await screen.findByText('Cancelled because of the weather. Guests were told and refunded.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel departure' })).toBeNull();
    expect(screen.queryByRole('group', { name: /Guide/ })).toBeNull();
  });
});
