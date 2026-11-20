// @ts-check
/**
 * Zod schemas for cancellation policies and cancelling bookings (BKG-26).
 */
import { z } from 'zod';

const basisPoints = z.number().int().min(0).max(10_000);

/** One tier: "cancel at least `hoursBefore` hours before departure → refund this much". */
export const PolicyRuleSchema = z.object({
  hoursBefore: z
    .number()
    .int()
    .min(0)
    .max(24 * 365),
  refundBasisPoints: basisPoints,
});

/** The rules of one policy VERSION. */
export const PolicyTermsSchema = z.object({
  rules: z
    .array(PolicyRuleSchema)
    .min(1)
    .max(10)
    .refine(
      (rules) => new Set(rules.map((r) => r.hoursBefore)).size === rules.length,
      'Each tier needs a different number of hours',
    )
    // A policy where cancelling LATER gets MORE money back would be a mistake (and an
    // exploit): refunds must never grow as departure gets closer.
    .refine((rules) => {
      const sorted = [...rules].sort((a, b) => b.hoursBefore - a.hoursBefore);
      return sorted.every(
        (r, i) => i === 0 || r.refundBasisPoints <= sorted[i - 1].refundBasisPoints,
      );
    }, 'Refunds must not increase as departure gets closer'),
  noShowRefundBasisPoints: basisPoints,
  depositRefundable: z.boolean(),
});

/** POST /api/cancellation-policies: a new policy and its first version. */
export const CreatePolicySchema = PolicyTermsSchema.extend({
  name: z.string().trim().min(2).max(60),
});

/** POST /api/bookings/:id/cancel */
export const CancelBookingSchema = z.object({
  // "guest" applies the policy; "operator" (we called it off) refunds in full.
  initiatedBy: z.enum(['guest', 'operator']),
  reason: z.string().trim().min(2).max(500),
  // Staff may set the refund themselves (PAY-08). Needs payments: edit. Recorded on the timeline.
  refundOverrideKobo: z.number().int().nonnegative().optional(),
  // Start the refund right away (the bookings desk, 16c-2: "Cancel and refund ₦62,500").
  // Without it the refund is owed, and started separately (POST /bookings/:id/refunds).
  startRefund: z.boolean().default(false),
});

/** POST /api/departures/:id/cancel: call off a whole departure (e.g. weather). */
export const CancelDepartureSchema = z.object({
  reason: z.string().trim().min(2).max(500),
});
