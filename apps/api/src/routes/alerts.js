// @ts-check
/**
 * Staff alerts (stage 11d): things a person should look at. For now, overdue balances.
 *
 *   GET  /api/alerts               bookings: view   open alerts, oldest first
 *   POST /api/alerts/:id/dismiss   bookings: edit   "handled" (called the guest, sent a link…)
 *
 * Alerts are rows in the notifications outbox with audience "staff" (written by the daily
 * balance-reminders job). Nothing is cancelled automatically when a balance is overdue
 * (decided 2026-11-17): staff decide. An alert about a balance that has since been paid
 * disappears on its own (listStaffAlerts tidies first).
 */
import { Router } from 'express';
import { listStaffAlerts, dismissStaffAlert } from '@okapigo/db';
import { balanceDueDate } from '@okapigo/shared/deposits';
import { localDate, localTime } from '@okapigo/shared/time';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function alertsRouter({ prisma }) {
  const router = Router();
  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;

  router.get('/alerts', requirePermission('bookings', 'view'), async (req, res) => {
    const { operatorId, timeZone } = authOf(req);
    const alerts = await listStaffAlerts(prisma, operatorId);
    res.json({
      alerts: alerts.map((a) => {
        const b = a.booking;
        const departureLocalDate = localDate(b.departure.startsAt, timeZone);
        return {
          id: a.id,
          kind: a.kind,
          createdAt: a.createdAt,
          // Everything needed to act without opening the booking: who, what, how much, when.
          booking: {
            id: b.id,
            reference: b.reference,
            status: b.status,
            lead: { name: b.leadName, phone: b.leadPhone, email: b.leadEmail },
            tour: b.product.title,
            departure: {
              localDate: departureLocalDate,
              localTime: localTime(b.departure.startsAt, timeZone),
            },
            // CURRENT figures, not the ones frozen in the alert: part may have been paid since.
            balanceKobo: b.totalKobo - b.amountPaidKobo,
            balanceDueDate: balanceDueDate(departureLocalDate),
          },
        };
      }),
    });
  });

  router.post(
    '/alerts/:id/dismiss',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const dismissed = await dismissStaffAlert(prisma, {
        operatorId: authOf(req).operatorId,
        id: req.params.id,
      });
      // Not found, another operator's, or already handled: all "no open alert here".
      if (!dismissed) throw new HttpError(404, 'NOT_FOUND', 'No open alert with that id.');
      res.status(204).end();
    },
  );

  return router;
}
