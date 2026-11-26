/**
 * The booking widget's own screens (stage 12h-1): the one-tour start with its date tiles, the
 * sold-out and no-dates states, all tours, and the height report to the host page.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { EmbedFrame, EmbedTour, EmbedTours } from '../src/screens/embed/Embed.jsx';
import { CheckoutFrame } from '../src/screens/checkout/CheckoutFrame.jsx';
import { Confirm } from '../src/screens/trip/Confirm.jsx';
import { resetEmbedded } from '../src/lib/data.js';

const operator = {
  slug: 'irin',
  name: 'Ìrìn Lagos Tours',
  city: 'Lagos',
  timeZone: 'Africa/Lagos',
};
const tour = {
  slug: 'walk',
  title: 'Lagos Island Heritage Walk',
  fromPriceKobo: 2_500_000,
  cancellationPolicy: {
    rules: [
      { hoursBefore: 48, refundBasisPoints: 10_000 },
      { hoursBefore: 0, refundBasisPoints: 0 },
    ],
    noShowRefundBasisPoints: 0,
    depositRefundable: false,
  },
};
const dep = (id, localDate, seatsAvailable) => ({
  id,
  localDate,
  localTime: '09:00',
  seatsAvailable,
  soldOut: seatsAvailable === 0,
});

function fakeApi(routes) {
  vi.stubGlobal('fetch', async (path) => {
    const match = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
    const [status, body] = match ? match[1] : [404, { error: { code: 'NOT_FOUND', message: 'x' } }];
    return new Response(JSON.stringify(body), { status });
  });
}
function renderAt(path, Screen, pattern) {
  const memory = memoryLocation({ path });
  render(
    <Router hook={memory.hook}>
      <EmbedFrame>
        <Route path={pattern} component={Screen} />
      </EmbedFrame>
    </Router>,
  );
}
const departures = (list) => [200, { from: '2026-11-18', to: '2027-01-12', departures: list }];

beforeEach(() => {
  resetEmbedded();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('one tour', () => {
  it('title, from price, six date tiles (a full one isn’t a link), and the terms line', async () => {
    fakeApi({
      '/public/irin/tours/walk/departures': departures([
        dep('a', '2026-11-18', 12),
        dep('b', '2026-11-19', 3),
        dep('c', '2026-11-20', 0),
        dep('d', '2026-11-21', 15),
        dep('e', '2026-11-22', 9),
        dep('f', '2026-11-23', 15),
        dep('g', '2026-11-24', 15),
      ]),
      '/public/irin/tours/walk': [200, { operator, tour }],
    });
    renderAt('/irin/walk', EmbedTour, '/:operator/:tour');

    expect(await screen.findByRole('heading', { name: 'Lagos Island Heritage Walk' })).toBeTruthy();
    expect(screen.getByText('₦25,000')).toBeTruthy();
    // Its own text is its name, in order, the hidden parts in between (19c-1).
    const first = await screen.findByRole('link', { name: 'Wed 18 Nov, 09:00, 12 left' });
    expect(first.getAttribute('href')).toBe('/irin/walk/book?departure=a');
    expect(screen.getByText('Full').closest('span.okg-embed__tile')).toBeTruthy(); // not a link
    expect(screen.getAllByRole('link', { name: /Nov, 09:00/ })).toHaveLength(5); // 6 tiles, 1 full
    expect(screen.getByRole('link', { name: 'More dates' }).getAttribute('href')).toBe(
      '/irin/walk/book',
    );
    expect(
      screen.getByText('Times in Lagos time · free cancellation up to 48 hours before'),
    ).toBeTruthy();
    expect(screen.getByText('Bookings by OkapiGo')).toBeTruthy();
  });

  it('sold out for now: says until when, and offers later dates', async () => {
    const full = Array.from({ length: 20 }, (_, i) =>
      dep(`x${i}`, `2026-11-${String(18 + (i % 10)).padStart(2, '0')}`, 0),
    ).slice(0, 10);
    fakeApi({
      '/public/irin/tours/walk/departures': departures([...full, dep('late', '2026-12-05', 8)]),
      '/public/irin/tours/walk': [200, { operator, tour }],
    });
    renderAt('/irin/walk', EmbedTour, '/:operator/:tour');
    expect(await screen.findByText('Sold out until Sat 5 Dec.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See later dates' })).toBeTruthy();
  });

  it('no dates at all: ask the operator', async () => {
    fakeApi({
      '/public/irin/tours/walk/departures': departures([]),
      '/public/irin/tours/walk': [200, { operator, tour }],
    });
    renderAt('/irin/walk', EmbedTour, '/:operator/:tour');
    expect(await screen.findByText('No dates scheduled yet. Ask Ìrìn on WhatsApp.')).toBeTruthy();
  });
});

describe('all tours', () => {
  it('a row per tour, straight into its checkout', async () => {
    fakeApi({
      '/public/irin': [
        200,
        {
          operator,
          tours: [
            {
              slug: 'walk',
              title: 'Lagos Island Heritage Walk',
              durationMinutes: 180,
              scheduleSummary: 'Daily 09:00',
              fromPriceKobo: 2_500_000,
              nextDeparture: { localDate: '2026-11-18', localTime: '09:00' },
            },
          ],
        },
      ],
    });
    renderAt('/irin', EmbedTours, '/:operator');
    const row = await screen.findByRole('link', { name: /Lagos Island Heritage Walk/ });
    expect(row.getAttribute('href')).toBe('/irin/walk/book');
    expect(row.textContent).toContain('3 h · daily 09:00 · next Wed 18 Nov');
  });
});

describe('the frame', () => {
  it('tells the host page its height, and only that', async () => {
    const observed = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(el) {
          observed.push(el);
        }
        disconnect() {}
      },
    );
    const posted = [];
    // In a real frame, window.parent is the host page.
    vi.spyOn(window, 'parent', 'get').mockReturnValue(
      /** @type {any} */ ({ postMessage: (msg, target) => posted.push([msg, target]) }),
    );
    fakeApi({
      '/public/irin/tours/walk/departures': departures([]),
      '/public/irin/tours/walk': [200, { operator, tour }],
    });
    renderAt('/irin/walk', EmbedTour, '/:operator/:tour');
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const [msg, target] = posted[0];
    expect(Object.keys(msg).sort()).toEqual(['height', 'type']);
    expect(msg.type).toBe('okapigo:resize');
    expect(typeof msg.height).toBe('number');
    expect(target).toBe('*'); // safe: it's only a number
    expect(observed[0]?.className).toBe('okg-embed'); // it watches its own box, not the page
  });
});

