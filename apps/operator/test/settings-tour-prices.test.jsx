/**
 * Settings › Tours › one tour, stage 16e-4b: Prices and Schedule and seats. The rules in
 * lib/tours.js, then the screen against a fake server: a price changed (and what it means for
 * bookings), added, removed, overlapping; one save bar for every section; the schedule changed
 * (and the booked departures it leaves), a new one, a one-off departure; a manager.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '../src/App.jsx';
import { EngineContext } from '../src/lib/engine.jsx';
import { createSyncEngine } from '../src/lib/sync.js';
import { createMemoryStore } from '../src/lib/store.js';
import { request } from '../src/lib/api.js';
import { clearLive } from '../src/lib/live.js';
import { addDays, localDate } from '@okapigo/shared/time';
import {
  agesLine,
  countsAsAdult,
  dayChip,
  koboOf,
  oneOffErrors,
  priceChangeWords,
  priceChanges,
  priceErrors,
  priceRows,
  pricesBody,
  runsPreview,
  scheduleBody,
  scheduleChanges,
  scheduleErrors,
  scheduleOf,
  syncLine,
  timesOf,
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

const cat = (/** @type {any} */ o) => ({ isActive: true, ...o });
const BADAGRY = {
  id: 'p-b',
  slug: 'badagry-heritage-day-trip',
  title: 'Badagry Heritage Day Trip',
  shortTitle: null,
  summary: 'A day in Badagry.',
  description: 'A full day.',
  status: 'published',
  durationMinutes: 600,
  transport: 'van',
  activityLabel: null,
  arriveMinutesEarly: null,
  defaultCapacity: 14,
  meetingPoint: { name: 'Ìrìn office', address: 'Yaba', lat: 6.5, lng: 3.37 },
  stops: [],
  inclusions: [],
  exclusions: [],
  whatToBring: [],
  faqs: [],
  addOns: [],
  priceCategories: [
    cat({
      id: 'c-adult',
      key: 'adult',
      name: 'Adult',
      minAge: 13,
      maxAge: null,
      amountKobo: 6_500_000,
    }),
    cat({
      id: 'c-child',
      key: 'child',
      name: 'Child',
      minAge: 3,
      maxAge: 12,
      amountKobo: 3_500_000,
    }),
    cat({ id: 'c-infant', key: 'infant', name: 'Infant', minAge: 0, maxAge: 2, amountKobo: 0 }),
    cat({
      id: 'c-old',
      key: 'old',
      name: 'Old',
      minAge: 0,
      maxAge: null,
      amountKobo: 1,
      isActive: false,
    }),
  ],
  pricesNote: 'Prices include 7.5% VAT.',
  upcomingBookings: 26,
};
const RULE = {
  id: 's-1',
  productId: 'p-b',
  startDate: '2026-01-01',
  endDate: null,
  daysOfWeek: [6],
  times: ['07:00'],
  capacity: null,
  skipDates: ['2026-12-26'],
  isActive: true,
};
const TODAY = localDate(new Date(), 'Africa/Lagos');
const DEPARTURES = `GET /api/departures?productId=p-b&from=${TODAY}&to=${addDays(TODAY, 92)}`;

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

/** The tour, its schedules and departures; more routes can be added. */
const tour = (
  /** @type {Record<string, (body: any) => [number, any]>} */ more = {},
  schedules = [RULE],
) =>
  fakeFetch({
    'GET /api/products/p-b': () => [200, { product: BADAGRY }],
    'GET /api/products/p-b/schedules': () => [200, { schedules }],
    [DEPARTURES]: () => [200, { departures: [] }],
    ...more,
  });

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

