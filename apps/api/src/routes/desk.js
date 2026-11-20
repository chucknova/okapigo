// @ts-check
/**
 * The office's bookings desk (stage 16c; designs O8 Bookings).
 *
 *   GET  /api/desk/bookings?filter=&q=   bookings: edit   find: today · upcoming · owes · cash ·
 *                                                         cancelled · all; reference, name or phone
 *   GET  /api/desk/bookings/:id          bookings: edit   one booking's page, in words
 *   POST /api/bookings/:id/notes         bookings: edit   a note on the timeline (and the manifest)
 *
 * Changes go through the routes already there: DELETE /api/holds/:id (release the seats),
 * POST /api/departures/:id/check-ins (no-shows from the desk, 15a), and in 16c-2 the money.
 */
import { Router } from 'express';
import { z } from 'zod';
import { deskList, deskBooking, addNote, DESK_FILTERS } from '@okapigo/db';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { toHttp } from './bookings.js';

const ListQuery = z.object({
  filter: z.enum(DESK_FILTERS).default('today'),
  q: z.string().trim().max(100).default(''),
});
const NoteBody = z.object({
  text: z.string().trim().min(1).max(1000),
  onManifest: z.boolean().default(false),
});

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function deskRouter({ prisma }) {
  const router = Router();
  /** @param {any} req */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;
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
    '/desk/bookings',
    requirePermission('bookings', 'edit'),
    validate({ query: ListQuery }),
    async (req, res) => {
      const { filter, q } = /** @type {any} */ (req.query);
      fresh(res).json({
        list: await deskList(prisma, { operatorId: authOf(req).operatorId, filter, q }),
      });
    },
  );

  router.get(
    '/desk/bookings/:id',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const booking = await domain(() =>
        deskBooking(prisma, { operatorId: authOf(req).operatorId, bookingId: req.params.id }),
      );
      fresh(res).json({ booking });
    },
  );

  router.post(
    '/bookings/:id/notes',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema, body: NoteBody }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const note = await domain(() =>
        addNote(prisma, { operatorId, bookingId: req.params.id, userId, ...req.body }),
      );
      res.status(201).json({ note: { id: note.id, createdAt: note.createdAt } });
    },
  );

  return router;
}
