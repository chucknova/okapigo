// @ts-check
/**
 * POST /api/quotes (products: view): "how much would this cost?"
 *
 *   { "productId": "…", "travellers": [{ "age": 34 }, { "age": 6 }],
 *     "addOns": [{ "addOnId": "…", "quantity": 2 }] }
 *   → 200 { product, quote: { lines, subtotalKobo, discountKobo, fees, tax, totalKobo, … } }
 *
 * A quote reserves nothing. Holding seats is session 7.
 */
import { Router } from 'express';
import { QuoteRequestSchema } from '@okapigo/shared/schemas/pricing';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

/** @param {{ quotes: ReturnType<typeof import('../pricing/quote-service.js').createQuoteService> }} deps */
export function quotesRouter({ quotes }) {
  const router = Router();

  router.post(
    '/quotes',
    requirePermission('products', 'view'),
    validate({ body: QuoteRequestSchema }),
    async (req, res) => {
      const result = await quotes.quote({
        // @ts-ignore: req.auth is set by requireAuth
        operatorId: req.auth.operatorId,
        productId: req.body.productId,
        travellers: req.body.travellers,
        addOns: req.body.addOns,
      });
      res.json(result);
    },
  );

  return router;
}
