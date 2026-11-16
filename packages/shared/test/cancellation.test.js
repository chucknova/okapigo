/**
 * The cancellation policy engine (BKG-26). Ìrìn's standard policy, from the PRD:
 *   48 h or more before → 100%,  24–48 h → 50%,  less than 24 h → nothing,  no-show → nothing.
 */
import { describe, it, expect } from 'vitest';
import { computeRefund } from '../src/cancellation.js';
import { PolicyTermsSchema } from '../src/schemas/cancellation.js';
import { nairaToKobo as N } from '../src/money.js';

const STANDARD = {
  rules: [
    { hoursBefore: 48, refundBasisPoints: 10_000 },
    { hoursBefore: 24, refundBasisPoints: 5_000 },
    { hoursBefore: 0, refundBasisPoints: 0 },
  ],
  noShowRefundBasisPoints: 0,
  depositRefundable: false,
};

const START = new Date('2026-12-12T08:00:00Z'); // Saturday, 09:00 in Lagos
const hoursBefore = (h) => new Date(START.getTime() - h * 3_600_000);

/** A guest cancelling a ₦62,500 booking `h` hours before departure. */
const guestCancels = (h, extra = {}) =>
  computeRefund({
    policy: STANDARD,
    amountPaidKobo: N(62500),
    departureStartsAt: START,
    at: hoursBefore(h),
    kind: 'cancel',
    initiatedBy: 'guest',
    ...extra,
  });

describe('guest cancellations follow the tiers', () => {
  it.each([
    [72, N(62500), 'full'],
    [48, N(62500), 'full'], // exactly 48 h counts as "48 h or more"
    [47.9, N(31250), 'partial'], // 50% of ₦62,500
    [24, N(31250), 'partial'],
    [23.9, 0, 'none'],
    [1, 0, 'none'],
  ])('%s hours before → refund %s kobo (%s)', (h, refund, outcome) => {
    const r = guestCancels(h);
    expect(r.refundKobo).toBe(refund);
    expect(r.forfeitedKobo).toBe(N(62500) - refund);
    expect(r.outcome).toBe(outcome);
  });

  it('reports which tier applied and how early it was', () => {
    expect(guestCancels(30)).toMatchObject({
      rule: { hoursBefore: 24, refundBasisPoints: 5000 },
      hoursBefore: 30,
      reason: 'POLICY_TIER',
    });
  });

  it('cancelling after the tour started gets nothing', () => {
    expect(guestCancels(-2)).toMatchObject({ refundKobo: 0, reason: 'AFTER_START' });
  });

  it('works whatever order the tiers are written in', () => {
    const shuffled = { ...STANDARD, rules: [...STANDARD.rules].reverse() };
    expect(guestCancels(50, { policy: shuffled }).refundKobo).toBe(N(62500));
  });

  it('rounds a partial refund to whole naira', () => {
    // 50% of ₦25,001 = ₦12,500.50 → ₦12,501 (halves round up, like pricing)
    expect(guestCancels(30, { amountPaidKobo: N(25001) }).refundKobo).toBe(N(12501));
  });
});

describe('operator cancellations', () => {
  it('always refund everything, even an hour before', () => {
    const r = guestCancels(1, { initiatedBy: 'operator' });
    expect(r).toMatchObject({
      refundKobo: N(62500),
      outcome: 'full',
      reason: 'OPERATOR_CANCELLED',
    });
  });

  it('refund the deposit too', () => {
    const r = guestCancels(1, { initiatedBy: 'operator', depositKobo: N(18750) });
    expect(r.refundKobo).toBe(N(62500));
  });
});

describe('no-shows', () => {
  it('use the no-show rate, not the tiers', () => {
    const r = computeRefund({
      policy: { ...STANDARD, noShowRefundBasisPoints: 2500 },
      amountPaidKobo: N(62500),
      departureStartsAt: START,
      at: new Date(START.getTime() + 3_600_000),
      kind: 'no_show',
      initiatedBy: 'guest',
    });
    // 25% of ₦62,500 = ₦15,625
    expect(r).toMatchObject({ refundKobo: N(15625), reason: 'NO_SHOW', rule: null });
  });
});

describe('deposits (BKG-06)', () => {
  // Badagry: 30% deposit of ₦65,000 = ₦19,500 paid, nothing else yet.
  it('a non-refundable deposit is kept even when cancelling early', () => {
    const r = guestCancels(100, { amountPaidKobo: N(19500), depositKobo: N(19500) });
    expect(r).toMatchObject({ refundKobo: 0, keptDepositKobo: N(19500), forfeitedKobo: N(19500) });
  });

  it('after paying the balance, only the deposit part is kept', () => {
    const r = guestCancels(100, { amountPaidKobo: N(65000), depositKobo: N(19500) });
    expect(r.refundKobo).toBe(N(45500)); // ₦65,000 − ₦19,500
  });

  it('a refundable deposit is treated like any other payment', () => {
    const r = guestCancels(100, {
      policy: { ...STANDARD, depositRefundable: true },
      amountPaidKobo: N(19500),
      depositKobo: N(19500),
    });
    expect(r.refundKobo).toBe(N(19500));
  });
});

describe('nothing paid yet', () => {
  it('refunds nothing and forfeits nothing', () => {
    expect(guestCancels(100, { amountPaidKobo: 0 })).toMatchObject({
      refundKobo: 0,
      forfeitedKobo: 0,
      outcome: 'none',
    });
  });
});

describe('policy validation', () => {
  it('accepts the standard policy', () => {
    expect(PolicyTermsSchema.safeParse(STANDARD).success).toBe(true);
  });

  it('rejects a policy where cancelling later refunds MORE', () => {
    const backwards = {
      ...STANDARD,
      rules: [
        { hoursBefore: 48, refundBasisPoints: 5000 },
        { hoursBefore: 24, refundBasisPoints: 10_000 },
      ],
    };
    expect(PolicyTermsSchema.safeParse(backwards).success).toBe(false);
  });

  it('rejects two tiers with the same hours', () => {
    const dup = {
      ...STANDARD,
      rules: [STANDARD.rules[0], { hoursBefore: 48, refundBasisPoints: 0 }],
    };
    expect(PolicyTermsSchema.safeParse(dup).success).toBe(false);
  });
});

describe('for ANY input', () => {
  it('the refund is never negative, never more than paid, and refund + forfeited = paid', () => {
    let seed = 7;
    const rand = (n) => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) % n;
    for (let i = 0; i < 500; i++) {
      const paid = N(rand(200_000));
      const r = computeRefund({
        policy: {
          ...STANDARD,
          noShowRefundBasisPoints: rand(10_001),
          depositRefundable: !!rand(2),
        },
        amountPaidKobo: paid,
        depositKobo: N(rand(100_000)),
        departureStartsAt: START,
        at: hoursBefore(rand(200) - 20),
        kind: rand(4) ? 'cancel' : 'no_show',
        initiatedBy: rand(5) ? 'guest' : 'operator',
      });
      expect(r.refundKobo).toBeGreaterThanOrEqual(0);
      expect(r.refundKobo).toBeLessThanOrEqual(paid);
      expect(r.refundKobo + r.forfeitedKobo).toBe(paid);
    }
  });
});
