/**
 * Sojourna's words (17d-1): the storefront's cards, the calendar, who's coming, the policy,
 * a booking's lines. Pure functions, from the supplier's OCTO answers.
 */
import { describe, it, expect } from 'vitest';
import {
  bookingRow,
  cancelWords,
  cardOf,
  checkWho,
  clock,
  countsOf,
  dateLabel,
  durationWords,
  featuresOf,
  firstWord,
  freeCancellation,
  kindOf,
  lastSyncWords,
  meetingPointOf,
  monthGrid,
  monthLabel,
  monthRange,
  orderLines,
  phoneWords,
  policyWords,
  possessive,
  refundDeadlines,
  seatsLabel,
  shiftMonth,
  startPlace,
  startedWhen,
  statusOf,
  timeOf,
  totalKobo,
  unitPrice,
  whoWords,
} from '../src/lib/words.js';

const unit = (
  /** @type {string} */ id,
  /** @type {string} */ type,
  /** @type {number} */ retail,
  accompaniedBy = /** @type {string[]} */ ([]),
) => ({
  id,
  type,
  title: `${type[0]}${type.slice(1).toLowerCase()} (ages)`,
  restrictions: { accompaniedBy },
  pricingFrom: [{ retail }],
});
const UNITS = [
  unit('adult', 'ADULT', 4_000_000),
  unit('child', 'CHILD', 2_200_000, ['adult']),
  unit('infant', 'INFANT', 0, ['adult']),
];
const RULES = [
  { hoursBefore: 48, refundPercent: 100 },
  { hoursBefore: 24, refundPercent: 50 },
  { hoursBefore: 0, refundPercent: 0 },
];

describe('dates and times', () => {
  it('as the designs write them', () => {
    expect(dateLabel('2026-12-12')).toBe('Sat 12 Dec');
    expect(dateLabel('2026-12-12T10:00:00+01:00')).toBe('Sat 12 Dec');
    expect(timeOf('2026-12-12T10:00:00+01:00')).toBe('10:00');
    expect(monthLabel(2026, 12)).toBe('December 2026');
    expect(monthRange(2026, 2)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange(2028, 2).to).toBe('2028-02-29');
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2027, 1, -1)).toEqual({ year: 2026, month: 12 });
    expect(clock(892)).toBe('14:52');
    expect(clock(5)).toBe('0:05');
    expect(clock(-3)).toBe('0:00');
    expect(durationWords(360)).toBe('6 hours');
    expect(durationWords(210)).toBe('3.5 hours');
    expect(durationWords(60)).toBe('1 hour');
    expect(durationWords(45)).toBe('45 minutes');
  });
});

describe('the storefront (M1)', () => {
  const product = (/** @type {any} */ o = {}) => ({
    id: 'p1',
    title: 'Tarkwa Bay Beach and Lagoon Trip',
    shortDescription: 'Across the lagoon by boat.',
    durationMinutesFrom: 360,
    categoryLabels: ['Boat'],
    options: [{ pickupRequired: false, units: UNITS, refundRules: RULES }],
    ...o,
  });

  it('the kind on the band: pickup first, then a long day, then the label', () => {
    expect(kindOf(product())).toBe('Boat trip');
    expect(kindOf(product({ categoryLabels: ['Walking'] }))).toBe('Walking tour');
    expect(kindOf(product({ categoryLabels: ['Evening'], title: 'Lagos Street Food Crawl' }))).toBe(
      'Food tour',
    );
    expect(kindOf(product({ categoryLabels: ['Van, full day'], durationMinutesFrom: 600 }))).toBe(
      'Day trip',
    );
    expect(kindOf(product({ options: [{ pickupRequired: true }], durationMinutesFrom: 600 }))).toBe(
      'Pickup included',
    );
    expect(kindOf(product({ categoryLabels: ['Sunset'], title: 'Cruise' }))).toBe('Sunset');
    expect(kindOf(product({ categoryLabels: [], title: 'Cruise' }))).toBe('Experience');
  });

  it('a card: its words and band, in turn', () => {
    expect(cardOf(product(), 6)).toEqual({
      id: 'p1',
      title: 'Tarkwa Bay Beach and Lagoon Trip',
      summary: 'Across the lagoon by boat.',
      duration: '6 hours',
      price: '₦40,000',
      kind: 'Boat trip',
      band: '#2A5BD7',
      freeCancel: 'Free cancellation up to 48 hours before',
    });
    expect(cardOf(product({ options: [{ units: [] }] }), 0)).toMatchObject({
      price: null,
      freeCancel: null,
    });
  });

  it('free cancellation: the latest a full refund still holds', () => {
    expect(freeCancellation(RULES)).toBe('Free cancellation up to 48 hours before');
    expect(freeCancellation([{ hoursBefore: 0, refundPercent: 100 }])).toBe(
      'Free cancellation until the start',
    );
    expect(freeCancellation([{ hoursBefore: 24, refundPercent: 50 }])).toBeNull();
    expect(freeCancellation(null)).toBeNull();
    // Full back from 72 h and from 48 h: free until 48 h before (the latest).
    expect(
      freeCancellation([
        { hoursBefore: 72, refundPercent: 100 },
        { hoursBefore: 48, refundPercent: 100 },
      ]),
    ).toBe('Free cancellation up to 48 hours before');
  });

  it('where to meet, and the content by kind', () => {
    const p = {
      locations: [
        { title: 'A pickup', types: ['PICKUP'], place: {} },
        {
          title: 'Jetty, Victoria Island',
          types: ['START'],
          shortDescription: null,
          place: {
            latitude: 6.43,
            longitude: 3.42,
            postalAddress: { streetAddress: 'Boat jetty' },
          },
        },
      ],
      features: [
        { type: 'PREARRIVAL_INFORMATION', shortDescription: 'Swimwear' },
        { type: 'INCLUSION', shortDescription: 'Boat' },
      ],
    };
    expect(meetingPointOf(p)).toEqual({
      name: 'Jetty, Victoria Island',
      address: 'Boat jetty',
      note: null,
      map: 'https://www.google.com/maps/search/?api=1&query=6.43,3.42',
    });
    expect(meetingPointOf({ locations: [] })).toBeNull();
    expect(
      meetingPointOf({ locations: [{ title: 'X', types: ['START'], place: {} }] })?.map,
    ).toBeNull();
    expect(featuresOf(p, 'PREARRIVAL_INFORMATION')).toEqual(['Swimwear']);
    expect(featuresOf(null, 'INCLUSION')).toEqual([]);
  });
});

