/**
 * The catalogue and tour page, rendered in a fake browser (jsdom) with a fake API.
 * They check what a guest would see, including the embedded-data shortcut and the states.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { Catalogue } from '../src/screens/Catalogue.jsx';
import { TourPage } from '../src/screens/TourPage.jsx';
import { resetEmbedded } from '../src/lib/data.js';

const operator = {
  slug: 'irin-lagos-tours',
  name: 'Ìrìn Lagos Tours',
  city: 'Lagos',
  currency: 'NGN',
  timeZone: 'Africa/Lagos',
  websiteStyle: 'classic',
  pricesInclude: 'VAT',
};
const card = (slug, title, extra = {}) => ({
  slug,
  title,
  summary: `${title} summary`,
  durationMinutes: 180,
  activityLabel: 'Walking',
  scheduleSummary: 'Daily 09:00',
  fromPriceKobo: 2_500_000,
  cancellationHeadline: 'Free cancellation up to 48 hours before',
  photo: null,
  nextDeparture: { localDate: '2026-11-18', localTime: '09:00', seatsAvailable: 12 },
  ...extra,
});
const tour = {
  slug: 'lagos-island-heritage-walk',
  title: 'Lagos Island Heritage Walk',
  summary: 'Three hours through old Lagos.',
  description: 'Walk the streets where modern Lagos began.',
  durationMinutes: 180,
  activityLabel: 'Walking',
  scheduleSummary: 'Daily 09:00',
  maxGuests: 15,
  meetingPoint: {
    name: 'Tinubu Square',
    address: 'Broad Street, Lagos Island',
    note: 'By the fountain.',
  },
  pickupPoints: [],
  stops: [{ name: 'Tinubu Square', description: 'Where it begins.' }],
  photos: [],
  inclusions: ['Bottled water'],
  exclusions: ['Tips'],
  whatToBring: ['Walking shoes'],
  faqs: [{ question: 'What if it rains?', answer: 'We walk in light rain.' }],
  fromPriceKobo: 2_500_000,
  depositBasisPoints: null,
  priceCategories: [
    { key: 'adult', name: 'Adult (13+)', minAge: 13, maxAge: null, amountKobo: 2_500_000 },
    { key: 'child', name: 'Child (3–12)', minAge: 3, maxAge: 12, amountKobo: 1_250_000 },
  ],
  addOns: [],
  cancellationPolicy: {
    rules: [
      { hoursBefore: 48, refundBasisPoints: 10_000 },
      { hoursBefore: 24, refundBasisPoints: 5_000 },
      { hoursBefore: 0, refundBasisPoints: 0 },
    ],
    noShowRefundBasisPoints: 0,
    depositRefundable: false,
  },
};

/** Puts data in the page the way the share pages do. */
function embed(data) {
  const el = document.createElement('script');
  el.id = 'okg-data';
  el.type = 'application/json';
  el.textContent = JSON.stringify(data);
  document.body.appendChild(el);
}

/** A fake API: path → [status, body]. Records what was asked. */
function fakeApi(routes) {
  const asked = [];
  vi.stubGlobal('fetch', async (path) => {
    asked.push(path);
    const match = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
    const [status, body] = match
      ? match[1]
      : [404, { error: { code: 'NOT_FOUND', message: 'Not found.' } }];
    return new Response(JSON.stringify(body), { status });
  });
  return asked;
}

