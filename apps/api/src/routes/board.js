// @ts-check
/**
 * The office's schedule and a departure's page (stage 16b; designs O6, O7).
 *
 *   GET /api/schedule/week?start=YYYY-MM-DD   bookings: edit   the week holding that day (Mon–Sun)
 *   GET /api/departures/:id/overview          bookings: edit   numbers, who's booked, notes, cancel preview
 *   GET /api/departures/:id/options           bookings: edit   guides and vans/boats, each saying why not
 *
 * Changes go through the routes already there: PUT /api/departures/:id/assignment (15a),
 * POST /api/departures/:id/cancel (session 9; now starting the refunds too, 16b).
 */
import { Router } from 'express';
import { z } from 'zod';
import { weekSchedule, departureOverview, assignmentOptions } from '@okapigo/db';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { toHttp } from './bookings.js';

const WeekQuery = z.object({ start: z.iso.date().optional() });

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function boardRouter({ prisma }) {
  const router = Router();
  /** @param {any} req */
  // @ts-ignore: req.auth is set by requireAuth
  const operatorOf = (req) => req.auth.operatorId;
  /** @param {() => Promise<any>} fn */
  const domain = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      throw toHttp(err);
    }
  };
  const fresh = (/** @type {any} */ res) => res.set('Cache-Control', 'private, no-store');

  router.get(
    '/schedule/week',
    requirePermission('bookings', 'edit'),
    validate({ query: WeekQuery }),
    async (req, res) => {
      const start = /** @type {any} */ (req.query).start;
      fresh(res).json({ week: await weekSchedule(prisma, { operatorId: operatorOf(req), start }) });
    },
  );

  router.get(
    '/departures/:id/overview',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const departure = await domain(() =>
        departureOverview(prisma, { operatorId: operatorOf(req), departureId: req.params.id }),
      );
      fresh(res).json({ departure });
    },
  );

  router.get(
    '/departures/:id/options',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const options = await domain(() =>
        assignmentOptions(prisma, { operatorId: operatorOf(req), departureId: req.params.id }),
      );
      fresh(res).json({ options });
    },
  );

  return router;
}
