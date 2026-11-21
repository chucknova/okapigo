/**
 * Session 17a: the OCTO mapping's rules on their own (octo/views.js) and the channel keys
 * (@okapigo/db channels.js). No database.
 */
import { describe, it, expect } from 'vitest';
import {
  availabilityOf,
  cancellationCutoffOf,
  localIso,
  pricingOf,
  statusOf,
  unitTypeOf,
} from '../src/octo/views.js';
import { hashApiKey, keyHint, makeApiKey } from '@okapigo/db';

describe('units, status, times', () => {
  it('a price category’s unit type', () => {
    expect(unitTypeOf({ minAge: 13, maxAge: null })).toBe('ADULT');
    expect(unitTypeOf({ minAge: 59, maxAge: null })).toBe('ADULT');
    expect(unitTypeOf({ minAge: 60, maxAge: null })).toBe('SENIOR');
    expect(unitTypeOf({ minAge: 0, maxAge: 2 })).toBe('INFANT');
    expect(unitTypeOf({ minAge: 3, maxAge: 3 })).toBe('CHILD');
    expect(unitTypeOf({ minAge: 3, maxAge: 12 })).toBe('CHILD');
    expect(unitTypeOf({ minAge: 13, maxAge: 17 })).toBe('YOUTH');
    expect(unitTypeOf({ minAge: 18, maxAge: 25 })).toBe('OTHER');
  });

  it('sold out, limited (under half left), available', () => {
    expect(statusOf(0, 12)).toBe('SOLD_OUT');
    expect(statusOf(-1, 12)).toBe('SOLD_OUT');
    expect(statusOf(5, 12)).toBe('LIMITED');
    expect(statusOf(6, 12)).toBe('AVAILABLE');
    expect(statusOf(12, 12)).toBe('AVAILABLE');
  });

  it('a local time with its offset', () => {
    const at = new Date('2026-12-05T08:00:00Z');
    expect(localIso(at, 'Africa/Lagos')).toBe('2026-12-05T09:00:00+01:00');
    expect(localIso(at, 'UTC')).toBe('2026-12-05T08:00:00+00:00');
    expect(localIso(at, 'America/New_York')).toBe('2026-12-05T03:00:00-05:00');
    expect(localIso(new Date('2026-07-01T23:30:00Z'), 'Asia/Kolkata')).toBe(
      '2026-07-02T05:00:00+05:30',
    );
  });

  it('the cancellation cutoff: the free-cancellation tier, else until the start', () => {
    expect(
      cancellationCutoffOf({
        rules: [
          { hoursBefore: 48, refundBasisPoints: 10_000 },
          { hoursBefore: 24, refundBasisPoints: 5_000 },
        ],
      }),
    ).toEqual({
      cancellationCutoff: '48 hours before the start',
      cancellationCutoffAmount: 48,
      cancellationCutoffUnit: 'hour',
    });
    // Two full-refund tiers: the later one (the latest a full refund is still given).
    expect(
      cancellationCutoffOf({
        rules: [
          { hoursBefore: 72, refundBasisPoints: 10_000 },
          { hoursBefore: 24, refundBasisPoints: 10_000 },
        ],
      }).cancellationCutoffAmount,
    ).toBe(24);
    expect(cancellationCutoffOf(null)).toEqual({
      cancellationCutoff: 'Until the start',
      cancellationCutoffAmount: 0,
      cancellationCutoffUnit: 'hour',
    });
    expect(
      cancellationCutoffOf({ rules: [{ hoursBefore: 24, refundBasisPoints: 5_000 }] })
        .cancellationCutoffAmount,
    ).toBe(0);
  });
});

describe('pricing and availability', () => {
  it('OCTO pricing: retail, the net after commission, the tax inside each', () => {
    expect(pricingOf(4_000_000, 279_100, 2000, 'VAT')).toEqual({
      original: 4_000_000,
      retail: 4_000_000,
      net: 3_200_000,
      currency: 'NGN',
      currencyPrecision: 2,
      includedTaxes: [{ name: 'VAT', retail: 279_100, original: 279_100, net: 223_300 }],
    });
    // No tax, or none inside: no tax lines. No commission: net = retail.
    expect(pricingOf(1_000_000, 0, 0, 'VAT')).toMatchObject({ net: 1_000_000, includedTaxes: [] });
    expect(pricingOf(1_000_000, 50_000, 0, null).includedTaxes).toEqual([]);
    expect(pricingOf(0, 0, 2000, 'VAT')).toMatchObject({ retail: 0, net: 0 });
  });

  it('a departure as availability: available only with enough seats for what was asked', () => {
    const d = {
      id: 'd1',
      startsAt: new Date('2026-12-05T09:00:00Z'),
      endsAt: new Date('2026-12-05T14:00:00Z'),
      capacity: 12,
      seatsAvailable: 4,
    };
    expect(availabilityOf(d, { timeZone: 'Africa/Lagos', pax: 0 })).toEqual({
      id: 'd1',
      localDateTimeStart: '2026-12-05T10:00:00+01:00',
      localDateTimeEnd: '2026-12-05T15:00:00+01:00',
      utcCutoffAt: '2026-12-05T09:00:00.000Z',
      allDay: false,
      available: true,
      status: 'LIMITED',
      vacancies: 4,
      capacity: 12,
      maxUnits: 4,
      openingHours: [],
    });
    expect(availabilityOf(d, { timeZone: 'Africa/Lagos', pax: 4 }).available).toBe(true);
    expect(availabilityOf(d, { timeZone: 'Africa/Lagos', pax: 5 }).available).toBe(false);
    // Overbooked by hand (more taken than the van holds): never negative.
    expect(availabilityOf({ ...d, seatsAvailable: -2 }, { timeZone: 'UTC', pax: 0 })).toMatchObject(
      {
        vacancies: 0,
        available: false,
        status: 'SOLD_OUT',
      },
    );
  });
});

describe('channel keys', () => {
  it('a new key, its hash, its hint', () => {
    const a = makeApiKey();
    expect(a).toMatch(/^octo_[A-Za-z0-9_-]{43}$/);
    expect(makeApiKey()).not.toBe(a);
    expect(hashApiKey(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(a)).toBe(hashApiKey(a));
    expect(hashApiKey(a)).not.toBe(hashApiKey(makeApiKey()));
    expect(keyHint('octo_abcdefk3Qz')).toBe('…k3Qz');
  });
});
