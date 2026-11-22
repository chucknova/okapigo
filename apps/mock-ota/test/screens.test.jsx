/**
 * Sojourna's pages (17d-1) against a fake server: the storefront (and its states), a tour
 * (a date, who's coming, the rules, a pickup, holding the seats, seats gone meanwhile),
 * checkout (paying, the hold running out, the supplier not confirming), and "You're booked".
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '../src/App.jsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const SUPPLIER = {
  name: 'Ìrìn Lagos Tours',
  contact: { telephone: '+2348090000123', address: 'Yaba, Lagos' },
};
const unit = (
  /** @type {string} */ id,
  /** @type {string} */ type,
  /** @type {string} */ title,
  /** @type {number} */ retail,
  accompaniedBy = /** @type {string[]} */ ([]),
) => ({
  id,
  type,
  title,
  restrictions: { accompaniedBy },
  pricingFrom: [{ retail }],
});
const RULES = [
  { hoursBefore: 48, refundPercent: 100 },
  { hoursBefore: 24, refundPercent: 50 },
  { hoursBefore: 0, refundPercent: 0 },
];
/** @param {any} [o] @param {any} [option] */
const product = (o = {}, option = {}) => ({
  id: 'p1',
  title: 'Tarkwa Bay Beach and Lagoon Trip',
  shortDescription: 'Across the lagoon by boat.',
  description: 'A boat across the lagoon to a quiet beach.',
  durationMinutesFrom: 360,
  timeZone: 'Africa/Lagos',
  categoryLabels: ['Boat'],
  locations: [
    {
      title: 'Five Cowries Terminal, Ikoyi',
      types: ['START'],
      shortDescription: null,
      place: { latitude: 6.45, longitude: 3.43, postalAddress: { streetAddress: 'Ikoyi' } },
    },
  ],
  features: [
    { type: 'PREARRIVAL_INFORMATION', shortDescription: 'Swimwear and a towel' },
    { type: 'INCLUSION', shortDescription: 'Boat' },
  ],
  options: [
    {
      pickupRequired: false,
      pickupLocations: [],
      refundRules: RULES,
      units: [
        unit('adult', 'ADULT', 'Adult (13+)', 4_000_000),
        unit('child', 'CHILD', 'Child (3–12)', 2_200_000, ['adult']),
        unit('infant', 'INFANT', 'Infant (0–2)', 0, ['adult']),
      ],
      ...option,
    },
  ],
  ...o,
});

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
      const key = Object.keys(routes).find((k) => {
        const [m, p] = k.split(' ');
        return m === method && (p === path || (p.endsWith('*') && path.startsWith(p.slice(0, -1))));
      });
      if (!key)
        return new Response(JSON.stringify({ problem: 'refused', message: path }), { status: 404 });
      const [status, json] = routes[key](body);
      return new Response(JSON.stringify(json), { status });
    }),
  );
  return sent;
}

/** @param {string} path */
function show(path) {
  const { hook, navigate, history } = memoryLocation({ path, record: true });
  const r = render(
    <Router hook={hook}>
      <App />
    </Router>,
  );
  return { ...r, navigate, history: /** @type {string[]} */ (history) };
}