describe('the calendar (M2)', () => {
  it('a month, Monday first: open, few left, sold out, not running', () => {
    const grid = monthGrid(2026, 12, [
      { localDate: '2026-12-05', available: false, status: 'SOLD_OUT', vacancies: 0 },
      { localDate: '2026-12-06', available: true, status: 'AVAILABLE', vacancies: 9 },
      { localDate: '2026-12-12', available: true, status: 'LIMITED', vacancies: 4 },
      { localDate: '2026-12-13', available: false, status: 'CLOSED', vacancies: 0 },
    ]);
    // 1 Dec 2026 is a Tuesday: one empty Monday first; 31 days; padded to whole weeks.
    expect(grid[0]).toBeNull();
    expect(grid[1]?.date).toBe('2026-12-01');
    expect(grid.length % 7).toBe(0);
    const day = (/** @type {number} */ n) => grid.find((c) => c?.n === n);
    expect(day(5)).toMatchObject({ state: 'soldOut', sub: 'Sold out', aria: 'Dec 5, sold out' });
    expect(day(6)).toMatchObject({ state: 'open', sub: '', aria: 'Dec 6, open', left: 9 });
    expect(day(12)).toMatchObject({ state: 'open', sub: '4 left' });
    expect(day(13)).toMatchObject({ state: 'closed', aria: 'Dec 13, not running' });
    expect(day(20)).toMatchObject({ state: 'closed', left: null });
    expect(seatsLabel(4)).toBe('Only 4 left');
    expect(seatsLabel(9)).toBe('9 seats left');
  });
});

describe('who’s coming (M2)', () => {
  it('the prices, the words, the total', () => {
    expect(UNITS.map(unitPrice)).toEqual(['₦40,000', '₦22,000', 'Free · needs a seat']);
    expect(unitPrice({})).toBe('');
    expect(whoWords(UNITS, { adult: 2, child: 1 })).toBe('2 adults, 1 child');
    expect(whoWords(UNITS, { adult: 1, child: 2, infant: 1 })).toBe(
      '1 adult, 2 children, 1 infant',
    );
    expect(whoWords(UNITS, {})).toBe('No one yet');
    expect(totalKobo(UNITS, { adult: 2, child: 1, infant: 1 })).toBe(10_200_000);
  });

  it('a child or infant needs an adult; infants take a seat; nobody: not yet', () => {
    expect(checkWho(UNITS, { adult: 2, child: 1 }, 4)).toEqual({
      used: 3,
      noAdult: false,
      tooMany: false,
      ok: true,
    });
    expect(checkWho(UNITS, { child: 1 }, 4)).toMatchObject({ noAdult: true, ok: false });
    expect(checkWho(UNITS, { adult: 2, child: 2, infant: 1 }, 4)).toMatchObject({
      used: 5,
      tooMany: true,
      ok: false,
    });
    expect(checkWho(UNITS, { adult: 9 }, null)).toMatchObject({ tooMany: false, ok: true });
    // Exactly the seats left: fine.
    expect(checkWho(UNITS, { adult: 4 }, 4)).toMatchObject({ tooMany: false, ok: true });
    expect(checkWho(UNITS, {}, 4)).toMatchObject({ used: 0, ok: false });
  });
});

