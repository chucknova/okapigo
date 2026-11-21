/**
 * Settings › Tours › one tour, stage 16e-4c: Extras, Pickup points, and Cancellation and
 * deposit. The rules in lib/tours.js, then the screen against a fake server: an extra changed,
 * added, removed; pickup points; the policy and deposit changed (and what that means for
 * bookings); all through the tour's one save bar; a manager.
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
  depositLine,
  extraChanges,
  extraErrors,
  extraLine,
  extraRows,
  extrasBody,
  noPickupsLine,
  pickupChanges,
  pickupErrors,
  pickupRows,
  pickupsBody,
  policyChoices,
  termsBody,
  termsChanges,
  termsErrors,
  termsForm,
  termsWords,
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

const LEKKI = {
  id: 'p-l',
  slug: 'lekki-nature-and-craft',
  title: 'Lekki Nature and Craft',
  shortTitle: null,
  summary: 'Nature and crafts.',
  description: 'A half day.',
  status: 'published',
  durationMinutes: 300,
  transport: 'van',
  activityLabel: null,
  arriveMinutesEarly: null,
  defaultCapacity: 12,
  meetingPoint: { name: 'Ìrìn office', address: 'Yaba', lat: 6.5, lng: 3.37 },
  stops: [],
  inclusions: [],
  exclusions: [],
  whatToBring: [],
  faqs: [],
  priceCategories: [
    {
      id: 'c-a',
      key: 'adult',
      name: 'Adult',
      minAge: 13,
      maxAge: null,
      amountKobo: 4_500_000,
      isActive: true,
    },
  ],
  addOns: [
    {
      id: 'a-lunch',
      name: 'Lunch',
      description: 'Jollof and plantain',
      priceKobo: 800_000,
      stockPerDeparture: null,
      isActive: true,
    },
    {
      id: 'a-boat',
      name: 'Boat ride',
      description: '',
      priceKobo: 500_000,
      stockPerDeparture: 10,
      isActive: true,
    },
    {
      id: 'a-old',
      name: 'Old',
      description: '',
      priceKobo: 1,
      stockPerDeparture: null,
      isActive: false,
    },
  ],
  pickupPoints: [
    { name: 'Victoria Island', address: 'Eko Hotel main gate', time: '07:15' },
    { name: 'Ikoyi', address: 'Falomo roundabout' },
  ],
  cancellationPolicyId: 'pol-std',
  depositBasisPoints: 3000,
  pricesNote: 'Prices include 7.5% VAT.',
  upcomingBookings: 5,
  balanceDueDays: 7,
  holdsLine: 'Seats are held 15 minutes on the website and 30 minutes on WhatsApp, for every tour.',
};
const STANDARD = {
  id: 'pol-std',
  name: 'Standard',
  current: {
    rules: [
      { hoursBefore: 48, refundBasisPoints: 10_000 },
      { hoursBefore: 24, refundBasisPoints: 5_000 },
      { hoursBefore: 0, refundBasisPoints: 0 },
    ],
  },
};
const FLEX = {
  id: 'pol-flex',
  name: 'Flexible',
  current: { rules: [{ hoursBefore: 24, refundBasisPoints: 10_000 }] },
};
const EMPTY = { id: 'pol-empty', name: 'Draft policy', current: null };
const TODAY = localDate(new Date(), 'Africa/Lagos');

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

const tour = (
  /** @type {Record<string, (body: any) => [number, any]>} */ more = {},
  product = LEKKI,
) =>
  fakeFetch({
    'GET /api/products/p-l': () => [200, { product }],
    'GET /api/products/p-l/schedules': () => [200, { schedules: [] }],
    [`GET /api/departures?productId=p-l&from=${TODAY}&to=${addDays(TODAY, 92)}`]: () => [
      200,
      { departures: [] },
    ],
    'GET /api/cancellation-policies': () => [200, { policies: [FLEX, STANDARD, EMPTY] }],
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

describe('tours.js: extras', () => {
  const saved = extraRows(LEKKI);

  it('the rows (active ones); each in a line', () => {
    expect(saved).toEqual([
      {
        id: 'a-lunch',
        name: 'Lunch',
        description: 'Jollof and plantain',
        naira: '8000',
        limit: '',
      },
      { id: 'a-boat', name: 'Boat ride', description: '', naira: '5000', limit: '10' },
    ]);
    expect(extraLine(saved[0])).toBe('₦8,000 each · No limit per departure');
    expect(extraLine(saved[1])).toBe('₦5,000 each · 10 per departure');
    expect(extraLine({ ...saved[0], naira: '0' })).toBe('Free · No limit per departure');
    expect(extraLine({ ...saved[0], naira: 'x', limit: 'y' })).toBe('');
  });

  it('checked; what PUT gets; what changed', () => {
    expect(extraErrors(saved)).toEqual({ rows: [{}, {}], count: 0 });
    expect(
      extraErrors([
        { id: null, name: '', description: 'x'.repeat(501), naira: 'lots', limit: '-1' },
      ]),
    ).toEqual({
      rows: [
        {
          name: 'Name it, like “Lunch”.',
          description: 'Keep it under 500 characters.',
          naira: 'A price in naira, like 8,000 (0 for free).',
          limit: 'A number, or empty for no limit.',
        },
      ],
      count: 4,
    });
    expect(extraErrors([{ ...saved[0], name: 'x'.repeat(101) }]).rows[0].name).toBe(
      'Keep it under 100 characters.',
    );
    const rows = [
      { ...saved[1], limit: '' },
      { id: null, name: ' Palm wine ', description: '', naira: '3,000', limit: '6' },
    ];
    expect(extrasBody(rows)).toEqual({
      addOns: [
        {
          id: 'a-boat',
          name: 'Boat ride',
          description: '',
          priceKobo: 500_000,
          stockPerDeparture: null,
        },
        { name: 'Palm wine', description: '', priceKobo: 300_000, stockPerDeparture: 6 },
      ],
    });
    expect(extraChanges(saved, saved)).toEqual([]);
    expect(extraChanges(rows, saved)).toEqual([
      'Boat ride',
      'New extra: Palm wine',
      'Removed: Lunch',
    ]);
    expect(extraChanges([saved[1], saved[0]], saved)).toEqual(['Extras order']);
    expect(extraChanges([{ ...saved[0], naira: '8,000' }, saved[1]], saved)).toEqual([]);
    expect(
      extraChanges(
        [...saved, { id: null, name: '', description: '', naira: '', limit: '' }],
        saved,
      ),
    ).toEqual(['New extra: unnamed']);
  });
});

describe('tours.js: pickup points', () => {
  const saved = pickupRows(LEKKI);

  it('area, place, time; checked; what PATCH gets; changed', () => {
    expect(saved).toEqual([
      { area: 'Victoria Island', place: 'Eko Hotel main gate', time: '07:15' },
      { area: 'Ikoyi', place: 'Falomo roundabout', time: '' },
    ]);
    expect(pickupErrors(saved)).toEqual({ rows: [{}, {}], count: 0 });
    expect(pickupErrors([{ area: '', place: '', time: '7.15' }])).toEqual({
      rows: [
        {
          area: 'The area, like “Victoria Island”.',
          place: 'Where exactly, like “Eko Hotel main gate”.',
          time: 'A 24-hour time, like 07:15.',
        },
      ],
      count: 3,
    });
    expect(
      pickupErrors([{ area: 'x'.repeat(121), place: 'y'.repeat(301), time: '' }]).rows[0],
    ).toEqual({
      area: 'Keep it under 120 characters.',
      place: 'Keep it under 300 characters.',
    });
    expect(pickupsBody([{ area: ' Ikoyi ', place: 'Falomo', time: ' ' }, saved[0]])).toEqual({
      pickupPoints: [
        { name: 'Ikoyi', address: 'Falomo' },
        { name: 'Victoria Island', address: 'Eko Hotel main gate', time: '07:15' },
      ],
    });
    expect(pickupChanges(saved, saved)).toEqual([]);
    expect(pickupChanges([{ ...saved[0], area: 'Victoria Island ' }, saved[1]], saved)).toEqual([]);
    expect(pickupChanges([saved[0]], saved)).toEqual(['Pickup points']);
    expect(noPickupsLine(LEKKI)).toBe('No pickup points: guests meet at Ìrìn office.');
  });
});

describe('tours.js: cancellation and deposit', () => {
  const saved = termsForm(LEKKI);

  it('the form; the menu; checked', () => {
    expect(saved).toEqual({ policyId: 'pol-std', deposit: 'allowed', percent: '30' });
    expect(termsForm({ cancellationPolicyId: null, depositBasisPoints: null })).toEqual({
      policyId: '',
      deposit: 'none',
      percent: '30',
    });
    expect(policyChoices([FLEX, STANDARD, EMPTY])).toEqual([
      { id: 'pol-flex', label: 'Flexible: Full refund 24 h+ · none under 24 h' },
      { id: 'pol-std', label: 'Standard: Full refund 48 h+ · 50% 24–48 h · No refund under 24 h' },
    ]);
    expect(termsErrors(saved)).toEqual({});
    expect(termsErrors({ ...saved, percent: '100' })).toEqual({
      percent: 'A whole percentage from 1 to 99.',
    });
    expect(termsErrors({ ...saved, percent: '0' }).percent).toBeDefined();
    expect(termsErrors({ ...saved, percent: '99' })).toEqual({});
    // No deposit: the percentage isn't checked.
    expect(termsErrors({ ...saved, deposit: 'none', percent: 'x' })).toEqual({});
  });

  it('what changed; what’s sent; what it means', () => {
    expect(termsChanges(saved, saved)).toEqual([]);
    expect(termsBody(saved, saved)).toEqual({});
    const f = { policyId: 'pol-flex', deposit: /** @type {const} */ ('none'), percent: '30' };
    expect(termsChanges(f, saved)).toEqual(['Cancellation policy', 'Deposit']);
    expect(termsBody(f, saved)).toEqual({
      cancellationPolicyId: 'pol-flex',
      depositBasisPoints: null,
    });
    expect(termsBody({ ...saved, percent: '25' }, saved)).toEqual({ depositBasisPoints: 2500 });
    expect(termsBody({ ...saved, policyId: '' }, saved)).toEqual({ cancellationPolicyId: null });
    // Switching to "none" and back to the same percentage is no change.
    expect(
      termsChanges({ ...saved, deposit: 'none' }, { ...saved, deposit: 'none', percent: '50' }),
    ).toEqual([]);
    expect(termsWords(f, saved, 5)).toBe(
      'New bookings get these terms. The 5 existing bookings keep the terms they were made with.',
    );
    expect(termsWords(f, saved, 1)).toBe(
      'New bookings get these terms. The 1 existing booking keeps the terms it was made with.',
    );
    expect(termsWords(f, saved, 0)).toBe(
      'New bookings get these terms. No booking is waiting on the old terms.',
    );
    expect(termsWords(saved, saved, 5)).toBeNull();
    expect(depositLine(saved, 7)).toBe(
      'Guests may pay 30% now; the balance is due 7 days before the trip. Booking later than that, they pay in full.',
    );
    expect(depositLine({ ...saved, percent: 'x' }, 7)).toMatch(/^Guests may pay … now/);
    expect(depositLine({ ...saved, deposit: 'none' }, 7)).toBe(
      'Guests pay in full when they book.',
    );
  });
});

describe('Settings › Tours › Extras, Pickup points, Cancellation and deposit', () => {
  it('an extra changed and one added: saved as a whole', async () => {
    const sent = tour({
      'PUT /api/products/p-l/add-ons': (b) => [
        200,
        {
          product: {
            ...LEKKI,
            addOns: b.addOns.map((/** @type {any} */ a, /** @type {number} */ i) => ({
              id: a.id ?? `a-new-${i}`,
              isActive: true,
              ...a,
            })),
          },
        },
      ],
    });
    await show(OWNER, '/settings/tours/p-l');
    const extras = await screen.findByRole('region', { name: 'Extras' });
    expect(within(extras).getByText('₦8,000 each · No limit per departure')).toBeTruthy();
    fireEvent.change(within(extras).getAllByLabelText(/^Price \(₦\)/)[0], {
      target: { value: '9,000' },
    });
    fireEvent.click(within(extras).getByRole('button', { name: 'Add an extra' }));
    const names = within(extras).getAllByRole('textbox', { name: /^Extra/ });
    fireEvent.change(names[2], { target: { value: 'Palm wine' } });
    fireEvent.change(within(extras).getAllByLabelText(/^Price \(₦\)/)[2], {
      target: { value: '3000' },
    });
    fireEvent.change(within(extras).getAllByLabelText(/^Limit per departure/)[2], {
      target: { value: '6' },
    });
    expect(screen.getByText('Unsaved changes: Lunch, New extra: Palm wine')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await within(extras).findByText(/^Saved · \d\d:\d\d\.$/)).toBeTruthy();
    expect(sent.find((x) => x.method === 'PUT')?.body).toEqual({
      addOns: [
        {
          id: 'a-lunch',
          name: 'Lunch',
          description: 'Jollof and plantain',
          priceKobo: 900_000,
          stockPerDeparture: null,
        },
        {
          id: 'a-boat',
          name: 'Boat ride',
          description: '',
          priceKobo: 500_000,
          stockPerDeparture: 10,
        },
        { name: 'Palm wine', description: '', priceKobo: 300_000, stockPerDeparture: 6 },
      ],
    });
  });

  it('an extra to fix holds the save; removed; discarded', async () => {
    const sent = tour();
    await show(OWNER, '/settings/tours/p-l');
    const extras = await screen.findByRole('region', { name: 'Extras' });
    fireEvent.change(within(extras).getAllByLabelText(/^Limit per departure/)[1], {
      target: { value: 'ten' },
    });
    expect(within(extras).getByText('A number, or empty for no limit.')).toBeTruthy();
    expect(
      /** @type {HTMLButtonElement} */ (screen.getByRole('button', { name: 'Save changes' }))
        .disabled,
    ).toBe(true);
    fireEvent.click(within(extras).getByRole('button', { name: 'Remove Boat ride' }));
    expect(screen.getByText('Unsaved changes: Removed: Boat ride')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(within(extras).getAllByRole('textbox', { name: /^Extra/ })).toHaveLength(2);
    expect(sent.some((x) => x.method === 'PUT')).toBe(false);
  });

  it('pickup points: one changed, one added, one removed; saved with the tour', async () => {
    const sent = tour({
      'PATCH /api/products/p-l': (b) => [200, { product: { ...LEKKI, ...b } }],
    });
    await show(OWNER, '/settings/tours/p-l');
    const pickups = await screen.findByRole('region', { name: 'Pickup points' });
    fireEvent.change(within(pickups).getAllByLabelText(/^Time/)[1], { target: { value: '07:30' } });
    fireEvent.click(within(pickups).getByRole('button', { name: 'Remove Victoria Island' }));
    fireEvent.click(within(pickups).getByRole('button', { name: 'Add a pickup point' }));
    fireEvent.change(within(pickups).getAllByLabelText(/^Area/)[1], {
      target: { value: 'Lekki Phase 1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    // The new one has no place yet: held.
    expect(within(pickups).getByText('Where exactly, like “Eko Hotel main gate”.')).toBeTruthy();
    fireEvent.change(within(pickups).getAllByLabelText(/^Place/)[1], {
      target: { value: 'Admiralty Way gate' },
    });
    expect(screen.getByText('Unsaved changes: Pickup points')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await within(pickups).findByText(/^Saved · \d\d:\d\d\.$/)).toBeTruthy();
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({
      pickupPoints: [
        { name: 'Ikoyi', address: 'Falomo roundabout', time: '07:30' },
        { name: 'Lekki Phase 1', address: 'Admiralty Way gate' },
      ],
    });
  });

  it('no pickup points: where guests meet instead', async () => {
    tour({}, { ...LEKKI, pickupPoints: [] });
    await show(OWNER, '/settings/tours/p-l');
    const pickups = await screen.findByRole('region', { name: 'Pickup points' });
    expect(within(pickups).getByText('No pickup points: guests meet at Ìrìn office.')).toBeTruthy();
  });

  it('cancellation and deposit: changed, what it means, saved', async () => {
    const sent = tour({
      'PATCH /api/products/p-l': (b) => [200, { product: { ...LEKKI, ...b } }],
    });
    await show(OWNER, '/settings/tours/p-l');
    const terms = await screen.findByRole('region', { name: 'Cancellation and deposit' });
    expect(within(terms).getByText(LEKKI.holdsLine)).toBeTruthy();
    expect(
      within(terms).getByText(
        'Guests may pay 30% now; the balance is due 7 days before the trip. Booking later than that, they pay in full.',
      ),
    ).toBeTruthy();
    const menu = /** @type {HTMLSelectElement} */ (
      within(terms).getByLabelText(/^Cancellation policy/)
    );
    await waitFor(() => expect(menu.options).toHaveLength(3));
    expect(menu.value).toBe('pol-std');
    expect(menu.options[1].textContent).toBe('Flexible: Full refund 24 h+ · none under 24 h');
    // The chosen policy in full under the menu (a long one is cut short inside it).
    expect(
      within(terms).getByText('Standard: Full refund 48 h+ · 50% 24–48 h · No refund under 24 h', {
        selector: 'span',
      }),
    ).toBeTruthy();
    fireEvent.change(menu, { target: { value: 'pol-flex' } });
    fireEvent.change(within(terms).getByLabelText('Deposit percentage'), {
      target: { value: '120' },
    });
    expect(within(terms).getByText('A whole percentage from 1 to 99.')).toBeTruthy();
    fireEvent.change(within(terms).getByLabelText('Deposit percentage'), {
      target: { value: '25' },
    });
    expect(
      within(terms).getByText(
        'New bookings get these terms. The 5 existing bookings keep the terms they were made with.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Unsaved changes: Cancellation policy, Deposit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await within(terms).findByText(/^Saved · \d\d:\d\d\.$/)).toBeTruthy();
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({
      cancellationPolicyId: 'pol-flex',
      depositBasisPoints: 2500,
    });
  });

  it('no policy: said what that means', async () => {
    tour({}, { ...LEKKI, cancellationPolicyId: null });
    await show(OWNER, '/settings/tours/p-l');
    const terms = await screen.findByRole('region', { name: 'Cancellation and deposit' });
    expect(
      within(terms).getByText(
        'Without a policy, guests can’t cancel for a refund themselves; you decide each one.',
      ),
    ).toBeTruthy();
  });

  it('no deposit: guests pay in full', async () => {
    const sent = tour({
      'PATCH /api/products/p-l': (b) => [200, { product: { ...LEKKI, ...b } }],
    });
    await show(OWNER, '/settings/tours/p-l');
    const terms = await screen.findByRole('region', { name: 'Cancellation and deposit' });
    fireEvent.click(within(terms).getByLabelText('No deposit'));
    expect(within(terms).getByText('Guests pay in full when they book.')).toBeTruthy();
    expect(within(terms).queryByLabelText('Deposit percentage')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(sent.some((x) => x.method === 'PATCH')).toBe(true));
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({ depositBasisPoints: null });
  });

  it('a manager looks: all switched off', async () => {
    tour();
    await show(MANAGER, '/settings/tours/p-l');
    const terms = await screen.findByRole('region', { name: 'Cancellation and deposit' });
    expect(
      within(terms)
        .getByLabelText(/^Cancellation policy/)
        .matches(':disabled'),
    ).toBe(true);
    const extras = screen.getByRole('region', { name: 'Extras' });
    expect(within(extras).getByRole('button', { name: 'Add an extra' }).matches(':disabled')).toBe(
      true,
    );
    const pickups = screen.getByRole('region', { name: 'Pickup points' });
    expect(within(pickups).getAllByLabelText(/^Area/)[0].matches(':disabled')).toBe(true);
  });
});