describe('M1 · the storefront', () => {
  it('the business’s tours, live: kind, length, price, free cancellation', async () => {
    fakeFetch({
      'GET /api/supplier': () => [200, { supplier: SUPPLIER }],
      'GET /api/experiences': () => [
        200,
        {
          experiences: [
            product(),
            product({ id: 'p2', title: 'Lekki', categoryLabels: [] }, { pickupRequired: true }),
          ],
        },
      ],
    });
    show('/');
    expect(
      await screen.findByRole('heading', { name: 'Experiences by Ìrìn Lagos Tours' }),
    ).toBeTruthy();
    expect(
      screen.getByText('2 experiences · local operator in Yaba, Lagos · instant confirmation'),
    ).toBeTruthy();
    const tarkwa = screen.getByRole('link', { name: /Tarkwa Bay/ });
    expect(tarkwa.getAttribute('href')).toBe('/experiences/p1');
    expect(tarkwa.textContent).toContain('Boat trip');
    expect(tarkwa.textContent).toContain('by Ìrìn Lagos Tours · 6 hours');
    expect(tarkwa.textContent).toContain('Free cancellation up to 48 hours before');
    expect(tarkwa.textContent).toContain('from ₦40,000 per adult');
    expect(screen.getByRole('link', { name: /Lekki/ }).textContent).toContain('Pickup included');
  });

  it('the supplier down: say so, and try again', async () => {
    let up = false;
    fakeFetch({
      'GET /api/supplier': () =>
        up ? [200, { supplier: SUPPLIER }] : [503, { problem: 'offline' }],
      'GET /api/experiences': () =>
        up ? [200, { experiences: [product()] }] : [503, { problem: 'offline' }],
    });
    show('/');
    const panel = within(await screen.findByRole('region', { name: /isn’t answering right now/ }));
    expect(panel.getByText('SUPPLIER OFFLINE')).toBeTruthy();
    up = true;
    fireEvent.click(panel.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Tarkwa Bay/ })).toBeTruthy();
  });

  it('nothing on Sojourna: say so', async () => {
    fakeFetch({
      'GET /api/supplier': () => [200, { supplier: SUPPLIER }],
      'GET /api/experiences': () => [200, { experiences: [] }],
    });
    show('/');
    expect(await screen.findByText('No experiences from Ìrìn Lagos Tours right now')).toBeTruthy();
    expect(screen.getByText('NOTHING LISTED')).toBeTruthy();
  });
});