describe('the policy (M2, M3)', () => {
  it('in words, tier by tier', () => {
    expect(policyWords(RULES)).toBe('full refund 48 h+ · 50% 24–48 h · no refund under 24 h');
    expect(policyWords([{ hoursBefore: 48, refundPercent: 100 }])).toBe(
      'full refund 48 h+ · no refund under 48 h',
    );
    expect(policyWords([{ hoursBefore: 0, refundPercent: 100 }])).toBe('full refund any time');
    expect(policyWords([])).toBe('refunds decided by the operator');
  });

  it('for one trip: until when each refund holds, in the trip’s own time', () => {
    const start = '2026-12-12T10:00:00+01:00';
    expect(refundDeadlines(RULES, start, new Date('2026-12-01T00:00:00Z'))).toBe(
      'Full refund until Thu 10 Dec, 10:00. 50% until Fri 11 Dec, 10:00.',
    );
    // A day and a half before: only the 50% is still ahead.
    expect(refundDeadlines(RULES, start, new Date('2026-12-10T22:00:00Z'))).toBe(
      '50% until Fri 11 Dec, 10:00.',
    );
    expect(refundDeadlines(RULES, start, new Date('2026-12-12T08:00:00Z'))).toBe(
      'No refund if cancelled now.',
    );
    expect(refundDeadlines(null, start)).toBe('No refund if cancelled now.');
    // A tier that gives nothing back isn't a deadline worth saying.
    expect(
      refundDeadlines(
        [
          { hoursBefore: 48, refundPercent: 100 },
          { hoursBefore: 12, refundPercent: 0 },
        ],
        start,
        new Date('2026-12-01T00:00:00Z'),
      ),
    ).toBe('Full refund until Thu 10 Dec, 10:00.');
  });
});

describe('a booking (M3, M4)', () => {
  it('its lines, its counts, where it starts; names and numbers', () => {
    const items = [{ unitId: 'adult' }, { unitId: 'adult' }, { unitId: 'child' }];
    expect(countsOf(items)).toEqual({ adult: 2, child: 1 });
    expect(orderLines(UNITS, items)).toEqual([
      { id: 'adult', text: '2 × Adult', price: '₦80,000' },
      { id: 'child', text: '1 × Child', price: '₦22,000' },
    ]);
    const p = { locations: [{ title: 'Jetty', types: ['START'], place: {} }] };
    expect(startPlace({ pickupLocation: null }, p)).toBe('Jetty');
    expect(
      startPlace(
        {
          pickupLocation: { title: 'Ikoyi' },
          localPickupDateTimeStart: '2026-12-09T07:30:00+01:00',
        },
        p,
      ),
    ).toBe('Pickup: Ikoyi at 07:30');
    expect(startPlace({ pickupLocation: { title: 'Ikoyi' } }, p)).toBe('Pickup: Ikoyi');
    expect(startPlace({}, {})).toBeNull();
    expect(firstWord(' Hannah Weber ')).toBe('Hannah');
    expect(possessive('Ìrìn Lagos Tours')).toBe('Ìrìn Lagos Tours’');
    expect(possessive('Sojourna')).toBe('Sojourna’s');
    expect(phoneWords('+2348090000123')).toBe('+234 809 000 0123');
    expect(phoneWords('+4915123456789')).toBe('+4915123456789');
  });
});

