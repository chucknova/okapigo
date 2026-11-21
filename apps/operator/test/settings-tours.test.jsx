/**
 * Settings › Tours (O10), stage 16e-4a: the rules in lib/tours.js, then the screen against a
 * fake server: the list, a new tour, a tour's basics (checked, what's sent, saved), on sale or
 * not, and a manager who can only look.
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
  basicsBody,
  basicsChanges,
  basicsErrors,
  basicsForm,
  blankTour,
  durationOf,
  faqsOf,
  faqsText,
  linesOf,
  newTourBody,
  newTourErrors,
  pinLine,
  saleWords,
  statusLine,
  stopsOf,
  stopsText,
  tourRows,
} from '../src/lib/tours.js';

afterEach(() => {
  cleanup();
  clearLive();
  vi.unstubAllGlobals();
});

const ALL = {
  products: 'edit',
  bookings: 'edit',
  payments: 'edit',
  operations: 'edit',
  channels: 'edit',
  marketing: 'edit',
  reports: 'edit',
  settings: 'edit',
};
const OWNER = {
  user: { name: 'Bisola Adeyemi', role: { key: 'owner', name: 'Owner' } },
  operator: { name: 'Ìrìn Lagos Tours', timeZone: 'Africa/Lagos' },
  permissions: ALL,
  owner: { name: 'Bisola Adeyemi' },
};
const MANAGER = {
  ...OWNER,
  user: { name: 'Kunle Bello', role: { key: 'manager', name: 'Operations manager' } },
  permissions: { ...ALL, products: 'view', channels: 'view', marketing: 'view', settings: 'none' },
};

const BADAGRY = {
  id: 'p-badagry',
  slug: 'badagry-heritage-day-trip',
  title: 'Badagry Heritage Day Trip',
  shortTitle: 'Badagry Day Trip',
  summary: 'The slave route, the first storey building and the Point of No Return.',
  description: 'A full day in Badagry.',
  status: 'published',
  durationMinutes: 600,
  transport: 'van',
  activityLabel: 'Van, guided',
  arriveMinutesEarly: 15,
  defaultCapacity: 14,
  meetingPoint: {
    name: 'Ìrìn office',
    address: 'Herbert Macaulay Way, Yaba',
    note: 'The green door',
    lat: 6.5095,
    lng: 3.3711,
  },
  stops: [
    { name: 'Vlekete Slave Market', description: '' },
    { name: 'Point of No Return', description: 'the walk to the beach' },
  ],
  inclusions: ['Transport', 'Entry fees'],
  exclusions: ['Lunch'],
  whatToBring: ['Water'],
  faqs: [{ question: 'Is lunch included?', answer: 'No: add it as an extra.' }],
  priceCategories: [{ id: 'c1', key: 'adult', isActive: true }],
  addOns: [],
  runs: 'Saturdays 07:00 · 14 seats',
};
const EPE = {
  ...BADAGRY,
  id: 'p-epe',
  title: 'Epe Fish Market Morning',
  status: 'draft',
  meetingPoint: { name: 'Epe jetty', address: 'Epe', lat: 6.4541, lng: 3.3947, approximate: true },
  priceCategories: [],
  runs: 'Not scheduled yet',
};
const OLD = { ...BADAGRY, id: 'p-old', title: 'Old Walk', status: 'archived', runs: '' };

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

/** @param {any} me @param {string} path */
async function show(me, path) {
  const engine = createSyncEngine({
    request,
    store: createMemoryStore({
      session: { token: 'tok', user: me.user, contact: 'x' },
      meta: { firstRunDone: true },
      me,
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

describe('tours.js', () => {
  it('the list: on sale and drafts first, retired last', () => {
    expect(tourRows([OLD, EPE, BADAGRY])).toEqual([
      {
        id: 'p-epe',
        title: 'Epe Fish Market Morning',
        runs: 'Not scheduled yet',
        tag: 'DRAFT',
        tone: 'warning',
      },
      {
        id: 'p-badagry',
        title: 'Badagry Heritage Day Trip',
        runs: 'Saturdays 07:00 · 14 seats',
        tag: 'ON SALE',
        tone: 'success',
      },
      { id: 'p-old', title: 'Old Walk', runs: '', tag: 'RETIRED', tone: 'muted' },
    ]);
    expect(statusLine('published')).toBe('Published (on sale)');
    expect(statusLine('draft')).toBe('Draft (not on sale yet)');
    expect(statusLine('archived')).toBe('Retired (not on sale)');
  });

  it('the text lists, one per line, both ways', () => {
    expect(linesOf(' a \n\n b\n')).toEqual(['a', 'b']);
    expect(stopsText(BADAGRY.stops)).toBe(
      'Vlekete Slave Market\nPoint of No Return — the walk to the beach',
    );
    expect(stopsOf('Vlekete\nPoint of No Return - the walk – to the beach')).toEqual([
      { name: 'Vlekete', description: '' },
      { name: 'Point of No Return', description: 'the walk — to the beach' },
    ]);
    expect(faqsText(BADAGRY.faqs)).toBe('Is lunch included?\nNo: add it as an extra.');
    expect(faqsOf('Q1?\nA1\nmore\n\n\nQ2?\nA2')).toEqual([
      { question: 'Q1?', answer: 'A1\nmore' },
      { question: 'Q2?', answer: 'A2' },
    ]);
  });

  it('the form from a tour; an approximate pin shows as not set', () => {
    const f = basicsForm(BADAGRY);
    expect(f).toMatchObject({
      hours: '10',
      minutes: '0',
      pin: '6.5095, 3.3711',
      arrive: '15',
      transport: 'van',
      inclusions: 'Transport\nEntry fees',
    });
    expect(basicsForm(EPE).pin).toBe('');
    expect(basicsForm({ ...BADAGRY, arriveMinutesEarly: null, shortTitle: null })).toMatchObject({
      arrive: '',
      shortTitle: '',
    });
    expect(durationOf({ hours: '3', minutes: '30' })).toBe(210);
    expect(durationOf({ hours: '', minutes: '45' })).toBe(45);
    expect(durationOf({ hours: '1.5', minutes: '0' })).toBeNaN();
    expect(durationOf({ hours: '-1', minutes: '0' })).toBeNaN();
  });

  it('what’s wrong, in words', () => {
    const ok = basicsForm(BADAGRY);
    expect(basicsErrors(ok)).toEqual({});
    expect(
      basicsErrors({
        ...ok,
        title: ' ',
        shortTitle: 'Badagry Heritage Day Trip!!',
        hours: '0',
        minutes: '10',
        pin: 'https://maps.app.goo.gl/x',
        arrive: '121',
        faqs: 'Just a question?',
      }),
    ).toEqual({
      title: 'Add a name.',
      shortTitle: 'Too long: 27 of 24 characters. WhatsApp’s lists cut it off.',
      hours: 'A tour lasts at least 15 minutes.',
      pin: expect.stringMatching(/^Short links can’t be read/),
      arrive: 'Use minutes from 0 to 120.',
      faqs: 'Each question needs its answer on the next line (a blank line between FAQs).',
    });
    expect(basicsErrors({ ...ok, hours: '400' }).hours).toBe('A tour lasts at most 14 days.');
    // The limits exactly: 15 minutes, 14 days.
    expect(basicsErrors({ ...ok, hours: '0', minutes: '15' }).hours).toBeUndefined();
    expect(basicsErrors({ ...ok, hours: '0', minutes: '14' }).hours).toBe(
      'A tour lasts at least 15 minutes.',
    );
    expect(basicsErrors({ ...ok, hours: '336', minutes: '0' }).hours).toBeUndefined();
    expect(basicsErrors({ ...ok, hours: '336', minutes: '1' }).hours).toBe(
      'A tour lasts at most 14 days.',
    );
    expect(basicsErrors({ ...ok, hours: 'x' }).hours).toBe(
      'Use whole hours and minutes, like 3 and 30.',
    );
    expect(basicsErrors({ ...ok, arrive: '2.5' }).arrive).toBe('Use minutes from 0 to 120.');
    expect(basicsErrors({ ...ok, arrive: '120' }).arrive).toBeUndefined();
    expect(basicsErrors({ ...ok, inclusions: 'x'.repeat(201) }).inclusions).toBe(
      'Keep each line under 200 characters.',
    );
    expect(basicsErrors({ ...ok, whatToBring: Array(31).fill('x').join('\n') }).whatToBring).toBe(
      'At most 30 lines (this has 31).',
    );
    expect(basicsErrors({ ...ok, meetingAddress: '' }).meetingAddress).toBe('Add the address.');
    expect(basicsErrors({ ...ok, summary: 'x'.repeat(301) }).summary).toBe(
      'Too long: 301 of 300 characters.',
    );
  });

  it('what changed, and only that is sent; the meeting point goes whole', () => {
    const saved = basicsForm(BADAGRY);
    expect(basicsChanges(saved, saved)).toEqual([]);
    expect(basicsBody(saved, saved)).toEqual({});
    const f = { ...saved, title: 'Badagry Day', hours: '9', minutes: '30', meetingName: 'Ìrìn HQ' };
    expect(basicsChanges(f, saved)).toEqual(['Name', 'Duration', 'Meeting point']);
    expect(basicsBody(f, saved)).toEqual({
      title: 'Badagry Day',
      durationMinutes: 570,
      meetingPoint: {
        name: 'Ìrìn HQ',
        address: 'Herbert Macaulay Way, Yaba',
        note: 'The green door',
        lat: 6.5095,
        lng: 3.3711,
      },
    });
    // The pin cleared: no lat/lng (the server uses the city's, approximate). An emptied short
    // name and arrive clear them.
    expect(
      basicsBody({ ...saved, pin: '', shortTitle: ' ', arrive: '', meetingNote: '' }, saved),
    ).toEqual({
      shortTitle: null,
      arriveMinutesEarly: null,
      meetingPoint: { name: 'Ìrìn office', address: 'Herbert Macaulay Way, Yaba' },
    });
    expect(
      basicsBody(
        {
          ...saved,
          stops: 'A\nB — b',
          inclusions: 'x',
          faqs: 'Q?\nA',
          transport: 'boat',
          arrive: '5',
        },
        saved,
      ),
    ).toEqual({
      stops: [
        { name: 'A', description: '' },
        { name: 'B', description: 'b' },
      ],
      inclusions: ['x'],
      faqs: [{ question: 'Q?', answer: 'A' }],
      transport: 'boat',
      arriveMinutesEarly: 5,
    });
  });

  it('the pin’s line; a new tour; on sale or not', () => {
    expect(pinLine('')).toMatch(/^Not set: guests see the address, with no map/);
    expect(pinLine('6.4541, 3.3947')).toBe(
      'Pin at 6.4541, 3.3947. Guests get a map and directions.',
    );
    expect(pinLine('nonsense')).toBeNull();

    expect(newTourErrors(blankTour())).toEqual({
      title: 'Add a name.',
      summary: 'Add a one-line summary.',
      meetingName: 'Add where guests meet.',
      meetingAddress: 'Add the address.',
    });
    expect(newTourErrors({ ...blankTour(), seats: '0', hours: '0', minutes: '5' })).toMatchObject({
      seats: 'From 1 to 500 seats.',
      hours: 'From 15 minutes to 14 days, in whole hours and minutes.',
    });
    expect(
      newTourBody({
        ...blankTour(),
        title: ' Epe Fish Market ',
        summary: 'Fish at dawn',
        hours: '4',
        seats: '10',
        meetingName: 'Epe jetty',
        meetingAddress: 'Epe',
        transport: 'boat',
      }),
    ).toEqual({
      title: 'Epe Fish Market',
      summary: 'Fish at dawn',
      description: 'Fish at dawn',
      durationMinutes: 240,
      defaultCapacity: 10,
      transport: 'boat',
      meetingPoint: { name: 'Epe jetty', address: 'Epe' },
    });

    expect(saleWords(BADAGRY)).toMatchObject({ action: 'Take off sale', ready: true });
    expect(saleWords(EPE)).toMatchObject({
      action: 'Put on sale',
      ready: false,
      why: expect.stringMatching(/^Add its prices before it goes on sale/),
    });
    expect(saleWords({ ...EPE, priceCategories: [{ isActive: false }] }).ready).toBe(false);
    expect(saleWords({ ...EPE, priceCategories: [{ isActive: true }] })).toMatchObject({
      ready: true,
      why: null,
    });
  });
});

describe('Settings › Tours', () => {
  it('the list; a manager looks, without New tour', async () => {
    fakeFetch({ 'GET /api/products': () => [200, { products: [BADAGRY, EPE] }] });
    await show(OWNER, '/settings/tours');
    const list = await screen.findByRole('list', { name: 'Tours' });
    const badagry = within(list).getByRole('link', { name: /Badagry Heritage Day Trip/ });
    expect(badagry.textContent).toContain('Saturdays 07:00 · 14 seats');
    expect(badagry.textContent).toContain('ON SALE');
    expect(badagry.getAttribute('href')).toBe('/settings/tours/p-badagry');
    expect(within(list).getByRole('link', { name: /Epe/ }).textContent).toContain('DRAFT');
    expect(screen.getByRole('link', { name: 'New tour' })).toBeTruthy();
    cleanup();
    clearLive();
    fakeFetch({ 'GET /api/products': () => [200, { products: [BADAGRY] }] });
    await show(MANAGER, '/settings/tours');
    expect(await screen.findByText('Only the owner can change this. You can look.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'New tour' })).toBeNull();
  });

  it('a new tour: checked, then made as a draft and opened', async () => {
    const sent = fakeFetch({
      'POST /api/products': (b) => [201, { product: { ...EPE, ...b, id: 'p-new' } }],
      'GET /api/products/p-new': () => [200, { product: { ...EPE, id: 'p-new' } }],
      'GET /api/products': () => [200, { products: [] }],
    });
    await show(OWNER, '/settings/tours/new');
    fireEvent.click(await screen.findByRole('button', { name: 'Make the draft' }));
    expect(screen.getByText('Add a name.')).toBeTruthy();
    expect(sent.some((x) => x.method === 'POST')).toBe(false);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Epe Fish Market' } });
    fireEvent.change(screen.getByLabelText(/^Summary/), { target: { value: 'Fish at dawn' } });
    fireEvent.change(screen.getByLabelText(/^Meeting point/), { target: { value: 'Epe jetty' } });
    fireEvent.change(screen.getByLabelText(/^Address/), { target: { value: 'Epe' } });
    fireEvent.change(screen.getByLabelText(/^Map pin/), { target: { value: 'not a pin' } });
    expect(screen.getByText(/^We couldn’t find a place in that/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Map pin/), {
      target: { value: 'https://www.google.com/maps/@6.5841,3.9834,15z' },
    });
    expect(
      screen.getByText('Pin at 6.5841, 3.9834. Guests get a map and directions.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Boat'));
    fireEvent.click(screen.getByRole('button', { name: 'Make the draft' }));
    expect(await screen.findByRole('heading', { name: 'Epe Fish Market Morning' })).toBeTruthy();
    expect(sent.find((x) => x.method === 'POST')?.body).toEqual({
      title: 'Epe Fish Market',
      summary: 'Fish at dawn',
      description: 'Fish at dawn',
      durationMinutes: 180,
      defaultCapacity: 12,
      transport: 'boat',
      meetingPoint: { name: 'Epe jetty', address: 'Epe', lat: 6.5841, lng: 3.9834 },
    });
  });

  it('basics: changed, checked, saved (only what changed)', async () => {
    const sent = fakeFetch({
      'GET /api/products/p-badagry': () => [200, { product: BADAGRY }],
      'PATCH /api/products/p-badagry': (b) => [200, { product: { ...BADAGRY, ...b } }],
    });
    await show(OWNER, '/settings/tours/p-badagry');
    const basics = await screen.findByRole('region', { name: 'Basics' });
    expect(
      within(basics).getByText('Pin at 6.5095, 3.3711. Guests get a map and directions.'),
    ).toBeTruthy();
    fireEvent.change(within(basics).getByLabelText(/^Short name/), {
      target: { value: 'Badagry Heritage Day Trip!' },
    });
    expect(within(basics).getByText('1 thing to fix before saving')).toBeTruthy();
    expect(
      /** @type {HTMLButtonElement} */ (screen.getByRole('button', { name: 'Save changes' }))
        .disabled,
    ).toBe(true);
    fireEvent.change(within(basics).getByLabelText(/^Short name/), {
      target: { value: 'Badagry' },
    });
    fireEvent.change(within(basics).getByLabelText(/^What to bring/), {
      target: { value: 'Water\nA hat' },
    });
    expect(screen.getByText('Unsaved changes: Short name, What to bring')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/^Saved · \d\d:\d\d\.$/)).toBeTruthy();
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({
      shortTitle: 'Badagry',
      whatToBring: ['Water', 'A hat'],
    });
    expect(screen.queryByText(/^Unsaved changes/)).toBeNull();
  });

  it('leaving with something to fix: “Save and leave” saves nothing', async () => {
    const sent = fakeFetch({
      'GET /api/products/p-badagry': () => [200, { product: BADAGRY }],
      'PATCH /api/products/p-badagry': (b) => [200, { product: { ...BADAGRY, ...b } }],
    });
    await show(OWNER, '/settings/tours/p-badagry');
    const basics = await screen.findByRole('region', { name: 'Basics' });
    fireEvent.change(within(basics).getByLabelText(/^Name/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('link', { name: '‹ Tours' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and leave' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.some((x) => x.method === 'PATCH')).toBe(false);
    expect(screen.getByRole('region', { name: 'Basics' })).toBeTruthy();
  });

  it('on sale: taking it off asks first; a draft without prices can’t go on yet', async () => {
    const sent = fakeFetch({
      'GET /api/products/p-badagry': () => [200, { product: BADAGRY }],
      'PATCH /api/products/p-badagry': (b) => [200, { product: { ...BADAGRY, ...b } }],
    });
    await show(OWNER, '/settings/tours/p-badagry');
    expect(await screen.findByText('Published (on sale)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take off sale' }));
    const ask = screen.getByRole('group', { name: 'Take it off sale?' });
    expect(ask.textContent).toContain('Bookings already made stay');
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it on sale' }));
    expect(sent.some((x) => x.method === 'PATCH')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Take off sale' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Take it off sale?' })).getByRole('button', {
        name: 'Take off sale',
      }),
    );
    await vi.waitFor(() => expect(sent.some((x) => x.method === 'PATCH')).toBe(true));
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({ status: 'draft' });
    cleanup();
    clearLive();

    fakeFetch({ 'GET /api/products/p-epe': () => [200, { product: EPE }] });
    await show(OWNER, '/settings/tours/p-epe');
    const put = /** @type {HTMLButtonElement} */ (
      await screen.findByRole('button', { name: 'Put on sale' })
    );
    expect(put.disabled).toBe(true);
    expect(screen.getByText(/^Add its prices before it goes on sale/)).toBeTruthy();
    // Its pin is only the city's: shown as not set.
    expect(screen.getByText(/^Not set: guests see the address/)).toBeTruthy();
  });

  it('a manager can look at a tour, not change it', async () => {
    fakeFetch({ 'GET /api/products/p-badagry': () => [200, { product: BADAGRY }] });
    await show(MANAGER, '/settings/tours/p-badagry');
    const basics = await screen.findByRole('region', { name: 'Basics' });
    expect(within(basics).getByLabelText(/^Name/).matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Take off sale' })).toBeNull();
  });
});