describe('M2 · one experience', () => {
  const routes = (/** @type {any} */ p = product(), extra = {}) => ({
    'GET /api/supplier': () => [200, { supplier: SUPPLIER }],
    'GET /api/experiences/p1': () => [200, { experience: p }],
    'GET /api/experiences/p1/calendar*': () => [
      200,
      {
        days: [
          { localDate: '2026-12-05', available: false, status: 'SOLD_OUT', vacancies: 0 },
          { localDate: '2026-12-12', available: true, status: 'LIMITED', vacancies: 4 },
          { localDate: '2026-12-13', available: true, status: 'AVAILABLE', vacancies: 11 },
        ],
      },
    ],
    'GET /api/experiences/p1/times*': () => [
      200,
      {
        times: [
          {
            id: 'd12',
            localDateTimeStart: '2026-12-12T10:00:00+01:00',
            available: true,
            vacancies: 4,
          },
        ],
      },
    ],
    ...extra,
  });

  it('the first open day, its time and seats; the rules; holding the seats', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-12-01T09:00:00Z') });
    const sent = fakeFetch(
      routes(undefined, {
        'POST /api/holds': () => [201, { booking: { uuid: 'u-1' } }],
        'GET /api/holds/u-1': () => [200, { booking: null, experience: null }],
      }),
    );
    const { history } = show('/experiences/p1');
    expect(
      await screen.findByRole('heading', { name: 'Tarkwa Bay Beach and Lagoon Trip' }),
    ).toBeTruthy();
    expect(screen.getByText('December 2026')).toBeTruthy();
    const twelve = await screen.findByRole('button', { name: 'Dec 12, open' });
    await waitFor(() => expect(twelve.getAttribute('aria-pressed')).toBe('true'));
    expect(twelve.textContent).toContain('4 left');
    expect(screen.getByRole('button', { name: 'Dec 5, sold out' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: 'Dec 20, not running' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(await screen.findByText('Only 4 left')).toBeTruthy();
    expect(
      screen.getByText(/full refund 48 h\+ · 50% 24–48 h · no refund under 24 h/),
    ).toBeTruthy();
    expect(screen.getByText(/Cancellation \(Ìrìn’s policy\)/)).toBeTruthy();
    // Two adults to start: ₦80,000.
    expect(screen.getByText('2 adults')).toBeTruthy();
    expect(screen.getByText('₦80,000')).toBeTruthy();
    // A child: ₦102,000. Two more people: too many for the 4 seats left.
    fireEvent.click(screen.getByRole('button', { name: 'More: Child (3–12)' }));
    expect(screen.getByText('₦102,000')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More: Infant (0–2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'More: Infant (0–2)' }));
    expect(screen.getByRole('alert').textContent).toBe(
      'Only 4 seats left at 10:00. Infants need a seat too.',
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Fewer: Infant (0–2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fewer: Infant (0–2)' }));
    // No adults: a child can't go alone.
    fireEvent.click(screen.getByRole('button', { name: 'Fewer: Adult (13+)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fewer: Adult (13+)' }));
    expect(screen.getByRole('alert').textContent).toBe(
      'Ìrìn Lagos Tours requires children and infants to travel with an adult.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'More: Adult (13+)' }));
    fireEvent.click(screen.getByRole('button', { name: 'More: Adult (13+)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(history.at(-1)).toBe('/checkout/u-1'));
    expect(sent.find((x) => x.method === 'POST')?.body).toEqual({
      productId: 'p1',
      availabilityId: 'd12',
      units: { adult: 2, child: 1, infant: 0 },
      pickupLocationId: null,
    });
  });

  it('a day picked straight away stays picked (journey 3 found it overwritten by the default)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-12-01T09:00:00Z') });
    const sent = fakeFetch(routes());
    show('/experiences/p1');
    const thirteen = await screen.findByRole('button', { name: 'Dec 13, open' });
    fireEvent.click(thirteen);
    await new Promise((r) => setTimeout(r, 50));
    expect(thirteen.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Dec 12, open' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    await waitFor(() =>
      expect(sent.some((x) => x.path === '/api/experiences/p1/times?date=2026-12-13')).toBe(true),
    );
  });

  it('a tour that collects guests: where, before Continue', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-12-01T09:00:00Z') });
    const p = product(
      {},
      {
        pickupRequired: true,
        pickupLocations: [
          {
            id: 'victoria-island',
            title: 'Victoria Island',
            shortDescription: 'Eko Hotel main gate · pickup at 07:15',
          },
          { id: 'ikoyi', title: 'Ikoyi', shortDescription: 'Falomo roundabout · pickup at 07:30' },
        ],
      },
    );
    const sent = fakeFetch(
      routes(p, { 'POST /api/holds': () => [201, { booking: { uuid: 'u-2' } }] }),
    );
    show('/experiences/p1');
    const where = within(
      await screen.findByRole('region', { name: 'Where should the van collect you?' }),
    );
    expect(where.getByText('REQUIRED')).toBeTruthy();
    await screen.findByText('Only 4 left');
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveProperty('disabled', true);
    fireEvent.click(where.getByRole('button', { name: /Ikoyi/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(sent.some((x) => x.method === 'POST')).toBe(true));
    expect(sent.find((x) => x.method === 'POST')?.body.pickupLocationId).toBe('ikoyi');
  });

  it('seats gone meanwhile: "Someone just took the last seats", and choose again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-12-01T09:00:00Z') });
    fakeFetch(
      routes(undefined, {
        'POST /api/holds': () => [409, { problem: 'taken', message: 'x', vacancies: 1 }],
      }),
    );
    show('/experiences/p1');
    await screen.findByText('Only 4 left');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const panel = within(
      await screen.findByRole('region', { name: 'Someone just took the last seats' }),
    );
    expect(panel.getByText('JUST TAKEN')).toBeTruthy();
    expect(panel.getByText(/1 seat is left at 10:00\.$/)).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: 'Choose again' }));
    expect(screen.queryByText('JUST TAKEN')).toBeNull();
  });

  it('a tour no longer on Sojourna: say so', async () => {
    fakeFetch({
      'GET /api/supplier': () => [200, { supplier: SUPPLIER }],
      'GET /api/experiences/p1': () => [
        400,
        { problem: 'refused', message: 'The Product ID was invalid' },
      ],
    });
    show('/experiences/p1');
    expect(await screen.findByText('This experience isn’t on Sojourna now')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See other experiences' })).toBeTruthy();
  });
});