beforeEach(() => {
  resetEmbedded();
  document.getElementById('okg-data')?.remove();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('A · Catalogue', () => {
  it('draws from embedded data at once, with no request', async () => {
    embed({
      kind: 'catalogue',
      operatorSlug: 'irin-lagos-tours',
      view: { operator, tours: [card('walk', 'Heritage Walk')] },
    });
    const asked = fakeApi({});

    render(<Catalogue params={{ operator: 'irin-lagos-tours' }} />);

    expect(screen.getByRole('heading', { name: 'Tours in Lagos' })).toBeTruthy();
    expect(
      screen.getByText('1 tour · prices include VAT · free cancellation up to 48 hours before'),
    ).toBeTruthy();
    const link = screen.getByRole('link', { name: /Heritage Walk/ });
    expect(link.getAttribute('href')).toBe('/irin-lagos-tours/walk');
    expect(link.textContent).toContain('₦25,000');
    expect(link.textContent).toContain('Wed 18 Nov');
    expect(asked).toEqual([]);
  });

  it('fetches when there is no embedded data, and leaves out a cancellation line tours disagree on', async () => {
    fakeApi({
      '/public/irin-lagos-tours': [
        200,
        {
          operator,
          tours: [card('a', 'Tour A'), card('b', 'Tour B', { cancellationHeadline: null })],
        },
      ],
    });

    render(<Catalogue params={{ operator: 'irin-lagos-tours' }} />);

    expect(await screen.findByText('2 tours · prices include VAT')).toBeTruthy();
  });

  it('shows "no tours" and "not found"', async () => {
    fakeApi({ '/public/irin-lagos-tours': [200, { operator, tours: [] }] });
    render(<Catalogue params={{ operator: 'irin-lagos-tours' }} />);
    expect(await screen.findByText('No tours available right now')).toBeTruthy();
    cleanup();

    fakeApi({});
    render(<Catalogue params={{ operator: 'nobody' }} />);
    expect(await screen.findByText("We couldn't find that page")).toBeTruthy();
  });

  it("says you're offline, with Try again", async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    render(<Catalogue params={{ operator: 'irin-lagos-tours' }} />);
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('B · Tour page', () => {
  const departures = (list) => [200, { from: '2026-11-17', to: '2027-01-12', departures: list }];
  const d = (id, localDate, seatsAvailable) => ({
    id,
    localDate,
    localTime: '09:00',
    seatsAvailable,
    soldOut: seatsAvailable === 0,
  });

  it('shows the facts, the policy in words, and dates that link into checkout', async () => {
    embed({
      kind: 'tour',
      operatorSlug: 'irin-lagos-tours',
      tourSlug: tour.slug,
      view: { operator, tour },
    });
    const asked = fakeApi({
      '/public/irin-lagos-tours/tours/lagos-island-heritage-walk/departures': departures([
        d('d1', '2026-11-18', 12),
        d('d2', '2026-11-19', 3),
        d('d3', '2026-11-20', 0),
      ]),
    });

    render(<TourPage params={{ operator: 'irin-lagos-tours', tour: tour.slug }} />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Lagos Island Heritage Walk' }),
    ).toBeTruthy();
    for (const chip of ['3 hours', 'Walking', 'Up to 15 guests', 'Daily 09:00']) {
      expect(screen.getByText(chip)).toBeTruthy();
    }
    expect(screen.getByText('24 to 48 hours before: 50% back')).toBeTruthy();
    expect(screen.getByText('Broad Street, Lagos Island. By the fountain.')).toBeTruthy();

    const tile = await screen.findByRole('link', { name: /Wed 18 Nov/ });
    expect(tile.getAttribute('href')).toBe(
      '/irin-lagos-tours/lagos-island-heritage-walk/book?departure=d1',
    );
    expect(screen.getAllByText(/Only 3 left/).length).toBeGreaterThan(0);
    // Sold out stays visible but isn't a link.
    expect(screen.getByLabelText('Fri 20 Nov: sold out')).toBeTruthy();
    // Only the live seats were fetched; the tour came embedded.
    expect(asked.every((p) => p.includes('/departures'))).toBe(true);
  });

  it('says "sold out until" with the next dates that have seats', async () => {
    embed({
      kind: 'tour',
      operatorSlug: 'irin-lagos-tours',
      tourSlug: tour.slug,
      view: { operator, tour },
    });
    // Far in the future relative to any test date: every date in the first 2 weeks is full.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
    const plus = (n) => {
      const t = new Date(`${today}T12:00:00Z`);
      t.setUTCDate(t.getUTCDate() + n);
      return t.toISOString().slice(0, 10);
    };
    fakeApi({
      '/public/irin-lagos-tours/tours/lagos-island-heritage-walk/departures': departures([
        d('a', plus(1), 0),
        d('b', plus(8), 0),
        d('c', plus(20), 6),
        d('e', plus(21), 9),
      ]),
    });

    render(<TourPage params={{ operator: 'irin-lagos-tours', tour: tour.slug }} />);

    expect(await screen.findByText(/^Sold out until /)).toBeTruthy();
    expect(screen.getByText('Popular')).toBeTruthy();
  });

  it("a tour that isn't sold any more says so, with a way back", async () => {
    fakeApi({});
    render(<TourPage params={{ operator: 'irin-lagos-tours', tour: 'gone' }} />);
    expect(await screen.findByText("This tour isn't available any more")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See all tours' }).getAttribute('href')).toBe(
      '/irin-lagos-tours',
    );
  });

  it('waits for the dates without breaking the page', async () => {
    embed({
      kind: 'tour',
      operatorSlug: 'irin-lagos-tours',
      tourSlug: tour.slug,
      view: { operator, tour },
    });
    vi.stubGlobal('fetch', () => new Promise(() => {})); // never answers
    render(<TourPage params={{ operator: 'irin-lagos-tours', tour: tour.slug }} />);
    await waitFor(() => expect(screen.getByRole('status', { name: 'Loading dates' })).toBeTruthy());
  });
});
