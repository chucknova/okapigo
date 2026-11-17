import { describe, it, expect } from 'vitest';
import { depositOffer, balanceDueDate, balanceNotice } from '../src/deposits.js';

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

describe('balanceNotice', () => {
  // Trip Sat 5 Dec → balance due Sat 28 Nov. Booked 10 Nov.
  const on = (todayLocalDate, bookedLocalDate = '2026-11-10') =>
    balanceNotice({ departureLocalDate: '2026-12-05', bookedLocalDate, todayLocalDate });

  it('reminds 7, 3 and 1 days before the due date', () => {
    expect(on('2026-11-20')).toBeNull(); // 8 days to go
    expect(on('2026-11-21')).toEqual({ kind: 'reminder', daysBefore: 7 });
    expect(on('2026-11-25')).toEqual({ kind: 'reminder', daysBefore: 3 });
    expect(on('2026-11-27')).toEqual({ kind: 'reminder', daysBefore: 1 });
  });

  it('keeps answering the latest milestone until the next, so a missed day is caught up', () => {
    expect(on('2026-11-23')).toEqual({ kind: 'reminder', daysBefore: 7 });
    expect(on('2026-11-26')).toEqual({ kind: 'reminder', daysBefore: 3 });
    expect(on('2026-11-28')).toEqual({ kind: 'reminder', daysBefore: 1 }); // due today
  });

  it('is overdue from the day after the due date until the trip', () => {
    expect(on('2026-11-29')).toEqual({ kind: 'overdue' });
    expect(on('2026-12-04')).toEqual({ kind: 'overdue' });
    expect(on('2026-12-05')).toBeNull();
  });

  it('skips milestones that had passed before the booking was made', () => {
    // Booked 24 Nov (after the 7-day milestone, 21 Nov): no 7-day reminder…
    expect(on('2026-11-24', '2026-11-24')).toBeNull();
    // …but the 3-day one (25 Nov) still comes.
    expect(on('2026-11-25', '2026-11-24')).toEqual({ kind: 'reminder', daysBefore: 3 });
    // Booked ON a milestone day: that milestone is skipped too.
    expect(on('2026-11-27', '2026-11-27')).toBeNull();
  });
});