describe('M3 · checkout', () => {
  const HOLD = {
    uuid: 'u-1',
    productId: 'p1',
    status: 'ON_HOLD',
    utcExpiresAt: '2026-12-01T09:15:00Z',
    availability: { localDateTimeStart: '2026-12-12T10:00:00+01:00' },
    unitItems: [{ unitId: 'adult' }, { unitId: 'adult' }, { unitId: 'child' }],
    pricing: { retail: 10_200_000 },
    pickupLocation: null,
  };
  const routes = (/** @type {any} */ extra = {}) => ({
    'GET /api/supplier': () => [200, { supplier: SUPPLIER }],
    'GET /api/holds/u-1': () => [200, { booking: HOLD, experience: product() }],
    ...extra,
  });

  it('the seats held, counting down; the order; paying (a test) → booked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-12-01T09:00:08Z') });
    const sent = fakeFetch(
      routes({ 'POST /api/holds/u-1/confirm': () => [201, { ref: 'SJ-48213' }] }),
    );
    const { history } = show('/checkout/u-1');
    expect((await screen.findByRole('timer', { name: 'Seats held' })).textContent).toBe(
      'Seats held for 14:52',
    );
    const order = within(screen.getByRole('complementary', { name: 'Your booking' }));
    expect(order.getByText('Sat 12 Dec · 10:00')).toBeTruthy();
    expect(order.getByText('Five Cowries Terminal, Ikoyi')).toBeTruthy();
    expect(order.getByText('2 × Adult')).toBeTruthy();
    expect(order.getByText('₦80,000')).toBeTruthy();
    expect(order.getByText('1 × Child')).toBeTruthy();
    expect(
      order.getByText('Full refund until Thu 10 Dec, 10:00. 50% until Fri 11 Dec, 10:00.'),
    ).toBeTruthy();
    expect(screen.getByText(/and Ìrìn Lagos Tours’ cancellation policy\.$/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Hannah Weber' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'hannah@guest.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₦102,000 (test)' }));
    await waitFor(() => expect(history.at(-1)).toBe('/booked/SJ-48213'));
    expect(sent.find((x) => x.method === 'POST')?.body).toEqual({
      fullName: 'Hannah Weber',
      email: 'hannah@guest.example',
      phone: '',
    });
  });

  it('the hold runs out: "Your seats were released", and choose again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-12-01T09:20:00Z') });
    fakeFetch(routes());
    show('/checkout/u-1');
    const panel = within(await screen.findByRole('region', { name: 'Your seats were released' }));
    expect(panel.getByText('TIME’S UP')).toBeTruthy();
    expect(panel.getByRole('link', { name: 'Choose again' }).getAttribute('href')).toBe(
      '/experiences/p1',
    );
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('released while paying; the supplier not confirming: nothing charged, try again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-12-01T09:00:00Z') });
    let answer = /** @type {[number, any]} */ ([502, { problem: 'not_confirmed', message: 'x' }]);
    fakeFetch(routes({ 'POST /api/holds/u-1/confirm': () => answer }));
    show('/checkout/u-1');
    fireEvent.change(await screen.findByLabelText('Full name'), {
      target: { value: 'Hannah Weber' },
    });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'hannah@guest.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₦102,000 (test)' }));
    const panel = within(
      await screen.findByRole('region', { name: 'We couldn’t confirm your booking' }),
    );
    expect(panel.getByText(/didn’t confirm in time\. You haven’t been charged\./)).toBeTruthy();
    answer = [410, { problem: 'expired', message: 'x' }];
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Your seats were released' })).toBeTruthy();
  });

  it('refused (a bad email): in the server’s words', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-12-01T09:00:00Z') });
    fakeFetch(
      routes({
        'POST /api/holds/u-1/confirm': () => [
          400,
          { problem: 'refused', message: 'Type an email address, like name@example.com.' },
        ],
      }),
    );
    show('/checkout/u-1');
    fireEvent.change(await screen.findByLabelText('Full name'), {
      target: { value: 'Hannah Weber' },
    });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₦102,000 (test)' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Type an email address, like name@example.com.',
    );
  });
});