describe('tours.js: prices', () => {
  const saved = priceRows(BADAGRY);

  it('the rows (active ones), money typed, ages in words', () => {
    expect(saved).toEqual([
      { id: 'c-adult', name: 'Adult', minAge: '13', maxAge: '', naira: '65000' },
      { id: 'c-child', name: 'Child', minAge: '3', maxAge: '12', naira: '35000' },
      { id: 'c-infant', name: 'Infant', minAge: '0', maxAge: '2', naira: '0' },
    ]);
    expect(koboOf('70,000')).toBe(7_000_000);
    expect(koboOf(' ₦1,500.50 ')).toBe(150_050);
    expect(koboOf('0')).toBe(0);
    expect(koboOf('1.234')).toBeNaN();
    expect(koboOf('-5')).toBeNaN();
    expect(koboOf('')).toBeNaN();
    expect(koboOf('20000000')).toBe(2_000_000_000);
    expect(koboOf('20000000.01')).toBeNaN();
    expect(agesLine(saved[0])).toBe('13 and over');
    expect(agesLine(saved[1])).toBe('3–12');
    expect(agesLine({ ...saved[0], minAge: '0' })).toBe('Any age');
    expect(agesLine({ ...saved[0], minAge: 'x' })).toBe('');
    expect(countsAsAdult(saved[0])).toBe(true);
    expect(countsAsAdult(saved[1])).toBe(false);
  });

  it('what’s wrong: each row, and together', () => {
    expect(priceErrors(saved, true)).toEqual({ rows: [{}, {}, {}], all: null, count: 0 });
    const bad = priceErrors(
      [
        { id: null, name: '', minAge: '121', maxAge: '', naira: 'free' },
        { id: null, name: 'Teen', minAge: '15', maxAge: '13', naira: '1' },
      ],
      false,
    );
    expect(bad.rows).toEqual([
      {
        name: 'Name it, like “Adult”.',
        minAge: 'An age from 0 to 120.',
        naira: 'A price in naira, like 70,000 (0 for free).',
      },
      { maxAge: 'Not below the youngest age.' },
    ]);
    expect(bad.count).toBe(4);
    expect(
      priceErrors(
        [...saved, { id: null, name: 'Senior', minAge: '60', maxAge: '', naira: '1' }],
        true,
      ),
    ).toMatchObject({
      all: 'Adult and Senior cover some of the same ages.',
      count: 1,
    });
    expect(priceErrors([], true).all).toBe('A tour on sale needs at least one price.');
    // Ages are only compared once every row is right (a wrong row would make a false overlap).
    expect(
      priceErrors(
        [
          { id: null, name: '', minAge: '0', maxAge: '', naira: '1' },
          { id: null, name: 'B', minAge: '5', maxAge: '', naira: '1' },
        ],
        true,
      ),
    ).toMatchObject({ all: null, count: 1 });
    expect(priceErrors([], false).all).toBeNull();
    expect(priceErrors([{ ...saved[0], name: 'x'.repeat(51) }], true).rows[0].name).toBe(
      'Keep it under 50 characters.',
    );
    expect(priceErrors([{ ...saved[0], maxAge: '200' }], true).rows[0].maxAge).toMatch(
      /^An age from 0 to 120/,
    );
  });

  it('what PUT gets; what changed; what it means for bookings', () => {
    const rows = [
      { ...saved[0], naira: '70,000' },
      { id: null, name: 'Senior ', minAge: '65', maxAge: '', naira: '50000' },
      saved[1],
    ];
    expect(pricesBody(rows)).toEqual({
      categories: [
        { id: 'c-adult', name: 'Adult', minAge: 13, maxAge: null, amountKobo: 7_000_000 },
        { name: 'Senior', minAge: 65, maxAge: null, amountKobo: 5_000_000 },
        { id: 'c-child', name: 'Child', minAge: 3, maxAge: 12, amountKobo: 3_500_000 },
      ],
    });
    expect(priceChanges(saved, saved)).toEqual([]);
    // "65,000" is the same price as "65000"; a space isn't a change.
    expect(
      priceChanges([{ ...saved[0], naira: '65,000', name: 'Adult ' }, saved[1], saved[2]], saved),
    ).toEqual([]);
    expect(priceChanges(rows, saved)).toEqual([
      'Adult price',
      'New price: Senior',
      'Removed: Infant',
    ]);
    expect(priceChanges([{ ...saved[0], name: 'Grown-up' }, saved[1], saved[2]], saved)).toEqual([
      'Adult',
    ]);
    expect(priceChanges([saved[1], saved[0], saved[2]], saved)).toEqual(['Price order']);
    expect(
      priceChanges([...saved, { id: null, name: '', minAge: '', maxAge: '', naira: '' }], saved),
    ).toEqual(['New price: unnamed']);

    expect(priceChangeWords(rows, saved, 26)).toBe(
      'You changed Adult from ₦65,000 to ₦70,000. New bookings pay ₦70,000; the 26 existing bookings keep their price.',
    );
    expect(priceChangeWords(rows, saved, 1)).toMatch(/; the 1 existing booking keeps its price\.$/);
    expect(priceChangeWords(rows, saved, 0)).toMatch(/; no booking is waiting at the old price\.$/);
    expect(
      priceChangeWords(
        [
          { ...saved[0], naira: '70000' },
          { ...saved[1], naira: '30000' },
        ],
        saved,
        2,
      ),
    ).toBe(
      'You changed Adult from ₦65,000 to ₦70,000 and Child from ₦35,000 to ₦30,000. New bookings pay the new prices; the 2 existing bookings keep their price.',
    );
    expect(priceChangeWords(saved, saved, 26)).toBeNull();
    expect(priceChangeWords([{ ...saved[0], naira: 'x' }], saved, 26)).toBeNull();
  });
});

