/**
 * Stage 19b-2a: photos and the logo in the staff app, against a fake server and a fake
 * upload connection (designs: U1 Business details, U2/U3 a tour's Photos, U7/U8 New tour).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor, act } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '../src/App.jsx';
import { EngineContext } from '../src/lib/engine.jsx';
import { createSyncEngine } from '../src/lib/sync.js';
import { createMemoryStore } from '../src/lib/store.js';
import { request } from '../src/lib/api.js';
import { clearLive } from '../src/lib/live.js';

afterEach(() => {
  cleanup();
  clearLive();
  vi.unstubAllGlobals();
  uploads.length = 0;
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

const pic = (/** @type {string} */ n) => ({
  url: `http://localhost:4000/media/photos/${n}.jpg`,
  small: `http://localhost:4000/media/photos/${n}-640.jpg`,
});
const PHOTOS = [
  { ...pic('a'), alt: 'The Point of No Return', credit: 'Ei’eke, CC BY 4.0' },
  { ...pic('b'), alt: 'The monument at sunset', credit: null },
  { ...pic('c'), alt: 'The First Storey Building', credit: 'Omoeko Media, CC BY-SA 4.0' },
];
const TOUR = {
  id: 'p-badagry',
  slug: 'badagry-heritage-day-trip',
  title: 'Badagry Heritage Day Trip',
  shortTitle: null,
  summary: 'The slave route and the Point of No Return.',
  description: 'A full day in Badagry.',
  status: 'published',
  durationMinutes: 600,
  transport: 'van',
  activityLabel: null,
  arriveMinutesEarly: null,
  defaultCapacity: 14,
  meetingPoint: { name: 'Ìrìn office', address: 'Yaba', lat: 6.5095, lng: 3.3711 },
  stops: [],
  inclusions: [],
  exclusions: [],
  whatToBring: [],
  faqs: [],
  photos: PHOTOS,
  priceCategories: [
    {
      id: 'c1',
      key: 'adult',
      name: 'Adult',
      minAge: 13,
      maxAge: null,
      amountKobo: 6_500_000,
      isActive: true,
    },
  ],
  pricesNote: '',
  upcomingBookings: 0,
  addOns: [],
  runs: 'Saturdays 07:00 · 14 seats',
};

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

/** Every upload the screens start; the test plays the server for each. */
const uploads = /** @type {FakeXhr[]} */ ([]);
class FakeXhr {
  constructor() {
    /** @type {any} */
    this.upload = {};
    /** @type {Record<string, string>} */
    this.headers = {};
    this.status = 0;
    this.responseText = '';
    uploads.push(this);
  }
  /** @param {string} m @param {string} url */
  open(m, url) {
    this.url = url;
  }
  /** @param {string} k @param {string} v */
  setRequestHeader(k, v) {
    this.headers[k] = v;
  }
  /** @param {any} body */
  send(body) {
    this.body = body;
  }
  abort() {
    act(() => /** @type {any} */ (this).onabort?.());
  }
  /** @param {number} percent */
  progress(percent) {
    act(() => this.upload.onprogress?.({ lengthComputable: true, loaded: percent, total: 100 }));
  }
  /** @param {number} status @param {any} json */
  async respond(status, json) {
    this.status = status;
    this.responseText = JSON.stringify(json);
    await act(async () => /** @type {any} */ (this).onload?.());
  }
}

