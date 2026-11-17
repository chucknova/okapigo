// @ts-check
/**
 * Refunds (PAY-08, stage 10e). Sending money back is a money decision: payments: edit.
 *
 *   POST /api/bookings/:id/refunds   { amountKobo?, reason }  default: exactly what's owed back
 *   GET  /api/bookings/:id/refunds                            bookings: view
 *   POST /api/payments/:id/refund    { amountKobo?, reason }  an unmatched receipt, sent back
 *   GET  /api/refunds?status=                                 payments: view
 *
 * A refund is "requested" (recorded), then "pending" (the provider accepted it), then
 * "processed" when the provider's webhook confirms the money left, which is also when the
 * ledger is written and a cancelled booking becomes "refunded".
 */
import { Router } from 'express';
import { z } from 'zod';
import { requestBookingRefund, requestReceiptRefund, BookingError } from '@okapigo/db';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';

const RefundSchema = z.object({
  amountKobo: z.number().int().positive().max(2_000_000_000).optional(),
  reason: z.string().trim().min(3).max(300),
});

/** @param {import('@prisma/client').Refund} r */
export function serializeRefund(r) {
  return {
    id: r.id,
    bookingId: r.bookingId,
    paymentId: r.paymentId,
    amountKobo: r.amountKobo,
    status: r.status,
    reason: r.reason,
    failureReason: r.failureReason,
    processedAt: r.processedAt,
    createdAt: r.createdAt,
  };
}

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient, provider: any }} deps
 */
export function refundsRouter({ prisma, provider }) {
  const router = Router();
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;

  /** Answers with the refund rows; 502 if the provider refused every part. */
  function reply(res, refunds) {
    const allFailed = refunds.length > 0 && refunds.every((r) => r.status === 'failed');
    if (allFailed) {
      throw new HttpError(
        502,
        'PROVIDER_REFUSED',
        `The payment provider refused the refund: ${refunds[0].failureReason}`,
        {
          refunds: refunds.map(serializeRefund),
        },
      );
    }
    res.status(201).json({ refunds: refunds.map(serializeRefund) });
  }

  function toHttp(err) {
    if (err instanceof BookingError) {
      return new HttpError(
        err.code === 'NOT_FOUND' ? 404 : 409,
        err.code,
        err.message,
        err.details,
      );
    }
    return err;
  }

  router.post(
    '/bookings/:id/refunds',
    requirePermission('payments', 'edit'),
    validate({ params: IdParamsSchema, body: RefundSchema }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      let refunds;
      try {
        refunds = await requestBookingRefund(prisma, provider, {
          operatorId,
          bookingId: req.params.id,
          amountKobo: req.body.amountKobo,
          reason: req.body.reason,
          actor: { type: 'user', userId },
        });
      } catch (err) {
        throw toHttp(err);
      }
      reply(res, refunds);
    },
  );

  router.get(
    '/bookings/:id/refunds',
    requirePermission('bookings', 'view'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const refunds = await prisma.refund.findMany({
        where: { bookingId: req.params.id, operatorId: authOf(req).operatorId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      res.json({ refunds: refunds.map(serializeRefund) });
    },
  );

  router.post(
    '/payments/:id/refund',
    requirePermission('payments', 'edit'),
    validate({ params: IdParamsSchema, body: RefundSchema }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      let refunds;
      try {
        refunds = await requestReceiptRefund(prisma, provider, {
          operatorId,
          paymentId: req.params.id,
          amountKobo: req.body.amountKobo,
          reason: req.body.reason,
          actor: { type: 'user', userId },
        });
      } catch (err) {
        throw toHttp(err);
      }
      reply(res, refunds);
    },
  );

  router.get('/refunds', requirePermission('payments', 'view'), async (req, res) => {
    const status = z
      .enum(['requested', 'pending', 'processed', 'failed'])
      .optional()
      .safeParse(req.query.status);
    if (!status.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown status.');
    const refunds = await prisma.refund.findMany({
      where: { operatorId: authOf(req).operatorId, status: status.data },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    res.json({ refunds: refunds.map(serializeRefund) });
  });

  return router;
}
