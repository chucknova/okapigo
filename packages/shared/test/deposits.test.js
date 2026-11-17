import { describe, it, expect } from 'vitest';
import { depositOffer, balanceDueDate } from '../src/deposits.js';

// Badagry, Sat 5 Dec 2026: ₦65,000 for one adult, 30% deposit allowed.
const badagry = {
  totalKobo: 6_500_000,
  depositBasisPoints: 3000,
  departureLocalDate: '2026-12-05',
  todayLocalDate: '2026-11-17',
};

describe('balanceDueDate', () => {
  it('is 7 days before the trip, across month and year ends', () => {
    expect(balanceDueDate('2026-12-05')).toBe('2026-11-28');
    expect(balanceDueDate('2027-01-03')).toBe('2026-12-27');
  });
});

describe('depositOffer', () => {
  it('offers 30% now (₦19,500) and the rest (₦45,500) by Sat 28 Nov', () => {
    expect(depositOffer(badagry)).toEqual({
      depositKobo: 1_950_000,
      balanceKobo: 4_550_000,
      balanceDueDate: '2026-11-28',
    });
  });

  it('rounds the deposit to whole naira, halves up', () => {
    // 30% of ₦65,005 = ₦19,501.50 → ₦19,502
    expect(depositOffer({ ...badagry, totalKobo: 6_500_500 })?.depositKobo).toBe(1_950_200);
  });

  it('is offered the day before the due date, but not on it or after', () => {
    expect(depositOffer({ ...badagry, todayLocalDate: '2026-11-27' })).not.toBeNull();
    expect(depositOffer({ ...badagry, todayLocalDate: '2026-11-28' })).toBeNull();
    expect(depositOffer({ ...badagry, todayLocalDate: '2026-12-01' })).toBeNull();
  });

  it("isn't offered when the tour has no deposit, or something is already paid", () => {
    expect(depositOffer({ ...badagry, depositBasisPoints: null })).toBeNull();
    expect(depositOffer({ ...badagry, amountPaidKobo: 1_950_000 })).toBeNull();
  });

  it("isn't offered when rounding leaves nothing to split", () => {
    // 1% of ₦10 rounds to ₦0
    expect(depositOffer({ ...badagry, totalKobo: 1_000, depositBasisPoints: 100 })).toBeNull();
  });
});
