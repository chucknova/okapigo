/**
 * The trip hub (stage 12f-1) with a fake API and a fixed clock: upcoming, trip day, balance
 * due and overdue, after, cancelled by the operator, refunded, offline from the saved copy,
 * the checklist, and a link that doesn't exist.
 * Times are Lagos (UTC+1). The Heritage Walk: Sat 5 Dec 2026, 09:00–12:00.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { TripHub } from '../src/screens/trip/TripHub.jsx';
import { saveTrip, savedTrip } from '../src/lib/trip-copy.js';

const T = 'T'.repeat(44);
const POLICY = {
  rules: [
    { hoursBefore: 48, refundBasisPoints: 10_000 },
    { hoursBefore: 24, refundBasisPoints: 5_000 },
    { hoursBefore: 0, refundBasisPoints: 0 },
  ],
  noShowRefundBasisPoints: 0,
  depositRefundable: false,
};
const trip = (over = {}) => ({
  reference: 'ILT-7K4Q2M',
  status: 'paid',
  operator: {
    slug: 'irin',
    name: 'Ìrìn Lagos Tours',
    timeZone: 'Africa/Lagos',
    phone: '+2348090000123',
    whatsapp: '+2348090000123',
  },
  tour: {
    slug: 'heritage',
    title: 'Lagos Island Heritage Walk',
    durationMinutes: 180,
    meetingPoint: {
      name: 'Tinubu Square',
      address: 'Broad Street, Lagos Island',
      note: 'Look for the guide in the green Ìrìn cap, by the fountain.',
      lat: 6.4541,
      lng: 3.3893,
    },
    whatToBring: ['Comfortable walking shoes', 'A hat or umbrella'],
    stops: ['Tinubu Square', 'Freedom Park'],
    arriveMinutesEarly: 10,
  },
  departure: {
    startsAt: '2026-12-05T08:00:00.000Z',
    endsAt: '2026-12-05T11:00:00.000Z',
    localDate: '2026-12-05',
    localTime: '09:00',
  },
  pickupPoint: null,
  lead: { name: 'Adaeze Okafor', email: 'adaeze@guest.example', phone: null },
  travellers: [
    { name: 'Adaeze Okafor', age: 34, categoryKey: 'adult', dietaryNeeds: '' },
    { name: 'Kamsi Okafor', age: 8, categoryKey: 'child', dietaryNeeds: 'No peanuts' },
  ],
  quote: {
    lines: [
      {
        type: 'ticket',
        categoryKey: 'adult',
        label: 'Adult (13+)',
        quantity: 1,
        totalKobo: 2_500_000,
      },
      {
        type: 'ticket',
        categoryKey: 'child',
        label: 'Child (3–12)',
        quantity: 1,
        totalKobo: 1_250_000,
      },
    ],
  },
  totalKobo: 3_750_000,
  amountPaidKobo: 3_750_000,
  depositPaidKobo: 0,
  balanceKobo: 0,
  balanceDueDate: null,
  paymentOptions: [],
  payments: [
    {
      reference: 'OKG-A',
      status: 'succeeded',
      purpose: 'full',
      amountKobo: 3_750_000,
      paidAt: '2026-11-17T10:00:00Z',
    },
  ],
  cancellationPolicy: POLICY,
  ticket: { code: 'OKG1' + 'x'.repeat(38), qr: { size: 2, path: 'M0 0h1v1h-1z' } },
  cancellation: null,
  refunds: [],
  ...over,
});
const at = (local) => new Date(`${local.replace(' ', 'T')}:00+01:00`).getTime();

/** @param {any} reply  [status, body], or 'offline' */
function fakeApi(reply) {
  vi.stubGlobal('fetch', async () => {
    if (reply === 'offline') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(reply[1]), { status: reply[0] });
  });
}
function renderHub() {
  const memory = memoryLocation({ path: `/trip/${T}` });
  render(
    <Router hook={memory.hook}>
      <Route path="/trip/:token" component={TripHub} />
    </Router>,
  );
}
const clock = (local) => vi.spyOn(Date, 'now').mockReturnValue(at(local));

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('before the trip', () => {
  it('upcoming: banner, countdown, ticket, meeting point, route, travellers, payment', async () => {
    clock('2026-11-17 10:00');
    fakeApi([200, { booking: trip() }]);
    renderHub();

    expect(await screen.findByText('See you on Sat 5 Dec!')).toBeTruthy();
    expect(screen.getByText('In 18 days')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'QR ticket for booking ILT-7K4Q2M' })).toBeTruthy();
    expect(screen.getByText('2 travellers · show this to your guide')).toBeTruthy();
    // Meeting point, the note, and "Arrive by" 10 minutes before 09:00.
    expect(
      screen.getByText(
        'Broad Street, Lagos Island. Look for the guide in the green Ìrìn cap, by the fountain. Arrive by 08:50.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Google Maps' }).getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=6.4541,3.3893',
    );
    expect(screen.getByText('Kamsi Okafor').textContent).toContain('Kamsi Okafor');
    expect(screen.getByText('· Child · No peanuts')).toBeTruthy();
    expect(screen.getByText('₦37,500 · paid on Tue 17 Nov')).toBeTruthy();
    expect(screen.getByText('Paid in full')).toBeTruthy();
    // Contact: WhatsApp first on ordinary days.
    const contact = screen.getByRole('region', { name: 'Contact Ìrìn' });
    const [first, second] = within(contact).getAllByRole('link');
    expect(first.getAttribute('href')).toBe('https://wa.me/2348090000123');
    expect(second.getAttribute('href')).toBe('tel:+2348090000123');
    // What cancelling now gives back, from the policy.
    expect(screen.getByText(/If you cancel now you’ll get/).textContent).toBe(
      'If you cancel now you’ll get ₦37,500 back (full refund until Thu 3 Dec, 09:00).',
    );
  });

  it('balance due by Sat 28 Nov, then overdue: the Pay button goes to pay the balance', async () => {
    const deposit = trip({
      amountPaidKobo: 1_125_000,
      depositPaidKobo: 1_125_000,
      balanceKobo: 2_625_000,
      balanceDueDate: '2026-11-28',
    });
    clock('2026-11-17 10:00');
    fakeApi([200, { booking: deposit }]);
    renderHub();
    expect(await screen.findByText('Balance of ₦26,250 due by Sat 28 Nov')).toBeTruthy();
    expect(screen.getByText('Deposit of ₦11,250 paid. Your seat is booked.')).toBeTruthy();
    const pays = screen.getAllByRole('link', { name: 'Pay ₦26,250' });
    expect(pays[0].getAttribute('href')).toBe(`/trip/${T}/pay`);
    // A kept deposit: nothing back yet if they cancel, and it says why.
    expect(screen.getByText(/If you cancel now, nothing is refunded/).textContent).toContain(
      'The ₦11,250 deposit isn’t refundable.',
    );
    cleanup();

    clock('2026-11-30 10:00');
    fakeApi([200, { booking: deposit }]);
    renderHub();
    expect(await screen.findByText('Your balance of ₦26,250 was due on Sat 28 Nov')).toBeTruthy();
    expect(
      screen.getByText('Your booking is still on. Please pay now or message Ìrìn.'),
    ).toBeTruthy();
  });

  it('ticks on the checklist are kept on this phone', async () => {
    clock('2026-11-17 10:00');
    fakeApi([200, { booking: trip() }]);
    renderHub();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'A hat or umbrella' }));
    cleanup();

    renderHub();
    expect((await screen.findByRole('checkbox', { name: 'A hat or umbrella' })).checked).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Comfortable walking shoes' }).checked).toBe(false);
  });
});

