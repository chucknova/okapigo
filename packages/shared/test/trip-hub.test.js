/**
 * tripSituation(): which state the trip hub is in, for every banner in design file 05.
 * Times are Lagos (UTC+1). The Heritage Walk: Sat 5 Dec 2026, 09:00–12:00 local.
 */
import { describe, it, expect } from 'vitest';
import { tripSituation, refundReason } from '../src/trip-hub.js';

const POLICY = {
  rules: [
    { hoursBefore: 48, refundBasisPoints: 10_000 },
    { hoursBefore: 24, refundBasisPoints: 5_000 },
    { hoursBefore: 0, refundBasisPoints: 0 },
  ],
  noShowRefundBasisPoints: 0,
  depositRefundable: false,
};
const booking = (over = {}) => ({
  status: 'paid',
  operator: { timeZone: 'Africa/Lagos' },
  departure: {
    startsAt: '2026-12-05T08:00:00.000Z',
    endsAt: '2026-12-05T11:00:00.000Z',
    localDate: '2026-12-05',
  },
  amountPaidKobo: 6_250_000,
  depositPaidKobo: 0,
  balanceKobo: 0,
  balanceDueDate: null,
  cancellationPolicy: POLICY,
  cancellation: null,
  refunds: [],
  ...over,
});
/** A Lagos wall-clock time as an instant: at('2026-12-05 08:12'). */
const at = (local) => new Date(`${local.replace(' ', 'T')}:00+01:00`);

describe('the phase follows the clock in the operator’s time zone', () => {
  it('upcoming: "In 18 days", and cancelling now gives everything back until Thu 3 Dec 09:00', () => {
    const s = tripSituation(booking(), at('2026-11-17 10:00'));
    expect(s).toMatchObject({ phase: 'upcoming', daysToGo: 18, balance: null, cancelled: null });
    expect(s.cancelNow).toEqual({
      refundKobo: 6_250_000,
      basisPoints: 10_000,
      keptDepositKobo: 0,
      until: '2026-12-03T08:00:00.000Z', // Thu 3 Dec, 09:00 Lagos
      hoursToGo: 431,
      tier: { fromHours: 48, toHours: null, nextBasisPoints: 5_000 },
    });
  });

  it('30 hours before: 50% back (₦31,250), until Fri 4 Dec 09:00', () => {
    const s = tripSituation(booking(), at('2026-12-04 03:00'));
    expect(s.cancelNow).toMatchObject({
      refundKobo: 3_125_000,
      basisPoints: 5_000,
      until: '2026-12-04T08:00:00.000Z',
    });
  });

  it('under 24 hours: nothing back, and no "until"', () => {
    const s = tripSituation(booking(), at('2026-12-04 20:00'));
    expect(s.cancelNow).toMatchObject({ refundKobo: 0, until: null });
  });

  it('trip day from Lagos midnight, even while it is still the 4th in UTC', () => {
    // 00:30 Lagos on the 5th = 23:30 UTC on the 4th.
    const s = tripSituation(booking(), at('2026-12-05 00:30'));
    expect(s).toMatchObject({ phase: 'today', daysToGo: 0, cancelNow: null }); // cancel hidden
    expect(tripSituation(booking(), at('2026-12-04 23:59')).phase).toBe('upcoming');
  });

  it('after the trip ends (12:00), or once staff mark it completed', () => {
    expect(tripSituation(booking(), at('2026-12-05 11:59')).phase).toBe('today');
    expect(tripSituation(booking(), at('2026-12-05 12:00')).phase).toBe('after');
    expect(tripSituation(booking({ status: 'completed' }), at('2026-12-05 10:00')).phase).toBe(
      'after',
    );
  });

  it('no-show and not-yet-paid have their own phases', () => {
    expect(tripSituation(booking({ status: 'no_show' }), at('2026-12-06 10:00')).phase).toBe(
      'no_show',
    );
    expect(tripSituation(booking({ status: 'held' }), at('2026-11-17 10:00')).phase).toBe(
      'not_booked',
    );
  });
});