describe('M4 · you’re booked', () => {
  const BOOKED = {
    stored: { ref: 'SJ-48213', lead: { name: 'Hannah Weber' } },
    booking: {
      status: 'CONFIRMED',
      supplierReference: 'ILT-6WQ3PZ',
      availability: { localDateTimeStart: '2026-12-12T10:00:00+01:00' },
      unitItems: [{ unitId: 'adult' }, { unitId: 'adult' }, { unitId: 'child' }],
      pricing: { retail: 10_200_000 },
      pickupLocation: null,
      voucher: { deliveryOptions: [{ deliveryFormat: 'QRCODE', deliveryValue: 'T1.abc' }] },
    },
    experience: product(),
    supplier: SUPPLIER,
  };

  it('both references, the ticket, where to meet, what to bring, who runs it, what was paid', async () => {
    fakeFetch({ 'GET /api/bookings/SJ-48213': () => [200, BOOKED] });
    show('/booked/SJ-48213');
    expect(await screen.findByRole('heading', { name: 'You’re booked, Hannah' })).toBeTruthy();
    expect(
      screen.getByText('Tarkwa Bay Beach and Lagoon Trip · Sat 12 Dec, 10:00 · 2 adults, 1 child'),
    ).toBeTruthy();
    expect(screen.getByText('SJ-48213')).toBeTruthy();
    expect(screen.getByText('Ìrìn’s reference')).toBeTruthy();
    expect(screen.getAllByText('ILT-6WQ3PZ')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'QR ticket from Ìrìn Lagos Tours' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in Google Maps' }).getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=6.45,3.43',
    );
    expect(
      within(screen.getByRole('region', { name: 'What to bring' })).getByText(
        'Swimwear and a towel',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/Questions on the day: \+234 809 000 0123 \(WhatsApp\)\.$/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Paid ₦102,000 to Sojourna. To cancel, go to My bookings: Ìrìn’s policy applies.',
      ),
    ).toBeTruthy();
    const print = vi.fn();
    vi.stubGlobal('print', print);
    fireEvent.click(screen.getByRole('button', { name: 'Download ticket (PDF)' }));
    expect(print).toHaveBeenCalled();
  });

  it('with a pickup: where and when we collect you; cancelled: no ticket', async () => {
    fakeFetch({
      'GET /api/bookings/SJ-1': () => [
        200,
        {
          ...BOOKED,
          booking: {
            ...BOOKED.booking,
            status: 'CANCELLED',
            pickupLocation: { title: 'Ikoyi', shortDescription: 'Falomo roundabout' },
            localPickupDateTimeStart: '2026-12-12T07:30:00+01:00',
          },
        },
      ],
    });
    show('/booked/SJ-1');
    expect(await screen.findByRole('heading', { name: 'Cancelled, Hannah' })).toBeTruthy();
    expect(screen.getByText('Where we collect you')).toBeTruthy();
    expect(screen.getByText('Falomo roundabout · be ready by 07:30')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /QR ticket/ })).toBeNull();
    expect(screen.getByText('This booking is cancelled.')).toBeTruthy();
  });

  it('an unknown reference: not found', async () => {
    fakeFetch({});
    show('/booked/SJ-0');
    expect(await screen.findByText('We can’t find that booking')).toBeTruthy();
  });
});

