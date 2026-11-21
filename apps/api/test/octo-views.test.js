/**
 * Session 17a: the OCTO mapping's rules on their own (octo/views.js) and the channel keys
 * (@okapigo/db channels.js). No database.
 */
import { describe, it, expect } from 'vitest';
import {
  availabilityOf,
  cancellationCutoffOf,
  localIso,
  contactOf,
  pricingOf,
  refundKindOf,
  splitName,
  statusOf,
  unitTypeOf,
} from '../src/octo/views.js';
import { hashApiKey, holdMinutesFor, keyHint, makeApiKey, octoStatusOf } from '@okapigo/db';

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

  it('the cancellation cutoff: until the start, the refund by the policy (decided 17b)', () => {
    expect(
      cancellationCutoffOf({
        rules: [
          { hoursBefore: 48, refundBasisPoints: 10_000 },
          { hoursBefore: 24, refundBasisPoints: 5_000 },
          { hoursBefore: 0, refundBasisPoints: 0 },
        ],
      }),
    ).toEqual({
      cancellationCutoff:
        'Until the start. Refund by the policy: Full refund 48 h+ · 50% 24–48 h · No refund under 24 h',
      cancellationCutoffAmount: 0,
      cancellationCutoffUnit: 'hour',
    });
    for (const none of [null, { rules: [] }]) {
      expect(cancellationCutoffOf(none)).toEqual({
        cancellationCutoff: 'Until the start. No refunds are set: the business decides each one.',
        cancellationCutoffAmount: 0,
        cancellationCutoffUnit: 'hour',
      });
    }
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

describe('bookings (17b)', () => {
  const now = new Date('2026-12-01T10:00:00Z');
  const later = new Date('2026-12-01T10:30:00Z');
  const earlier = new Date('2026-12-01T09:30:00Z');

  it('the OCTO status, from our booking and its hold', () => {
    expect(octoStatusOf({ status: 'held' }, { status: 'active', expiresAt: later }, now)).toBe(
      'ON_HOLD',
    );
    // Held, but its time is up (the sweeper hasn't been yet): expired already.
    expect(octoStatusOf({ status: 'held' }, { status: 'active', expiresAt: earlier }, now)).toBe(
      'EXPIRED',
    );
    expect(octoStatusOf({ status: 'held' }, { status: 'active', expiresAt: now }, now)).toBe(
      'EXPIRED',
    );
    expect(
      octoStatusOf({ status: 'cancelled' }, { status: 'expired', expiresAt: earlier }, now),
    ).toBe('EXPIRED');
    expect(
      octoStatusOf({ status: 'cancelled' }, { status: 'released', expiresAt: later }, now),
    ).toBe('CANCELLED');
    expect(
      octoStatusOf({ status: 'refunded' }, { status: 'converted', expiresAt: later }, now),
    ).toBe('CANCELLED');
    for (const sold of ['confirmed', 'paid', 'part_paid', 'amended', 'no_show']) {
      expect(octoStatusOf({ status: sold }, { status: 'converted', expiresAt: earlier }, now)).toBe(
        'CONFIRMED',
      );
    }
    expect(
      octoStatusOf({ status: 'completed' }, { status: 'converted', expiresAt: earlier }, now),
    ).toBe('REDEEMED');
  });

  it('how long a hold: what was asked, 1 to 30 minutes; 30 when not said', () => {
    expect(holdMinutesFor(undefined)).toBe(30);
    expect(holdMinutesFor(5)).toBe(5);
    expect(holdMinutesFor(30)).toBe(30);
    expect(holdMinutesFor(31)).toBe(30);
    expect(holdMinutesFor(0)).toBe(1);
  });

  it('the refund kind; a contact with every key; a name split in two', () => {
    expect(refundKindOf(0, 8_000_000)).toBe('NONE');
    expect(refundKindOf(4_000_000, 8_000_000)).toBe('PARTIAL');
    expect(refundKindOf(8_000_000, 8_000_000)).toBe('FULL');
    expect(refundKindOf(0, 0)).toBe('NONE');
    expect(contactOf()).toEqual({
      fullName: null,
      firstName: null,
      lastName: null,
      emailAddress: null,
      phoneNumber: null,
      locales: [],
      postalCode: null,
      country: null,
      notes: null,
    });
    expect(splitName(' Ada  Okafor Eze ')).toEqual({ firstName: 'Ada', lastName: 'Okafor Eze' });
    expect(splitName('Ada')).toEqual({ firstName: 'Ada', lastName: null });
  });
});
