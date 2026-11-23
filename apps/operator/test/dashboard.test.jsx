/**
 * Dashboard (design D1), stage 18c: who sees it, and the screen against a fake server: the
 * four tiles, the trend with its change, the channels and tours, empty 30 days, and More.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '../src/App.jsx';
import { EngineContext } from '../src/lib/engine.jsx';
import { createSyncEngine } from '../src/lib/sync.js';
import { createMemoryStore } from '../src/lib/store.js';
import { request } from '../src/lib/api.js';
import { clearLive } from '../src/lib/live.js';
import { canSeeDashboard, updatedWords } from '../src/lib/dashboard.js';

afterEach(() => {
  cleanup();
  clearLive();
  vi.unstubAllGlobals();
});

const bars = (/** @type {number} */ n) => Array.from({ length: 30 }, (_, i) => `${(i * n) % 100}%`);
const DASH = {
  updatedAt: '16:52',
  today: [
    { key: 'departures', label: 'Departures today', value: '3', note: '1 under way · 2 to come' },
    {
      key: 'bookings',
      label: 'Bookings today',
      value: '7',
      note: '4 website · 2 WhatsApp · 1 Sojourna',
    },
    {
      key: 'money',
      label: 'Money in today',
      value: '₦412,500',
      note: '₦437,500 paid · ₦25,000 refunded',
    },
    { key: 'checkins', label: 'Checked in today', value: '38 of 41', note: '3 not yet' },
  ],
  range: { from: '24 Oct', middle: '8 Nov', to: 'Today', words: '24 Oct – 22 Nov' },
  money: { total: '₦6,842,500', change: { text: '+12%', tone: 'up' }, bars: bars(7) },
  bookings: { total: '142', change: null, bars: bars(3) },
  channels: [
    { name: 'Website and widget', bookings: '78', money: '₦3,912,500' },
    { name: 'Sojourna', bookings: '15', money: '₦612,000' },
  ],
  tours: [
    { title: 'Lagos Island Heritage Walk', fill: '86%' },
    { title: 'Tarkwa Bay Beach and Lagoon Trip', fill: '78%' },
  ],
};

const ME = (/** @type {string} */ reports) => ({
  user: { name: 'Kunle Bello', role: { key: 'manager', name: 'Manager' } },
  operator: { name: 'Ìrìn Lagos Tours', slug: 'irin-lagos-tours', timeZone: 'Africa/Lagos' },
  permissions: { bookings: 'edit', reports, marketing: 'view' },
  owner: { name: 'Bisola Adeyemi' },
});

/** @param {any} dashboard */
function fakeServer(dashboard = DASH) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ path) =>
      path === '/api/dashboard'
        ? Response.json({ dashboard })
        : Response.json({ error: { code: 'NOT_FOUND', message: path } }, { status: 404 }),
    ),
  );
}

/** @param {string} path @param {any} me */
async function show(path, me = ME('edit')) {
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

describe('dashboard.js', () => {
  it('who: reports at least to look; before /api/me, the owner and managers', () => {
    expect(canSeeDashboard({ permissions: { reports: 'view' } }, null)).toBe(true);
    expect(canSeeDashboard({ permissions: { reports: 'none' } }, null)).toBe(false);
    expect(canSeeDashboard(null, { user: { role: { key: 'owner' } } })).toBe(true);
    expect(canSeeDashboard(null, { user: { role: { key: 'guide' } } })).toBe(false);
    expect(updatedWords('10:12')).toBe('Live, updated 10:12');
  });
});

describe('the Dashboard screen', () => {
  it('D1: the four tiles, the trend, the channels, seats filled', async () => {
    fakeServer();
    await show('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByText('Live, updated 16:52')).toBeTruthy();
    const today = screen.getByRole('region', { name: 'Today' });
    for (const t of DASH.today) {
      expect(within(today).getByText(t.label)).toBeTruthy();
      expect(within(today).getByText(t.value)).toBeTruthy();
      expect(within(today).getByText(t.note)).toBeTruthy();
    }
    const trend = screen.getByRole('region', { name: 'The last 30 days' });
    expect(within(trend).getByText('24 Oct – 22 Nov')).toBeTruthy();
    expect(within(trend).getByText('+12%').className).toContain('dash-change--up');
    expect(within(trend).getAllByText('on the 30 days before')).toHaveLength(1); // bookings: no change
    const charts = within(trend).getAllByRole('img');
    expect(charts.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Money in each day, the last 30 days: ₦6,842,500 in all',
      'Bookings each day, the last 30 days: 142 in all',
    ]);
    const days = charts[0].querySelectorAll('span');
    expect(days).toHaveLength(30);
    expect(days[29].className).toBe('is-today');
    expect(/** @type {HTMLElement} */ (days[1]).style.height).toBe('7%');
    expect(within(trend).getByText(/^Money in: payments received each day/)).toBeTruthy();

    const channels = screen.getByRole('region', { name: 'Where bookings came from · 30 days' });
    expect(
      within(channels)
        .getAllByRole('row')
        .map((r) => r.textContent),
    ).toEqual(['ChannelBookingsMoney in', 'Website and widget78₦3,912,500', 'Sojourna15₦612,000']);
    const tours = screen.getByRole('region', { name: 'Seats filled, by tour · 30 days' });
    expect(within(tours).getByText('86%')).toBeTruthy();
  });

  it('a new business: nothing in 30 days, said in words', async () => {
    fakeServer({ ...DASH, channels: [], tours: [] });
    await show('/dashboard');
    expect(await screen.findByText('No bookings in the last 30 days.')).toBeTruthy();
    expect(screen.getByText('No departures in the last 30 days.')).toBeTruthy();
  });

  it('More lists the Dashboard with reports; not without', async () => {
    fakeServer();
    await show('/more');
    expect((await screen.findAllByRole('link', { name: /Dashboard/ })).length).toBeGreaterThan(0);
    cleanup();
    clearLive();
    await show('/more', ME('none'));
    expect(await screen.findByRole('heading', { name: 'More' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Dashboard/ })).toBeNull();
  });
});