describe('on the day and after', () => {
  it('trip day: the dark band, the ticket with the lead’s name, Call first, no cancelling', async () => {
    clock('2026-12-05 08:12');
    fakeApi([200, { booking: trip() }]);
    renderHub();

    expect(await screen.findByText('Starts at 09:00 · Meet at Tinubu Square')).toBeTruthy();
    expect(screen.getByText('2 travellers · Adaeze Okafor')).toBeTruthy();
    expect(screen.getByText('Turn your screen brightness up. Works without signal.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Directions in Google Maps' })).toBeTruthy();
    const help = screen.getByRole('region', { name: 'Running late or can’t find us?' });
    expect(within(help).getAllByRole('link')[0].getAttribute('href')).toBe('tel:+2348090000123');
    expect(screen.queryByText('Change or cancel')).toBeNull();
    expect(screen.getByText('Comfortable walking shoes · A hat or umbrella')).toBeTruthy();
  });

  it('after: thanks, a link to more tours, no ticket', async () => {
    clock('2026-12-05 13:00');
    fakeApi([200, { booking: trip() }]);
    renderHub();
    expect(await screen.findByText('Thanks for coming!')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See Ìrìn’s other tours' }).getAttribute('href')).toBe(
      '/irin',
    );
    expect(screen.queryByRole('img', { name: /QR ticket/ })).toBeNull();
    expect(screen.queryByText('Ask a question')).toBeNull();
  });
});

