// @ts-check
/**
 * cancellation.js — THE cancellation policy engine (BKG-26). Works out how much money goes
 * back to a guest when a booking is cancelled or the guest doesn't show up.
 *
 * Like the pricing pipeline, it's a PURE function: no database, no clock (the caller passes
 * "now"). Same inputs → same refund, on every channel, and easy to test exhaustively.
 *
 * A POLICY is a list of tiers, checked from the most generous down:
 *
 *   rules: [ { hoursBefore: 48, refundBasisPoints: 10000 },   48 h or more before → 100%
 *            { hoursBefore: 24, refundBasisPoints:  5000 },   24–48 h before      →  50%
 *            { hoursBefore:  0, refundBasisPoints:     0 } ]  less than 24 h      →   0%
 *   noShowRefundBasisPoints: 0      didn't turn up → 0%
 *   depositRefundable: false        a deposit is kept whatever happens
 *
 * The rules, in order:
 *   1. OPERATOR cancels (weather, guide ill): full refund of everything paid, always.
 *      The policy protects the operator from guests changing their minds, not the reverse.
 *   2. Work out the REFUNDABLE BASE: what was paid, minus the deposit if deposits are kept.
 *   3. Pick the percentage: the no-show rate, or the first tier whose `hoursBefore` the
 *      cancellation meets (exactly 48 h before counts as "48 h or more").
 *   4. refund = that percentage of the base, rounded to whole naira (same rounding as
 *      pricing), never more than the base. Whatever isn't refunded is "forfeited".
 */
import { percentOf } from './pricing.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * @typedef {{ hoursBefore: number, refundBasisPoints: number }} PolicyRule
 * @typedef {{ rules: PolicyRule[], noShowRefundBasisPoints: number, depositRefundable: boolean }} Policy
 */

/**
 * @param {{
 *   policy: Policy,
 *   amountPaidKobo: number,
 *   depositKobo?: number,        // the part of amountPaid that was a deposit (BKG-06)
 *   departureStartsAt: Date,
 *   at: Date,                    // when the cancellation happens ("now")
 *   kind: 'cancel' | 'no_show',
 *   initiatedBy: 'guest' | 'operator',
 * }} input
 */
export function computeRefund({
  policy,
  amountPaidKobo,
  depositKobo = 0,
  departureStartsAt,
  at,
  kind,
  initiatedBy,
}) {
  const hoursBefore = (departureStartsAt.getTime() - at.getTime()) / HOUR_MS;

  // 1. The operator called it off: everything back, policy doesn't apply.
  if (initiatedBy === 'operator') {
    return result({
      amountPaidKobo,
      refundKobo: amountPaidKobo,
      basisPoints: 10_000,
      rule: null,
      hoursBefore,
      reason: 'OPERATOR_CANCELLED',
    });
  }

  // 2. A non-refundable deposit comes off the top.
  const keptDeposit = policy.depositRefundable ? 0 : Math.min(depositKobo, amountPaidKobo);
  const base = amountPaidKobo - keptDeposit;

  // 3. Which percentage applies?
  let basisPoints;
  /** @type {PolicyRule | null} */
  let rule = null;
  let reason = 'NO_SHOW';
  if (kind === 'no_show') {
    basisPoints = policy.noShowRefundBasisPoints;
  } else {
    // Most generous tier first, so the first match is the right one.
    const tiers = [...policy.rules].sort((a, b) => b.hoursBefore - a.hoursBefore);
    rule = tiers.find((r) => hoursBefore >= r.hoursBefore) ?? null;
    basisPoints = rule?.refundBasisPoints ?? 0;
    reason = rule ? 'POLICY_TIER' : 'AFTER_START'; // cancelling after the tour began
  }

  // 4. Apply it, rounded like every other percentage, never more than the base.
  const refundKobo = Math.min(percentOf(base, basisPoints), base);
  return result({
    amountPaidKobo,
    refundKobo,
    basisPoints,
    rule,
    hoursBefore,
    reason,
    keptDeposit,
  });
}

/** Shapes the answer. `forfeitedKobo` is what the operator keeps. */
function result({
  amountPaidKobo,
  refundKobo,
  basisPoints,
  rule,
  hoursBefore,
  reason,
  keptDeposit = 0,
}) {
  return {
    refundKobo,
    forfeitedKobo: amountPaidKobo - refundKobo,
    keptDepositKobo: keptDeposit,
    refundBasisPoints: basisPoints,
    rule,
    // Rounded for display and the timeline: "cancelled 30.5 hours before departure".
    hoursBefore: Math.round(hoursBefore * 10) / 10,
    reason,
    outcome: refundKobo === 0 ? 'none' : refundKobo === amountPaidKobo ? 'full' : 'partial',
  };
}
