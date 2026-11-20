/**
 * The office (16a): screens by role, the manager's Today, and the staff states.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '../src/App.jsx';
import { EngineContext } from '../src/lib/engine.jsx';
import { createSyncEngine } from '../src/lib/sync.js';
import { createMemoryStore } from '../src/lib/store.js';
import { ApiError, request } from '../src/lib/api.js';
import { liveState, supportCode, load, clearLive, SLOW_MS } from '../src/lib/live.js';
import { isOffice, whoLine, ownerName } from '../src/lib/roles.js';

afterEach(() => {
  cleanup();
  clearLive();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ME_MANAGER = {
  user: { name: 'Kunle Bello', role: { key: 'manager', name: 'Manager' } },
  operator: { name: 'Ìrìn Lagos Tours', timeZone: 'Africa/Lagos' },
  permissions: { bookings: 'edit', operations: 'edit' },
  owner: { name: 'Bisola Adeyemi' },
};
const ME_GUIDE = {
  user: { name: 'Femi Ogunleye', role: { key: 'guide', name: 'Guide' } },
  operator: { name: 'Ìrìn Lagos Tours', timeZone: 'Africa/Lagos' },
  permissions: { bookings: 'view', operations: 'edit' },
  owner: { name: 'Bisola Adeyemi' },
};
const TODAY = {
  today: {
    date: 'Sat 5 Dec',
    summary: '2 departures · 20 guests · 1 guide out',
    needs: [
      {
        kind: 'no_guide',
        tone: 'urgent',
        key: 'IN 2 H 20',
        title: 'Tarkwa Bay has no guide',
        detail: '10:00 · 8 booked · Amaka is free',
        action: 'Assign',
        href: '/departures/d2',
      },
      {
        kind: 'cash',
        tone: 'info',
        key: 'CASH',
        title: '₦45,500 cash with Femi',
        detail: 'Confirm when it’s handed in',
        action: 'Open',
        href: '/bookings/b1',
      },
    ],
    departures: [
      {
        id: 'd1',
        time: '07:00',
        tour: 'Badagry Day Trip',
        guide: 'Femi · Van 1',
        hasGuide: true,
        guideSynced: 'synced 07:31',
        progress: '11 of 12 checked in',
        pct: 92,
        state: { text: 'Under way · synced 07:31', tone: 'ok' },
      },
      {
        id: 'd2',
        time: '10:00',
        tour: 'Tarkwa Bay Beach Day',
        guide: 'No guide yet',
        hasGuide: false,
        guideSynced: null,
        progress: '8 booked of 12',
        pct: 0,
        state: { text: 'Needs a guide', tone: 'urgent' },
      },
    ],
    phones: [
      { name: 'Femi', trip: 'Badagry, 07:00', status: 'Synced 07:31 · 0 waiting', tone: 'ok' },
    ],
    badges: { schedule: 1, inbox: 7 },
  },
};

/** @param {Record<string, (body: any) => [number, any, Record<string,string>?]>} routes */
function fakeFetch(routes) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ path) => {
      const route = routes[path];
      if (!route)
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: path } }), {
          status: 404,
        });
      const [status, json, headers = {}] = route(undefined);
      return new Response(json === null ? null : JSON.stringify(json), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    }),
  );
}

/** @param {any} me @param {string} path */
async function show(me, path = '/') {
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
  return engine;
}

describe('roles', () => {
  it('the office can edit bookings; before /api/me, the sign-in role says', () => {
    expect(isOffice(ME_MANAGER, null)).toBe(true);
    expect(isOffice(ME_GUIDE, null)).toBe(false);
    expect(isOffice(null, { user: { role: { key: 'owner' } } })).toBe(true);
    expect(isOffice(null, { user: { role: { key: 'guide' } } })).toBe(false);
    expect(whoLine(ME_GUIDE, null)).toBe('Femi Ogunleye (guide)');
    expect(ownerName(ME_GUIDE)).toBe('Bisola');
    expect(ownerName(null)).toBe('the owner');
  });
});

