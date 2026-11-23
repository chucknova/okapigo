// @ts-check
/**
 * dashboard.js — who sees the Dashboard, and its fixed words (design D1, stage 18c). The
 * figures and their words come from the server (GET /api/dashboard).
 */
import { hasAccess } from '@okapigo/shared/permissions';

/** Reports, at least to look: the owner and managers; never a guide. @param {any} me @param {any} session */
export function canSeeDashboard(me, session) {
  if (me?.permissions?.reports) return hasAccess(me.permissions.reports, 'view');
  return ['owner', 'manager'].includes(session?.user?.role?.key);
}

/** What "money in" means, under the trend (decided 2026-11-23). */
export const MONEY_IN_NOTE =
  'Money in: payments received each day, minus refunds sent. Travel websites’ sales count on the day they pay you.';

/** "Live, updated 10:12". @param {string} at */
export const updatedWords = (at) => `Live, updated ${at}`;
