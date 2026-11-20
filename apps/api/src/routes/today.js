// @ts-check
/**
 * The manager's Today (stage 16a; designs: "Manager’s Today").
 *
 *   GET /api/today   bookings: edit   Needs you · Departures today · Guides’ phones · badges
 *
 * For the office (manager, owner): guides have their own Today, from the offline package.
 * Never cached: it's what's true now (the manager's screens need a connection).
 */
import { Router } from 'express';
import { managerToday } from '@okapigo/db';
import { requirePermission } from '../middleware/auth.js';

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function todayRouter({ prisma }) {
  const router = Router();
  router.get('/today', requirePermission('bookings', 'edit'), async (req, res) => {
    // @ts-ignore: req.auth is set by requireAuth
    const { operatorId } = req.auth;
    res
      .set('Cache-Control', 'private, no-store')
      .json({ today: await managerToday(prisma, { operatorId }) });
  });
  return router;
}
