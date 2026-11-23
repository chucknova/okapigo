// @ts-check
/**
 * The dashboard (RPT-01, stage 18c; design D1).
 *
 *   GET /api/dashboard   reports: view   today's four tiles, the 30-day trend, where bookings
 *                                        came from, seats filled by tour
 *
 * The figures are packages/db/src/dashboard.js (money in from the ledger, by the business's
 * day); the words are packages/shared/src/dashboard.js. Read fresh every time: it shows money.
 */
import { Router } from 'express';
import { dashboardFigures } from '@okapigo/db';
import { dashboardView } from '@okapigo/shared/dashboard';
import { localTime } from '@okapigo/shared/time';
import { requirePermission } from '../middleware/auth.js';

/** @param {{ prisma: import('@prisma/client').PrismaClient, now?: () => Date }} deps */
export function dashboardRouter({ prisma, now = () => new Date() }) {
  const router = Router();
  router.get('/dashboard', requirePermission('reports', 'view'), async (req, res) => {
    // @ts-ignore: req.auth is set by requireAuth
    const { operatorId, timeZone } = /** @type {import('../middleware/auth.js').AuthContext} */ (
      req.auth
    );
    const at = now();
    const figures = await dashboardFigures(prisma, { operatorId, timeZone, now: at });
    res.set('Cache-Control', 'private, no-store').json({
      dashboard: { ...dashboardView(figures), updatedAt: localTime(at, timeZone) },
    });
  });
  return router;
}
