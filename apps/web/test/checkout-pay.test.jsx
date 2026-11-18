/**
 * Checkout steps 3–4 with a fake API: holding seats, the server's errors, the deposit choice,
 * paying, and the hold running out.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Router, Route, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { Details } from '../src/screens/checkout/Details.jsx';
import { Review } from '../src/screens/checkout/Review.jsx';
import { resetEmbedded } from '../src/lib/data.js';
import { EmbedFrame } from '../src/screens/embed/Embed.jsx';

const operator = { slug: 'irin', name: 'Ìrìn Lagos Tours', timeZone: 'Africa/Lagos' };
const tour = {
  slug: 'badagry',
  title: 'Badagry Heritage Day Trip',
  durationMinutes: 600,
  meetingPoint: { name: 'Ìrìn office, Yaba', address: 'Commercial Avenue' },
  pickupPoints: [],
  addOns: [],
  priceCategories: [
    { key: 'adult', name: 'Adult (13+)', minAge: 13, maxAge: null, amountKobo: 6_500_000 },
  ],
  cancellationPolicy: {
    rules: [
      { hoursBefore: 48, refundBasisPoints: 10_000 },
      { hoursBefore: 0, refundBasisPoints: 0 },
    ],
    noShowRefundBasisPoints: 0,
    depositRefundable: false,
  },
};
const departure = {
  id: 'd1',
  startsAt: '2026-12-05T06:00:00Z',
  localDate: '2026-12-05',
  localTime: '07:00',
  seatsAvailable: 14,
};
const filled = {
  departure,
  counts: { adult: 1 },
  addOns: {},
  pickup: null,
  lead: { name: 'Funmi Adeyemi', email: '', phone: '0805 987 6543', marketingConsent: false },
  travellers: [{ name: 'Funmi Adeyemi', age: '41', dietaryNeeds: '' }],
  payOption: 'full',
  booking: null,
};
/** The guest view of a held Badagry booking, as GET /public/bookings/:token returns it. */
const heldBooking = (overrides = {}) => ({
  reference: 'ILT-3MZ8RB',
  status: 'held',
  tour: { title: tour.title, meetingPoint: tour.meetingPoint },
  departure,
  pickupPoint: null,
  lead: { name: 'Funmi Adeyemi', email: null, phone: '+2348059876543' },
  travellers: [{ name: 'Funmi Adeyemi', age: 41, categoryKey: 'adult', dietaryNeeds: '' }],
  quote: {
    lines: [
      {
        type: 'ticket',
        categoryKey: 'adult',
        label: 'Adult (13+)',
        quantity: 1,
        totalKobo: 6_500_000,
      },
    ],
    tax: { name: 'VAT', inclusive: true },
    taxKobo: 453_500,
  },
  totalKobo: 6_500_000,
  holdExpiresAt: new Date(Date.now() + 13 * 60_000).toISOString(),
  paymentOptions: [
    { type: 'full', amountKobo: 6_500_000 },
    {
      type: 'deposit',
      amountKobo: 1_950_000,
      balanceKobo: 4_550_000,
      balanceDueDate: '2026-11-28',
    },
  ],
  cancellationPolicy: tour.cancellationPolicy,
  payments: [],
  ...overrides,
});

/** Fake API: answers by path; records requests. `routes` maps a path start to a handler. */
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
        return new Response(body === null ? null : JSON.stringify(body), { status });
      }
    }
    return Response.json({ operator, tour });
  });
  return calls;
}

function renderAt(path) {
  const memory = memoryLocation({ path, record: true });
  render(
    <Router hook={memory.hook}>
      <Switch>
        <Route path="/:operator/:tour/book/review" component={Review} />
        <Route path="/:operator/:tour/book/details" component={Details} />
      </Switch>
    </Router>,
  );
  return memory;
}
const KEY = 'okg-checkout:irin/badagry';

