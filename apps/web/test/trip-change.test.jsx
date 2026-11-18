/**
 * Change or cancel (stage 12f-2) with a fake API and a fixed clock: the two choices, cancel
 * yourself (refund first, one request, the refund changed, the provider refusing), not on the
 * day, ask the operator, and the trip hub's "request sent" banner and Change button.
 * The Heritage Walk: Sat 5 Dec 2026, 09:00 Lagos. ₦62,500 paid.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Router, Route, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { ChangeOrCancel, CancelBooking, AskOperator } from '../src/screens/trip/TripChange.jsx';
import { TripHub } from '../src/screens/trip/TripHub.jsx';

const T = 'T'.repeat(44);
const trip = (over = {}) => ({
  reference: 'ILT-7K4Q2M',
  status: 'paid',
  operator: {
    slug: 'irin',
    name: 'Ìrìn Lagos Tours',
    timeZone: 'Africa/Lagos',
    phone: null,
    whatsapp: null,
  },
  tour: {
    slug: 'heritage',
    title: 'Heritage Walk',
    durationMinutes: 180,
    meetingPoint: { name: 'Tinubu Square', address: 'Broad Street' },
    whatToBring: [],
    stops: [],
    arriveMinutesEarly: null,
  },
  departure: {
    startsAt: '2026-12-05T08:00:00.000Z',
    endsAt: '2026-12-05T11:00:00.000Z',
    localDate: '2026-12-05',
    localTime: '09:00',
  },
  pickupPoint: null,
  lead: { name: 'Adaeze Okafor', email: 'adaeze@guest.example', phone: '+2348031234567' },
  travellers: [
    { name: 'Adaeze Okafor', age: 34, categoryKey: 'adult', dietaryNeeds: '' },
    { name: 'Chidi Okafor', age: 36, categoryKey: 'adult', dietaryNeeds: '' },
    { name: 'Kamsi Okafor', age: 8, categoryKey: 'child', dietaryNeeds: '' },
  ],
  quote: { lines: [] },
  totalKobo: 6_250_000,
  amountPaidKobo: 6_250_000,
  depositPaidKobo: 0,
  balanceKobo: 0,
  balanceDueDate: null,
  payments: [],
  cancellationPolicy: {
    rules: [
      { hoursBefore: 48, refundBasisPoints: 10_000 },
      { hoursBefore: 24, refundBasisPoints: 5_000 },
      { hoursBefore: 0, refundBasisPoints: 0 },
    ],
    noShowRefundBasisPoints: 0,
    depositRefundable: false,
  },
  ticket: null,
  cancellation: null,
  refunds: [],
  openRequests: [],
  ...over,
});
const at = (local) => new Date(`${local.replace(' ', 'T')}:00+01:00`);
/** 30 hours before the start: the 50% tier, as in the design. */
const THIRTY_HOURS_BEFORE = '2026-12-04 03:00';

/** Fake API by path ending; records calls. @param {Record<string, (body: any) => [number, any] | Promise<[number, any]>>} routes */
function fakeApi(routes) {
  const calls = [];
  vi.stubGlobal('fetch', async (path, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method ?? 'GET', body });
    for (const [end, handler] of Object.entries(routes)) {
      if (path.endsWith(end)) {
        const [status, json] = await handler(body);
        return new Response(JSON.stringify(json), { status });
      }
    }
    return new Response(JSON.stringify({ booking: trip() }), { status: 200 });
  });
  return calls;
}
function renderAt(path) {
  const memory = memoryLocation({ path, record: true });
  render(
    <Router hook={memory.hook}>
      <Switch>
        <Route path="/trip/:token/change" component={ChangeOrCancel} />
        <Route path="/trip/:token/cancel" component={CancelBooking} />
        <Route path="/trip/:token/ask" component={AskOperator} />
        <Route path="/trip/:token" component={TripHub} />
      </Switch>
    </Router>,
  );
  return memory;
}

