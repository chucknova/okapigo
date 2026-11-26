/**
 * Stage 19b-2b: photos and the logo on the guest pages (designs: U4 the website, U5 a tour
 * page), and the words around them (lib/photos.js).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { Catalogue } from '../src/screens/Catalogue.jsx';
import { TourPage } from '../src/screens/TourPage.jsx';
import { resetEmbedded } from '../src/lib/data.js';
import { creditLine, siteCredits, counterLine, srcSet, shownIndex } from '../src/lib/photos.js';

const M = 'http://localhost:4000/media/photos/';
const photo = (/** @type {string} */ n, /** @type {string} */ alt, credit = null) => ({
  url: `${M}${n}.jpg`,
  small: `${M}${n}-640.jpg`,
  alt,
  credit,
});
const LOGO = {
  url: 'http://localhost:4000/media/logos/l.png',
  small: 'http://localhost:4000/media/logos/l-128.png',
};

describe('lib/photos.js', () => {
  it('a credit line, or none', () => {
    expect(creditLine(photo('a', 'x', 'Sho photography, CC BY-SA 4.0'))).toBe(
      'Photo: Sho photography, CC BY-SA 4.0',
    );
    expect(creditLine(photo('a', 'x'))).toBeNull();
    expect(creditLine(null)).toBeNull();
  });

  it("the website's credits: the hero and each card's photo, each once, in order", () => {
    const hero = photo('h', 'x', 'Joeyjayjuniors, CC BY-SA 4.0');
    const tours = [
      { photo: photo('a', 'x', 'Sho photography, CC BY-SA 4.0') },
      { photo: null },
      { photo: photo('b', 'x', ' Joeyjayjuniors, CC BY-SA 4.0 ') },
      { photo: photo('c', 'x') },
      {},
    ];
    expect(siteCredits(hero, tours)).toBe(
      'Photo credits: Joeyjayjuniors, CC BY-SA 4.0; Sho photography, CC BY-SA 4.0',
    );
    expect(siteCredits(null, [{ photo: photo('c', 'x') }])).toBeNull();
  });

  it('counting, the sizes the browser picks from, and which photo is showing', () => {
    expect(counterLine(0, 3)).toBe('1 of 3');
    expect(srcSet(photo('a', 'x'))).toBe(`${M}a-640.jpg 640w, ${M}a.jpg 1600w`);
    expect(srcSet({ url: `${M}a.jpg`, alt: 'x' })).toBeUndefined();
    expect(srcSet({ url: `${M}a.jpg`, small: `${M}a.jpg`, alt: 'x' })).toBeUndefined();
    expect(shownIndex(0, 390, 3)).toBe(0);
    expect(shownIndex(400, 390, 3)).toBe(1);
    expect(shownIndex(5000, 390, 3)).toBe(2);
    expect(shownIndex(-20, 390, 3)).toBe(0);
    expect(shownIndex(300, 0, 3)).toBe(0);
  });
});