describe('the overlay (stage 12h-2)', () => {
  /** Opens a screen the way the overlay does: /embed/…?overlay=1. */
  const inOverlay = (ui) => {
    window.history.replaceState({}, '', '/embed/irin/walk/book?overlay=1');
    const memory = memoryLocation({ path: '/irin/walk/book' });
    render(
      <Router hook={memory.hook}>
        <EmbedFrame>{ui}</EmbedFrame>
      </Router>,
    );
  };
  const step = (n) => (
    <CheckoutFrame
      step={n}
      title="Choose a date"
      subtitle="Walk · Step 1 of 4"
      operatorName="Ìrìn"
      backHref="/irin/walk"
    >
      <p>content</p>
    </CheckoutFrame>
  );

  it('step 1: Close where Back usually is; it asks the host page to close', () => {
    const posted = [];
    vi.spyOn(window, 'parent', 'get').mockReturnValue(
      /** @type {any} */ ({ postMessage: (m) => posted.push(m) }),
    );
    inOverlay(step(1));
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(posted).toContainEqual({ type: 'okapigo:close' });
    // Escape too (inside the frame, the host page never hears the key).
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(posted.filter((m) => m.type === 'okapigo:close')).toHaveLength(2);
    // In the overlay the frame doesn't report a height (its size is fixed).
    expect(posted.some((m) => m.type === 'okapigo:resize')).toBe(false);
  });

  it('from step 2: Back appears beside Close; and the overlay is remembered between steps', () => {
    inOverlay(step(2));
    cleanup();
    window.history.replaceState({}, '', '/embed/irin/walk/book/who'); // no ?overlay=1 now
    const memory = memoryLocation({ path: '/irin/walk/book/who' });
    render(
      <Router hook={memory.hook}>
        <EmbedFrame>{step(2)}</EmbedFrame>
      </Router>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back' })).toBeTruthy();
  });

  it('outside the overlay there is no Close', () => {
    const memory = memoryLocation({ path: '/irin/walk/book' });
    render(
      <Router hook={memory.hook}>
        <EmbedFrame>{step(1)}</EmbedFrame>
      </Router>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back' })).toBeTruthy();
  });
});

describe('booking completed (stage 12h-2)', () => {
  const T = 'T'.repeat(44);
  const booked = {
    reference: 'ILT-7K4Q2M',
    status: 'paid',
    operator: { slug: 'irin', name: 'Ìrìn Lagos Tours', timeZone: 'Africa/Lagos' },
    tour: {
      slug: 'walk',
      title: 'Heritage Walk',
      durationMinutes: 180,
      meetingPoint: { name: 'Tinubu Square', address: 'Broad Street' },
    },
    departure: { startsAt: '2026-12-05T08:00:00Z', localDate: '2026-12-05', localTime: '09:00' },
    pickupPoint: null,
    lead: { name: 'Tola Bello', email: 'tola@guest.example', phone: null },
    travellers: [{ name: 'Tola Bello', age: 30, categoryKey: 'adult', dietaryNeeds: '' }],
    quote: { lines: [], tax: { name: 'VAT', inclusive: true }, taxKobo: 0 },
    totalKobo: 2_500_000,
    amountPaidKobo: 2_500_000,
    balanceKobo: 0,
    balanceDueDate: null,
    paymentOptions: [],
    payments: [
      {
        reference: 'OKG-A',
        status: 'succeeded',
        purpose: 'full',
        amountKobo: 2_500_000,
        paidAt: '2026-11-18T10:00:00Z',
      },
    ],
    cancellationPolicy: null,
  };

  it('in the widget, the confirmation tells the host page once, with nothing personal; trip links open a new tab', async () => {
    const posted = [];
    vi.spyOn(window, 'parent', 'get').mockReturnValue(
      /** @type {any} */ ({ postMessage: (m) => posted.push(m) }),
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    fakeApi({ [`/public/bookings/${T}`]: [200, { booking: booked }] });
    const memory = memoryLocation({ path: `/trip/${T}/confirm?reference=OKG-A` });
    render(
      <Router hook={memory.hook}>
        <EmbedFrame>
          <Route path="/trip/:token/confirm" component={Confirm} />
        </EmbedFrame>
      </Router>,
    );
    expect(await screen.findByRole('heading', { name: 'Booking confirmed' })).toBeTruthy();
    await waitFor(() =>
      expect(posted.filter((m) => m.type === 'okapigo:booking-completed')).toHaveLength(1),
    );
    const event = posted.find((m) => m.type === 'okapigo:booking-completed');
    expect(event.booking).toEqual({
      reference: 'ILT-7K4Q2M',
      operator: 'irin',
      tour: 'walk',
      amountPaidKobo: 2_500_000,
      currency: 'NGN',
    });
    expect(JSON.stringify(event)).not.toContain('Tola');
    const trip = screen.getByRole('link', { name: 'Open your trip page' });
    expect(trip.getAttribute('target')).toBe('_blank');
    expect(trip.getAttribute('href')).toBe(`/trip/${T}`);
  });
});