beforeEach(() => {
  localStorage.clear();
  // Only Date's clock is fixed; timers stay real so the screens' requests resolve.
  vi.useFakeTimers({ toFake: ['Date'], now: at(THIRTY_HOURS_BEFORE) });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('1 · Change or cancel', () => {
  it('two choices side by side, and why the refund is what it is', async () => {
    fakeApi({});
    renderAt(`/trip/${T}/change`);
    const cancelNow = await screen.findByRole('link', { name: /Cancel now/ });
    expect(cancelNow.getAttribute('href')).toBe(`/trip/${T}/cancel`);
    expect(cancelNow.textContent).toContain('Instant');
    expect(cancelNow.textContent).toContain('You get ₦31,250 back.');
    const askLink = screen.getByRole('link', { name: /Ask Ìrìn/ });
    expect(askLink.textContent).toContain('Reply in a few hours');
    expect(screen.getByText('Why ₦31,250?')).toBeTruthy();
    expect(
      screen.getByText(
        'Your trip is 30 hours away. Between 24 and 48 hours before, the policy gives 50% back. After Fri 4 Dec, 09:00 it gives nothing.',
      ),
    ).toBeTruthy();
  });

  it('not on the day of the trip: contact the operator instead', async () => {
    vi.setSystemTime(at('2026-12-05 07:30'));
    fakeApi({});
    renderAt(`/trip/${T}/cancel`);
    expect(await screen.findByText('Please contact Ìrìn')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
  });
});

describe('2–3 · Cancel yourself', () => {
  it('shows the refund first, sends the amount shown, once, and says it’s on its way', async () => {
    let release;
    const calls = fakeApi({
      '/cancel': () =>
        new Promise((r) => {
          release = () =>
            r([
              200,
              {
                refundKobo: 3_125_000,
                refundStarted: true,
                booking: trip({ status: 'cancelled' }),
              },
            ]);
        }),
    });
    renderAt(`/trip/${T}/cancel`);

    expect(await screen.findByText('Cancel your Heritage Walk on Sat 5 Dec?')).toBeTruthy();
    expect(screen.getByText('Refund (50%)')).toBeTruthy();
    expect(
      screen.getByText(
        'You’ll get ₦31,250 back (50%) because the trip is in 30 hours. It goes back to the card or account you paid with.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/All 3 travellers are cancelled\./)).toBeTruthy();

    const button = screen.getByRole('button', { name: 'Cancel and get ₦31,250 back' });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByRole('button', { name: 'Cancelling…' });
    release();

    expect(await screen.findByText('Your ₦31,250 refund is on its way.')).toBeTruthy();
    const posts = calls.filter((c) => c.path.endsWith('/cancel'));
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ expectRefundKobo: 3_125_000 });
    expect(screen.getByRole('link', { name: 'Book another date' }).getAttribute('href')).toBe(
      '/irin/heritage',
    );
  });

  it('the refund changed meanwhile: nothing cancelled, the new amount is shown to check', async () => {
    let first = true;
    fakeApi({
      '/cancel': () => [
        409,
        { error: { code: 'REFUND_CHANGED', message: 'The refund has changed.', refundKobo: 0 } },
      ],
      [`/public/bookings/${T}`]: () => {
        // The second load (after the 409) is a moment later: under 24 hours now.
        if (!first) vi.setSystemTime(at('2026-12-04 09:30'));
        first = false;
        return [200, { booking: trip() }];
      },
    });
    renderAt(`/trip/${T}/cancel`);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel and get ₦31,250 back' }));

    expect(
      await screen.findByText(/Time has moved on: the refund is now ₦0\. Nothing was cancelled\./),
    ).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Cancel booking' })).toBeTruthy();
  });

  it('the provider refused the refund just now: it’s owed, and the operator will send it', async () => {
    fakeApi({
      '/cancel': () => [200, { refundKobo: 3_125_000, refundStarted: false, booking: trip() }],
    });
    renderAt(`/trip/${T}/cancel`);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel and get ₦31,250 back' }));
    expect(await screen.findByText('₦31,250 is owed back to you.')).toBeTruthy();
    expect(
      screen.getByText('Ìrìn will send it. It can take 5–10 working days to appear.'),
    ).toBeTruthy();
  });

  it('offline: says nothing was cancelled', async () => {
    fakeApi({ '/cancel': () => Promise.reject(new TypeError('Failed to fetch')) });
    renderAt(`/trip/${T}/cancel`);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel and get ₦31,250 back' }));
    expect(
      await screen.findByText(
        'You’re offline. Nothing was cancelled. Please try again.'.replace('’', "'"),
      ),
    ).toBeTruthy();
  });
});

describe('Ask the operator', () => {
  it('chooses, writes, sends; the message is required; "Ask instead" starts on Cancel', async () => {
    const calls = fakeApi({ '/requests': () => [201, { booking: trip() }] });
    renderAt(`/trip/${T}/ask?kind=cancel`);

    expect((await screen.findByRole('radio', { name: 'Cancel' })).checked).toBe(true);
    expect(screen.getByText('Replies go to 0803 123 4567 and adaeze@guest.example.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send to Ìrìn' }));
    expect(await screen.findByText('Write a short message.')).toBeTruthy();
    expect(calls.some((c) => c.path.endsWith('/requests'))).toBe(false);

    fireEvent.click(screen.getByRole('radio', { name: 'Change the date' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Your message/ }), {
      target: { value: '  Can we move to Sun 6 Dec?  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Ìrìn' }));

    expect(await screen.findByText('Ìrìn will reply by WhatsApp or email.')).toBeTruthy();
    expect(calls.find((c) => c.path.endsWith('/requests')).body).toEqual({
      kind: 'change_date',
      message: 'Can we move to Sun 6 Dec?',
    });
  });

  it('too many waiting: the server’s words, and the message is kept', async () => {
    fakeApi({
      '/requests': () => [
        409,
        {
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'You already have requests waiting for a reply.',
          },
        },
      ],
    });
    renderAt(`/trip/${T}/ask`);
    const box = await screen.findByRole('textbox', { name: /Your message/ });
    fireEvent.change(box, { target: { value: 'Hello again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Ìrìn' }));
    expect(await screen.findByText('You already have requests waiting for a reply.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Your message/ }).value).toBe('Hello again');
  });
});

describe('back on the trip hub', () => {
  it('an open request has its banner; Change or cancel is a button to the choices', async () => {
    vi.setSystemTime(at('2026-12-01 12:00'));
    fakeApi({
      [`/public/bookings/${T}`]: () => [
        200,
        {
          booking: trip({
            openRequests: [
              {
                kind: 'change_date',
                message: 'Can we move to Sun 6 Dec?',
                createdAt: '2026-12-01T10:00:00Z',
              },
            ],
          }),
        },
      ],
    });
    renderAt(`/trip/${T}`);
    expect(await screen.findByText('Your request was sent on Tue 1 Dec')).toBeTruthy();
    expect(screen.getByText(/“Can we move to Sun 6 Dec\?” Ìrìn will reply/)).toBeTruthy();
    expect(screen.queryByText('See you on Sat 5 Dec!')).toBeNull(); // the request banner instead
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: 'Change or cancel this booking' }).getAttribute('href'),
      ).toBe(`/trip/${T}/change`),
    );
  });
});
