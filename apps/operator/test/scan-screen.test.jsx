/**
 * The Scan screen (O4, 15c-3), with a fake camera that "sees" the codes a test gives it.
 *   - a good scan: tick who's here, check in 2 of 3, the note with Undo
 *   - money owed: asks first
 *   - problems: cancelled, not ours (search instead)
 *   - search by name, tap a name: the same sheet as a scan
 *   - no camera permission: how to allow it, search instead
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { createHash } from 'node:crypto';
import { App } from '../src/App.jsx';
import { EngineContext } from '../src/lib/engine.jsx';
import { createSyncEngine } from '../src/lib/sync.js';
import { createMemoryStore } from '../src/lib/store.js';
import { request } from '../src/lib/api.js';
import { makePackage } from './fixtures.js';

const cam = vi.hoisted(() => ({
  codes: /** @type {string[]} */ ([]),
  problem: /** @type {string | null} */ (null),
}));
vi.mock('../src/lib/camera.js', () => ({
  openCamera: async () =>
    cam.problem ? { ok: false, problem: cam.problem } : { ok: true, stop() {}, torch: null },
  createReader: async () => ({ read: async () => cam.codes.shift() ?? null }),
  buzz: () => {},
}));

afterEach(() => {
  cleanup();
  cam.codes = [];
  cam.problem = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const sha = (/** @type {string} */ s) => createHash('sha256').update(s).digest('hex');

async function scanner({ owes = false } = {}) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-05T07:12:00+01:00'));
  vi.stubGlobal('navigator', { ...navigator, onLine: false });
  const pkg = makePackage();
  pkg.departures[0].bookings.forEach(
    (/** @type {any} */ b, i) => (b.ticketFingerprint = sha(`code-${i}`)),
  );
  pkg.departures[0].bookings[2].endedAt = '2026-12-04T15:00:00.000Z';
  if (owes)
    pkg.departures[0].bookings[0].money = {
      owedKobo: 4_550_000,
      paidKobo: 1_950_000,
      label: '₦45,500 still to pay',
    };
  const engine = createSyncEngine({
    request,
    store: createMemoryStore({
      session: { token: 'tok', user: { name: 'Femi' }, contact: 'femi@irin.example' },
      meta: { firstRunDone: true },
      package: { data: pkg, etag: null, savedAt: '2026-12-05T05:40:00.000Z' },
    }),
  });
  await engine.load();
  const { hook } = memoryLocation({ path: '/scan/dep-badagry' });
  render(
    <EngineContext.Provider value={engine}>
      <Router hook={hook}>
        <App base="" />
      </Router>
    </EngineContext.Provider>,
  );
  return engine;
}

describe('Scan (O4)', () => {
  it('a good scan: untick who’s missing, check in 2 of 3; the note says who’s not yet; Undo', async () => {
    const engine = await scanner();
    expect(screen.getByText('Badagry Heritage Day Trip · 07:00')).toBeTruthy();
    cam.codes.push('code-0');
    expect(await screen.findByText('Ticket OK', { selector: '.result-title' })).toBeTruthy();
    expect(screen.getByText('ILT-7Q2LKD · this departure')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Kamsi Okafor/));
    expect(screen.getByText('stays “Not yet”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check in 2 of 3' }));
    await waitFor(() => expect(engine.getState().outbox).toHaveLength(1));
    expect(engine.getState().outbox[0]).toMatchObject({
      bookingId: 'b-okafor',
      travellerIds: ['t-adaeze', 't-chidi'],
      status: 'present',
    });
    expect((await screen.findByRole('status')).textContent).toContain(
      '2 checked in · Okafor · Kamsi not yet',
    );
    expect(screen.getByText('Next ticket')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(engine.getState().outbox).toHaveLength(2));
    expect(engine.getState().outbox[1]).toMatchObject({
      travellerIds: ['t-adaeze', 't-chidi'],
      status: 'pending',
    });
  });

  it('Undo works until the next scan', async () => {
    await scanner();
    cam.codes.push('code-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Check in 2' }));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeTruthy();
    cam.codes.push('code-2'); // the next ticket (a cancelled one)
    expect(
      await screen.findByText('Cancelled: don’t check in', { selector: '.result-title' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('money owed: the sheet asks first', async () => {
    const engine = await scanner({ owes: true });
    cam.codes.push('code-0');
    expect(await screen.findByRole('heading', { name: 'Adaeze still owes ₦45,500' })).toBeTruthy();
    expect(screen.getByText('Deposit of ₦19,500 paid. Balance was due Sat 28 Nov.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check in, still owing' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Check in 3' }));
    await waitFor(() =>
      expect(engine.getState().outbox[0]).toMatchObject({
        confirmOwed: true,
        travellerIds: ['t-adaeze', 't-chidi', 't-kamsi'],
      }),
    );
  });

  it('problems: a cancelled booking; not a ticket at all → search by name → the same sheet', async () => {
    await scanner();
    cam.codes.push('code-2');
    expect(
      await screen.findByText('Cancelled: don’t check in', { selector: '.result-title' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Call the office' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Scan the next ticket' }));

    cam.codes.push('https://example.com/menu');
    expect(
      await screen.findByText('Not an Ìrìn Lagos Tours ticket', { selector: '.result-title' }),
    ).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Search by name or reference',
      }),
    );
    fireEvent.change(await screen.findByLabelText('Name, phone or reference'), {
      target: { value: 'nwos' },
    });
    // Emeka, and his unnamed guest ("Guest 2 of Emeka Nwosu’s booking").
    expect(screen.getByRole('status').textContent).toBe(
      'Badagry Heritage Day Trip · Sat 5 Dec · 2 matches',
    );
    fireEvent.click(screen.getByRole('button', { name: /^Emeka Nwosu/ }));
    expect(await screen.findByText('ILT-5PX9TN · this departure')).toBeTruthy();
  });

  it('no camera permission: how to allow it; search instead', async () => {
    cam.problem = 'denied';
    await scanner();
    expect(
      await screen.findByRole('heading', { name: 'The app can’t use the camera' }),
    ).toBeTruthy();
    expect(screen.getByText(/^Set/).textContent).toBe('Set Camera to Allow.');
    fireEvent.click(screen.getByRole('button', { name: 'Search by name instead' }));
    fireEvent.change(await screen.findByLabelText('Name, phone or reference'), {
      target: { value: 'Okonkwo' },
    });
    expect(
      screen.getByRole('heading', { name: 'No one called “Okonkwo” on this trip' }),
    ).toBeTruthy();
  });
});
