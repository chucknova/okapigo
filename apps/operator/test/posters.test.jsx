/**
 * Posters (designs P1–P2), stage 18b: the choices and words in lib/posters.js, then the screen
 * against a fake server: the tours, a template that can't be used (and why), Seats left's
 * departure, the preview and Download, a failed drawing, no tours yet, and who sees Posters.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '../src/App.jsx';
import { EngineContext } from '../src/lib/engine.jsx';
import { createSyncEngine } from '../src/lib/sync.js';
import { createMemoryStore } from '../src/lib/store.js';
import { request } from '../src/lib/api.js';
import { clearLive } from '../src/lib/live.js';
import {
  canMakePosters,
  choose,
  defaultWords,
  downloadLabel,
  fetchPoster,
  fileFor,
  firstChoice,
  posterPath,
  savedWords,
} from '../src/lib/posters.js';

afterEach(() => {
  cleanup();
  clearLive();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DATA = {
  tours: [
    {
      id: 't1',
      slug: 'badagry-heritage-day-trip',
      title: 'Badagry Heritage Day Trip',
      posterTitle: 'Badagry Heritage Day Trip',
      meta: 'From ₦65,000 · 10 h · Saturdays 07:00',
      departures: [],
    },
    {
      id: 't2',
      slug: 'lagos-island-heritage-walk',
      title: 'Lagos Island Heritage Walk',
      posterTitle: 'Lagos Island Heritage Walk',
      meta: 'From ₦25,000 · 3 h · Daily 09:00',
      departures: [
        { id: 'd1', when: 'Sat 28 Nov, 09:00', seatsLeft: 4 },
        { id: 'd2', when: 'Sun 29 Nov, 09:00', seatsLeft: 1 },
      ],
    },
  ],
  weekend: { days: ['2026-11-28', '2026-11-29'], count: 2 },
};

describe('posters.js: the choices', () => {
  it('who: marketing at least to look; before /api/me, the owner and managers', () => {
    expect(canMakePosters({ permissions: { marketing: 'view' } }, null)).toBe(true);
    expect(canMakePosters({ permissions: { marketing: 'none' } }, null)).toBe(false);
    expect(canMakePosters(null, { user: { role: { key: 'manager' } } })).toBe(true);
    expect(canMakePosters(null, { user: { role: { key: 'guide' } } })).toBe(false);
  });

  it('starts on the first tour, New tour, square, its words', () => {
    expect(firstChoice(DATA)).toEqual({
      tourId: 't1',
      template: 'new_tour',
      size: 'square',
      words: 'NEW TOUR',
      departureId: null,
    });
    expect(firstChoice({ tours: [] }).tourId).toBeNull();
  });

  it('a new template brings its words; a new tour its first departure', () => {
    let c = firstChoice(DATA);
    c = choose(c, { tourId: 't2' }, DATA);
    expect(c.departureId).toBe('d1');
    c = choose(c, { template: 'offer' }, DATA);
    expect(c.words).toBe(defaultWords('offer'));
    c = choose(c, { words: 'Festive season' }, DATA);
    expect(c.words).toBe('Festive season');
    // The same template again keeps the owner's words.
    expect(choose(c, { template: 'offer' }, DATA).words).toBe('Festive season');
  });

  it('a tour without departures can’t keep "Seats left": back to New tour', () => {
    let c = choose(firstChoice(DATA), { tourId: 't2' }, DATA);
    c = choose(c, { template: 'seats_left' }, DATA);
    expect(c.words).toBe('');
    c = choose(c, { tourId: 't1' }, DATA);
    expect(c).toMatchObject({ template: 'new_tour', words: 'NEW TOUR', departureId: null });
  });

  it('the picture’s address and file name', () => {
    const c = /** @type {const} */ ({
      tourId: 't2',
      template: 'seats_left',
      size: 'story',
      words: '  THIS SATURDAY ',
      departureId: 'd1',
    });
    expect(posterPath(c)).toBe(
      '/api/posters/png?template=seats_left&size=story&productId=t2&departureId=d1&words=THIS+SATURDAY',
    );
    // This weekend: no tour, no departure; empty words left out.
    expect(posterPath({ ...c, template: 'weekend', words: ' ' })).toBe(
      '/api/posters/png?template=weekend&size=story',
    );
    expect(posterPath({ ...c, template: 'offer' })).not.toContain('departureId');
    expect(fileFor(c, 'heritage', 'irin')).toBe('heritage-seats-left-story.png');
    expect(fileFor({ ...c, template: 'weekend' }, 'heritage', 'irin')).toBe(
      'irin-weekend-story.png',
    );
    expect(downloadLabel('square')).toBe('Download PNG · 1080 × 1080');
    expect(savedWords('a.png', 'story')).toBe(
      'a.png (1080 × 1920). Post it, or send it on WhatsApp.',
    );
  });

  it('fetching the picture: with the sign-in; offline, no answer, a refusal, a server error', async () => {
    const ok = vi.fn(async () => new Response(new Blob(['png']), { status: 200 }));
    const r = await fetchPoster('/p', { token: 'tok', fetchImpl: ok, online: () => true });
    expect(r.ok).toBe(true);
    expect(/** @type {any} */ (ok.mock.calls[0])[1].headers).toEqual({
      Authorization: 'Bearer tok',
    });
    const offline = 'Couldn’t make the PNG (no connection). Try again when you’re online.';
    expect(await fetchPoster('/p', { token: null, online: () => false })).toEqual({
      ok: false,
      problem: offline,
    });
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await fetchPoster('/p', { token: null, fetchImpl: down, online: () => true })).toEqual({
      ok: false,
      problem: offline,
    });
    const refused = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'That departure is full.' } }), {
          status: 409,
        }),
    );
    expect(
      await fetchPoster('/p', { token: null, fetchImpl: refused, online: () => true }),
    ).toEqual({ ok: false, problem: 'That departure is full.' });
    // A server error's own words are for us, not for staff.
    const broken = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'stack trace…' } }), { status: 500 }),
    );
    expect(await fetchPoster('/p', { token: null, fetchImpl: broken, online: () => true })).toEqual(
      { ok: false, problem: 'Couldn’t make the PNG. Try again.' },
    );
    const aborted = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    await expect(
      fetchPoster('/p', { token: null, fetchImpl: aborted, online: () => true }),
    ).rejects.toThrow('aborted');
  });
});