describe('tours.js: schedule', () => {
  it('the rule to edit; times; what’s wrong', () => {
    expect(scheduleOf([{ ...RULE, isActive: false, id: 'off' }, RULE], BADAGRY)).toEqual({
      id: 's-1',
      others: 0,
      form: { days: [6], times: '07:00', seats: '14', until: '', skip: ['2026-12-26'] },
    });
    expect(scheduleOf([RULE, { ...RULE, id: 's-2' }], BADAGRY).others).toBe(1);
    expect(scheduleOf([{ ...RULE, isActive: false }], BADAGRY)).toMatchObject({
      id: 's-1',
      others: 0,
    });
    expect(scheduleOf([], BADAGRY)).toEqual({
      id: null,
      others: 0,
      form: { days: [], times: '', seats: '14', until: '', skip: [] },
    });
    expect(
      scheduleOf([{ ...RULE, capacity: 9, endDate: '2027-03-31' }], BADAGRY).form,
    ).toMatchObject({
      seats: '9',
      until: '2027-03-31',
    });
    expect(timesOf(' 18:30, 7:00 ')).toEqual(['07:00', '18:30']);
    expect(scheduleErrors({ days: [], times: '', seats: '0', until: '', skip: [] })).toEqual({
      days: 'Pick at least one day.',
      times: 'Add a start time, like 07:00.',
      seats: 'From 1 to 500 seats.',
    });
    expect(
      scheduleErrors({ days: [1], times: '25:00', seats: '500', until: '', skip: [] }),
    ).toEqual({
      times: 'Use 24-hour times like 07:00 or 18:30, separated by commas.',
    });
    expect(
      scheduleErrors({ days: [1], times: '07:00, 7:00', seats: '1', until: '', skip: [] }).times,
    ).toBe('That time is there twice.');
    const thirteen = Array.from(
      { length: 13 },
      (_, i) => `${String(i + 6).padStart(2, '0')}:00`,
    ).join(',');
    expect(
      scheduleErrors({ days: [1], times: thirteen, seats: '1', until: '', skip: [] }).times,
    ).toBe('At most 12 start times.');
    expect(
      scheduleErrors({ days: [1], times: '07:00', seats: '501', until: '', skip: [] }).seats,
    ).toBe('From 1 to 500 seats.');
  });

  it('in words; what changed; what’s sent', () => {
    const saved = scheduleOf([RULE], BADAGRY).form;
    expect(runsPreview(saved)).toBe('Saturdays 07:00');
    expect(runsPreview({ ...saved, days: [0, 6] })).toBe('Weekends 07:00');
    expect(runsPreview({ ...saved, days: [] })).toBeNull();
    expect(scheduleChanges(saved, saved)).toEqual([]);
    const f = { ...saved, days: [0, 6], times: '7:00', seats: '12', skip: [] };
    expect(scheduleChanges(f, saved)).toEqual(['Days', 'Seats', 'Not running on']);
    expect(scheduleBody(f, saved, false, '2026-11-21')).toEqual({
      daysOfWeek: [0, 6],
      capacity: 12,
      skipDates: [],
    });
    expect(scheduleBody({ ...saved, until: '2027-01-31' }, saved, false, '2026-11-21')).toEqual({
      endDate: '2027-01-31',
    });
    expect(
      scheduleBody({ ...saved, until: '' }, { ...saved, until: '2027-01-31' }, false, 'x'),
    ).toEqual({
      endDate: null,
    });
    expect(scheduleBody({ ...saved, times: '07:00, 14:00' }, saved, false, 'x')).toEqual({
      times: ['07:00', '14:00'],
    });
    expect(scheduleBody(f, saved, true, '2026-11-21')).toEqual({
      startDate: '2026-11-21',
      daysOfWeek: [0, 6],
      times: ['07:00'],
      capacity: 12,
      endDate: null,
      skipDates: [],
    });
    expect(syncLine({ created: 4, removed: 1 })).toBe('4 departures added, 1 removed.');
    expect(syncLine({ created: 1, removed: 0 })).toBe('1 departure added.');
    expect(syncLine({ created: 0, removed: 2 })).toBe('2 removed.');
    expect(syncLine({ created: 0, removed: 0 })).toBe('The departures already matched.');
    expect(dayChip('2026-12-26')).toBe('Sat 26 Dec');
  });

  it('a one-off departure, checked', () => {
    expect(oneOffErrors({ date: '', time: '9', seats: '' }, '2026-11-21')).toEqual({
      date: 'Pick a date.',
      time: 'A 24-hour time, like 10:00.',
      seats: 'From 1 to 500 seats.',
    });
    expect(oneOffErrors({ date: '2026-11-20', time: '10:00', seats: '5' }, '2026-11-21')).toEqual({
      date: 'That date has passed.',
    });
    expect(oneOffErrors({ date: '2026-11-21', time: '10:00', seats: '5' }, '2026-11-21')).toEqual(
      {},
    );
  });
});

