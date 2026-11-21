/**
 * Settings › Channels (O11), stage 17c-2: the rules in lib/channels.js, then the screen against
 * a fake server: the cards and the open channel's page, a tour switched off, the commission
 * (save bar), a new key and switching off (both asked first), a payment from the OTA,
 * connecting one (the key shown once), the empty page, and a manager who can only look.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { localDate } from '@okapigo/shared/time';
import { App } from '../src/App.jsx';
import { EngineContext } from '../src/lib/engine.jsx';
import { createSyncEngine } from '../src/lib/sync.js';
import { createMemoryStore } from '../src/lib/store.js';
import { request } from '../src/lib/api.js';
import { clearLive } from '../src/lib/live.js';
import {
  commissionError,
  connectBody,
  connectErrors,
  newKeyWords,
  owedAfterLine,
  parseNaira,
  parsePercent,
  paymentBody,
  paymentErrors,
  paymentForm,
  recordLabel,
  stateClass,
  switchOffWords,
  viaHelp,
} from '../src/lib/channels.js';

afterEach(() => {
  cleanup();
  clearLive();
  vi.unstubAllGlobals();
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
const MANAGER = {
  ...OWNER,
  user: { name: 'Kunle Bello', role: { key: 'manager', name: 'Operations manager' } },
  permissions: { ...ALL, products: 'view', channels: 'view', marketing: 'view', settings: 'none' },
};

const SOJOURNA = {
  id: 'ch-soj',
  name: 'Sojourna',
  isActive: true,
  status: 'Connected',
  commissionBasisPoints: 2000,
  commission: '20%',
  summary: '20% commission · 5 of 5 tours · last booking 10:42',
  month: { lead: 'This month:', strong: '6 bookings · ₦412,000' },
  owedKobo: 32_960_000,
  owedLine: '₦329,600 owed',
};
const DEMO = {
  id: 'ch-demo',
  name: 'Demo OTA',
  isActive: false,
  status: 'Switched off',
  commissionBasisPoints: 1500,
  commission: '15%',
  summary: '15% · can’t see or sell anything',
  month: { lead: '2 past bookings kept', strong: null },
  owedKobo: 0,
  owedLine: '₦0 owed',
};
const tour = (/** @type {string} */ id, /** @type {string} */ title, o = {}) => ({
  id,
  title,
  on: true,
  canSwitch: true,
  note: 'On sale on Sojourna',
  ...o,
});
/** @param {any} [o] */
const page = (o = {}) => ({
  ...SOJOURNA,
  tours: [
    tour('t-walk', 'Lagos Island Heritage Walk'),
    tour('t-lekki', 'Lekki Nature and Craft Half-Day', { note: 'On sale · pickup points shared' }),
    tour('t-epe', 'Epe Fish Market Morning', {
      on: false,
      canSwitch: false,
      note: 'Draft: only published tours can be on',
    }),
  ],
  bookings: [
    {
      id: 'b-1',
      reference: 'ILT-6WQ3PZ',
      who: 'Hannah Weber · 2A 1C',
      tour: 'Tarkwa Bay · Sat 12 Dec',
      price: '₦102,000',
      state: 'Owes ₦81,600',
      tone: 'owes',
    },
    {
      id: 'b-2',
      reference: 'ILT-4TG6VC',
      who: 'Liu Wei · 2A',
      tour: 'Street Food · Fri 4 Dec',
      price: '₦70,000',
      state: 'Cancelled · owes ₦0',
      tone: 'muted',
    },
  ],
  money: {
    salesLabel: 'Sales this month (6)',
    sales: '₦412,000',
    shareLabel: 'Sojourna’s 20%',
    share: '− ₦82,400',
    owedLabel: 'Sojourna owes Ìrìn Lagos Tours',
    owed: '₦329,600',
    lastPayment: 'Last payment from Sojourna: ₦210,400 on Tue 3 Nov (October’s sales).',
  },
  connection: {
    octoEndpoint: 'http://localhost:4000/octo',
    keyHint: '7Q2c',
    keyLine: 'ending ••••7Q2c · made Sat 14 Nov · last used 10:42',
  },
  keptLine: '3 upcoming bookings from Sojourna stay as they are; their guests can still come.',
  ...o,
});

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