function embed(/** @type {any} */ data) {
  const el = document.createElement('script');
  el.id = 'okg-data';
  el.type = 'application/json';
  el.textContent = JSON.stringify(data);
  document.body.appendChild(el);
}
beforeEach(() => {
  resetEmbedded();
  document.getElementById('okg-data')?.remove();
  vi.stubGlobal(
    'fetch',
    async () => new Response(JSON.stringify({ departures: [] }), { status: 200 }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const operator = {
  slug: 'irin-lagos-tours',
  name: 'Ìrìn Lagos Tours',
  city: 'Lagos',
  currency: 'NGN',
  timeZone: 'Africa/Lagos',
  websiteStyle: 'lagoon',
  pricesInclude: 'VAT',
  logo: null,
};
const SITE = {
  kind: 'City and food tours',
  tagline: 'Walk Lagos with people who love it',
  intro: null,
  about: null,
  whyUs: [],
  faqs: [],
  contact: { phone: null, whatsapp: null, email: null, address: null, socials: [] },
  hours: null,
  hero: null,
};
const card = (/** @type {string} */ slug, /** @type {string} */ title, p = null) => ({
  slug,
  title,
  summary: `${title}.`,
  durationMinutes: 180,
  activityLabel: null,
  scheduleSummary: 'Daily 09:00',
  fromPriceKobo: 2_500_000,
  cancellationHeadline: null,
  nextDeparture: null,
  photo: p,
});

describe('the website (U4)', () => {
  /** @param {any} over */
  const show = (over = {}) => {
    embed({
      kind: 'catalogue',
      operatorSlug: 'irin-lagos-tours',
      view: {
        operator: { ...operator, ...over.operator },
        site: { ...SITE, ...over.site },
        tours: over.tours ?? [card('walk', 'Heritage Walk')],
      },
    });
    render(<Catalogue params={{ operator: 'irin-lagos-tours' }} />);
  };

  it('the logo, the hero photo with its credit, photos on the cards, the credits at the foot', () => {
    show({
      operator: { logo: LOGO },
      site: { hero: photo('h', 'Tinubu Square from above', 'Joeyjayjuniors, CC BY-SA 4.0') },
      tours: [
        card(
          'walk',
          'Heritage Walk',
          photo('a', 'The cathedral’s tower', 'Sho photography, CC BY-SA 4.0'),
        ),
        card('food', 'Street Food Crawl'),
      ],
    });
    const mark = document.querySelector('.okg-site__bar .okg-mark--logo');
    expect(mark?.getAttribute('src')).toBe(LOGO.small);
    const hero = screen.getByRole('img', { name: 'Tinubu Square from above' });
    expect(hero.getAttribute('src')).toBe(`${M}h.jpg`);
    expect(hero.getAttribute('srcset')).toBe(`${M}h-640.jpg 640w, ${M}h.jpg 1600w`);
    expect(screen.getByText('Photo: Joeyjayjuniors, CC BY-SA 4.0')).toBeTruthy();
    expect(document.querySelector('.okg-site-hero--photo')).toBeTruthy();
    const walk = screen.getByRole('link', { name: /Heritage Walk/ });
    const cover = within(walk).getByRole('img', { name: 'The cathedral’s tower' });
    expect(cover.getAttribute('src')).toBe(`${M}a-640.jpg`); // the small copy on cards
    expect(cover.getAttribute('loading')).toBe('lazy');
    // A card with no photo has none (and the card isn't marked as having one).
    const food = screen.getByRole('link', { name: /Street Food Crawl/ });
    expect(within(food).queryByRole('img')).toBeNull();
    expect(food.className).not.toContain('okg-site-card--photo');
    // Cards carry no credit of their own: the footer names everyone, once.
    expect(within(walk).queryByText(/^Photo:/)).toBeNull();
    expect(
      screen.getByText(
        'Photo credits: Joeyjayjuniors, CC BY-SA 4.0; Sho photography, CC BY-SA 4.0',
      ),
    ).toBeTruthy();
  });

  it('none of them: the first letter, the pattern hero, no credits line', () => {
    show();
    expect(document.querySelector('.okg-site__bar .okg-mark')?.textContent).toBe('Ì');
    expect(document.querySelector('.okg-site-hero--photo')).toBeNull();
    expect(document.querySelector('.okg-site-hero__ring')).toBeTruthy();
    expect(screen.queryByText(/^Photo credits/)).toBeNull();
  });
});

const TOUR = {
  slug: 'lagos-island-heritage-walk',
  title: 'Lagos Island Heritage Walk',
  summary: 'Three hours through old Lagos.',
  description: 'Walk the streets where modern Lagos began.',
  durationMinutes: 180,
  activityLabel: 'Walking',
  scheduleSummary: 'Daily 09:00',
  maxGuests: 15,
  meetingPoint: { name: 'Tinubu Square', address: 'Broad Street' },
  pickupPoints: [],
  stops: [],
  photos: [],
  inclusions: [],
  exclusions: [],
  whatToBring: [],
  faqs: [],
  fromPriceKobo: 2_500_000,
  depositBasisPoints: null,
  priceCategories: [
    { key: 'adult', name: 'Adult', minAge: 13, maxAge: null, amountKobo: 2_500_000 },
  ],
  addOns: [],
  cancellationPolicy: null,
};

describe('a tour page (U5)', () => {
  /** @param {any[]} photos @param {any} [op] */
  const show = (photos, op = operator) => {
    embed({
      kind: 'tour',
      operatorSlug: 'irin-lagos-tours',
      tourSlug: TOUR.slug,
      view: { operator: op, tour: { ...TOUR, photos } },
    });
    render(<TourPage params={{ operator: 'irin-lagos-tours', tour: TOUR.slug }} />);
  };
  const PHOTOS = [
    photo('a', 'The cathedral’s tower', 'Sho photography, CC BY-SA 4.0'),
    photo('b', 'Tinubu Square from above', 'Joeyjayjuniors, CC BY-SA 4.0'),
    photo('c', 'The Marina’s towers'),
  ];

  it('several photos: they swipe; "1 of 3", Next and Previous; the shown photo’s credit', () => {
    show(PHOTOS, { ...operator, logo: LOGO });
    const fig = screen.getByRole('figure', { name: 'Photos, 1 of 3' });
    const imgs = within(fig).getAllByRole('img');
    expect(imgs.map((i) => i.getAttribute('alt'))).toEqual(PHOTOS.map((p) => p.alt));
    expect(imgs.map((i) => i.getAttribute('loading'))).toEqual(['eager', 'lazy', 'lazy']);
    expect(imgs[0].getAttribute('srcset')).toBe(`${M}a-640.jpg 640w, ${M}a.jpg 1600w`);
    expect(within(fig).getByText('1 of 3')).toBeTruthy();
    expect(within(fig).getByText('Photo: Sho photography, CC BY-SA 4.0')).toBeTruthy();
    expect(within(fig).queryByRole('button', { name: 'Previous photo' })).toBeNull();

    const strip = /** @type {HTMLElement} */ (fig.querySelector('.okg-photos__strip'));
    strip.scrollTo = vi.fn();
    fireEvent.click(within(fig).getByRole('button', { name: 'Next photo' }));
    expect(within(fig).getByText('2 of 3')).toBeTruthy();
    expect(within(fig).getByText('Photo: Joeyjayjuniors, CC BY-SA 4.0')).toBeTruthy();
    expect(within(fig).getByRole('button', { name: 'Previous photo' })).toBeTruthy();
    fireEvent.click(within(fig).getByRole('button', { name: 'Next photo' }));
    // The last: no Next; this one has no credit.
    expect(within(fig).getByText('3 of 3')).toBeTruthy();
    expect(within(fig).queryByRole('button', { name: 'Next photo' })).toBeNull();
    expect(within(fig).queryByText(/^Photo:/)).toBeNull();
    fireEvent.click(within(fig).getByRole('button', { name: 'Previous photo' }));
    expect(within(fig).getByText('2 of 3')).toBeTruthy();

    // Swiping (scrolling the strip) moves the count too.
    Object.defineProperty(strip, 'clientWidth', { value: 390, configurable: true });
    strip.scrollLeft = 0;
    fireEvent.scroll(strip);
    expect(within(fig).getByText('1 of 3')).toBeTruthy();

    expect(document.querySelector('.okg-tour__header .okg-mark--logo')?.getAttribute('src')).toBe(
      LOGO.small,
    );
  });

  it('one photo: no count, no buttons; none: the pattern band', () => {
    show(PHOTOS.slice(0, 1));
    const fig = screen.getByRole('figure', { name: 'Photo' });
    expect(within(fig).queryByRole('button')).toBeNull();
    expect(within(fig).queryByText(/of 1/)).toBeNull();
    cleanup();
    resetEmbedded();
    document.getElementById('okg-data')?.remove();
    show([]);
    expect(screen.queryByRole('figure')).toBeNull();
    expect(document.querySelector('.okg-tour__band--pattern')).toBeTruthy();
    expect(document.querySelector('.okg-tour__header .okg-mark')?.textContent).toBe('Ì');
  });
});
