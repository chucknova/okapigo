// @ts-check
/**
 * quote-service.js — prices a basket for a real product, using the shared pipeline.
 *
 * The pipeline (packages/shared/src/pricing.js) is pure: it needs prices handed to it.
 * This service is the bridge: it LOADS the product's active prices and add-ons and the
 * operator's tax/fee settings from the database, then calls priceBasket().
 *
 * Staff quotes (this session), holds and bookings (session 7) and the public checkout
 * (session 10) all go through quote(), so every channel prices the same way (INV-24).
 */
import { priceBasket, PricingError } from '@okapigo/shared/pricing';
import { OperatorPricingSchema } from '@okapigo/shared/schemas/pricing';
import { HttpError } from '../middleware/errors.js';

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function createQuoteService({ prisma }) {
  return {
    /**
     * @param {{
     *   operatorId: string,
     *   productId: string,
     *   travellers: Array<{ age: number } | { categoryKey: string }>,
     *   addOns?: Array<{ addOnId: string, quantity: number }>,
     * }} input
     */
    async quote({ operatorId, productId, travellers, addOns = [] }) {
      const product = await prisma.product.findFirst({
        where: { id: productId, operatorId, status: { not: 'archived' } },
        include: {
          operator: true,
          priceCategories: {
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
          addOns: { where: { isActive: true } },
        },
      });
      if (!product) throw new HttpError(404, 'NOT_FOUND', 'Product not found.');

      // The JSON column isn't checked by the database, so check it here. A broken setting
      // is OUR bug, not the guest's: fail loudly (500) rather than quietly mis-price.
      const settings = OperatorPricingSchema.safeParse(product.operator.pricing);
      if (!settings.success) {
        throw new Error(`Operator ${operatorId} has invalid pricing settings`);
      }

      try {
        const quote = priceBasket({
          priceCategories: product.priceCategories,
          addOns: product.addOns,
          travellers,
          addOnSelections: addOns,
          promo: null, // promo codes: see docs/parking-lot.md
          fees: settings.data.fees,
          tax: settings.data.tax,
        });
        // priceCategories: the active categories used, so callers (bookings) can record
        // which category each traveller was charged as.
        return {
          product: { id: product.id, title: product.title },
          quote,
          priceCategories: product.priceCategories,
        };
      } catch (err) {
        // "No price for age 1" etc. is a problem with the request → 400 with the code.
        if (err instanceof PricingError) throw new HttpError(400, err.code, err.message);
        throw err;
      }
    },
  };
}
