// @ts-check
/**
 * Zod schemas for pricing: the operator's tax/fee settings and a quote request.
 */
import { z } from 'zod';

/** Percentages are basis points: 750 = 7.5%. Integers, so no float rates. */
const basisPoints = z.number().int().min(0).max(10_000);
const kobo = z.number().int().nonnegative().max(2_000_000_000);

export const FeeSchema = z.discriminatedUnion('type', [
  z.object({ name: z.string().trim().min(1).max(60), type: z.literal('percent'), basisPoints }),
  z.object({ name: z.string().trim().min(1).max(60), type: z.literal('fixed'), amountKobo: kobo }),
]);

export const TaxSchema = z.object({
  name: z.string().trim().min(1).max(30),
  basisPoints,
  // true = catalogue prices already include the tax (shown as "includes VAT")
  inclusive: z.boolean(),
});

/** Stored on the operator (operators.pricing). Applies to every product it sells. */
export const OperatorPricingSchema = z.object({
  tax: TaxSchema.nullable(),
  fees: z.array(FeeSchema).max(5),
});

/** POST /api/quotes: "how much would this cost?" */
export const QuoteRequestSchema = z.object({
  productId: z.uuid(),
  travellers: z
    .array(
      z.union([
        z.object({ age: z.number().int().min(0).max(120) }).strict(),
        z.object({ categoryKey: z.string().trim().min(1).max(50) }).strict(),
      ]),
    )
    .min(1, 'Add at least one traveller')
    .max(50),
  addOns: z
    .array(z.object({ addOnId: z.uuid(), quantity: z.number().int().min(1).max(100) }))
    .max(20)
    .default([]),
});
