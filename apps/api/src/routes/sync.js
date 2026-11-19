// @ts-check
/**
 * The operator app's sync API (OPS-09, stage 15b): what a phone saves to work offline, and
 * the outbox it sends when signal returns. The rules live in packages/db/src/sync.js.
 *
 *   GET  /api/sync/package                  operations: view   today's and tomorrow's departures
 *                                                              I'm on, with manifests (304 if unchanged)
 *   POST /api/sync/changes                  operations: edit   { changes: [...] } oldest first
 *   GET  /api/sync/conflicts                operations: view   waiting to be looked at (O5)
 *   POST /api/sync/conflicts/:id/dismiss    operations: edit   "OK" ({ cashReturned }: "I gave the cash back"
 *
 * A guide sees and sends only their own; staff who can edit bookings (manager, owner) may
 * act on any departure, and see everyone's conflicts.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  offlinePackage,
  applyChanges,
  listConflicts,
  dismissConflict,
  MAX_CHANGES_PER_SYNC,
} from '@okapigo/db';
import { hasAccess } from '@okapigo/shared/permissions';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { toHttp } from './bookings.js';

const CHECK_IN_STATES = ['pending', 'present', 'late', 'no_show'];
const Common = {
  // The phone's own id for this change: the same id sent again gets the same answer.
  id: z.uuid(),
  at: z.iso.datetime({ offset: true }),
  departureId: z.uuid(),
};
const Change = z.discriminatedUnion('kind', [
  z
    .object({
      ...Common,
      kind: z.literal('check_in'),
      code: z.string().trim().min(10).max(80).optional(),
      bookingId: z.uuid().optional(),
      travellerIds: z.array(z.uuid()).max(50).optional(),
      status: z.enum(['present', 'late', 'no_show', 'pending']),
      confirmOwed: z.boolean().optional(),
      // What the phone saw for each traveller when the guide tapped (to spot someone else's change).
      seen: z.record(z.uuid(), z.enum(CHECK_IN_STATES)).optional(),
      // "She's paid by link · check her in" (15c-4): kept with the change, for the phone.
      paidBy: z.enum(['link']).optional(),
    })
    .refine((c) => Boolean(c.code) !== Boolean(c.bookingId), 'Send a ticket code OR a booking'),
  z.object({ ...Common, kind: z.literal('no_show'), bookingId: z.uuid() }),
  // "She paid me cash" (15c-4): reported, not a payment until the office confirms it.
  z.object({
    ...Common,
    kind: z.literal('cash'),
    bookingId: z.uuid(),
    amountKobo: z.number().int().min(100).max(100_000_000),
  }),
  z.object({
    ...Common,
    kind: z.literal('name'),
    travellerId: z.uuid(),
    name: z.string().max(200),
    seen: z.string().max(200).optional(),
  }),
]);
const ChangesBody = z.object({
  changes: z
    .array(Change)
    .min(1)
    .max(MAX_CHANGES_PER_SYNC)
    .refine((cs) => new Set(cs.map((c) => c.id)).size === cs.length, 'Each change id once'),
});

const DismissBody = z.object({ cashReturned: z.boolean().optional() }).optional();

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient, authSecret: string, webPublicUrl?: string }} deps
 *   webPublicUrl: where guests pay (the tour-day payment links' QR, 15c-4)
 */
export function syncRouter({ prisma, authSecret, webPublicUrl = '' }) {
  const router = Router();
  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;
  /** May act on any departure, and see everyone's conflicts. @param {any} req */
  const everyone = (req) => hasAccess(authOf(req).permissions.bookings, 'edit');
  /** @param {() => Promise<any>} fn */
  const domain = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      throw toHttp(err);
    }
  };

  router.get('/sync/package', requirePermission('operations', 'view'), async (req, res) => {
    const { operatorId, userId } = authOf(req);
    const pkg = await offlinePackage(prisma, {
      operatorId,
      userId,
      secret: authSecret,
      webPublicUrl,
    });
    // no-cache = "keep it, but ask me first": the phone sends the ETag back (If-None-Match)
    // and gets 304 Not Modified, with no body, when nothing changed. Express adds the ETag.
    res.set('Cache-Control', 'private, no-cache').json({ package: pkg });
  });

  router.post(
    '/sync/changes',
    requirePermission('operations', 'edit'),
    validate({ body: ChangesBody }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const results = await applyChanges(prisma, {
        operatorId,
        userId,
        secret: authSecret,
        anyDeparture: everyone(req),
        changes: req.body.changes,
      });
      res.json({ results });
    },
  );

  router.get('/sync/conflicts', requirePermission('operations', 'view'), async (req, res) => {
    const { operatorId, userId } = authOf(req);
    res.set('Cache-Control', 'private, no-store').json({
      conflicts: await listConflicts(prisma, { operatorId, userId, everyone: everyone(req) }),
    });
  });

  router.post(
    '/sync/conflicts/:id/dismiss',
    requirePermission('operations', 'edit'),
    validate({ params: IdParamsSchema, body: DismissBody }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      await domain(() =>
        dismissConflict(prisma, {
          operatorId,
          userId,
          everyone: everyone(req),
          id: req.params.id,
          cashReturned: Boolean(req.body?.cashReturned),
        }),
      );
      res.status(204).end();
    },
  );

  return router;
}