describe('a deposit booking’s balance', () => {
  const deposit = (over = {}) =>
    booking({
      amountPaidKobo: 1_950_000,
      depositPaidKobo: 1_950_000,
      balanceKobo: 4_550_000,
      balanceDueDate: '2026-11-28',
      ...over,
    });

  it('due by Sat 28 Nov: shown, not overdue, on the day itself either', () => {
    expect(tripSituation(deposit(), at('2026-11-17 10:00')).balance).toEqual({
      amountKobo: 4_550_000,
      dueDate: '2026-11-28',
      overdue: false,
    });
    expect(tripSituation(deposit(), at('2026-11-28 23:00')).balance?.overdue).toBe(false);
  });

  it('overdue from the next day; still shown on the trip day (nothing is cancelled)', () => {
    expect(tripSituation(deposit(), at('2026-11-29 08:00')).balance?.overdue).toBe(true);
    expect(tripSituation(deposit(), at('2026-12-05 08:00')).balance?.overdue).toBe(true);
  });

  it('a kept deposit is not part of "you’d get back"', () => {
    expect(tripSituation(deposit(), at('2026-11-17 10:00')).cancelNow).toMatchObject({
      refundKobo: 0, // everything paid so far is the non-refundable deposit
      keptDepositKobo: 1_950_000,
    });
  });

  it('no balance line once the trip is over or cancelled', () => {
    expect(tripSituation(deposit(), at('2026-12-06 10:00')).balance).toBeNull();
    expect(
      tripSituation(deposit({ status: 'cancelled' }), at('2026-11-20 10:00')).balance,
    ).toBeNull();
  });
});

describe('cancelled and refunded', () => {
  it('by the guest: when, and the refund on its way', () => {
    const s = tripSituation(
      booking({
        status: 'cancelled',
        cancellation: {
          at: '2026-11-24T09:00:00Z',
          by: 'guest',
          reason: null,
          refundKobo: 6_250_000,
        },
      }),
      at('2026-11-24 12:00'),
    );
    expect(s).toMatchObject({ phase: 'cancelled', cancelNow: null, balance: null });
    expect(s.cancelled).toEqual({
      by: 'guest',
      on: '2026-11-24',
      reason: null,
      refundKobo: 6_250_000,
      refunded: null,
    });
  });

  it('by the operator, with the reason staff gave', () => {
    const s = tripSituation(
      booking({
        status: 'cancelled',
        cancellation: {
          at: '2026-12-04T15:00:00Z',
          by: 'operator',
          reason: 'Storm warning',
          refundKobo: 6_250_000,
        },
      }),
      at('2026-12-04 18:00'),
    );
    expect(s.cancelled).toMatchObject({ by: 'operator', reason: 'Storm warning' });
  });

  it('refunded: the total back, the last date, and a percent only for part of it', () => {
    const full = tripSituation(
      booking({
        status: 'refunded',
        refunds: [{ amountKobo: 6_250_000, processedAt: '2026-11-26T10:00:00Z' }],
      }),
      at('2026-11-27 10:00'),
    );
    expect(full.cancelled?.refunded).toEqual({
      amountKobo: 6_250_000,
      on: '2026-11-26',
      percent: null,
    });

    // Paid in two parts (deposit + balance): two refunds, one total. 50% of it here.
    const half = tripSituation(
      booking({
        status: 'refunded',
        refunds: [
          { amountKobo: 1_000_000, processedAt: '2026-11-25T10:00:00Z' },
          { amountKobo: 2_125_000, processedAt: '2026-11-26T10:00:00Z' },
        ],
      }),
      at('2026-11-27 10:00'),
    );
    expect(half.cancelled?.refunded).toEqual({
      amountKobo: 3_125_000,
      on: '2026-11-26',
      percent: 50,
    });
  });
});

describe('"Why ₦31,250?" in words', () => {
  const why = (local, over = {}) => {
    const c = tripSituation(booking(over), at(local)).cancelNow;
    return refundReason(/** @type {any} */ (c), 'UNTIL');
  };
  it('in the full-refund tier, days away', () => {
    expect(why('2026-11-17 10:00')).toBe(
      'Your trip is 18 days away. 48 hours or more before, the policy gives everything back. After UNTIL it gives 50% back.',
    );
  });
  it('30 hours before: the design’s sentence', () => {
    expect(why('2026-12-04 03:00')).toBe(
      'Your trip is 30 hours away. Between 24 and 48 hours before, the policy gives 50% back. After UNTIL it gives nothing.',
    );
  });
  it('under 24 hours: nothing, and no "after"', () => {
    expect(why('2026-12-04 20:00')).toBe(
      'Your trip is 13 hours away. Less than 24 hours before, the policy gives nothing.',
    );
  });
  it('mentions a kept deposit', () => {
    expect(why('2026-11-17 10:00', { depositPaidKobo: 1_000_000 })).toContain(
      'The deposit isn’t refundable.',
    );
  });
});
