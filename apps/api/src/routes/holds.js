// @ts-check
/**
 * Checkout holds (INV-23): set seats aside while a guest pays.
 *
 *   POST   /api/holds       bookings: edit   { departureId, travellers, addOns } → 201 hold
 *   GET    /api/holds/:id   bookings: view
 *   DELETE /api/holds/:id   bookings: edit   release early (guest changed their mind)
 *
 * These are the STAFF routes (a phone booking). The public checkout (session 10), WhatsApp
 * (session 13) and the OTA (session 16) create holds through the same createHold(), with
 * their own channel, so a seat held anywhere is unavailable everywhere.
 *
 * Order of work in POST:
 *   1. find the departure (must be this operator's)
 *   2. QUOTE the basket with the shared pricing pipeline: the price snapshot
 *   3. createHold(): LOCK the departure, check seats and add-on stock, claim them
 *   4. schedule the expiry job (if Redis is down, the sweeper still catches it)
 */
import { Router } from 'express';
import { createHold, releaseHold, HoldError } from '@okapigo/db';
import { CreateHoldSchema } from '@okapigo/shared/schemas/pricing';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { serializeHold } from './serializers.js';

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   quotes: ReturnType<typeof import('../pricing/quote-service.js').createQuoteService>,
 *   jobs: { scheduleHoldExpiry: (holdId: string, expiresAt: Date) => Promise<void> },
 * }} deps
 */
export function holdsRouter({ prisma, quotes, jobs }) {
  const router = Router();

  router.post(
    '/holds',
    requirePermission('bookings', 'edit'),
    validate({ body: CreateHoldSchema }),
    async (req, res) => {
      // @ts-ignore: req.auth is set by requireAuth
      const { operatorId } = req.auth;
      const { departureId, travellers, addOns } = req.body;

      const departure = await prisma.departure.findFirst({
        where: { id: departureId, operatorId },
        include: { product: { include: { operator: true } } },
      });
      if (!departure) throw new HttpError(404, 'NOT_FOUND', 'Departure not found.');

      const { quote } = await quotes.quote({
        operatorId,
        productId: departure.productId,
        travellers,
        addOns,
      });

      let hold;
      try {
        hold = await createHold(prisma, {
          operatorId,
          departureId,
          seats: travellers.length,
          addOns,
          channel: 'staff',
          travellers,
          quote,
          totalKobo: quote.totalKobo,
          holdMinutes: departure.product.operator.holdMinutes,
        });
      } catch (err) {
        // "Sold out" and friends are normal business outcomes: 409 Conflict with the code.
        if (err instanceof HoldError) throw new HttpError(409, err.code, err.message, err.details);
        throw err;
      }

      try {
        await jobs.scheduleHoldExpiry(hold.id, hold.expiresAt);
      } catch (err) {
        // Don't fail the guest's checkout because Redis hiccupped: the hold is safely in
        // the database and the once-a-minute sweeper will release it on time anyway.
        req.log.warn(
          { err, holdId: hold.id },
          'could not schedule hold expiry; sweeper will handle it',
        );
      }

      res.status(201).json({ hold: serializeHold(hold) });
    },
  );

  router.get(
    '/holds/:id',
    requirePermission('bookings', 'view'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const hold = await prisma.hold.findFirst({
        // @ts-ignore
        where: { id: req.params.id, operatorId: req.auth.operatorId },
        include: { addOns: true },
      });
      if (!hold) throw new HttpError(404, 'NOT_FOUND', 'Hold not found.');
      res.json({ hold: serializeHold(hold) });
    },
  );

  router.delete(
    '/holds/:id',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const hold = await prisma.hold.findFirst({
        // @ts-ignore
        where: { id: req.params.id, operatorId: req.auth.operatorId },
      });
      if (!hold) throw new HttpError(404, 'NOT_FOUND', 'Hold not found.');

      const released = await releaseHold(prisma, hold.id, { reason: 'released' });
      if (!released) {
        throw new HttpError(
          409,
          'HOLD_NOT_ACTIVE',
          `This hold has already ${hold.status === 'active' ? 'ended' : hold.status}.`,
        );
      }
      res.status(204).end();
    },
  );

  return router;
}