/** The channels routes; more can be added. @param {Record<string, (body: any) => [number, any]>} [more] */
const channels = (more = {}) =>
  fakeFetch({
    'GET /api/channels': () => [
      200,
      { channels: [SOJOURNA, DEMO], octoEndpoint: 'http://localhost:4000/octo' },
    ],
    'GET /api/channels/ch-soj': () => [200, { channel: page() }],
    ...more,
  });

/** @param {any} me @param {string} path */
async function show(me, path) {
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

/** The open channel's page (it stays put once loaded). */
const channelPage = async () => within(await screen.findByRole('region', { name: 'Money' }));

describe('channels.js', () => {
  it('a commission typed, and the connect form', () => {
    expect(parsePercent('20')).toBe(20);
    expect(parsePercent(' 17,5 % ')).toBe(17.5);
    expect(parsePercent('100')).toBe(100);
    for (const bad of ['', '101', '12.345', 'ten', '-1']) expect(parsePercent(bad)).toBeNull();
    expect(commissionError('abc')).toBe('A percentage from 0 to 100, like 20 or 17.5');
    expect(commissionError('15')).toBeNull();
    expect(connectErrors({ name: ' S ', commission: '20' })).toEqual({
      name: 'At least 2 characters',
    });
    expect(connectErrors({ name: 'x'.repeat(61), commission: '200' })).toEqual({
      name: 'At most 60 characters',
      commission: 'A percentage from 0 to 100, like 20 or 17.5',
    });
    expect(connectErrors({ name: 'sojourna', commission: '20' }, ['Sojourna'])).toEqual({
      name: 'You already have a channel with that name',
    });
    expect(connectErrors({ name: 'Tripwell', commission: '17.5' }, ['Sojourna'])).toEqual({});
    expect(connectBody({ name: ' Tripwell ', commission: '17.5' })).toEqual({
      name: 'Tripwell',
      commissionPercent: 17.5,
    });
    expect(viaHelp(' Tripwell ')).toBe('How it shows on bookings: “via Tripwell”');
    expect(viaHelp('')).toBe('How it shows on bookings: “via Sojourna”');
  });

  it('a payment from the OTA: the form, its checks, what it sends, what’s owed after', () => {
    expect(paymentForm(32_960_000, '2026-12-03')).toEqual({
      amount: '329,600',
      receivedOn: '2026-12-03',
      reference: '',
    });
    expect(paymentForm(0, '2026-12-03').amount).toBe('');
    expect(parseNaira('₦329,600')).toBe(32_960_000);
    expect(parseNaira('12.50')).toBe(1250);
    for (const bad of ['', '0.5', 'abc', '1.234']) expect(parseNaira(bad)).toBeNull();
    const o = { owedKobo: 32_960_000, today: '2026-12-03', name: 'Sojourna' };
    const ok = { amount: '329,600', receivedOn: '2026-12-03', reference: ' SOJ-0193 ' };
    expect(paymentErrors(ok, o)).toEqual({});
    expect(paymentErrors({ ...ok, amount: '329,601' }, o)).toEqual({
      amount: 'Sojourna owes ₦329,600: record up to that',
    });
    expect(paymentErrors({ ...ok, amount: '1' }, { ...o, owedKobo: 0 })).toEqual({
      amount: 'Sojourna owes nothing right now',
    });
    expect(paymentErrors({ ...ok, amount: 'x', receivedOn: '2026-12-04' }, o)).toEqual({
      amount: 'Type the amount in naira, like 329,600',
      receivedOn: 'That day hasn’t come yet',
    });
    expect(paymentErrors({ ...ok, receivedOn: '', reference: 'x'.repeat(81) }, o)).toEqual({
      receivedOn: 'Pick the day it arrived',
      reference: 'At most 80 characters',
    });
    expect(paymentBody(ok)).toEqual({
      amountKobo: 32_960_000,
      receivedOn: '2026-12-03',
      reference: 'SOJ-0193',
    });
    expect(paymentBody({ ...ok, reference: '  ' }).reference).toBeNull();
    expect(owedAfterLine(32_960_000, '329,600')).toBe(
      'Pays off the oldest bookings first. Owed after this: ₦0.',
    );
    expect(owedAfterLine(32_960_000, '100,000')).toBe(
      'Pays off the oldest bookings first. Owed after this: ₦229,600.',
    );
    expect(owedAfterLine(100, '5,000')).toMatch(/Owed after this: ₦0\.$/);
    expect(recordLabel('329,600')).toBe('Record ₦329,600');
    expect(recordLabel('')).toBe('Record the payment');
  });

  it('the questions asked first, and the tones', () => {
    expect(newKeyWords('Sojourna', '7Q2c')).toEqual({
      title: 'Make a new key for Sojourna?',
      body: 'The old key (••••7Q2c) stops working at once. Sojourna can’t check seats or sell until someone pastes the new key into their settings.',
      kept: 'Existing bookings aren’t affected.',
    });
    expect(switchOffWords('Sojourna')).toEqual({
      title: 'Switch off Sojourna?',
      body: 'Sojourna won’t be able to sell. Its bookings stay.',
    });
    expect(stateClass('owes')).toBe('tone--warning');
    expect(stateClass('ok')).toBe('tone--ok');
    expect(stateClass('muted')).toBe('tone--muted');
  });
});

describe('Settings › Channels', () => {
  it('the cards, and the open channel’s page as designed', async () => {
    channels();
    await show(OWNER, '/settings/channels');
    expect(await screen.findByRole('heading', { name: 'Sell on travel websites' })).toBeTruthy();
    const cards = within(screen.getByRole('list', { name: 'Channels' }));
    const soj = cards.getByRole('link', { name: /^Sojourna/ });
    expect(soj.textContent).toContain('Connected');
    expect(soj.textContent).toContain('20% commission · 5 of 5 tours · last booking 10:42');
    expect(soj.textContent).toContain('This month: 6 bookings · ₦412,000');
    expect(soj.textContent).toContain('₦329,600 owed');
    expect(soj.getAttribute('aria-current')).toBe('true');
    const demo = cards.getByRole('link', { name: /^Demo OTA/ });
    expect(demo.textContent).toContain('Switched off');
    expect(demo.textContent).toContain('2 past bookings kept');

    const money = await channelPage();
    expect(money.getByText('Sales this month (6)')).toBeTruthy();
    expect(money.getByText('− ₦82,400')).toBeTruthy();
    expect(money.getByText('Sojourna owes Ìrìn Lagos Tours')).toBeTruthy();
    expect(money.getByText(/October’s sales/)).toBeTruthy();
    const tours = within(screen.getByRole('region', { name: 'Tours on Sojourna' }));
    expect(tours.getByText('Changes reach Sojourna within a minute')).toBeTruthy();
    const epe = /** @type {HTMLInputElement} */ (
      tours.getByRole('switch', { name: /Epe Fish Market Morning/ })
    );
    expect(epe.checked).toBe(false);
    expect(epe.disabled).toBe(true);
    const lekki = tours.getByRole('switch', { name: /Lekki/ });
    expect(lekki.closest('label')?.textContent).toContain('On sale · pickup points shared');
    const latest = within(screen.getByRole('region', { name: 'Latest bookings via Sojourna' }));
    expect(latest.getByRole('link', { name: 'ILT-6WQ3PZ' }).getAttribute('href')).toBe(
      '/bookings/b-1',
    );
    expect(latest.getByText('Owes ₦81,600').className).toContain('tone--warning');
    expect(latest.getByRole('link', { name: 'All in Bookings ›' }).getAttribute('href')).toBe(
      '/bookings?channel=ch-soj',
    );
    const conn = within(screen.getByRole('region', { name: 'Connection' }));
    expect(conn.getByText('http://localhost:4000/octo')).toBeTruthy();
    expect(conn.getByText('ending ••••7Q2c · made Sat 14 Nov · last used 10:42')).toBeTruthy();
  });

  it('a tour switched off: sent at once', async () => {
    const sent = channels({
      'PUT /api/channels/ch-soj/tours/t-walk': () => [200, { channel: page() }],
    });
    await show(OWNER, '/settings/channels/ch-soj');
    await channelPage();
    fireEvent.click(screen.getByRole('switch', { name: /Heritage Walk/ }));
    await waitFor(() => expect(sent.some((x) => x.method === 'PUT')).toBe(true));
    expect(sent.find((x) => x.method === 'PUT')?.body).toEqual({ on: false });
  });

  it('the commission: the save bar, new sales only', async () => {
    const sent = channels({ 'PATCH /api/channels/ch-soj': () => [200, { channel: page() }] });
    await show(OWNER, '/settings/channels/ch-soj');
    await channelPage();
    const field = screen.getByRole('textbox', { name: /Commission/ });
    expect(screen.getByText('New sales use the new %. Past bookings keep theirs.')).toBeTruthy();
    fireEvent.change(field, { target: { value: 'abc' } });
    expect(screen.getByText('A percentage from 0 to 100, like 20 or 17.5')).toBeTruthy();
    const bar = within(screen.getByRole('region', { name: 'Unsaved changes' }));
    expect(
      /** @type {HTMLButtonElement} */ (bar.getByRole('button', { name: 'Save changes' })).disabled,
    ).toBe(true);
    fireEvent.change(field, { target: { value: '25' } });
    fireEvent.click(bar.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(sent.some((x) => x.method === 'PATCH')).toBe(true));
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({ commissionPercent: 25 });
  });

  it('a new key: asked first; then shown once, with Copy; “I’ve stored it” closes it', async () => {
    const sent = channels({
      'POST /api/channels/ch-soj/key': () => [
        200,
        { apiKey: 'octo_NEWKEY123', octoEndpoint: 'http://localhost:4000/octo', channel: page() },
      ],
    });
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...globalThis.navigator, clipboard: { writeText }, onLine: true });
    await show(OWNER, '/settings/channels/ch-soj');
    await channelPage();
    fireEvent.click(screen.getByRole('button', { name: 'New key' }));
    const ask = within(screen.getByRole('alertdialog', { name: 'Make a new key for Sojourna?' }));
    expect(ask.getByText(/The old key \(••••7Q2c\) stops working at once/)).toBeTruthy();
    expect(ask.getByText('Existing bookings aren’t affected.')).toBeTruthy();
    fireEvent.click(ask.getByRole('button', { name: 'Keep the old one' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sent.some((x) => x.method === 'POST')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'New key' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make a new key' }));
    const once = within(
      await screen.findByRole('dialog', { name: 'Paste these into Sojourna’s supplier settings' }),
    );
    expect(once.getByText('octo_NEWKEY123')).toBeTruthy();
    expect(
      once.getByText('Store it now: you won’t see it again. Lost it? Make a new key.'),
    ).toBeTruthy();
    fireEvent.click(once.getAllByRole('button', { name: 'Copy' })[1]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('octo_NEWKEY123'));
    expect(once.getByRole('button', { name: 'Copied' })).toBeTruthy();
    fireEvent.click(once.getByRole('button', { name: 'I’ve stored it' }));
    expect(screen.queryByText('octo_NEWKEY123')).toBeNull();
  });

  it('switching off: asked first; switched off, what stays, and back on', async () => {
    let on = true;
    const sent = channels({
      'GET /api/channels/ch-soj': () => [
        200,
        { channel: page(on ? {} : { isActive: false, status: 'Switched off' }) },
      ],
      'PATCH /api/channels/ch-soj': (body) => {
        on = body.isActive;
        return [200, { channel: page() }];
      },
    });
    await show(OWNER, '/settings/channels/ch-soj');
    await channelPage();
    fireEvent.click(screen.getByRole('button', { name: 'Switch off' }));
    const ask = within(screen.getByRole('alertdialog', { name: 'Switch off Sojourna?' }));
    expect(ask.getByText('Sojourna won’t be able to sell. Its bookings stay.')).toBeTruthy();
    fireEvent.click(ask.getByRole('button', { name: 'Switch off Sojourna' }));
    const off = within(await screen.findByRole('region', { name: 'Switched off' }));
    expect(
      off.getByText(
        'Sojourna can’t see your tours, prices or seats, and can’t sell. Its key is turned off.',
      ),
    ).toBeTruthy();
    expect(off.getByText(/3 upcoming bookings from Sojourna stay as they are/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New key' })).toBeNull();
    fireEvent.click(off.getByRole('button', { name: 'Switch back on' }));
    await waitFor(() => expect(sent.filter((x) => x.method === 'PATCH')).toHaveLength(2));
    expect(sent.filter((x) => x.method === 'PATCH').map((x) => x.body)).toEqual([
      { isActive: false },
      { isActive: true },
    ]);
  });

  it('a payment from Sojourna: what it owes to start; checked; sent', async () => {
    const sent = channels({
      'POST /api/channels/ch-soj/payments': () => [201, { channel: page() }],
    });
    await show(OWNER, '/settings/channels/ch-soj');
    const money = await channelPage();
    fireEvent.click(money.getByRole('button', { name: 'Record a payment from Sojourna' }));
    const sheet = within(screen.getByRole('dialog', { name: 'Payment received from Sojourna' }));
    const amount = /** @type {HTMLInputElement} */ (
      sheet.getByRole('textbox', { name: 'Amount (₦)' })
    );
    expect(amount.value).toBe('329,600');
    expect(
      sheet.getByText('Pays off the oldest bookings first. Owed after this: ₦0.'),
    ).toBeTruthy();
    fireEvent.change(amount, { target: { value: '400,000' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Record ₦400,000' }));
    expect(sheet.getByText('Sojourna owes ₦329,600: record up to that')).toBeTruthy();
    expect(sent.some((x) => x.method === 'POST')).toBe(false);
    fireEvent.change(amount, { target: { value: '300,000' } });
    expect(
      sheet.getByText('Pays off the oldest bookings first. Owed after this: ₦29,600.'),
    ).toBeTruthy();
    fireEvent.change(sheet.getByRole('textbox', { name: 'Bank reference' }), {
      target: { value: 'SOJ-PAYOUT-NOV-0193' },
    });
    fireEvent.click(sheet.getByRole('button', { name: 'Record ₦300,000' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent.find((x) => x.method === 'POST')?.body).toEqual({
      amountKobo: 30_000_000,
      receivedOn: localDate(new Date(), 'Africa/Lagos'),
      reference: 'SOJ-PAYOUT-NOV-0193',
    });
  });

  it('no channels yet: connect one, and see its key once', async () => {
    let made = false;
    const sent = fakeFetch({
      'GET /api/channels': () => [
        200,
        { channels: made ? [SOJOURNA] : [], octoEndpoint: 'http://localhost:4000/octo' },
      ],
      'GET /api/channels/ch-soj': () => [200, { channel: page() }],
      'POST /api/channels': () => {
        made = true;
        return [
          201,
          { channel: page(), apiKey: 'octo_FIRSTKEY', octoEndpoint: 'http://localhost:4000/octo' },
        ];
      },
    });
    await show(OWNER, '/settings/channels');
    const empty = within(await screen.findByRole('region', { name: 'No channels yet' }));
    expect(empty.getByText(/Connect a travel website \(Viator, GetYourGuide/)).toBeTruthy();
    fireEvent.click(empty.getByRole('button', { name: 'Connect a channel' }));
    const sheet = within(screen.getByRole('dialog', { name: 'Connect a channel' }));
    expect(
      sheet.getByText('All published tours start switched on. You can change that after.'),
    ).toBeTruthy();
    fireEvent.click(sheet.getByRole('button', { name: 'Connect and make a key' }));
    expect(sheet.getByText('At least 2 characters')).toBeTruthy();
    fireEvent.change(sheet.getByRole('textbox', { name: /^Name/ }), {
      target: { value: 'Sojourna' },
    });
    expect(sheet.getByText('How it shows on bookings: “via Sojourna”')).toBeTruthy();
    fireEvent.click(sheet.getByRole('button', { name: 'Connect and make a key' }));
    const once = within(
      await screen.findByRole('dialog', { name: 'Paste these into Sojourna’s supplier settings' }),
    );
    expect(once.getByText('octo_FIRSTKEY')).toBeTruthy();
    expect(once.getByText('http://localhost:4000/octo')).toBeTruthy();
    expect(sent.find((x) => x.method === 'POST')?.body).toEqual({
      name: 'Sojourna',
      commissionPercent: 20,
    });
  });

  it('a manager can look, not change', async () => {
    channels();
    await show(MANAGER, '/settings/channels');
    await channelPage();
    expect(screen.getByText('Only the owner can change this. You can look.')).toBeTruthy();
    for (const name of [
      'Connect a channel',
      'New key',
      'Switch off',
      'Record a payment from Sojourna',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    const walk = /** @type {HTMLInputElement} */ (
      screen.getByRole('switch', { name: /Heritage Walk/ })
    );
    expect(walk.disabled).toBe(true);
    expect(
      /** @type {HTMLInputElement} */ (screen.getByRole('textbox', { name: /Commission/ }))
        .disabled,
    ).toBe(true);
  });
});