describe('the back office (M5, 17d-2)', () => {
  const stored = {
    ref: 'SJ-48213',
    supplierReference: 'ILT-6WQ3PZ',
    lead: { name: 'Hannah Weber' },
  };
  const booking = (/** @type {any} */ o = {}) => ({
    status: 'CONFIRMED',
    cancellable: true,
    availability: { localDateTimeStart: '2026-12-12T10:00:00+01:00' },
    unitItems: [{ unitId: 'adult' }, { unitId: 'adult' }, { unitId: 'child' }],
    pricing: { retail: 10_200_000 },
    refundIfCancelledNow: { amount: 10_200_000, percent: 100, hoursBefore: 500 },
    ...o,
  });

  it('a row, in the designs’ words; what can be done', () => {
    expect(
      bookingRow({ stored, booking: booking(), title: 'Tarkwa Bay Beach and Lagoon Trip' }),
    ).toEqual({
      ref: 'SJ-48213',
      ilt: 'ILT-6WQ3PZ',
      guest: 'Hannah Weber',
      tour: 'Tarkwa Bay Beach and Lagoon Trip',
      date: 'Sat 12 Dec · 10:00',
      who: '2 adults, 1 child',
      total: '₦102,000',
      status: { text: 'Confirmed', tone: 'ok' },
      action: 'cancel',
    });
    expect(
      bookingRow({ stored, booking: booking({ cancellable: false }), title: 'X' }).action,
    ).toBe('too_late');
    expect(
      bookingRow({ stored, booking: booking({ status: 'CANCELLED' }), title: null }),
    ).toMatchObject({
      tour: 'A tour no longer listed',
      action: null,
    });
    expect(bookingRow({ stored, booking: null, title: 'X' })).toMatchObject({
      date: '',
      who: '',
      total: '',
      status: { text: 'Can’t reach the supplier', tone: 'bad' },
      action: null,
    });
  });

  it('the status: cancelled by Sojourna (its guest) or by the supplier; checked in; expired', () => {
    const cancelled = (/** @type {any} */ c) => booking({ status: 'CANCELLED', cancellation: c });
    const ours = { ...stored, cancelledAt: '2026-11-21T10:00:00Z' };
    expect(statusOf(ours, cancelled({ refund: 'FULL', refundAmount: 10_200_000 }))).toEqual({
      text: 'Cancelled · ₦102,000 refunded',
      tone: 'muted',
    });
    expect(statusOf(ours, cancelled({ refund: 'PARTIAL', refundAmount: 5_100_000 })).text).toBe(
      'Cancelled · ₦51,000 refunded',
    );
    expect(statusOf(ours, cancelled({ refund: 'NONE', refundAmount: 0 })).text).toBe(
      'Cancelled · no refund',
    );
    expect(statusOf(ours, cancelled({ refund: 'PARTIAL' })).text).toBe('Cancelled · refunded');
    expect(statusOf(ours, cancelled({ refund: 'NONE' })).text).toBe('Cancelled · no refund');
    expect(statusOf(stored, cancelled({ refund: 'FULL', refundAmount: 10_200_000 })).text).toBe(
      'Cancelled by supplier · full refund',
    );
    expect(statusOf(stored, cancelled({ refund: 'PARTIAL', refundAmount: 100 })).text).toBe(
      'Cancelled by supplier · ₦1 refunded',
    );
    expect(statusOf(stored, booking({ status: 'REDEEMED' })).text).toBe('Checked in');
    expect(statusOf(stored, booking({ status: 'EXPIRED' })).text).toBe('Expired');
  });

  it('the question before cancelling: from the supplier’s own preview', () => {
    const row = bookingRow({ stored, booking: booking(), title: 'Tarkwa Bay' });
    expect(cancelWords(row, booking(), 'Ìrìn Lagos Tours')).toEqual({
      title: 'Cancel SJ-48213?',
      line: 'Hannah Weber · Tarkwa Bay · Sat 12 Dec, 10:00 · 2 adults, 1 child',
      headline: 'Cancelled 20 days before: full refund',
      money: '₦102,000 back to the guest, under Ìrìn Lagos Tours’ policy.',
      tone: 'ok',
      note: 'Ìrìn is told at once and the 3 seats go back on sale everywhere.',
      button: 'Cancel and refund ₦102,000',
    });
    const half = booking({
      refundIfCancelledNow: { amount: 5_100_000, percent: 50, hoursBefore: 30.4 },
    });
    expect(cancelWords(row, half, 'Ìrìn Lagos Tours')).toMatchObject({
      headline: 'Cancelled 30 hours before: 50% back',
      button: 'Cancel and refund ₦51,000',
    });
    const none = booking({
      unitItems: [{ unitId: 'adult' }],
      refundIfCancelledNow: { amount: 0, percent: 0, hoursBefore: 10 },
    });
    expect(cancelWords(row, none, 'Ìrìn Lagos Tours')).toMatchObject({
      headline: 'Cancelled 10 hours before: no refund',
      money: 'Nothing goes back to the guest, under Ìrìn Lagos Tours’ policy.',
      tone: 'warn',
      note: 'Ìrìn is told at once and the 1 seat goes back on sale everywhere.',
      button: 'Cancel booking',
    });
    expect(cancelWords(row, booking({ refundIfCancelledNow: null }), 'Sojourna').headline).toBe(
      'no refund',
    );
  });

  it('last sync, and when a trip started', () => {
    const now = new Date(2026, 10, 21, 18, 0);
    expect(lastSyncWords(null, now)).toBe('not synced yet');
    expect(lastSyncWords(new Date(2026, 10, 21, 10, 42).toISOString(), now)).toBe(
      'last sync 10:42',
    );
    expect(lastSyncWords(new Date(2026, 10, 20, 9, 5).toISOString(), now)).toBe(
      'last sync Fri 20 Nov',
    );
    expect(startedWhen('2026-11-21T09:00:00+01:00', now)).toBe('09:00 today');
    expect(startedWhen('2026-11-20T09:00:00+01:00', now)).toBe('09:00 on Fri 20 Nov');
  });
});