describe('Settings › Tours › Prices', () => {
  it('a price changed: what it means for bookings, then saved', async () => {
    const sent = tour({
      'PUT /api/products/p-b/price-categories': (b) => [
        200,
        {
          product: {
            ...BADAGRY,
            priceCategories: b.categories.map((/** @type {any} */ c, /** @type {number} */ i) => ({
              id: c.id ?? `c-new-${i}`,
              isActive: true,
              ...c,
            })),
          },
        },
      ],
    });
    await show(OWNER, '/settings/tours/p-b');
    const prices = await screen.findByRole('region', { name: 'Prices' });
    expect(within(prices).getByText('Prices include 7.5% VAT.')).toBeTruthy();
    expect(within(prices).getByText('13 and over · counts as an adult')).toBeTruthy();
    expect(within(prices).getByText('Free, needs a seat')).toBeTruthy();
    const [adultPrice] = within(prices).getAllByLabelText(/^Price \(₦\)/);
    fireEvent.change(adultPrice, { target: { value: '70,000' } });
    expect(
      within(prices).getByText(
        'You changed Adult from ₦65,000 to ₦70,000. New bookings pay ₦70,000; the 26 existing bookings keep their price.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Unsaved changes: Adult price')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await within(prices).findByText(/^Saved · \d\d:\d\d\.$/)).toBeTruthy();
    expect(sent.find((x) => x.method === 'PUT')?.body).toEqual({
      categories: [
        { id: 'c-adult', name: 'Adult', minAge: 13, maxAge: null, amountKobo: 7_000_000 },
        { id: 'c-child', name: 'Child', minAge: 3, maxAge: 12, amountKobo: 3_500_000 },
        { id: 'c-infant', name: 'Infant', minAge: 0, maxAge: 2, amountKobo: 0 },
      ],
    });
    // The bar hears from the section a moment after its note.
    await waitFor(() => expect(screen.queryByText(/^Unsaved changes/)).toBeNull());
  });

  it('added and removed; two prices for the same age hold the save', async () => {
    const sent = tour();
    await show(OWNER, '/settings/tours/p-b');
    const prices = await screen.findByRole('region', { name: 'Prices' });
    fireEvent.click(within(prices).getByRole('button', { name: 'Remove Infant' }));
    fireEvent.click(within(prices).getByRole('button', { name: 'Add a category' }));
    const names = within(prices).getAllByLabelText(/^Category/);
    fireEvent.change(names[2], { target: { value: 'Senior' } });
    fireEvent.change(within(prices).getByLabelText('Senior: youngest age'), {
      target: { value: '60' },
    });
    fireEvent.change(within(prices).getAllByLabelText(/^Price \(₦\)/)[2], {
      target: { value: '50000' },
    });
    expect(screen.getByText('Unsaved changes: New price: Senior, Removed: Infant')).toBeTruthy();
    expect(within(prices).getByText('Adult and Senior cover some of the same ages.')).toBeTruthy();
    expect(
      /** @type {HTMLButtonElement} */ (screen.getByRole('button', { name: 'Save changes' }))
        .disabled,
    ).toBe(true);
    // Discard: back as they were.
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(within(prices).getAllByLabelText(/^Category/)).toHaveLength(3);
    expect(sent.some((x) => x.method === 'PUT')).toBe(false);
  });

  it('one save bar: the basics and the prices saved together, in order', async () => {
    const sent = tour({
      'PATCH /api/products/p-b': (b) => [200, { product: { ...BADAGRY, ...b } }],
      'PUT /api/products/p-b/price-categories': () => [200, { product: BADAGRY }],
    });
    await show(OWNER, '/settings/tours/p-b');
    const basics = await screen.findByRole('region', { name: 'Basics' });
    fireEvent.change(within(basics).getByLabelText(/^Name/), { target: { value: 'Badagry Day' } });
    const prices = screen.getByRole('region', { name: 'Prices' });
    fireEvent.change(within(prices).getAllByLabelText(/^Price \(₦\)/)[1], {
      target: { value: '30000' },
    });
    expect(screen.getByText('Unsaved changes: Name, Child price')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByText(/^Unsaved changes/)).toBeNull());
    expect(sent.filter((x) => x.method !== 'GET').map((x) => `${x.method} ${x.path}`)).toEqual([
      'PATCH /api/products/p-b',
      'PUT /api/products/p-b/price-categories',
    ]);
  });

  it('a refused save stops there: what was saved stays, the rest waits', async () => {
    const sent = tour({
      'PATCH /api/products/p-b': (b) => [200, { product: { ...BADAGRY, ...b } }],
      'PUT /api/products/p-b/price-categories': () => [
        409,
        {
          error: {
            code: 'AGE_RANGE_OVERLAP',
            message: 'The "adult" and "senior" prices cover some of the same ages.',
          },
        },
      ],
    });
    await show(OWNER, '/settings/tours/p-b');
    const basics = await screen.findByRole('region', { name: 'Basics' });
    fireEvent.change(within(basics).getByLabelText(/^Name/), { target: { value: 'Badagry Day' } });
    const prices = screen.getByRole('region', { name: 'Prices' });
    fireEvent.change(within(prices).getAllByLabelText(/^Price \(₦\)/)[1], {
      target: { value: '30000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await within(prices).findByText(/cover some of the same ages/)).toBeTruthy();
    expect(screen.getByText('Unsaved changes: Child price')).toBeTruthy();
    expect(sent.filter((x) => x.method === 'PATCH')).toHaveLength(1);
  });
});

describe('Settings › Tours: the save bar across sections', () => {
  it('a section with something to fix but no change doesn’t hold up another’s save', async () => {
    const sent = fakeFetch({
      // An older tour whose stored summary is empty (Basics shows it to fix).
      'GET /api/products/p-b': () => [200, { product: { ...BADAGRY, summary: '' } }],
      'GET /api/products/p-b/schedules': () => [200, { schedules: [RULE] }],
      [DEPARTURES]: () => [200, { departures: [] }],
      'PUT /api/products/p-b/price-categories': () => [200, { product: BADAGRY }],
    });
    await show(OWNER, '/settings/tours/p-b');
    const basics = await screen.findByRole('region', { name: 'Basics' });
    expect(within(basics).getByText('Add a one-line summary.')).toBeTruthy();
    const prices = screen.getByRole('region', { name: 'Prices' });
    fireEvent.change(within(prices).getAllByLabelText(/^Price \(₦\)/)[1], {
      target: { value: '30000' },
    });
    const save = /** @type {HTMLButtonElement} */ (
      screen.getByRole('button', { name: 'Save changes' })
    );
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(sent.some((x) => x.method === 'PUT')).toBe(true));
  });

  it('“Save and leave” with a price to fix sends nothing', async () => {
    const sent = tour();
    await show(OWNER, '/settings/tours/p-b');
    const prices = await screen.findByRole('region', { name: 'Prices' });
    fireEvent.change(within(prices).getAllByLabelText(/^Price \(₦\)/)[0], {
      target: { value: 'lots' },
    });
    fireEvent.click(screen.getByRole('link', { name: '‹ Tours' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and leave' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.some((x) => x.method === 'PUT')).toBe(false);
    expect(screen.getByRole('region', { name: 'Prices' })).toBeTruthy();
  });
});

describe('Settings › Tours › Schedule and seats', () => {
  it('changed and saved; the booked departures it leaves, with links', async () => {
    const sent = tour({
      'PATCH /api/schedules/s-1': () => [
        200,
        {
          schedule: { ...RULE, daysOfWeek: [0, 6] },
          sync: {
            created: 8,
            removed: 0,
            needsAttention: [{}],
            attention: [
              { id: 'd-9', text: 'Sat 26 Dec, 07:00 · 4 guests · no longer in the schedule' },
            ],
          },
        },
      ],
    });
    await show(OWNER, '/settings/tours/p-b');
    const sched = await screen.findByRole('region', { name: 'Schedule and seats' });
    expect(await within(sched).findByText('Runs: Saturdays 07:00')).toBeTruthy();
    expect(within(sched).getByText(/^Sat 26 Dec/)).toBeTruthy();
    fireEvent.click(within(sched).getByLabelText('Sun'));
    expect(within(sched).getByText('Runs: Weekends 07:00')).toBeTruthy();
    fireEvent.change(within(sched).getByLabelText(/^Seats per departure/), {
      target: { value: '12' },
    });
    // "Add a date" needs a date, and one not already there.
    const addDate = /** @type {HTMLButtonElement} */ (
      within(sched).getByRole('button', { name: 'Add a date' })
    );
    expect(addDate.disabled).toBe(true);
    fireEvent.change(within(sched).getByLabelText('A date it doesn’t run'), {
      target: { value: '2026-12-26' },
    });
    expect(addDate.disabled).toBe(true);
    fireEvent.click(within(sched).getByRole('button', { name: 'Run on Sat 26 Dec again' }));
    fireEvent.change(within(sched).getByLabelText('A date it doesn’t run'), {
      target: { value: '2027-01-02' },
    });
    fireEvent.click(within(sched).getByRole('button', { name: 'Add a date' }));
    expect(screen.getByText('Unsaved changes: Days, Seats, Not running on')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await within(sched).findByText(/^Saved · \d\d:\d\d\. 8 departures added\.$/),
    ).toBeTruthy();
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({
      daysOfWeek: [0, 6],
      capacity: 12,
      skipDates: ['2027-01-02'],
    });
    const left = within(sched).getByRole('status', { name: 'Booked departures' });
    expect(left.textContent).toContain('This booked departure stays until you decide');
    expect(
      within(left)
        .getByRole('link', { name: 'Sat 26 Dec, 07:00 · 4 guests · no longer in the schedule ›' })
        .getAttribute('href'),
    ).toBe('/departures/d-9');
  });

  it('no schedule yet: a new one, from today', async () => {
    const sent = tour(
      {
        'PATCH /api/schedules/s-new': (b) => [
          200,
          {
            schedule: { ...RULE, ...b, id: 's-new' },
            sync: { created: 0, removed: 0, attention: [] },
          },
        ],
        'POST /api/products/p-b/schedules': (b) => [
          201,
          {
            schedule: { ...RULE, ...b, id: 's-new' },
            sync: { created: 9, removed: 0, attention: [] },
          },
        ],
      },
      [],
    );
    await show(OWNER, '/settings/tours/p-b');
    const sched = await screen.findByRole('region', { name: 'Schedule and seats' });
    expect(await within(sched).findByText('Not running yet')).toBeTruthy();
    fireEvent.click(within(sched).getByLabelText('Wed'));
    fireEvent.click(within(sched).getByLabelText('Sat'));
    fireEvent.change(within(sched).getByLabelText(/^Start time/), { target: { value: '8:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await within(sched).findByText(/9 departures added\.$/)).toBeTruthy();
    expect(sent.find((x) => x.method === 'POST')?.body).toEqual({
      startDate: TODAY,
      daysOfWeek: [3, 6],
      times: ['08:00'],
      capacity: 14,
      endDate: null,
      skipDates: [],
    });
    // Saved again: that rule changes; no second one is made.
    fireEvent.change(within(sched).getByLabelText(/^Seats per departure/), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(sent.filter((x) => x.method !== 'GET').map((x) => `${x.method} ${x.path}`)).toEqual([
        'POST /api/products/p-b/schedules',
        'PATCH /api/schedules/s-new',
      ]),
    );
  });

  it('a one-off departure, added straight away; the coming ones listed', async () => {
    const one = {
      id: 'd-1',
      scheduleId: null,
      status: 'scheduled',
      localDate: '2027-01-01',
      localTime: '10:00',
      capacity: 8,
    };
    const sent = tour({
      [DEPARTURES]: () => [
        200,
        {
          departures: [
            one,
            { ...one, id: 'd-2', scheduleId: 's-1' },
            { ...one, id: 'd-3', status: 'cancelled' },
          ],
        },
      ],
      'POST /api/products/p-b/departures': (b) => [
        201,
        { departure: { ...one, ...b, id: 'd-new' } },
      ],
    });
    await show(OWNER, '/settings/tours/p-b');
    const group = await screen.findByLabelText('One-off departures');
    const link = await within(group).findByRole('link', { name: 'Fri 1 Jan, 10:00 · 8 seats ›' });
    expect(link.getAttribute('href')).toBe('/departures/d-1');
    expect(within(group).getAllByRole('link')).toHaveLength(1);
    fireEvent.click(within(group).getByRole('button', { name: 'Add a one-off departure' }));
    const add = within(group).getByRole('group', { name: 'Add a one-off departure' });
    fireEvent.click(within(add).getByRole('button', { name: 'Add it' }));
    expect(within(add).getByText('Pick a date.')).toBeTruthy();
    fireEvent.change(within(add).getByLabelText('Date'), { target: { value: addDays(TODAY, 10) } });
    fireEvent.change(within(add).getByLabelText('Time'), { target: { value: '10:00' } });
    fireEvent.click(within(add).getByRole('button', { name: 'Add it' }));
    await waitFor(() => expect(sent.some((x) => x.method === 'POST')).toBe(true));
    expect(sent.find((x) => x.method === 'POST')?.body).toEqual({
      date: addDays(TODAY, 10),
      time: '10:00',
      capacity: 14,
    });
    // Not part of the save bar.
    // The bar hears from the section a moment after its note.
    await waitFor(() => expect(screen.queryByText(/^Unsaved changes/)).toBeNull());
  });

  it('a manager looks: the days and prices switched off, no one-off', async () => {
    tour();
    await show(MANAGER, '/settings/tours/p-b');
    const sched = await screen.findByRole('region', { name: 'Schedule and seats' });
    expect(within(sched).getByLabelText('Sat').matches(':disabled')).toBe(true);
    expect(within(sched).queryByRole('button', { name: 'Add a one-off departure' })).toBeNull();
    const prices = screen.getByRole('region', { name: 'Prices' });
    expect(
      within(prices)
        .getAllByLabelText(/^Price \(₦\)/)[0]
        .matches(':disabled'),
    ).toBe(true);
  });
});
