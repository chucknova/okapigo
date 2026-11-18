// @ts-check
/**
 * Guest requests (stage 12f-2): what guests asked from the trip hub's "Ask Ìrìn".
 *
 *   GET  /api/guest-requests?status=open|answered   bookings: view   open ones oldest first
 *   POST /api/guest-requests/:id/answer              bookings: edit   "replied" (+ a note)
 *
 * Each row carries what's needed to reply without opening the booking: who, how to reach
 * them, which trip, and what they asked. The screen for this is part of the operator app
 * (designed later, see docs/flows/README.md).
 */
import { Router } from 'express';
import { z } from 'zod';
import { listGuestRequests, answerGuestRequest } from '@okapigo/db';
import { localDate, localTime } from '@okapigo/shared/time';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { toHttp } from './bookings.js';

const ListQuery = z.object({ status: z.enum(['open', 'answered']).default('open') });
const AnswerBody = z.object({ note: z.string().trim().max(500).optional() });

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function guestRequestsRouter({ prisma }) {
  const router = Router();
  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;

  router.get('/guest-requests', requirePermission('bookings', 'view'), async (req, res) => {
    const { operatorId, timeZone } = authOf(req);
    const query = ListQuery.safeParse(req.query);
    if (!query.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'status must be open or answered');
    }
    const rows = await listGuestRequests(prisma, operatorId, { status: query.data.status });
    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        message: r.message,
        status: r.status,
        staffNote: r.staffNote,
        createdAt: r.createdAt,
        answeredAt: r.answeredAt,
        booking: {
          id: r.booking.id,
          reference: r.booking.reference,
          status: r.booking.status,
          lead: {
            name: r.booking.leadName,
            phone: r.booking.leadPhone,
            email: r.booking.leadEmail,
          },
          tour: r.booking.product.title,
          departure: {
            localDate: localDate(r.booking.departure.startsAt, timeZone),
            localTime: localTime(r.booking.departure.startsAt, timeZone),
          },
        },
      })),
    });
  });

  router.post(
    '/guest-requests/:id/answer',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema, body: AnswerBody }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      try {
        const request = await answerGuestRequest(prisma, {
          operatorId,
          requestId: req.params.id,
          userId,
          note: req.body.note,
        });
        res.json({
          request: { id: request.id, status: request.status, staffNote: request.staffNote },
        });
      } catch (err) {
        throw toHttp(err);
      }
    },
  );

  return router;
}