beforeEach(() => {
  resetEmbedded();
  sessionStorage.clear();
  vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('step 3: Continue to payment', () => {
  it('holds the seats, keeps the booking token, and opens step 4', async () => {
    sessionStorage.setItem(KEY, JSON.stringify(filled));
    const calls = fakeApi({
      '/public/irin/bookings': () => [201, { token: 'T'.repeat(44), booking: heldBooking() }],
      '/public/bookings/': () => [200, { booking: heldBooking() }],
    });
    const memory = renderAt('/irin/badagry/book/details');

    fireEvent.click(await screen.findByRole('checkbox', { name: /I accept the booking terms/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    await waitFor(() => expect(memory.history.at(-1)).toBe('/irin/badagry/book/review'));
    const sent = calls.find((c) => c.path === '/public/irin/bookings').body;
    expect(sent).toMatchObject({
      departureId: 'd1',
      lead: { name: 'Funmi Adeyemi', phone: '0805 987 6543', acceptTerms: true },
      travellers: [{ name: 'Funmi Adeyemi', age: 41, categoryKey: 'adult' }],
    });
    expect(JSON.parse(sessionStorage.getItem(KEY)).booking.token).toBe('T'.repeat(44));
  });

  it('after going back and changing something, the old hold is given back first', async () => {
    // A booking was held, then the guest changed the date: its key no longer matches.
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...filled, booking: { token: 'O'.repeat(44), key: 'old' } }),
    );
    const calls = fakeApi({
      '/public/bookings/OOOO': () => [204, null],
      '/public/irin/bookings': () => [201, { token: 'T'.repeat(44), booking: heldBooking() }],
      '/public/bookings/TTTT': () => [200, { booking: heldBooking() }],
    });
    renderAt('/irin/badagry/book/details');

    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }));

    await waitFor(() => expect(calls.some((c) => c.path === '/public/irin/bookings')).toBe(true));
    const order = calls.map((c) => c.path);
    expect(order.indexOf(`/public/bookings/${'O'.repeat(44)}/release`)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(`/public/bookings/${'O'.repeat(44)}/release`)).toBeLessThan(
      order.indexOf('/public/irin/bookings'),
    );
  });

  it("shows the server's field error under the field, and holds nothing", async () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...filled, lead: { ...filled.lead, phone: '0803 123 45' } }),
    );
    fakeApi({
      '/public/irin/bookings': () => [
        400,
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Some fields are invalid',
            issues: [
              {
                path: 'lead.phone',
                message: 'Enter 11 digits like 0803 123 4567, or start with +234.',
              },
            ],
          },
        },
      ],
    });
    renderAt('/irin/badagry/book/details');

    fireEvent.click(await screen.findByRole('checkbox', { name: /I accept the booking terms/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    expect(
      await screen.findByText('Enter 11 digits like 0803 123 4567, or start with +234.'),
    ).toBeTruthy();
    expect(screen.getByText('1 thing to fix before you continue.')).toBeTruthy();
    expect(screen.getByLabelText('Phone (WhatsApp)').getAttribute('aria-invalid')).toBe('true');
  });

  it('seats ran out while filling in: says how many are left, details kept', async () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...filled, counts: { adult: 3 }, travellers: [] }),
    );
    fakeApi({
      '/public/irin/bookings': () => [
        409,
        { error: { code: 'SOLD_OUT', message: 'Only 1 seats left.', seatsAvailable: 1 } },
      ],
    });
    renderAt('/irin/badagry/book/details');
    const names = await screen.findAllByLabelText('Full name');
    names.slice(1).forEach((el, i) => fireEvent.change(el, { target: { value: `Guest ${i}` } }));
    screen
      .getAllByLabelText('Age')
      .forEach((el) => fireEvent.change(el, { target: { value: '30' } }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I accept the booking terms/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    expect(await screen.findByText('Sorry, only 1 seat is left now')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Book 1 traveller instead' })).toBeTruthy();
    expect(screen.getAllByLabelText('Full name')[0].value).toBe('Funmi Adeyemi'); // kept
  });
});