const ME = (/** @type {string} */ role, /** @type {string} */ marketing) => ({
  user: { name: 'Kunle Bello', role: { key: role, name: role } },
  operator: { name: 'Ìrìn Lagos Tours', slug: 'irin-lagos-tours', timeZone: 'Africa/Lagos' },
  permissions: { bookings: 'edit', operations: 'edit', marketing },
  owner: { name: 'Bisola Adeyemi' },
});

/**
 * @param {{ data?: any, png?: () => Response }} f
 */
function fakeServer({ data = DATA, png = () => new Response(new Blob(['png']), { status: 200 }) }) {
  const asked = /** @type {string[]} */ ([]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ path) => {
      asked.push(path);
      if (path.startsWith('/api/posters/png')) return png();
      if (path === '/api/posters') return Response.json(data);
      return Response.json({ error: { code: 'NOT_FOUND', message: path } }, { status: 404 });
    }),
  );
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:poster', revokeObjectURL: () => {} }),
  );
  return asked;
}

/** @param {string} path @param {any} me */
async function show(path, me = ME('manager', 'view')) {
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

describe('the Posters screen', () => {
  it('P1: the tours, the templates, the preview, Download; then "Saved"', async () => {
    const asked = fakeServer({});
    await show('/posters');
    expect(await screen.findByRole('heading', { name: 'Posters' })).toBeTruthy();
    expect(await screen.findByText('From ₦25,000 · 3 h · Daily 09:00')).toBeTruthy();
    // The first tour has no departures: Seats left can't be used, and says why.
    expect(screen.getByRole('radio', { name: /Seats left/ })).toHaveProperty('disabled', true);
    expect(screen.getByText('No departures in the next 14 days')).toBeTruthy();
    const img = await screen.findByRole('img', {
      name: 'Poster preview: Badagry Heritage Day Trip',
    });
    expect(img.getAttribute('src')).toBe('blob:poster');
    expect(asked).toContain(
      '/api/posters/png?template=new_tour&size=square&productId=t1&words=NEW+TOUR',
    );
    const download = screen.getByRole('link', { name: 'Download PNG · 1080 × 1080' });
    expect(download.getAttribute('download')).toBe('badagry-heritage-day-trip-new-tour.png');
    fireEvent.click(download);
    expect(screen.getByRole('status').textContent).toBe(
      'Saved: badagry-heritage-day-trip-new-tour.png (1080 × 1080). Post it, or send it on WhatsApp.',
    );
  });

  it('Seats left: the departure to choose, with its seats; Story changes the size', async () => {
    const asked = fakeServer({});
    await show('/posters');
    fireEvent.click(await screen.findByRole('radio', { name: /Lagos Island Heritage Walk/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Seats left/ }));
    const pick = /** @type {HTMLSelectElement} */ (screen.getByLabelText('Departure'));
    expect([...pick.options].map((o) => o.textContent)).toEqual([
      'Sat 28 Nov, 09:00 · 4 seats left',
      'Sun 29 Nov, 09:00 · 1 seat left',
    ]);
    fireEvent.change(pick, { target: { value: 'd2' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Story' }));
    await waitFor(() =>
      expect(asked).toContain(
        '/api/posters/png?template=seats_left&size=story&productId=t2&departureId=d2',
      ),
    );
    expect(await screen.findByRole('link', { name: 'Download PNG · 1080 × 1920' })).toBeTruthy();
  });

  it('a drawing that fails: the reason, and no Download', async () => {
    fakeServer({
      png: () => Response.json({ error: { message: 'That departure is full.' } }, { status: 409 }),
    });
    await show('/posters');
    expect((await screen.findByRole('alert')).textContent).toBe('That departure is full.');
    expect(screen.queryByRole('link', { name: /Download PNG/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Download PNG/ })).toHaveProperty('disabled', true);
  });

  it('no tours yet: "Nothing to make a poster of yet", Add a tour', async () => {
    fakeServer({ data: { tours: [], weekend: { days: [], count: 0 } } });
    await show('/posters');
    expect(await screen.findByText('Nothing to make a poster of yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add a tour' }).getAttribute('href')).toBe(
      '/settings/tours/new',
    );
  });

  it('More lists Posters for the office; not without marketing', async () => {
    fakeServer({});
    await show('/more');
    // In the More list, and in the side menu on a wide screen.
    expect((await screen.findAllByRole('link', { name: /Posters/ })).length).toBeGreaterThan(0);
    cleanup();
    clearLive();
    await show('/more', ME('manager', 'none'));
    expect(await screen.findByRole('heading', { name: 'More' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Posters/ })).toBeNull();
  });
});