describe('M5 · the back office (17d-2)', () => {
  const row = (
    /** @type {string} */ ref,
    /** @type {any} */ booking,
    /** @type {any} */ o = {},
  ) => ({
    stored: { ref, supplierReference: `ILT-${ref.slice(3)}`, lead: { name: 'Hannah Weber' }, ...o },
    booking,
    title: 'Tarkwa Bay Beach and Lagoon Trip',
  });
  const confirmed = (/** @type {any} */ o = {}) => ({
    status: 'CONFIRMED',
    cancellable: true,
    availability: { localDateTimeStart: '2026-12-12T10:00:00+01:00' },
    unitItems: [{ unitId: 'adult' }, { unitId: 'adult' }, { unitId: 'child' }],
    pricing: { retail: 10_200_000 },
    refundIfCancelledNow: { amount: 10_200_000, percent: 100, hoursBefore: 500 },
    ...o,
  });

  it('the bookings, their statuses from the supplier; cancelling asks first, then cancels', async () => {
    let cancelled = false;
    const sent = fakeFetch({
      'GET /api/bookings': () => [
        200,
        {
          supplier: SUPPLIER,
          lastSyncAt: new Date().toISOString(),
          rows: [
            row(
              'SJ-48213',
              cancelled
                ? confirmed({
                    status: 'CANCELLED',
                    cancellable: false,
                    cancellation: { refund: 'FULL', refundAmount: 10_200_000 },
                  })
                : confirmed(),
              cancelled ? { cancelledAt: 'x' } : {},
            ),
            row(
              'SJ-48102',
              confirmed({
                status: 'CANCELLED',
                cancellable: false,
                cancellation: { refund: 'FULL', refundAmount: 7_000_000 },
              }),
            ),
          ],
        },
      ],
      'POST /api/bookings/SJ-48213/cancel': () => {
        cancelled = true;
        return [200, { booking: {} }];
      },
    });
    show('/bookings');
    expect(
      await screen.findByRole('heading', { name: 'Bookings · Ìrìn Lagos Tours' }),
    ).toBeTruthy();
    expect(
      screen.getByText(/^Supplier connected through OCTO · last sync \d\d:\d\d$/),
    ).toBeTruthy();
    expect(screen.getByText('2 bookings')).toBeTruthy();
    const first = /** @type {HTMLElement} */ (screen.getByText('SJ-48213').closest('tr'));
    expect(first.textContent).toContain('Ìrìn: ILT-48213');
    expect(first.textContent).toContain('Sat 12 Dec · 10:00');
    expect(first.textContent).toContain('2 adults, 1 child');
    expect(first.textContent).toContain('₦102,000');
    expect(first.textContent).toContain('Confirmed');
    // The business called this one off (weather): shown by itself.
    expect(screen.getByText('Cancelled by supplier · full refund')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel SJ-48102' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel SJ-48213' }));
    const ask = within(screen.getByRole('alertdialog', { name: 'Cancel SJ-48213?' }));
    expect(
      ask.getByText(
        'Hannah Weber · Tarkwa Bay Beach and Lagoon Trip · Sat 12 Dec, 10:00 · 2 adults, 1 child',
      ),
    ).toBeTruthy();
    expect(ask.getByText('Cancelled 20 days before: full refund')).toBeTruthy();
    expect(
      ask.getByText(/₦102,000 back to the guest, under Ìrìn Lagos Tours’ policy\./),
    ).toBeTruthy();
    expect(
      ask.getByText('Ìrìn is told at once and the 3 seats go back on sale everywhere.'),
    ).toBeTruthy();
    fireEvent.click(ask.getByRole('button', { name: 'Keep booking' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sent.some((x) => x.method === 'POST')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel SJ-48213' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and refund ₦102,000' }));
    expect(await screen.findByText('Cancelled · ₦102,000 refunded')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel SJ-48213' })).toBeNull();
  });

  it('a trip that has started: too late to cancel online; ask the business', async () => {
    fakeFetch({
      'GET /api/bookings': () => [
        200,
        {
          supplier: SUPPLIER,
          lastSyncAt: null,
          rows: [row('SJ-48190', confirmed({ cancellable: false, refundIfCancelledNow: null }))],
        },
      ],
    });
    show('/bookings');
    expect(await screen.findByText(/not synced yet$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel SJ-48190' }));
    const panel = within(screen.getByRole('alertdialog', { name: 'Too late to cancel online' }));
    expect(panel.getByText('PAST THE CUTOFF')).toBeTruthy();
    expect(panel.getByText('This booking can’t be cancelled online any more')).toBeTruthy();
    expect(
      panel.getByText(
        'SJ-48190 · Tarkwa Bay Beach and Lagoon Trip started at 10:00 on Sat 12 Dec. After the start Ìrìn treats it as a no-show. Ask Ìrìn Lagos Tours directly.',
      ),
    ).toBeTruthy();
    expect(panel.getByRole('link', { name: 'Contact Ìrìn Lagos Tours' }).getAttribute('href')).toBe(
      'tel:+2348090000123',
    );
    fireEvent.click(panel.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('refused at the last moment (it just started): in the supplier’s words; none yet; offline', async () => {
    const sent = fakeFetch({
      'GET /api/bookings': () => [
        200,
        { supplier: SUPPLIER, lastSyncAt: null, rows: [row('SJ-1', confirmed())] },
      ],
      'POST /api/bookings/SJ-1/cancel': () => [
        409,
        { problem: 'too_late', message: 'The tour has started: it can’t be cancelled now.' },
      ],
    });
    show('/bookings');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel SJ-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and refund ₦102,000' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The tour has started: it can’t be cancelled now.',
    );
    // The list asked again: it may say "too late" now.
    await waitFor(() => expect(sent.filter((x) => x.path === '/api/bookings')).toHaveLength(2));
    cleanup();
    fakeFetch({
      'GET /api/bookings': () => [200, { supplier: SUPPLIER, lastSyncAt: null, rows: [] }],
    });
    show('/bookings');
    expect(await screen.findByText('Nothing booked yet')).toBeTruthy();
    cleanup();
    fakeFetch({ 'GET /api/bookings': () => [503, { problem: 'offline' }] });
    show('/bookings');
    expect(await screen.findByText('SUPPLIER OFFLINE')).toBeTruthy();
  });
});
