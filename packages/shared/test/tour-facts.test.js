import { describe, it, expect } from 'vitest';
import {
  formatDurationShort,
  scheduleSummary,
  describePolicy,
  priceNote,
  freeCancellationUntil,
  policyDeadlines,
  policyLine,
} from '../src/tour-facts.js';

describe('formatDurationShort', () => {
  it('says hours the way cards do', () => {
    expect(formatDurationShort(180)).toBe('3 h');
    expect(formatDurationShort(210)).toBe('3.5 h');
    expect(formatDurationShort(600)).toBe('10 h');
    expect(formatDurationShort(45)).toBe('45 min');
    expect(formatDurationShort(195)).toBe('3 h 15 min');
  });
});

describe('scheduleSummary', () => {
  const s = (daysOfWeek, times = ['09:00']) => [{ daysOfWeek, times }];

  it("covers Ìrìn's five tours", () => {
    expect(scheduleSummary(s([0, 1, 2, 3, 4, 5, 6]))).toBe('Daily 09:00');
    expect(scheduleSummary(s([4, 5, 6], ['18:30']))).toBe('Thu–Sat 18:30');
    expect(scheduleSummary(s([3, 6], ['08:00']))).toBe('Wed, Sat 08:00');
    expect(scheduleSummary(s([0, 6], ['10:00']))).toBe('Weekends 10:00');
    expect(scheduleSummary(s([6], ['07:00']))).toBe('Saturdays 07:00');
  });

  it('lists days Monday first, and several times', () => {
    expect(scheduleSummary(s([0, 1], ['09:00', '15:00']))).toBe('Mon, Sun 09:00, 15:00');
  });

  it('ignores inactive schedules, and gives up on mixed patterns', () => {
    expect(scheduleSummary([{ daysOfWeek: [6], times: ['07:00'], isActive: false }])).toBeNull();
    expect(
      scheduleSummary([
        { daysOfWeek: [6], times: ['07:00'] },
        { daysOfWeek: [0], times: ['10:00'] },
      ]),
    ).toBeNull();
  });
});

describe('describePolicy', () => {
  const standard = {
    rules: [
      { hoursBefore: 48, refundBasisPoints: 10_000 },
      { hoursBefore: 24, refundBasisPoints: 5_000 },
      { hoursBefore: 0, refundBasisPoints: 0 },
    ],
    noShowRefundBasisPoints: 0,
  };

  it("says Ìrìn's Standard policy as the tour page does", () => {
    expect(describePolicy(standard, 'Ìrìn')).toEqual({
      headline: 'Free cancellation up to 48 hours before',
      lines: [
        '48 hours or more before: full refund',
        '24 to 48 hours before: 50% back',
        'Less than 24 hours, or no-show: no refund',
        'If Ìrìn cancels, for example for weather: full refund',
      ],
    });
  });

  it('has no headline when cancelling is never free, and says a different no-show rule', () => {
    const strict = {
      rules: [
        { hoursBefore: 72, refundBasisPoints: 5_000 },
        { hoursBefore: 0, refundBasisPoints: 2_500 },
      ],
      noShowRefundBasisPoints: 0,
    };
    expect(describePolicy(strict, 'Ìrìn')).toEqual({
      headline: null,
      lines: [
        '72 hours or more before: 50% back',
        'Less than 72 hours: 25% back',
        'No-show: no refund',
        'If Ìrìn cancels, for example for weather: full refund',
      ],
    });
  });

  it('says what happens below the lowest tier when there is no 0-hour tier', () => {
    const p = {
      rules: [{ hoursBefore: 24, refundBasisPoints: 10_000 }],
      noShowRefundBasisPoints: 0,
    };
    expect(describePolicy(p, 'Ìrìn').lines).toEqual([
      '24 hours or more before: full refund',
      'Less than 24 hours, or no-show: no refund',
      'If Ìrìn cancels, for example for weather: full refund',
    ]);
  });
});

describe('priceNote', () => {
  it('names the "from" category and the others, without age ranges', () => {
    const cats = [
      { key: 'adult', name: 'Adult (13+)', minAge: 13, maxAge: null, amountKobo: 2_500_000 },
      { key: 'child', name: 'Child (3–12)', minAge: 3, maxAge: 12, amountKobo: 1_250_000 },
      { key: 'infant', name: 'Infant (0–2)', minAge: 0, maxAge: 2, amountKobo: 0 },
    ];
    expect(priceNote(cats)).toEqual({ per: 'per adult', others: ['child ₦12,500', 'infant free'] });
  });
});

describe('freeCancellationUntil', () => {
  const standard = {
    rules: [
      { hoursBefore: 48, refundBasisPoints: 10_000 },
      { hoursBefore: 24, refundBasisPoints: 5_000 },
      { hoursBefore: 0, refundBasisPoints: 0 },
    ],
  };

  it('is 48 hours before the start, in Lagos time', () => {
    // Sat 5 Dec 2026, 09:00 Lagos = 08:00 UTC
    expect(freeCancellationUntil(standard, '2026-12-05T08:00:00Z', 'Africa/Lagos')).toBe(
      'Thu 3 Dec, 09:00',
    );
  });

  it('is null when nothing is free, or free until the start', () => {
    expect(
      freeCancellationUntil(
        { rules: [{ hoursBefore: 0, refundBasisPoints: 5_000 }] },
        '2026-12-05T08:00:00Z',
        'Africa/Lagos',
      ),
    ).toBeNull();
    expect(
      freeCancellationUntil(
        { rules: [{ hoursBefore: 0, refundBasisPoints: 10_000 }] },
        '2026-12-05T08:00:00Z',
        'Africa/Lagos',
      ),
    ).toBeNull();
  });
});

describe('policyDeadlines', () => {
  it("says Ìrìn's Standard policy as dates for one booking", () => {
    const standard = {
      rules: [
        { hoursBefore: 48, refundBasisPoints: 10_000 },
        { hoursBefore: 24, refundBasisPoints: 5_000 },
        { hoursBefore: 0, refundBasisPoints: 0 },
      ],
      noShowRefundBasisPoints: 0,
    };
    expect(policyDeadlines(standard, '2026-12-05T08:00:00Z', 'Africa/Lagos', 'Ìrìn')).toEqual([
      'Until Thu 3 Dec, 09:00: full refund',
      'Until Fri 4 Dec, 09:00: 50% back',
      'After that, or no-show: no refund',
      'If Ìrìn cancels: full refund',
    ]);
  });
});

describe('policyLine (16e-4c)', () => {
  it('a policy in one line, for choosing one', () => {
    const standard = [
      { hoursBefore: 48, refundBasisPoints: 10_000 },
      { hoursBefore: 24, refundBasisPoints: 5_000 },
      { hoursBefore: 0, refundBasisPoints: 0 },
    ];
    expect(policyLine({ rules: standard })).toBe(
      'Full refund 48 h+ · 50% 24–48 h · No refund under 24 h',
    );
    // Rules in any order; a lowest tier above 0 hours ends with "none under".
    expect(
      policyLine({
        rules: [
          { hoursBefore: 24, refundBasisPoints: 2_500 },
          { hoursBefore: 72, refundBasisPoints: 10_000 },
        ],
      }),
    ).toBe('Full refund 72 h+ · 25% 24–72 h · none under 24 h');
    expect(policyLine({ rules: [{ hoursBefore: 0, refundBasisPoints: 10_000 }] })).toBe(
      'Full refund any time',
    );
  });
});
