/**
 * Checkout steps 1–2 in a fake browser with a fake API: choosing a date reaches step 2
 * (the bug found in the browser), and step 2 follows the server's quote.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { Route, Switch } from 'wouter';
import { ChooseDate } from '../src/screens/checkout/ChooseDate.jsx';
import { WhoComing } from '../src/screens/checkout/WhoComing.jsx';
import { resetEmbedded } from '../src/lib/data.js';

const operator = {
  slug: 'irin',
  name: 'Ìrìn Lagos Tours',
  city: 'Lagos',
  timeZone: 'Africa/Lagos',
  pricesInclude: 'VAT',
};
const tour = {
  slug: 'walk',
  title: 'Lagos Island Heritage Walk',
  durationMinutes: 180,
  scheduleSummary: 'Daily 09:00',
  meetingPoint: { name: 'Tinubu Square', address: 'Broad Street' },
  pickupPoints: [],
  addOns: [],
  priceCategories: [
    { key: 'adult', name: 'Adult (13+)', minAge: 13, maxAge: null, amountKobo: 2_500_000 },
    { key: 'child', name: 'Child (3–12)', minAge: 3, maxAge: 12, amountKobo: 1_250_000 },
  ],
  cancellationPolicy: {
    rules: [{ hoursBefore: 48, refundBasisPoints: 10_000 }],
    noShowRefundBasisPoints: 0,
  },
};
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
const plus = (n) => {
  const t = new Date(`${today}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const departures = [
  {
    id: 'd1',
    startsAt: `${plus(2)}T08:00:00Z`,
    localDate: plus(2),
    localTime: '09:00',
    seatsAvailable: 12,
    soldOut: false,
  },
  {
    id: 'd2',
    startsAt: `${plus(3)}T08:00:00Z`,
    localDate: plus(3),
    localTime: '09:00',
    seatsAvailable: 0,
    soldOut: true,
  },
];

/** The fake API: tour, departures and a quote that applies the adult rule like the server. */
function fakeApi() {
  vi.stubGlobal('fetch', async (path, init) => {
    if (path.includes('/quote')) {
      const body = JSON.parse(init.body);
      const adults = body.travellers.filter((t) => t.categoryKey === 'adult').length;
      const children = body.travellers.length - adults;
      const total = adults * 2_500_000 + children * 1_250_000;
      return Response.json({
        quote: {
          lines: [
            ...(adults
              ? [
                  {
                    type: 'ticket',
                    categoryKey: 'adult',
                    label: 'Adult (13+)',
                    quantity: adults,
                    totalKobo: adults * 2_500_000,
                  },
                ]
              : []),
            ...(children
              ? [
                  {
                    type: 'ticket',
                    categoryKey: 'child',
                    label: 'Child (3–12)',
                    quantity: children,
                    totalKobo: children * 1_250_000,
                  },
                ]
              : []),
          ],
          totalKobo: total,
          taxKobo: 0,
          tax: null,
        },
        blocker: adults
          ? null
          : {
              code: 'ADULT_REQUIRED',
              message: 'Children must travel with an adult. Add at least one adult (13 or over).',
            },
        availability: { seatsAvailable: 12, addOns: [] },
      });
    }
    if (path.includes('/departures')) return Response.json({ departures });
    return Response.json({ operator, tour });
  });
}

/** Renders the checkout routes at a path, with an in-memory address bar. */
function renderAt(path) {
  const memory = memoryLocation({ path, record: true });
  render(
    <Router hook={memory.hook}>
      <Switch>
        <Route path="/:operator/:tour/book/who" component={WhoComing} />
        <Route path="/:operator/:tour/book" component={ChooseDate} />
      </Switch>
    </Router>,
  );
  return memory;
}

beforeEach(() => {
  resetEmbedded();
  sessionStorage.clear();
  fakeApi();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('step 1 → step 2', () => {
  it('choosing a date opens step 2 with that date (and survives the hand-over)', async () => {
    const memory = renderAt('/irin/walk/book');
    const row = await screen.findByRole('button', { name: /09:00, 12 left/ });
    // Sold-out dates are listed, but not buttons.
    // Its own text is its name, in order, the month hidden in between (19c-1).
    expect(row.textContent).toMatch(/^\w{3} \d+ \w{3}, 09:00, 12 left$/);
    expect(screen.getByText('Sold out').closest('.okg-date-row--sold-out')).toBeTruthy();

    fireEvent.click(row);

    await waitFor(() => expect(memory.history.at(-1)).toBe('/irin/walk/book/who'));
    expect(await screen.findByText('Who’s coming?', { selector: 'p' })).toBeTruthy();
    // Saved at once: a refresh here would still know the date.
    expect(JSON.parse(sessionStorage.getItem('okg-checkout:irin/walk')).departure.id).toBe('d1');
  });

  it('a step-2 link with no date chosen goes back to step 1', async () => {
    const memory = renderAt('/irin/walk/book/who');
    await waitFor(() => expect(memory.history.at(-1)).toBe('/irin/walk/book'));
  });
});

describe('step 2', () => {
  beforeEach(() => {
    sessionStorage.setItem(
      'okg-checkout:irin/walk',
      JSON.stringify({ departure: departures[0], counts: {}, addOns: {}, pickup: null }),
    );
  });

  it('starts with one adult, prices it on the server, and lets the guest continue', async () => {
    renderAt('/irin/walk/book/who');
    // In both the phone price card and the desktop summary (no CSS in the test browser).
    expect((await screen.findAllByText('1 × Adult')).length).toBe(2);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Continue' }).every((b) => !b.disabled)).toBe(
        true,
      ),
    );
  });

  it('children alone: the server’s message, and Continue says why it’s off', async () => {
    renderAt('/irin/walk/book/who');
    await screen.findAllByText('1 × Adult');

    // Two separate taps, as a person makes them (the page re-renders in between).
    fireEvent.click(screen.getByRole('button', { name: 'Add one Child (3–12)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove one Adult (13+)' }));

    expect(
      await screen.findByText(
        'Children must travel with an adult. Add at least one adult (13 or over).',
      ),
    ).toBeTruthy();
    expect(screen.getAllByText('Add an adult to continue').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Continue' }).every((b) => b.disabled)).toBe(true);
  });
});
