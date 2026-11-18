/**
 * The operator site (the old catalogue) and tour page, rendered in a fake browser (jsdom) with a fake API.
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

describe('The operator site (stage 12g-2)', () => {
  const site = (over = {}) => ({
    kind: 'City and food tours',
    tagline: 'Walk Lagos with people who love it',
    intro: 'Small groups, local guides, free cancellation up to 48 hours before.',
    about: 'Ìrìn means “walk” in Yoruba.',
    whyUs: [
      { title: 'Free cancellation up to 48 hours', text: 'Plans change.' },
      { title: 'Small groups', text: 'Never more than 15.' },
      { title: 'Guides from the neighbourhood', text: 'Not a script.' },
    ],
    faqs: [{ question: 'How do I pay?', answer: 'By card or bank transfer, through Paystack.' }],
    contact: {
      phone: '+2348090000123',
      whatsapp: '+2348090000123',
      email: 'hello@irin.example',
      address: 'Yaba, Lagos',
      socials: [{ network: 'instagram', url: 'https://instagram.example/irin' }],
    },
    ...over,
  });
  /** @param {any} view */
  const show = (view) => {
    embed({ kind: 'catalogue', operatorSlug: 'irin-lagos-tours', view });
    fakeApi({});
    render(<Catalogue params={{ operator: 'irin-lagos-tours' }} />);
  };
  const noContact = { phone: null, whatsapp: null, email: null, address: null, socials: [] };

  it('draws from embedded data at once: hero, tours, about, why, questions, contact', () => {
    embed({
      kind: 'catalogue',
      operatorSlug: 'irin-lagos-tours',
      view: { operator, site: site(), tours: [card('walk', 'Heritage Walk')] },
    });
    const asked = fakeApi({});
    render(<Catalogue params={{ operator: 'irin-lagos-tours' }} />);

    expect(screen.getByText('City and food tours · Lagos')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Walk Lagos with people who love it' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See tours and dates' }).getAttribute('href')).toBe(
      '#tours',
    );
    const link = screen.getByRole('link', { name: /Heritage Walk/ });
    expect(link.getAttribute('href')).toBe('/irin-lagos-tours/walk');
    expect(link.textContent).toContain('3 h · walking · daily 09:00');
    expect(link.textContent).toContain('₦25,000');
    expect(link.textContent).toContain('Book · Wed 18 Nov');
    expect(screen.getByRole('heading', { name: 'About Ìrìn' })).toBeTruthy();
    expect(screen.getByText('Guides from the neighbourhood')).toBeTruthy();
    expect(screen.getByText('How do I pay?')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Chat on WhatsApp' }).getAttribute('href')).toBe(
      'https://wa.me/2348090000123',
    );
    expect(screen.getByRole('link', { name: '0809 000 0123' }).getAttribute('href')).toBe(
      'tel:+2348090000123',
    );
    expect(screen.getByRole('link', { name: 'hello@irin.example' }).getAttribute('href')).toBe(
      'mailto:hello@irin.example',
    );
    const insta = screen.getByRole('link', { name: 'Instagram' });
    expect(insta.getAttribute('rel')).toBe('noopener noreferrer');
    expect(asked).toEqual([]);
  });

  it('no tagline: the business name is the title, with "Tours in Lagos" under it', () => {
    show({ operator, site: site({ tagline: null, kind: null }), tours: [card('walk', 'Walk')] });
    expect(screen.getByRole('heading', { level: 1, name: 'Ìrìn Lagos Tours' })).toBeTruthy();
    expect(screen.getByText('Tours in Lagos')).toBeTruthy();
  });

  it('no about, no points, no questions: those sections hide', () => {
    show({
      operator,
      site: site({ about: null, whyUs: [], faqs: [] }),
      tours: [card('w', 'Walk')],
    });
    expect(screen.queryByRole('heading', { name: 'About Ìrìn' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Why book with us' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Questions' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'About' })).toBeNull(); // nor in the menu
  });

  it('no WhatsApp: phone and email only; no contact at all: the section hides', () => {
    show({
      operator,
      site: site({
        contact: { ...noContact, phone: '+2348090000123', email: 'hello@irin.example' },
      }),
      tours: [card('w', 'Walk')],
    });
    expect(screen.getByRole('heading', { name: 'Get in touch' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Chat on WhatsApp' })).toBeNull();
    cleanup();
    resetEmbedded();
    document.getElementById('okg-data')?.remove();

    show({ operator, site: site({ contact: noContact }), tours: [card('w', 'Walk')] });
    expect(screen.queryByRole('heading', { name: 'Get in touch' })).toBeNull();
  });

  it('no tours: "New tours coming soon", and nothing offers to book', () => {
    show({ operator, site: site(), tours: [] });
    expect(screen.getByText('New tours coming soon')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Message us on WhatsApp' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Book/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'See tours and dates' })).toBeNull();
  });

  it('older data with no site at all still makes a finished page', () => {
    show({ operator, tours: [card('w', 'Walk')] });
    expect(screen.getByRole('heading', { level: 1, name: 'Ìrìn Lagos Tours' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Our tours' })).toBeTruthy();
  });

  it('fetches without embedded data; "not found"; offline with Try again', async () => {
    fakeApi({ '/public/irin-lagos-tours': [200, { operator, site: site(), tours: [] }] });
    render(<Catalogue params={{ operator: 'irin-lagos-tours' }} />);
    expect(await screen.findByText('New tours coming soon')).toBeTruthy();
    cleanup();

    fakeApi({});
    render(<Catalogue params={{ operator: 'nobody' }} />);
    expect(await screen.findByText("We couldn't find that page")).toBeTruthy();
    cleanup();

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
