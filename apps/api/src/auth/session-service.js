// @ts-check
/**
 * session-service.js — signed-in sessions.
 *
 * After a correct code, createSession() makes a random token and stores its SHA-256 hash.
 * The client sends the token on every request:   Authorization: Bearer <token>
 * findActiveSession() hashes what it receives and looks it up.
 *
 * Why database sessions and not JWTs (signed tokens that need no lookup)?
 *   - Revocable now: sign out, or deactivating a guide, kills their sessions immediately.
 *     A JWT stays valid until it expires, whatever happens.
 *   - One indexed lookup per request is cheap at our scale.
 * Trade-off: every request touches the database. Fine for the MVP; a cache can come later.
 *
 * Why 30 days? Guides use the offline PWA on tour days. A short session could expire
 * mid-tour with no signal to sign in again. The PRD requires 72 hours offline, and 30 days
 * leaves a wide margin.
 */
import { generateSessionToken, hashToken } from '../lib/secrets.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Only write last_used_at if it's older than this. Otherwise EVERY request would cause a
// database write just to record "still here".
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient }} deps
 */
export function createSessionService({ prisma }) {
  return {
    /**
     * @param {{ userId: string, userAgent?: string }} input
     * @param {import('@prisma/client').Prisma.TransactionClient} [tx] pass to create inside a transaction
     * @returns {Promise<string>} the token. Shown to the client ONCE; we never see it again.
     */
    async createSession({ userId, userAgent }, tx = prisma) {
      const token = generateSessionToken();
      await tx.session.create({
        data: {
          userId,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
          userAgent: userAgent?.slice(0, 200),
        },
      });
      return token;
    },

    /**
     * Returns the session (with user, role and operator) if the token is valid, else null.
     * Valid = exists, not revoked, not expired, and the user is still active.
     * @param {string} token
     */
    async findActiveSession(token) {
      const session = await prisma.session.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: { include: { role: true, operator: true } } },
      });

      const now = Date.now();
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt.getTime() <= now ||
        !session.user.isActive
      ) {
        return null;
      }

      if (now - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
        await prisma.session.update({
          where: { id: session.id },
          data: { lastUsedAt: new Date() },
        });
      }
      return session;
    },

    /** Sign out one device. @param {string} sessionId */
    async revokeSession(sessionId) {
      await prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },

    /** Sign out every device, e.g. when a user is deactivated. @param {string} userId */
    async revokeAllForUser(userId) {
      await prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
  };
}