/** @param {any} me @param {string} path */
async function show(me, path) {
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
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

/** The hidden file input inside an element. @param {HTMLElement} el */
const fileInput = (el) => /** @type {HTMLInputElement} */ (el.querySelector('input[type=file]'));
/** @param {HTMLElement} el @param {File[]} files */
const pick = (el, files) => fireEvent.change(fileInput(el), { target: { files } });
const jpeg = (/** @type {string} */ name) => new File(['bytes'], name, { type: 'image/jpeg' });
const saveButton = () =>
  /** @type {HTMLButtonElement} */ (screen.getByRole('button', { name: 'Save changes' }));

describe("a tour's Photos (U2, U3)", () => {
  it('shows them, the cover first, with the count', async () => {
    fakeFetch({ 'GET /api/products/p-badagry': () => [200, { product: TOUR }] });
    await show(OWNER, '/settings/tours/p-badagry');
    const photos = await screen.findByRole('region', { name: 'Photos' });
    expect(within(photos).getByText('3 of 8 ✓')).toBeTruthy();
    const list = within(photos).getByRole('list', { name: 'Photos' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    const first = within(list).getAllByRole('listitem')[0];
    expect(within(first).getByText('Cover')).toBeTruthy();
    expect(within(first).getByRole('img').getAttribute('src')).toBe(pic('a').small);
    expect(within(first).queryByRole('button', { name: /^Move photo 1 up/ })).toBeNull();
    expect(within(first).queryByRole('button', { name: /Make photo 1 the cover/ })).toBeNull();
    const fields = within(first).getAllByRole('textbox');
    expect(fields.map((f) => /** @type {HTMLInputElement} */ (f).value)).toEqual([
      'The Point of No Return',
      'Ei’eke, CC BY 4.0',
    ]);
  });

  it('a new cover and a new order are saved, in that order', async () => {
    const sent = fakeFetch({
      'GET /api/products/p-badagry': () => [200, { product: TOUR }],
      'PATCH /api/products/p-badagry': (b) => [200, { product: { ...TOUR, ...b } }],
    });
    await show(OWNER, '/settings/tours/p-badagry');
    const photos = await screen.findByRole('region', { name: 'Photos' });
    fireEvent.click(within(photos).getByRole('button', { name: 'Make photo 3 the cover' }));
    // Now [c, a, b]: move a (photo 2) down → [c, b, a].
    fireEvent.click(within(photos).getByRole('button', { name: 'Move photo 2 down' }));
    expect(screen.getByText('Unsaved changes: Photos')).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(sent.some((x) => x.method === 'PATCH')).toBe(true));
    expect(sent.find((x) => x.method === 'PATCH')?.body.photos.map((p) => p.alt)).toEqual([
      'The First Storey Building',
      'The monument at sunset',
      'The Point of No Return',
    ]);
  });

  it('removing one from a tour on sale with 3 asks first; it stays on sale', async () => {
    const sent = fakeFetch({
      'GET /api/products/p-badagry': () => [200, { product: TOUR }],
      'PATCH /api/products/p-badagry': (b) => [200, { product: { ...TOUR, ...b } }],
    });
    await show(OWNER, '/settings/tours/p-badagry');
    const photos = await screen.findByRole('region', { name: 'Photos' });
    fireEvent.click(within(photos).getByRole('button', { name: 'Remove photo 2' }));
    const ask = within(photos).getByRole('group', { name: 'Remove this photo?' });
    expect(ask.textContent).toContain(
      'Badagry Heritage Day Trip will have 2 photos, under the 3 a tour on sale should have. It stays on sale.',
    );
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' }));
    expect(within(photos).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(within(photos).getByRole('button', { name: 'Remove photo 2' }));
    fireEvent.click(within(photos).getByRole('button', { name: 'Remove it' }));
    expect(within(photos).getAllByRole('listitem')).toHaveLength(2);
    expect(within(photos).getByText('2 of 3 needed')).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(sent.some((x) => x.method === 'PATCH')).toBe(true));
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({
      photos: [PHOTOS[0], PHOTOS[2]],
    });
  });

  it('an upload: picked, on its way (no saving yet), arrived, described, saved', async () => {
    const sent = fakeFetch({
      'GET /api/products/p-badagry': () => [200, { product: TOUR }],
      'PATCH /api/products/p-badagry': (b) => [200, { product: { ...TOUR, ...b } }],
    });
    await show(OWNER, '/settings/tours/p-badagry');
    const photos = await screen.findByRole('region', { name: 'Photos' });
    pick(photos, [jpeg('beach.jpg')]);
    expect(uploads[0].url).toBe('/api/uploads/photo');
    expect(uploads[0].headers.Authorization).toBe('Bearer tok');
    expect(within(photos).getByText('Uploading beach.jpg… 0%')).toBeTruthy();
    uploads[0].progress(40);
    expect(within(photos).getByText('Uploading beach.jpg… 40%')).toBeTruthy();
    expect(within(photos).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
    expect(within(photos).getByText('3 of 8 ✓ · 1 uploading')).toBeTruthy();
    expect(within(photos).getByText('Save when the upload ends.')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);

    await uploads[0].respond(201, { picture: { ...pic('d'), width: 1600, height: 1067 } });
    // Arrived: now it needs a description before saving.
    expect(
      within(photos).getByText('Describe the photo: guests using screen readers need it.'),
    ).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    const items = within(photos).getAllByRole('listitem');
    const [alt] = within(items[3]).getAllByRole('textbox');
    fireEvent.change(alt, { target: { value: 'The beach at Badagry' } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(sent.some((x) => x.method === 'PATCH')).toBe(true));
    expect(sent.find((x) => x.method === 'PATCH')?.body.photos[3]).toEqual({
      ...pic('d'),
      alt: 'The beach at Badagry',
      credit: null,
    });
  });

  it("an upload refused: the server's words, Try again sends it again; Cancel takes it away", async () => {
    fakeFetch({ 'GET /api/products/p-badagry': () => [200, { product: TOUR }] });
    await show(OWNER, '/settings/tours/p-badagry');
    const photos = await screen.findByRole('region', { name: 'Photos' });
    pick(photos, [jpeg('menu.pdf')]);
    await uploads[0].respond(400, {
      error: { code: 'WRONG_TYPE', message: 'That’s a PDF. Use a JPEG, PNG or WebP picture.' },
    });
    expect(
      within(photos).getByText('menu.pdf: That’s a PDF. Use a JPEG, PNG or WebP picture.'),
    ).toBeTruthy();
    fireEvent.click(within(photos).getByRole('button', { name: 'Try again' }));
    expect(uploads).toHaveLength(2);
    fireEvent.click(within(photos).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(within(photos).getAllByRole('listitem')).toHaveLength(3));
    // Too big: never sent.
    const big = new File(['x'], 'huge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 14 * 1024 * 1024 });
    pick(photos, [big]);
    expect(uploads).toHaveLength(2);
    expect(
      within(photos).getByText('huge.jpg: That photo is 14 MB. Use one under 10 MB.'),
    ).toBeTruthy();
  });

  it('a draft lists what it needs to go on sale, each with its section', async () => {
    const draft = { ...TOUR, status: 'draft', photos: PHOTOS.slice(0, 1), priceCategories: [] };
    fakeFetch({ 'GET /api/products/p-badagry': () => [200, { product: draft }] });
    await show(OWNER, '/settings/tours/p-badagry');
    const put = /** @type {HTMLButtonElement} */ (
      await screen.findByRole('button', { name: 'Put on sale' })
    );
    expect(put.disabled).toBe(true);
    const sale = screen.getByLabelText('On sale');
    expect(sale.textContent).toContain('Add its prices');
    expect(sale.textContent).toContain('Add 2 more photos (it has 1 of 3)');
    expect(within(sale).getByRole('link', { name: 'Photos' }).getAttribute('href')).toBe(
      '#tour-photos',
    );
    expect(document.getElementById('tour-photos')).toBeTruthy();
    expect(document.getElementById('tour-prices')).toBeTruthy();
  });
});

describe('the tours list', () => {
  it('says what each still needs', async () => {
    fakeFetch({
      'GET /api/products': () => [
        200,
        {
          products: [
            { ...TOUR, photos: PHOTOS.slice(0, 2) },
            {
              ...TOUR,
              id: 'p-epe',
              title: 'Epe Fish Market',
              status: 'draft',
              photos: [],
              priceCategories: [],
            },
          ],
        },
      ],
    });
    await show(OWNER, '/settings/tours');
    expect(await screen.findByText('needs 1 more photo')).toBeTruthy();
    expect(screen.getByText('needs prices and 3 photos')).toBeTruthy();
  });
});

describe('New tour, with its photos (U7, U8)', () => {
  const routes = (/** @type {any} */ extra = {}) => ({
    'POST /api/products': (/** @type {any} */ b) => [
      201,
      { product: { ...TOUR, ...b, id: 'p-new', status: 'draft' } },
    ],
    'GET /api/products/p-new': () => [200, { product: { ...TOUR, id: 'p-new', status: 'draft' } }],
    'GET /api/products': () => [200, { products: [] }],
    ...extra,
  });
  const fill = () => {
    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: 'Lagos Lagoon by Speedboat' },
    });
    fireEvent.change(screen.getByLabelText(/^Summary/), {
      target: { value: 'The city from the water' },
    });
    fireEvent.change(screen.getByLabelText(/^Meeting point/), {
      target: { value: 'Five Cowries jetty' },
    });
    fireEvent.change(screen.getByLabelText(/^Address/), { target: { value: 'Ikoyi' } });
  };

  it('photos come right after the summary; made with them, cover first, no credits asked', async () => {
    const sent = fakeFetch(routes());
    await show(OWNER, '/settings/tours/new');
    const group = await screen.findByRole('group', { name: 'Photos' });
    expect(within(group).getByText('0 of 3 needed')).toBeTruthy();
    expect(screen.getByText(/No photos yet\? Make the draft anyway/)).toBeTruthy();
    fill();
    pick(group, [jpeg('boat.jpg'), jpeg('shore.jpg')]);
    expect(uploads).toHaveLength(2);
    await uploads[0].respond(201, { picture: pic('boat') });
    await uploads[1].respond(201, { picture: pic('shore') });
    expect(within(group).queryByLabelText(/^Credit/)).toBeNull();
    // Not red before anyone tries (designs: U8)…
    expect(within(group).queryAllByText(/^Describe the photo: guests/)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Make the draft' }));
    expect(await screen.findByText('Describe each photo, or remove it.')).toBeTruthy();
    // …then each one says so.
    expect(within(group).getAllByText(/^Describe the photo: guests/)).toHaveLength(2);
    const [boat, shore] = within(group).getAllByRole('textbox');
    fireEvent.change(boat, { target: { value: 'A speedboat under the bridge' } });
    fireEvent.change(shore, { target: { value: 'Waves on the rocks' } });
    fireEvent.click(within(group).getByRole('button', { name: 'Make photo 2 the cover' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make the draft' }));
    await waitFor(() => expect(sent.some((x) => x.method === 'POST')).toBe(true));
    expect(sent.find((x) => x.method === 'POST')?.body.photos).toEqual([
      { ...pic('shore'), alt: 'Waves on the rocks', credit: null },
      { ...pic('boat'), alt: 'A speedboat under the bridge', credit: null },
    ]);
  });

  it('while a photo uploads it waits; with no photos the draft is made without them', async () => {
    const sent = fakeFetch(routes());
    await show(OWNER, '/settings/tours/new');
    const group = await screen.findByRole('group', { name: 'Photos' });
    fill();
    pick(group, [jpeg('boat.jpg')]);
    fireEvent.click(screen.getByRole('button', { name: 'Make the draft' }));
    expect(await screen.findByText('Wait for the photos to finish uploading.')).toBeTruthy();
    expect(sent.some((x) => x.method === 'POST')).toBe(false);
    fireEvent.click(within(group).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(within(group).queryAllByRole('listitem')).toHaveLength(0));
    fireEvent.click(screen.getByRole('button', { name: 'Make the draft' }));
    await waitFor(() => expect(sent.some((x) => x.method === 'POST')).toBe(true));
    expect(sent.find((x) => x.method === 'POST')?.body).not.toHaveProperty('photos');
  });
});

const WEBSITE = {
  slug: 'irin-lagos-tours',
  siteUrl: 'https://okapigo.app/irin-lagos-tours',
  embedScriptUrl: 'https://okapigo.app/embed.js',
  style: 'lagoon',
  mode: 'light',
  phone: '+2348030000001',
  whatsapp: '+2348090000123',
  site: { tagline: 'Walk Lagos with people who love it' },
  embedDomains: [],
  styles: ['lagoon', 'classic', 'earth'],
  modes: ['auto', 'light', 'dark'],
};
const LOGO = {
  url: 'http://localhost:4000/media/logos/l.png',
  small: 'http://localhost:4000/media/logos/l-128.png',
};

describe('Business details: the logo and the hero photo (U1)', () => {
  it('none yet: the first letter and the pattern; adding both, then saving', async () => {
    const sent = fakeFetch({
      'GET /api/website': () => [200, { website: WEBSITE }],
      'PATCH /api/website': (b) => [
        200,
        { website: { ...WEBSITE, site: { ...WEBSITE.site, ...b.site } } },
      ],
    });
    await show(OWNER, '/settings/website');
    const logo = await screen.findByRole('group', { name: 'Logo' });
    expect(within(logo).getByText('Ì')).toBeTruthy();
    expect(within(logo).getByText('Using your first letter.')).toBeTruthy();
    const hero = screen.getByRole('group', { name: 'Hero photo' });
    expect(within(hero).getByText('Using your style’s pattern until then')).toBeTruthy();

    // A change elsewhere, then the logo on its way: no saving until it arrives.
    fireEvent.change(screen.getByLabelText(/^Tagline/), { target: { value: 'Walk Lagos' } });
    pick(logo, [new File(['png'], 'irin.png', { type: 'image/png' })]);
    expect(uploads[0].url).toBe('/api/uploads/logo');
    expect(within(logo).getByText('Uploading irin.png… 0%')).toBeTruthy();
    expect(screen.getByText('Save when the upload ends.')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    await uploads[0].respond(201, { picture: LOGO });
    expect(within(logo).getByRole('img', { name: 'Your logo' }).getAttribute('src')).toBe(
      LOGO.small,
    );
    expect(within(logo).getByRole('button', { name: 'Replace logo' })).toBeTruthy();

    pick(hero, [jpeg('tinubu.jpg')]);
    expect(uploads[1].url).toBe('/api/uploads/photo');
    await uploads[1].respond(201, { picture: pic('tinubu') });
    expect(screen.getByText('Unsaved changes: Tagline, Logo, Hero photo')).toBeTruthy();
    expect(
      within(hero).getByText('Describe the photo first: guests using screen readers need it.'),
    ).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(within(hero).getByLabelText(/^Describe the photo/), {
      target: { value: 'Tinubu Square from above' },
    });
    fireEvent.change(within(hero).getByLabelText(/^Credit/), {
      target: { value: 'Joeyjayjuniors, CC BY-SA 4.0' },
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(sent.some((x) => x.method === 'PATCH')).toBe(true));
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({
      site: {
        tagline: 'Walk Lagos',
        logo: LOGO,
        hero: {
          ...pic('tinubu'),
          alt: 'Tinubu Square from above',
          credit: 'Joeyjayjuniors, CC BY-SA 4.0',
        },
      },
    });
  });

  it('removing the logo saves null; a problem shows the words; Discard puts it back', async () => {
    const saved = { ...WEBSITE, site: { ...WEBSITE.site, logo: LOGO } };
    const sent = fakeFetch({
      'GET /api/website': () => [200, { website: saved }],
      'PATCH /api/website': (b) => [
        200,
        { website: { ...saved, site: { ...saved.site, ...b.site } } },
      ],
    });
    await show(OWNER, '/settings/website');
    const logo = await screen.findByRole('group', { name: 'Logo' });
    pick(logo, [jpeg('huge.jpg')]);
    await uploads[0].respond(413, {
      error: { code: 'TOO_BIG', message: 'That logo is 14 MB. Use one under 10 MB.' },
    });
    expect(within(logo).getByRole('alert').textContent).toBe(
      'That logo is 14 MB. Use one under 10 MB.',
    );
    fireEvent.click(within(logo).getByRole('button', { name: 'Remove' }));
    expect(within(logo).getByText('Ì')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(within(logo).getByRole('img', { name: 'Your logo' })).toBeTruthy();
    fireEvent.click(within(logo).getByRole('button', { name: 'Remove' }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(sent.some((x) => x.method === 'PATCH')).toBe(true));
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({ site: { logo: null } });
  });
});
