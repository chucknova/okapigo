/**
 * Stage 12e screens with a fake API: confirming → confirmed (full and deposit), didn't go
 * through, paid after the hold ended; paying a balance; every payment link state.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Router, Route, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { Confirm } from '../src/screens/trip/Confirm.jsx';
import { PayBalance } from '../src/screens/trip/PayBalance.jsx';
import { PaymentLink, PaymentLinkDone } from '../src/screens/pay/PaymentLink.jsx';
import { rememberTrip } from '../src/lib/trips.js';

const T = 'T'.repeat(44);
const REF = 'OKG-AAAAAAAAAAAAAAAAAAAA';
const booking = (overrides = {}) => ({
  reference: 'ILT-3MZ8RB',
  status: 'paid',
  operator: { slug: 'irin', name: 'Ìrìn Lagos Tours', timeZone: 'Africa/Lagos' },
  tour: {
    slug: 'badagry',
    title: 'Badagry Heritage Day Trip',
    durationMinutes: 600,
    meetingPoint: { name: 'Ìrìn office, Yaba', address: 'Commercial Avenue', lat: 6.5, lng: 3.37 },
  },
  departure: { startsAt: '2026-12-05T06:00:00Z', localDate: '2026-12-05', localTime: '07:00' },
  pickupPoint: null,
  lead: { name: 'Funmi Adeyemi', email: null, phone: '+2348059876543' },
  travellers: [{ name: 'Funmi Adeyemi', age: 41, categoryKey: 'adult', dietaryNeeds: '' }],
  quote: { lines: [], tax: { name: 'VAT', inclusive: true }, taxKobo: 453_500 },
  totalKobo: 6_500_000,
  amountPaidKobo: 6_500_000,
  balanceKobo: 0,
  holdExpiresAt: null,
  paymentOptions: [],
  payments: [
    {
      reference: REF,
      status: 'succeeded',
      purpose: 'full',
      amountKobo: 6_500_000,
      paidAt: '2026-11-17T10:00:00Z',
    },
  ],
  cancellationPolicy: { rules: [], noShowRefundBasisPoints: 0, depositRefundable: false },
  ...overrides,
});

function fakeApi(routes) {
  const calls = [];
  vi.stubGlobal('fetch', async (path, init = {}) => {
    calls.push({
      path,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body) : null,
    });
    for (const [prefix, handler] of Object.entries(routes)) {
      if (path.startsWith(prefix)) {
        const [status, body] = await handler(path, init);
        return new Response(JSON.stringify(body), { status });
      }
    }
    return new Response('{}', { status: 404 });
  });
  return calls;
}

function renderAt(path) {
  const memory = memoryLocation({ path, record: true });
  render(
    <Router hook={memory.hook}>
      <Switch>
        <Route path="/trip/:token/confirm" component={Confirm} />
        <Route path="/trip/:token/pay" component={PayBalance} />
        <Route path="/pay/:token/done" component={PaymentLinkDone} />
        <Route path="/pay/:token" component={PaymentLink} />
      </Switch>
    </Router>,
  );
  return memory;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('location', { ...window.location, assign: vi.fn(), origin: 'http://localhost' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('C → D: confirming, then confirmed', () => {
  it('paid in full: confirmed, reference, sent to the phone on WhatsApp, Paid in full', async () => {
    fakeApi({ [`/public/bookings/${T}`]: () => [200, { booking: booking() }] });
    renderAt(`/trip/${T}/confirm?reference=${REF}`);

    expect(await screen.findByRole('heading', { name: 'Booking confirmed' })).toBeTruthy();
    expect(screen.getByText('ILT-3MZ8RB')).toBeTruthy();
    expect(screen.getByText('A confirmation was sent to 0805 987 6543 on WhatsApp.')).toBeTruthy();
    expect(screen.getByText('Paid in full')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add to calendar' }).getAttribute('href')).toBe(
      `/public/bookings/${T}/calendar.ics`,
    );
    // Sharing sends the TOUR's link, never the private trip page.
    const share = screen.getByRole('link', { name: 'Share on WhatsApp' }).getAttribute('href');
    expect(decodeURIComponent(share)).toContain('/irin/badagry');
    expect(share).not.toContain(T);
    // This phone now knows the trip (for the payment link page).
    // (Saved in an effect just after the page draws: wait for it, don't race it.)
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('okg-trips'))).toEqual({ 'ILT-3MZ8RB': T }),
    );
  });

  it('a deposit: the balance and its due date, with Pay balance now', async () => {
    fakeApi({
      [`/public/bookings/${T}`]: () => [
        200,
        {
          booking: booking({
            status: 'part_paid',
            amountPaidKobo: 1_950_000,
            balanceKobo: 4_550_000,
          }),
        },
      ],
    });
    renderAt(`/trip/${T}/confirm?reference=${REF}`);

    expect(await screen.findByText('Balance due')).toBeTruthy();
    expect(screen.getByText(/Pay by Sat 28 Nov/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pay balance now' }).getAttribute('href')).toBe(
      `/trip/${T}/pay`,
    );
    expect(screen.getByText('Deposits are non-refundable.')).toBeTruthy();
  });

  it('waits while the payment is unconfirmed', async () => {
    fakeApi({
      [`/public/bookings/${T}`]: () => [
        200,
        {
          booking: booking({
            status: 'held',
            payments: [
              {
                reference: REF,
                status: 'initiated',
                purpose: 'full',
                amountKobo: 6_500_000,
                paidAt: null,
              },
            ],
          }),
        },
      ],
    });
    renderAt(`/trip/${T}/confirm?reference=${REF}`);
    expect(await screen.findByText('Confirming your payment…')).toBeTruthy();
  });

  it('declined with the hold still on: no money taken, Try again goes back to review', async () => {
    fakeApi({
      [`/public/bookings/${T}`]: () => [
        200,
        {
          booking: booking({
            status: 'held',
            amountPaidKobo: 0,
            balanceKobo: 6_500_000,
            holdExpiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
            payments: [
              {
                reference: REF,
                status: 'failed',
                purpose: 'full',
                amountKobo: 6_500_000,
                paidAt: null,
              },
            ],
          }),
        },
      ],
    });
    renderAt(`/trip/${T}/confirm?reference=${REF}`);

    expect(await screen.findByText('Your payment didn’t go through')).toBeTruthy();
    expect(
      screen.getByText(/No money was taken. Your seats are still held for about 9 minutes/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(
      '/irin/badagry/book/review',
    );
  });

  it('paid after the seats were released: says what happens next', async () => {
    fakeApi({
      [`/public/bookings/${T}`]: () => [200, { booking: booking({ status: 'cancelled' }) }],
    });
    renderAt(`/trip/${T}/confirm?reference=${REF}`);
    expect(
      await screen.findByText('We got your payment after your seats were released'),
    ).toBeTruthy();
    expect(screen.getByText(/full refund of ₦65,000/)).toBeTruthy();
  });
});

describe('F: pay your balance', () => {
  it('shows what was paid and when, and pays the "balance" option', async () => {
    const calls = fakeApi({
      [`/public/bookings/${T}/pay`]: () => [
        201,
        { payment: { authorizationUrl: 'https://checkout.example/b' } },
      ],
      [`/public/bookings/${T}`]: () => [
        200,
        {
          booking: booking({
            status: 'part_paid',
            amountPaidKobo: 1_950_000,
            balanceKobo: 4_550_000,
            paymentOptions: [{ type: 'balance', amountKobo: 4_550_000 }],
            payments: [
              {
                reference: REF,
                status: 'succeeded',
                purpose: 'deposit',
                amountKobo: 1_950_000,
                paidAt: '2026-11-17T10:00:00Z',
              },
            ],
          }),
        },
      ],
    });
    renderAt(`/trip/${T}/pay`);

    expect(await screen.findByText('Paid on Tue 17 Nov')).toBeTruthy();
    expect(screen.getByText('Due by Sat 28 Nov')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₦45,500' }));

    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith('https://checkout.example/b'),
    );
    expect(calls.find((c) => c.path.endsWith('/pay')).body).toEqual({
      option: 'balance',
      method: 'any',
    });
  });
});

describe('E: payment link page', () => {
  const L = 'L'.repeat(32);
  const link = (state, extra = {}) => ({
    state,
    amountKobo: 4_550_000,
    purpose: 'balance',
    operator: { slug: 'irin', name: 'Ìrìn Lagos Tours' },
    tour: { title: 'Badagry Heritage Day Trip' },
    departure: { localDate: '2026-12-05', localTime: '07:00' },
    reference: 'ILT-3MZ8RB',
    expiresOn: '2026-11-24',
    paidOn: null,
    ...extra,
  });
  const linkApi = (
    l,
    payReply = [201, { payment: { authorizationUrl: 'https://checkout.example/l' } }],
  ) =>
    fakeApi({
      [`/public/payment-links/${L}/pay`]: () => payReply,
      [`/public/payment-links/${L}`]: () => [200, { link: l }],
    });

  it('back from Paystack, no webhook: from 8 s it asks Paystack itself, then shows paid', async () => {
    const start = Date.now();
    let waited = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => start + waited);
    let paid = false;
    const paidLink = () => link('paid', { paidOn: '2026-11-18' });
    const calls = fakeApi({
      [`/public/payment-links/${L}/check`]: () => {
        paid = true; // the provider said yes
        return [200, { link: paidLink() }];
      },
      [`/public/payment-links/${L}`]: () => [200, { link: paid ? paidLink() : link('open') }],
    });
    renderAt(`/pay/${L}/done`);

    expect(await screen.findByText('Confirming your payment…')).toBeTruthy();
    // One 2-second round goes by with only a look at the link (the webhook's turn first).
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(1), {
      timeout: 4_000,
    });
    expect(calls.some((c) => c.path.endsWith('/check'))).toBe(false); // the webhook's turn first
    waited = 9_000;
    expect(
      await screen.findByText('This link has been paid. Thank you!', {}, { timeout: 5_000 }),
    ).toBeTruthy();
    expect(calls.filter((c) => c.path.endsWith('/check'))).toHaveLength(1);
    clock.mockRestore();
  });

  it('open: the amount and facts, no personal details, and Pay', async () => {
    linkApi(link('open'));
    renderAt(`/pay/${L}`);

    expect(await screen.findByRole('heading', { name: 'Pay your balance' })).toBeTruthy();
    expect(screen.getByText('until Tue 24 Nov')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pay ₦45,500' }));
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith('https://checkout.example/l'),
    );
  });

  it('paid: thanks, and the trip page button only if this phone knows the trip', async () => {
    linkApi(link('paid', { paidOn: '2026-11-23' }));
    renderAt(`/pay/${L}`);
    expect(await screen.findByText('This link has been paid. Thank you!')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open your trip page' })).toBeNull();
    cleanup();

    rememberTrip('ILT-3MZ8RB', T);
    linkApi(link('paid', { paidOn: '2026-11-23' }));
    renderAt(`/pay/${L}`);
    expect(
      (await screen.findByRole('link', { name: 'Open your trip page' })).getAttribute('href'),
    ).toBe(`/trip/${T}`);
  });

  it.each([
    ['expired', 'This link has expired'],
    ['cancelled', 'This link is no longer active'],
    ['out_of_date', 'This link is out of date'],
  ])('%s says so', async (state, title) => {
    linkApi(link(state));
    renderAt(`/pay/${L}`);
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull();
  });

  it('payment service down: says so, with Try again', async () => {
    linkApi(link('open'), [502, { error: { code: 'PROVIDER_ERROR', message: 'busy' } }]);
    renderAt(`/pay/${L}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Pay ₦45,500' }));
    expect(await screen.findByText('Payment is temporarily unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('a link that never existed', async () => {
    fakeApi({
      [`/public/payment-links/${L}`]: () => [404, { error: { code: 'NOT_FOUND', message: 'x' } }],
    });
    renderAt(`/pay/${L}`);
    expect(await screen.findByText('This payment link doesn’t exist')).toBeTruthy();
  });
});