describe('cancelled', () => {
  it('by the operator: their reason, the full refund, Message on WhatsApp, no ticket', async () => {
    clock('2026-12-04 18:00');
    fakeApi([
      200,
      {
        booking: trip({
          status: 'cancelled',
          ticket: null,
          cancellation: {
            at: '2026-12-04T15:00:00Z',
            by: 'operator',
            reason: 'Storm warning',
            refundKobo: 3_750_000,
          },
        }),
      },
    ]);
    renderHub();
    expect(await screen.findByText('Ìrìn had to cancel this trip')).toBeTruthy();
    expect(
      screen.getByText(
        '“Storm warning” You’ll get a full refund of ₦37,500. Want another date instead? Message Ìrìn.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Message Ìrìn on WhatsApp' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /QR ticket/ })).toBeNull();
  });

  it('refunded in part: the amount, the percent and the date', async () => {
    clock('2026-11-27 10:00');
    fakeApi([
      200,
      {
        booking: trip({
          status: 'refunded',
          ticket: null,
          cancellation: {
            at: '2026-11-24T09:00:00Z',
            by: 'guest',
            reason: null,
            refundKobo: 1_875_000,
          },
          refunds: [{ amountKobo: 1_875_000, processedAt: '2026-11-26T10:00:00Z' }],
        }),
      },
    ]);
    renderHub();
    expect(await screen.findByText('Refunded ₦18,750 (50%) on Thu 26 Nov')).toBeTruthy();
  });
});

describe('no signal', () => {
  it('shows the copy saved on this phone, says so, and the ticket still shows', async () => {
    saveTrip(T, trip(), at('2026-12-05 07:12'));
    clock('2026-12-05 08:12');
    fakeApi('offline');
    renderHub();

    expect(await screen.findByText('You’re offline')).toBeTruthy();
    expect(
      screen.getByText('Showing what this phone saved at 07:12. Your ticket still works.'),
    ).toBeTruthy();
    expect(screen.getByRole('img', { name: 'QR ticket for booking ILT-7K4Q2M' })).toBeTruthy();
    expect(screen.getByText(/last updated 07:12/)).toBeTruthy();
  });

  it('Pay needs a connection while offline', async () => {
    saveTrip(
      T,
      trip({
        amountPaidKobo: 1_125_000,
        depositPaidKobo: 1_125_000,
        balanceKobo: 2_625_000,
        balanceDueDate: '2026-11-28',
      }),
      at('2026-11-20 07:00'),
    );
    clock('2026-11-20 08:00');
    fakeApi('offline');
    renderHub();
    const pay = await screen.findAllByRole('button', { name: 'Pay ₦26,250 · Needs a connection' });
    expect(pay[0].disabled).toBe(true);
  });

  it('every load saves a fresh copy; trips that ended over two weeks ago are forgotten', async () => {
    saveTrip(
      'OLD'.padEnd(44, 'x'),
      trip({ departure: { ...trip().departure, endsAt: '2026-10-01T11:00:00Z' } }),
    );
    clock('2026-11-17 10:00');
    fakeApi([200, { booking: trip() }]);
    renderHub();
    await screen.findByText('See you on Sat 5 Dec!');
    // The copy is saved just AFTER the page shows (an effect): wait for it, don't race it.
    await waitFor(() => expect(savedTrip(T)?.booking.reference).toBe('ILT-7K4Q2M'));
    expect(savedTrip('OLD'.padEnd(44, 'x'))).toBeNull();
  });
});

it('a link that doesn’t exist says so', async () => {
  fakeApi([404, { error: { code: 'NOT_FOUND', message: 'Booking not found.' } }]);
  renderHub();
  expect(await screen.findByText('This trip link doesn’t work')).toBeTruthy();
});