describe('live data: states', () => {
  const e = (/** @type {any} */ o) => ({
    data: null,
    at: null,
    error: null,
    loading: false,
    startedAt: null,
    ...o,
  });
  it('loading, slow after 10 s, ready, offline, stale, error, denied', () => {
    const now = 100_000;
    expect(liveState(e({ loading: true, startedAt: now - 1000 }), { online: true, now })).toBe(
      'loading',
    );
    expect(liveState(e({ loading: true, startedAt: now - SLOW_MS }), { online: true, now })).toBe(
      'slow',
    );
    expect(liveState(e({ data: {} }), { online: true, now })).toBe('ready');
    expect(liveState(e({}), { online: false, now })).toBe('offline');
    expect(liveState(e({ data: {} }), { online: false, now })).toBe('stale');
    expect(liveState(e({ error: new ApiError('server', 'x') }), { online: true, now })).toBe(
      'error',
    );
    expect(liveState(e({ error: new ApiError('unreachable', 'x') }), { online: true, now })).toBe(
      'offline',
    );
    expect(
      liveState(e({ error: new ApiError('api', 'x', { status: 403 }) }), { online: true, now }),
    ).toBe('denied');
  });

  it('the support code: the request id’s start, and the time', () => {
    const err = new ApiError('server', 'x', { requestId: '5f2a91c0-0000' });
    expect(supportCode(err, new Date('2026-12-05T06:41:00Z'), 'Africa/Lagos')).toBe('5F2A-07:41');
  });

  it('one fetch per path at a time, shared', async () => {
    let calls = 0;
    const send = /** @type {any} */ (
      async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return { status: 200, body: { ok: 1 }, etag: null };
      }
    );
    await Promise.all([1, 2, 3].map(() => load('/x', { token: 't', online: () => true, send })));
    expect(calls).toBe(1);
  });
});

describe('the office’s screens', () => {
  it('a manager: their Today, five tabs with badges, Needs you first', async () => {
    fakeFetch({ '/api/today': () => [200, TODAY], '/api/me': () => [200, ME_MANAGER] });
    await show(ME_MANAGER);
    expect(await screen.findByRole('heading', { name: 'Today, Sat 5 Dec' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Needs you · 2' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Tarkwa Bay has no guide/ }).getAttribute('href')).toBe(
      '/departures/d2',
    );
    expect(screen.getByText('11 of 12 checked in · under way')).toBeTruthy();
    const tabs = screen
      .getAllByRole('navigation', { name: 'Main' })
      .find((n) => n.className.includes('tabs'));
    expect([...(tabs?.querySelectorAll('a') ?? [])].map((a) => a.textContent)).toEqual([
      'Today',
      'Schedule1',
      'Bookings',
      'Inbox7',
      'More',
    ]);
  });

  it('a guide opening a manager link: "This page is for managers", who to ask', async () => {
    fakeFetch({});
    await show(ME_GUIDE, '/schedule');
    expect(await screen.findByRole('heading', { name: 'This page is for managers' })).toBeTruthy();
    expect(
      screen.getByText('You’re signed in as Femi Ogunleye (guide). Ask Bisola if you need access.'),
    ).toBeTruthy();
    const tabs = screen
      .getAllByRole('navigation', { name: 'Main' })
      .find((n) => n.className.includes('tabs'));
    expect([...(tabs?.querySelectorAll('a') ?? [])].map((a) => a.textContent)).toEqual([
      'Today',
      'Scan',
      'Sync',
    ]);
  });

  it('offline with nothing loaded: "You’re offline"', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    await show(ME_MANAGER);
    expect(await screen.findByRole('heading', { name: 'You’re offline' })).toBeTruthy();
  });

  it('our server broken: "Today didn’t load", with a code to quote', async () => {
    fakeFetch({
      '/api/today': () => [
        500,
        { error: { code: 'X', message: 'x' } },
        { 'X-Request-Id': '5f2a91c0' },
      ],
    });
    await show(ME_MANAGER);
    expect(await screen.findByRole('heading', { name: 'Today didn’t load' })).toBeTruthy();
    expect(screen.getByText(/^5F2A-\d\d:\d\d$/)).toBeTruthy();
  });

  it('loaded, then the signal goes: still shown, greyed, "Offline · shown as of …"', async () => {
    fakeFetch({ '/api/today': () => [200, TODAY], '/api/me': () => [200, ME_MANAGER] });
    const engine = await show(ME_MANAGER);
    expect(await screen.findByRole('heading', { name: 'Today, Sat 5 Dec' })).toBeTruthy();
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    engine.connectionChanged();
    expect(await screen.findByText(/^Offline · shown as of \d\d:\d\d$/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Today, Sat 5 Dec', hidden: true })).toBeTruthy();
  });
});
