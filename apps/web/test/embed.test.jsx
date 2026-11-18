/**
 * The booking widget's own screens (stage 12h-1): the one-tour start with its date tiles, the
 * sold-out and no-dates states, all tours, and the height report to the host page.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { EmbedFrame, EmbedTour, EmbedTours } from '../src/screens/embed/Embed.jsx';
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

beforeEach(() => resetEmbedded());
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
    const first = await screen.findByRole('link', { name: 'Wed 18 Nov, 09:00: 12 left' });
    expect(first.getAttribute('href')).toBe('/irin/walk/book?departure=a');
    expect(screen.getByLabelText('Fri 20 Nov, 09:00: Sold out').tagName).toBe('SPAN'); // not a link
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
