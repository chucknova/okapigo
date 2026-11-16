// @ts-check
/**
 * auth.js — who is calling, and are they allowed? (ACC-05)
 *
 *   requireAuth(sessions)               → 401 unless a valid session token is sent
 *   requirePermission('bookings','edit') → 403 unless the user's role grants that level
 *
 * In app.js, requireAuth guards EVERYTHING under /api, so a new route there is protected
 * by default ("default deny"). Each route then adds requirePermission for its module.
 *
 * After requireAuth, handlers can read `req.auth`:
 *   { sessionId, userId, operatorId, roleKey, permissions }
 * and MUST scope every query by req.auth.operatorId, which is what keeps one tour business
 * from ever seeing another's data.
 */
import { hasAccess } from '@okapigo/shared/permissions';
import { HttpError } from './errors.js';

/**
 * @typedef {{
 *   sessionId: string,
 *   userId: string,
 *   operatorId: string,
 *   roleKey: string,
 *   permissions: Record<string, import('@okapigo/shared/permissions').AccessLevel>,
 * }} AuthContext
 */

/**
 * @param {ReturnType<typeof import('../auth/session-service.js').createSessionService>} sessions
 * @returns {import('express').RequestHandler}
 */
export function requireAuth(sessions) {
  return async (req, _res, next) => {
    // Expect "Authorization: Bearer <token>".
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    }

    const session = await sessions.findActiveSession(token);
    if (!session) {
      throw new HttpError(401, 'UNAUTHENTICATED', 'Your session has ended. Sign in again.');
    }

    /** @type {AuthContext} */
    const auth = {
      sessionId: session.id,
      userId: session.user.id,
      operatorId: session.user.operatorId,
      roleKey: session.user.role.key,
      permissions: /** @type {any} */ (session.user.role.permissions),
    };
    // @ts-ignore: attaching our own property to Express's request object
    req.auth = auth;
    // Every log line for this request now says who made it.
    req.log = req.log.child({ userId: auth.userId, operatorId: auth.operatorId });
    next();
  };
}

/**
 * @param {import('@okapigo/shared/permissions').Module} module
 * @param {import('@okapigo/shared/permissions').AccessLevel} level
 * @returns {import('express').RequestHandler}
 */
export function requirePermission(module, level) {
  return (req, _res, next) => {
    /** @type {AuthContext | undefined} */
    // @ts-ignore
    const auth = req.auth;
    // A module missing from the role's JSON counts as "none": fail closed, never open.
    const granted = auth?.permissions?.[module] ?? 'none';
    if (!hasAccess(granted, level)) {
      throw new HttpError(403, 'FORBIDDEN', `You need ${level} access to ${module}.`);
    }
    next();
  };
}