describe('step 4: review and pay', () => {
  const withBooking = (extra = {}) =>
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...filled, booking: { token: 'T'.repeat(44), key: 'k' }, ...extra }),
    );

  it('offers the deposit, and pays the option chosen (never an amount)', async () => {
    withBooking();
    const calls = fakeApi({
      '/public/bookings/TTTT': (path) =>
        path.endsWith('/pay')
          ? [201, { payment: { authorizationUrl: 'https://checkout.example/abc' } }]
          : [200, { booking: heldBooking() }],
    });
    renderAt('/irin/badagry/book/review');

    expect(await screen.findByText(/Pay a 30% deposit now: ₦19,500/)).toBeTruthy();
    expect(screen.getByText('Deposits are non-refundable.')).toBeTruthy();
    expect(screen.getByText(/0805 987 6543/)).toBeTruthy(); // the phone, the way people write it
    fireEvent.click(screen.getByRole('radio', { name: /deposit/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pay deposit ₦19,500' }));

    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith('https://checkout.example/abc'),
    );
    const pay = calls.find((c) => c.path.endsWith('/pay'));
    expect(pay.body).toEqual({ option: 'deposit', method: 'any' });
  });

  it('a second tap does nothing while the payment is being set up', async () => {
    withBooking();
    let release;
    const calls = fakeApi({
      '/public/bookings/TTTT': (path) =>
        path.endsWith('/pay')
          ? new Promise(
              (r) => (release = () => r([201, { payment: { authorizationUrl: 'https://x' } }])),
            )
          : [200, { booking: heldBooking() }],
    });
    renderAt('/irin/badagry/book/review');
    const button = await screen.findByRole('button', { name: 'Pay ₦65,000' });

    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByRole('button', { name: 'Setting up your payment…' });
    release();

    await waitFor(() => expect(window.location.assign).toHaveBeenCalledTimes(1));
    expect(calls.filter((c) => c.path.endsWith('/pay'))).toHaveLength(1);
  });

  describe('back from Paystack without its redirect (back button, closed tab)', () => {
    const open = { reference: 'OKG-ABCDEFGH12', status: 'initiated', purpose: 'full' };

    it('the payment went through: asks Paystack, then shows the confirmation', async () => {
      withBooking();
      const calls = fakeApi({
        '/public/bookings/TTTT': (path) =>
          path.endsWith('/check')
            ? [200, { status: 'succeeded' }]
            : [200, { booking: heldBooking({ payments: [open] }) }],
      });
      const memory = renderAt('/irin/badagry/book/review');

      await waitFor(() =>
        expect(memory.history.at(-1)).toBe(
          `/trip/${'T'.repeat(44)}/confirm?reference=OKG-ABCDEFGH12`,
        ),
      );
      expect(calls.filter((c) => c.path.endsWith('/OKG-ABCDEFGH12/check'))).toHaveLength(1);
      expect(calls.some((c) => c.path.endsWith('/pay'))).toBe(false); // never paid twice
    });

    it('not paid (they came back to change something): Pay is offered again', async () => {
      withBooking();
      let answer;
      fakeApi({
        '/public/bookings/TTTT': (path) =>
          path.endsWith('/check')
            ? new Promise((r) => (answer = () => r([200, { status: 'initiated' }])))
            : [200, { booking: heldBooking({ payments: [open] }) }],
      });
      const memory = renderAt('/irin/badagry/book/review');

      const busy = await screen.findByRole('button', { name: 'Checking your payment…' });
      expect(busy.disabled).toBe(true);
      answer();
      expect(await screen.findByRole('button', { name: 'Pay ₦65,000' })).toBeTruthy();
      expect(memory.history.at(-1)).toBe('/irin/badagry/book/review');
    });

    it('already booked (the webhook got there first): straight to the confirmation', async () => {
      withBooking();
      fakeApi({
        '/public/bookings/TTTT': () => [200, { booking: heldBooking({ status: 'paid' }) }],
      });
      const memory = renderAt('/irin/badagry/book/review');
      await waitFor(() => expect(memory.history.at(-1)).toBe(`/trip/${'T'.repeat(44)}/confirm`));
    });
  });

  describe('inside the booking widget (stage 12h)', () => {
    const renderEmbedded = (path) => {
      const memory = memoryLocation({ path, record: true });
      render(
        <Router hook={memory.hook}>
          <EmbedFrame>
            <Route path="/:operator/:tour/book/review" component={Review} />
          </EmbedFrame>
        </Router>,
      );
      return memory;
    };

    it('while Paystack is open in the other tab, it watches; once paid, the frame shows the confirmation', async () => {
      withBooking();
      vi.stubGlobal(
        'open',
        vi.fn(() => ({ opener: {}, location: { href: '' }, close: vi.fn() })),
      );
      let paid = false;
      fakeApi({
        '/public/bookings/TTTT': (path) =>
          path.endsWith('/pay')
            ? [201, { payment: { authorizationUrl: 'https://checkout.example/w' } }]
            : [200, { booking: heldBooking(paid ? { status: 'paid' } : {}) }],
      });
      const memory = renderEmbedded('/irin/badagry/book/review');
      fireEvent.click(await screen.findByRole('button', { name: 'Pay ₦65,000' }));
      expect(await screen.findByText('Paystack is open in a new tab')).toBeTruthy();

      paid = true; // the guest pays in the other tab; the webhook confirms the booking
      await waitFor(() => expect(memory.history.at(-1)).toBe(`/trip/${'T'.repeat(44)}/confirm`), {
        timeout: 6_000,
      });
    });

    it('says Paystack opens in a new tab, opens it AT THE TAP, then sends it to Paystack', async () => {
      withBooking();
      const tab = { opener: /** @type {any} */ ({}), location: { href: '' }, close: vi.fn() };
      const open = vi.fn(() => tab);
      vi.stubGlobal('open', open);
      let answer;
      fakeApi({
        '/public/bookings/TTTT': (path) =>
          path.endsWith('/pay')
            ? new Promise(
                (r) =>
                  (answer = () =>
                    r([201, { payment: { authorizationUrl: 'https://checkout.example/w' } }])),
              )
            : [200, { booking: heldBooking() }],
      });
      renderEmbedded('/irin/badagry/book/review');

      expect(
        await screen.findByText(
          'You’ll be taken to Paystack in a new tab to pay securely, then to your confirmation.',
        ),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Pay ₦65,000' }));
      // Opened during the tap, before the server answered (browsers block it later).
      expect(open).toHaveBeenCalledWith('', '_blank');
      answer();

      expect(await screen.findByText('Paystack is open in a new tab')).toBeTruthy();
      expect(tab.location.href).toBe('https://checkout.example/w');
      expect(tab.opener).toBeNull(); // Paystack's page gets no handle on the frame
      expect(window.location.assign).not.toHaveBeenCalled(); // the frame stays put
      expect(screen.getByRole('link', { name: 'Open Paystack again' }).getAttribute('href')).toBe(
        'https://checkout.example/w',
      );
    });

    it('if paying can’t start, the empty tab is closed again', async () => {
      withBooking();
      const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
      vi.stubGlobal(
        'open',
        vi.fn(() => tab),
      );
      fakeApi({
        '/public/bookings/TTTT': (path) =>
          path.endsWith('/pay')
            ? [502, { error: { code: 'PROVIDER_ERROR', message: 'down' } }]
            : [200, { booking: heldBooking() }],
      });
      renderEmbedded('/irin/badagry/book/review');
      fireEvent.click(await screen.findByRole('button', { name: 'Pay ₦65,000' }));
      expect(await screen.findByText('Payment is temporarily unavailable')).toBeTruthy();
      expect(tab.close).toHaveBeenCalled();
    });
  });

  it('payment service down: says so, seats still held, Try again', async () => {
    withBooking();
    fakeApi({
      '/public/bookings/TTTT': (path) =>
        path.endsWith('/pay')
          ? [502, { error: { code: 'PROVIDER_ERROR', message: 'down' } }]
          : [200, { booking: heldBooking() }],
    });
    renderAt('/irin/badagry/book/review');
    fireEvent.click(await screen.findByRole('button', { name: 'Pay ₦65,000' }));

    expect(await screen.findByText('Payment is temporarily unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Try again · Pay ₦65,000/ })).toBeTruthy();
  });

  it('when the hold has ended: says so, and holds the seats again with everything entered', async () => {
    withBooking();
    let held = false;
    const calls = fakeApi({
      '/public/bookings/TTTT': (path) =>
        path.endsWith('/release')
          ? [204, null]
          : [
              200,
              {
                booking: heldBooking({
                  holdExpiresAt: new Date(Date.now() - 1000).toISOString(),
                  paymentOptions: [],
                  status: 'cancelled',
                }),
              },
            ],
      '/public/irin/bookings': () => {
        held = true;
        return [201, { token: 'N'.repeat(44), booking: heldBooking() }];
      },
      '/public/bookings/NNNN': () => [200, { booking: heldBooking() }],
    });
    renderAt('/irin/badagry/book/review');

    expect(await screen.findByText('Your 15 minutes are up')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Pay/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Hold my seats again' }));

    await waitFor(() => expect(held).toBe(true));
    expect(calls.find((c) => c.path === '/public/irin/bookings').body.lead.name).toBe(
      'Funmi Adeyemi',
    );
    // Held again: the countdown is back (in both the phone and desktop headers).
    expect((await screen.findAllByText('Seats held')).length).toBeGreaterThan(0);
  });
});
