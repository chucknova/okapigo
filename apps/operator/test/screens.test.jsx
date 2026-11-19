/**
 * The 15c-1 screens, drawn from the engine's state (jsdom; the network is a fake fetch).
 *   - sign-in: the code signs in by itself; a wrong code counts the tries down
 *   - first sign-in with no signal: "You need signal to sign in the first time"
 *   - Today: the card's facts, counting changes not sent yet
 *   - Sync: a conflict as YOU DID / THE OFFICE HAD / SO NOW, with OK
 *   - the strip: offline, in words
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '../src/App.jsx';
import { EngineContext } from '../src/lib/engine.jsx';
import { createSyncEngine } from '../src/lib/sync.js';
import { createMemoryStore } from '../src/lib/store.js';
import { request } from '../src/lib/api.js';
import { makePackage } from './fixtures.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A fake fetch answering a few paths. @param {Record<string, (body: any) => [number, any]>} routes */
function fakeFetch(routes) {
  /** @type {Array<{ path: string, body: any }>} */
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ path, /** @type {any} */ init) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ path, body });
      const route = routes[path];
      if (!route)
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: path } }), {
          status: 404,
        });
      const [status, json] = route(body);
      return new Response(json === null ? null : JSON.stringify(json), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

/** @param {Record<string, any>} stored @param {string} [path] */
async function show(stored, path = '/') {
  const engine = createSyncEngine({ request, store: createMemoryStore(stored) });
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

const signedIn = {
  session: { token: 'tok', user: { name: 'Femi' }, contact: 'femi@irin.example' },
  meta: { firstRunDone: true },
};

describe('sign-in (O1)', () => {
  it('a code, a wrong code (tries left), then the right one signs in by itself', async () => {
    let attempt = 0;
    const calls = fakeFetch({
      '/auth/otp/request': () => [202, { message: 'sent' }],
      '/auth/otp/verify': () =>
        ++attempt === 1
          ? [
              400,
              { error: { code: 'INVALID_CODE', message: 'That code is wrong or has expired.' } },
            ]
          : [200, { token: 'tok', user: { name: 'Femi' } }],
      '/api/sync/conflicts': () => [200, { conflicts: [] }],
      '/api/sync/package': () => [200, { package: makePackage() }],
    });
    const engine = await show({});
    fireEvent.change(screen.getByLabelText('Email or phone number'), {
      target: { value: 'femi@irin.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy();
    expect(screen.getByText(/Send again in 0:/)).toBeTruthy();

    // A pasted code fills every box and goes by itself.
    fireEvent.change(screen.getByLabelText('Digit 1 of 6'), { target: { value: '111111' } });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That code isn’t right. You have 4 tries left.',
    );
    fireEvent.change(screen.getByLabelText('Digit 1 of 6'), { target: { value: '482917' } });
    await waitFor(() => expect(engine.getState().session?.token).toBe('tok'));
    expect(calls.filter((c) => c.path === '/auth/otp/verify').map((c) => c.body)).toEqual([
      { contact: 'femi@irin.example', code: '111111' },
      { contact: 'femi@irin.example', code: '482917' },
    ]);
    // Signed in, first time on this phone: First run.
    expect(
      await screen.findByRole('heading', {
        name: /home screen|ready for no signal|Getting your trips ready/,
      }),
    ).toBeTruthy();
  });

  it('the first sign-in with no signal: say so, plainly', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    await show({});
    fireEvent.change(screen.getByLabelText('Email or phone number'), {
      target: { value: 'femi@irin.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(
      await screen.findByRole('heading', { name: 'You need signal to sign in the first time' }),
    ).toBeTruthy();
  });
});

describe('Today (O2)', () => {
  it('my departure, counting the changes not sent yet; the strip says offline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-05T06:40:00+01:00'));
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    await show({
      ...signedIn,
      package: { data: makePackage(), etag: 'W/"1"', savedAt: '2026-12-05T05:40:00.000Z' },
      outbox: [
        {
          id: 'c1',
          at: '2026-12-05T05:39:00.000Z',
          kind: 'check_in',
          departureId: 'dep-badagry',
          bookingId: 'b-okafor',
          travellerIds: ['t-adaeze', 't-chidi'],
          status: 'present',
        },
      ],
    });
    expect(screen.getByRole('heading', { name: 'Today, Sat 5 Dec' })).toBeTruthy();
    expect(screen.getByText('Badagry Heritage Day Trip')).toBeTruthy();
    expect(screen.getByText('Starts in 20 min')).toBeTruthy();
    expect(screen.getByText('Van 1 · 14 seats · Driver: Sola')).toBeTruthy();
    expect(screen.getByText('2 of 5 checked in (2 not sent yet)')).toBeTruthy();
    expect(screen.getByText('back about 17:00')).toBeTruthy();
    expect(screen.getByText('1 no peanuts')).toBeTruthy();
    expect(screen.getByText('Offline · saved 06:40 · 1 change waiting')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Offline · saved/ }).getAttribute('href')).toBe(
      '/sync',
    );
    expect(screen.getByLabelText('1 waiting')).toBeTruthy();
  });

  it('no departures today: says so, and shows the next', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-04T09:00:00+01:00'));
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const pkg = makePackage();
    pkg.days = ['2026-12-04', '2026-12-05'];
    await show({
      ...signedIn,
      package: { data: pkg, etag: null, savedAt: '2026-12-04T07:00:00.000Z' },
    });
    expect(screen.getByText('No departures for you today')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Next, Sat 5 Dec' })).toBeTruthy();
  });
});

describe('Sync (O5): a conflict', () => {
  it('YOU DID / THE OFFICE HAD / SO NOW; OK dismisses it on the server', async () => {
    const calls = fakeFetch({
      '/api/sync/conflicts/srv-1/dismiss': () => [204, null],
    });
    const engine = await show(
      {
        ...signedIn,
        package: { data: makePackage(), etag: null, savedAt: new Date().toISOString() },
        conflicts: [
          {
            id: 'srv-1',
            message: 'You marked…',
            explanation: {
              title: 'Bayo Adewale wasn’t checked in',
              youDid: 'Marked Bayo Adewale present at 07:08 (offline).',
              theyLabel: 'The office had',
              theyHad: 'Cancelled the booking at 06:55.',
              soNow:
                'Nothing changed. The booking stays cancelled. If they’re with you, call the office.',
              canUseMine: false,
            },
          },
        ],
      },
      '/sync',
    );
    expect(screen.getByRole('heading', { name: 'Bayo Adewale wasn’t checked in' })).toBeTruthy();
    expect(screen.getByText('You did')).toBeTruthy();
    expect(screen.getByText('The office had')).toBeTruthy();
    expect(screen.getByText('Cancelled the booking at 06:55.')).toBeTruthy();
    expect(screen.getByText('Nothing changed.').tagName).toBe('STRONG');
    expect(screen.queryByRole('button', { name: 'Use mine' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Call the office' }).getAttribute('href')).toBe(
      'tel:+2348030000000',
    );
    expect(screen.getByText('1 change needs a look · tap')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(engine.getState().conflicts).toEqual([]));
    expect(calls.map((c) => c.path)).toContain('/api/sync/conflicts/srv-1/dismiss');
    expect(await screen.findByRole('heading', { name: 'Everything is sent' })).toBeTruthy();
  });
});
