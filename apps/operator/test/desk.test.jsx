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
  ageOf,
  changeBody,
  changedNote,
  nextToRemove,
  saveChangeLabel,
  amountIn,
  canRetryByCard,
  cancelLabel,
  cancelledNote,
  linkSentText,
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
      categoryKey: 'adult',
      position: 1,
      checkInStatus: 'present',
      state: { text: 'Present 07:05', tone: 'ok' },
    },
    {
      id: 't2',
      name: 'Guest 2',
      kind: 'Adult',
      categoryKey: 'adult',
      position: 2,
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
  cancel: {
    paidKobo: 1_950_000,
    policyKobo: 0,
    policyText: '₦0 nothing back: the ₦19,500 deposit isn’t refundable',
    maxKobo: 1_950_000,
    title: 'Cancel ILT-2LW9DK · Yemi Ojo',
    sub: 'Badagry Day Trip, Sat 12 Dec 07:00 · paid ₦19,500 · trip is in 9 days',
  },
  actNote: 'Cancelling now: the ₦19,500 deposit isn’t refunded (deposits are non-refundable).',
  sums: { owedKobo: 4_550_000, owedBackKobo: 0, byCardKobo: 1_950_000, timeZone: 'Africa/Lagos' },
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
    expect(actionButtons(OWES.actions).map((b) => b.label)).toEqual([
      'Send payment link',
      'Change travellers',
      'Add note',
      'Mark no-show',
      'Cancel booking',
    ]);
    expect(actionButtons(OWES.actions).find((b) => b.key === 'cancel')?.danger).toBe(true);
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

describe('desk.js: the money’s words (16c-2)', () => {
  it('an amount typed, up to a limit, in its own words', () => {
    expect(amountIn('45,500', 4_550_000, 'Too much.')).toEqual({ ok: true, kobo: 4_550_000 });
    expect(amountIn('₦ 20,000.50', 4_550_000, 'Too much.')).toEqual({ ok: true, kobo: 2_000_050 });
    expect(amountIn('50,000', 4_550_000, 'Only ₦45,500 is owed back.')).toEqual({
      ok: false,
      error: 'Only ₦45,500 is owed back.',
    });
    expect(amountIn('abc', 4_550_000, 'Too much.')).toEqual({
      ok: false,
      error: 'Type the amount in naira, like 45,500.',
    });
  });

  it('after sending a link; the cancel button; after cancelling; retrying by card', () => {
    expect(
      linkSentText(
        { amountKobo: 4_550_000, expiresAt: '2026-12-12T16:42:00Z' },
        new Date('2026-12-05T16:42:00Z'),
        'Africa/Lagos',
      ),
    ).toBe(
      'Payment link for ₦45,500 sent at 17:42 · expires Sat 12 Dec. It shows under Messages with its delivery status.',
    );
    expect(cancelLabel(3_125_000)).toBe('Cancel and refund ₦31,250');
    expect(cancelLabel(0)).toBe('Cancel booking');
    expect(cancelledNote(0, null)).toBe(
      'Cancelled. Nothing to refund. The guest is told by WhatsApp and email.',
    );
    expect(cancelledNote(3_125_000, { started: true })).toBe(
      'Cancelled. Refund of ₦31,250 started; the guest is told by WhatsApp and email.',
    );
    expect(
      cancelledNote(3_125_000, { started: false, problem: 'At most ₦0 can be refunded.' }),
    ).toBe(
      'Cancelled, but the refund of ₦31,250 didn’t start: At most ₦0 can be refunded. Send it from this page.',
    );
    expect(canRetryByCard({ owedBackKobo: 100, byCardKobo: 100 })).toBe(true);
    expect(canRetryByCard({ owedBackKobo: 100, byCardKobo: 99 })).toBe(false); // part was cash
    expect(canRetryByCard({ owedBackKobo: 0, byCardKobo: 100 })).toBe(false);
  });
});

describe('the desk’s money (16c-2)', () => {
  const CASH = {
    ...OWES,
    chip: { key: 'cash', text: 'Cash to confirm', tone: 'info', expiresAt: null },
    banner: {
      kind: 'cash',
      tone: 'info',
      title: 'Cash reported by Femi: ₦45,500',
      text: 'Sat 5 Dec, 07:12, at check-in.',
      cashReportId: 'c1',
      amountKobo: 4_550_000,
    },
  };
  const FAILED = {
    ...OWES,
    status: 'cancelled',
    chip: { key: 'refund_failed', text: 'Refund failed', tone: 'urgent', expiresAt: null },
    banner: {
      kind: 'refund_failed',
      tone: 'urgent',
      title: 'Refund of ₦62,500 failed',
      text: 'The card has expired.',
    },
    cancel: null,
    actNote: '',
    sums: { owedKobo: 0, owedBackKobo: 6_250_000, byCardKobo: 6_250_000, timeZone: 'Africa/Lagos' },
  };
  const base = (/** @type {any} */ b, /** @type {any} */ extra = {}) => ({
    'GET /api/desk/bookings?filter=today': () => [200, { list: list() }],
    [`GET /api/desk/bookings/${b.id}`]: () => [200, { booking: b }],
    ...extra,
  });

  it('cash: confirmed as reported; a different amount; not received', async () => {
    const sent = fakeFetch(
      base(CASH, {
        'POST /api/cash-reports/c1/confirm': () => [200, { cash: {} }],
        'POST /api/cash-reports/c1/not-received': () => [200, { cash: {} }],
      }),
    );
    await show('/bookings/b3');
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm ₦45,500 received' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      '₦45,500 cash confirmed. It’s in the books.',
    );
    expect(sent.find((x) => x.method === 'POST')).toMatchObject({
      path: '/api/cash-reports/c1/confirm',
      body: {},
    });

    fireEvent.click(screen.getByRole('button', { name: 'Received a different amount' }));
    const field = screen.getByRole('textbox', { name: /^Amount \(₦\)/ });
    fireEvent.change(field, { target: { value: '50,000' } });
    expect(
      screen.getByText('That’s more than was reported. Confirm the reported amount instead.'),
    ).toBeTruthy();
    fireEvent.change(field, { target: { value: '20,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm received' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      '₦20,000 cash confirmed. The rest is still owed.',
    );
    expect(sent.find((x) => x.body?.amountKobo === 2_000_000)?.path).toBe(
      '/api/cash-reports/c1/confirm',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Not received' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Marked not received. The guest still owes, and the owner has been alerted.',
    );
  });

  it('a payment link: the balance or another amount, how long; sent, or copied', async () => {
    const link = { amountKobo: 2_000_000, expiresAt: '2026-12-07T16:42:00Z' };
    const sent = fakeFetch(
      base(OWES, {
        'POST /api/bookings/b3/payment-links': (/** @type {any} */ body) => [
          201,
          { link: { ...link, amountKobo: body.amountKobo }, url: 'https://pay.example/pay/tok123' },
        ],
      }),
    );
    await show('/bookings/b3');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Send payment link' }))[0]);
    expect(screen.getByRole('textbox', { name: /^Amount \(₦\)/ })).toHaveProperty(
      'value',
      '45,500',
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Other' }));
    fireEvent.change(screen.getByRole('textbox', { name: /^Amount \(₦\)/ }), {
      target: { value: '60,000' },
    });
    expect(screen.getByText('That’s more than they owe.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send to the guest' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.change(screen.getByRole('textbox', { name: /^Amount \(₦\)/ }), {
      target: { value: '20,000' },
    });
    fireEvent.click(screen.getByRole('radio', { name: '2 days' }));

    // Copied: made without messaging the guest, shown to copy.
    fireEvent.click(screen.getByRole('button', { name: 'Copy the link instead' }));
    expect(await screen.findByDisplayValue('https://pay.example/pay/tok123')).toBeTruthy();
    expect(sent.find((x) => x.body?.send === false)?.body).toEqual({
      amountKobo: 2_000_000,
      expiresInDays: 2,
      send: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send to the guest' }));
    expect((await screen.findByRole('status')).textContent).toMatch(
      /^Payment link for ₦20,000 sent at \d\d:\d\d · expires Mon 7 Dec\. /,
    );
    expect(sent.filter((x) => x.method === 'POST').at(-1)?.body).toEqual({
      amountKobo: 2_000_000,
      expiresInDays: 2,
    });
  });

  it('cancelling: the policy by default; another amount needs a reason; the refund started', async () => {
    const sent = fakeFetch(
      base(OWES, {
        'POST /api/bookings/b3/cancel': () => [200, { refund: {}, refundStart: { started: true } }],
      }),
    );
    await show('/bookings/b3');
    expect(await screen.findByText(OWES.actNote)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(screen.getByRole('heading', { name: 'Cancel ILT-2LW9DK · Yemi Ojo' })).toBeTruthy();
    expect(
      screen.getByRole('radio', {
        name: 'Policy: ₦0 nothing back: the ₦19,500 deposit isn’t refundable',
      }),
    ).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('radio', { name: 'Another amount, up to ₦19,500' }));
    const go = screen.getByRole('button', { name: 'Cancel and refund ₦19,500' });
    expect(go).toHaveProperty('disabled', true); // a reason first
    fireEvent.change(screen.getByRole('textbox', { name: /^Reason/ }), {
      target: { value: 'Family emergency' },
    });
    fireEvent.click(go);
    expect((await screen.findByRole('status')).textContent).toBe(
      'Cancelled. Refund of ₦19,500 started; the guest is told by WhatsApp and email.',
    );
    expect(sent.find((x) => x.method === 'POST')?.body).toEqual({
      initiatedBy: 'guest',
      reason: 'Family emergency',
      refundOverrideKobo: 1_950_000,
      startRefund: true,
    });
  });

  it('a failed refund: try again by card, or record a bank transfer', async () => {
    const sent = fakeFetch(
      base(FAILED, {
        'POST /api/bookings/b3/refunds': () => [201, { refunds: [] }],
        'POST /api/bookings/b3/refunds/bank-transfer': () => [201, { refund: {} }],
      }),
    );
    await show('/bookings/b3');
    fireEvent.click(await screen.findByRole('button', { name: 'Try the refund again' }));
    expect((await screen.findByRole('status')).textContent).toBe('Refund of ₦62,500 started.');

    fireEvent.click(screen.getByRole('button', { name: 'I refunded by bank transfer' }));
    const record = screen.getByRole('button', { name: 'Record and tell the guest' });
    expect(record).toHaveProperty('disabled', true); // the reference is needed
    fireEvent.change(screen.getByRole('textbox', { name: 'Transfer reference' }), {
      target: { value: 'GTB-55102' },
    });
    fireEvent.click(record);
    expect((await screen.findByRole('status')).textContent).toBe(
      'Refund of ₦62,500 recorded. The guest is told it was sent.',
    );
    const body = sent.find((x) => x.path.endsWith('/bank-transfer'))?.body;
    expect(body).toMatchObject({ amountKobo: 6_250_000, reference: 'GTB-55102' });
    expect(body.sentOn).toMatch(/^\d{4}-\d\d-\d\d$/);
  });

  it('part was paid in cash: no card retry, only the bank transfer', async () => {
    fakeFetch(base({ ...FAILED, sums: { ...FAILED.sums, byCardKobo: 1_000_000 } }));
    await show('/bookings/b3');
    expect(await screen.findByRole('button', { name: 'I refunded by bank transfer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try the refund again' })).toBeNull();
  });
});

describe('changing travellers (16c-3)', () => {
  const T = [
    { id: 'a1', categoryKey: 'adult', position: 1, checkInStatus: 'pending' },
    { id: 'a2', categoryKey: 'adult', position: 2, checkInStatus: 'pending' },
    { id: 'a3', categoryKey: 'adult', position: 3, checkInStatus: 'present' },
    { id: 'c4', categoryKey: 'child', position: 4, checkInStatus: 'pending' },
  ];
  it('who "−" takes off: the newest added, else the last booked who can go', () => {
    expect(
      nextToRemove(T, [], [{ categoryKey: 'adult' }, { categoryKey: 'child' }], 'adult'),
    ).toEqual({
      added: 0,
    });
    // a3 is checked in, a1 is the lead: a2.
    expect(nextToRemove(T, [], [], 'adult')).toEqual({ id: 'a2' });
    expect(nextToRemove(T, ['a2'], [], 'adult')).toBeNull();
    expect(nextToRemove(T, [], [], 'child')).toEqual({ id: 'c4' });
    expect(nextToRemove(T, [], [], 'infant')).toBeNull();
  });

  it('what is sent, the save button, and what happened', () => {
    expect(ageOf(' 9 ')).toBe(9);
    expect(ageOf('')).toBeNull();
    expect(ageOf('nine')).toBeNull();
    // A baby is 0: an age, not "no age". A half-year isn't typed as an age.
    expect(ageOf('0')).toBe(0);
    expect(ageOf('2.5')).toBeNull();
    expect(changeBody(['a2'], [{ categoryKey: 'child', name: ' Tobi ', age: '9' }])).toEqual({
      remove: ['a2'],
      add: [{ categoryKey: 'child', name: 'Tobi', age: 9 }],
    });
    expect(saveChangeLabel({ extraKobo: 3_500_000, owedAfterKobo: 8_050_000, refund: null })).toBe(
      'Save and send a link for ₦35,000',
    );
    // Owing less than the extra (part was overpaid): the link is for what's owed.
    expect(saveChangeLabel({ extraKobo: 3_500_000, owedAfterKobo: 1_000_000, refund: null })).toBe(
      'Save and send a link for ₦10,000',
    );
    expect(
      saveChangeLabel({ extraKobo: 0, owedAfterKobo: 0, refund: { policyKobo: 2_500_000 } }),
    ).toBe('Save and refund ₦25,000');
    expect(saveChangeLabel({ extraKobo: 0, owedAfterKobo: 0, refund: { policyKobo: 0 } })).toBe(
      'Save',
    );
    expect(changedNote({ link: { sent: true, amountKobo: 3_500_000 }, refundStart: null })).toBe(
      'Travellers changed. A link for ₦35,000 was sent to the guest.',
    );
    expect(
      changedNote({
        link: null,
        refundStart: { started: false, problem: 'At most ₦0 can be refunded.' },
      }),
    ).toBe(
      'Travellers changed. The refund didn’t start: At most ₦0 can be refunded. Send it from this page.',
    );
    expect(
      changedNote({
        link: { sent: false, problem: 'Nothing owed.' },
        refundStart: { started: true },
      }),
    ).toBe(
      'Travellers changed. The link didn’t go: Nothing owed. Send one from this page. The refund has started.',
    );
  });

  const cats = (/** @type {number} */ adults, /** @type {number} */ children) => [
    {
      key: 'adult',
      name: 'Adult (13+)',
      priceKobo: 6_500_000,
      booked: true,
      minAge: 13,
      maxAge: null,
      count: adults,
    },
    {
      key: 'child',
      name: 'Child (3–12)',
      priceKobo: 3_500_000,
      booked: false,
      minAge: 3,
      maxAge: 12,
      count: children,
    },
  ];
  /** The server's preview, worked out roughly as it would. @param {any} body */
  const plan = (body) => {
    const adults =
      2 -
      body.remove.length +
      body.add.filter((/** @type {any} */ a) => a.categoryKey === 'adult').length;
    const children = body.add.filter((/** @type {any} */ a) => a.categoryKey === 'child').length;
    const total = adults * 6_500_000 + children * 3_500_000;
    return {
      categories: cats(adults, children),
      removing: body.remove,
      oldTotalKobo: 13_000_000,
      newTotalKobo: total,
      extraKobo: Math.max(0, total - 13_000_000),
      owedAfterKobo: Math.max(0, total - 13_000_000),
      refund:
        total < 13_000_000
          ? {
              overpaidKobo: 6_500_000,
              policyKobo: 6_500_000,
              policyText: '₦65,000 of ₦65,000 (full refund)',
            }
          : null,
      seats: {
        fits: true,
        delta: body.add.length - body.remove.length,
        text: 'fits (13 of 14 in Van 1)',
      },
      changed: body.add.length + body.remove.length > 0,
    };
  };

  it('the sheet: + a child, an age needed, the new total; saved with a link', async () => {
    const sent = fakeFetch({
      'GET /api/desk/bookings?filter=today': () => [200, { list: list() }],
      'GET /api/desk/bookings/b3': () => [200, { booking: { ...OWES, status: 'paid' } }],
      'POST /api/bookings/b3/travellers/preview': (/** @type {any} */ body) =>
        body.add.some((/** @type {any} */ a) => a.categoryKey === 'child' && a.age === null)
          ? [409, { error: { code: 'AGE_NEEDED', message: 'Give the age of each child (3–12).' } }]
          : [200, { plan: plan(body) }],
      'POST /api/bookings/b3/travellers/change': (/** @type {any} */ body) => [
        200,
        { plan: plan(body), link: { sent: true, amountKobo: 3_500_000 }, refundStart: null },
      ],
    });
    await show('/bookings/b3');
    fireEvent.click(await screen.findByRole('button', { name: 'Change travellers' }));
    expect(await screen.findByText('₦35,000 (today’s price)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More: Child' }));
    expect(await screen.findByText('Give the age of each child (3–12).')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Child’s name' }), {
      target: { value: 'Tobi Ojo' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Age' }), { target: { value: '9' } });
    const save = await screen.findByRole('button', { name: 'Save and send a link for ₦35,000' });
    expect(screen.getByText('Seats: fits (13 of 14 in Van 1)')).toBeTruthy();
    fireEvent.click(save);
    expect((await screen.findByRole('status')).textContent).toBe(
      'Travellers changed. A link for ₦35,000 was sent to the guest.',
    );
    expect(sent.find((x) => x.path.endsWith('/travellers/change'))?.body).toEqual({
      remove: [],
      add: [{ categoryKey: 'child', name: 'Tobi Ojo', age: 9 }],
      refundKobo: 0,
      sendLink: true,
    });
  });

  it('the sheet: − an adult; the policy’s refund, confirmed by saving', async () => {
    const sent = fakeFetch({
      'GET /api/desk/bookings?filter=today': () => [200, { list: list() }],
      'GET /api/desk/bookings/b3': () => [200, { booking: { ...OWES, status: 'paid' } }],
      'POST /api/bookings/b3/travellers/preview': (/** @type {any} */ body) => [
        200,
        { plan: plan(body) },
      ],
      'POST /api/bookings/b3/travellers/change': (/** @type {any} */ body) => [
        200,
        { plan: plan(body), link: null, refundStart: { started: true } },
      ],
    });
    await show('/bookings/b3');
    fireEvent.click(await screen.findByRole('button', { name: 'Change travellers' }));
    // Nothing changed yet: nothing to save.
    expect(await screen.findByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    fireEvent.click(await screen.findByRole('button', { name: 'Fewer: Adult' }));
    expect(await screen.findByText('₦65,000 of ₦65,000 (full refund)')).toBeTruthy();
    // Only Guest 2 could go (Yemi is the lead): no more "−".
    expect(screen.getByRole('button', { name: 'Fewer: Adult' })).toHaveProperty('disabled', true);
    fireEvent.click(await screen.findByRole('button', { name: 'Save and refund ₦65,000' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Travellers changed. The refund has started.',
    );
    expect(sent.find((x) => x.path.endsWith('/travellers/change'))?.body).toEqual({
      remove: ['t2'],
      add: [],
      refundKobo: 6_500_000,
      sendLink: true,
    });
  });
});
