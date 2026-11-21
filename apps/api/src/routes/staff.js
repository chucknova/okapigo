// @ts-check
/**
 * Staff management (ACC-05; the screen is Settings › Staff and roles, stage 16e-3).
 *
 *   GET   /api/staff              settings: view   everyone, with how each stands in words
 *   POST  /api/staff              settings: edit   invite someone (emailed, or words to copy)
 *   POST  /api/staff/:id/invite   settings: edit   send the invitation again
 *   PATCH /api/staff/:id          settings: edit   name, contact, role; remove or give back access
 *
 * How someone stands (designs: "Active · synced 07:31", "Invited · hasn't signed in"):
 *   invited   never signed in (no session yet)
 *   active    has signed in; "synced 07:31" once their phone has synced
 *   removed   no access (isActive false)
 *
 * Removing someone (isActive false):
 *   - signs them out everywhere at once (their sessions are revoked: database sessions make
 *     this possible, see session-service.js). Anything still waiting on their phone is then
 *     refused, so the screen says what their phone had waiting at its last sync (decided
 *     2026-11-21: say it accurately; asking them to sync first is suggested, not required).
 *   - takes them off the departures they were going to guide, and says which ones
 *   - hands the chats they'd taken over back to "Needs a person"
 *
 * There must always be at least one owner: the last one can't be removed or made something
 * else. Nobody changes their own role or access (they could lock themselves out).
 */
import { Router } from 'express';
import { CreateStaffSchema, UpdateStaffSchema } from '@okapigo/shared/schemas/roles';
import { formatPhoneForDisplay } from '@okapigo/shared/contact';
import { localDate, localTime } from '@okapigo/shared/time';
import { formatAt } from '@okapigo/shared/tour-facts';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { serializeUser } from './serializers.js';
import { inviteEmail, inviteWords } from '../messages/invite.js';

/** "dayo@example.com", or "0809 777 8899": how they sign in, as people write it. @param {any} u */
const contactOf = (u) => u.email ?? (u.phone ? formatPhoneForDisplay(u.phone) : '');

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   sessions: ReturnType<typeof import('../auth/session-service.js').createSessionService>,
 *   apiPublicUrl?: string,
 *   mailer?: import('../messages/mailers.js').Mailer | null,
 *   emailFrom?: string,
 * }} deps
 */
export function staffRouter({
  prisma,
  sessions,
  apiPublicUrl = '',
  mailer = null,
  emailFrom = 'onboarding@resend.dev',
}) {
  const router = Router();
  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;
  // The app staff sign in to (the API serves it at /app/).
  const appUrl = `${apiPublicUrl.replace(/\/+$/, '')}/app/`;

  /**
   * The role must belong to the caller's own operator. The database would also refuse
   * (composite foreign key, session 2), but checking here gives a clear 400 instead of a 500.
   * @param {string} operatorId @param {string} roleId
   */
  async function ownRole(operatorId, roleId) {
    const role = await prisma.role.findFirst({ where: { id: roleId, operatorId } });
    if (!role) throw new HttpError(400, 'INVALID_ROLE', 'That role does not exist.');
    return role;
  }

  /** @param {{ channel: string, destination: string }} contact @param {string | null} except */
  async function assertContactFree(contact, except) {
    const field = contact.channel === 'email' ? 'email' : 'phone';
    const taken = await prisma.user.findFirst({
      where: { [field]: contact.destination, ...(except && { id: { not: except } }) },
    });
    if (taken)
      throw new HttpError(409, 'CONTACT_IN_USE', 'Someone already uses that email or phone.');
  }

  /**
   * Each person with how they stand, their coming departures and what their phone had waiting.
   * @param {string} operatorId @param {string[] | null} ids  null: everyone
   */
  async function rows(operatorId, ids = null) {
    const [operator, users] = await Promise.all([
      prisma.operator.findUniqueOrThrow({ where: { id: operatorId } }),
      prisma.user.findMany({
        where: { operatorId, ...(ids && { id: { in: ids } }) },
        include: { role: true, _count: { select: { sessions: true } } },
        orderBy: { name: 'asc' },
      }),
    ]);
    const tz = operator.timeZone;
    const now = new Date();
    const coming = await prisma.departure.findMany({
      where: {
        operatorId,
        guideId: { in: users.map((u) => u.id) },
        status: 'scheduled',
        startsAt: { gte: now },
      },
      include: { product: { select: { title: true, shortTitle: true } } },
      orderBy: { startsAt: 'asc' },
    });
    /** "Sat 5 Dec 09:00", or "09:00" today. @param {Date} at */
    const when = (at) =>
      localDate(at, tz) === localDate(now, tz) ? localTime(at, tz) : formatAt(at.getTime(), tz);
    return users.map((u) => {
      const status = !u.isActive ? 'removed' : u._count.sessions === 0 ? 'invited' : 'active';
      const waiting = u.outboxWaiting ?? 0;
      return {
        ...serializeUser(u),
        contact: contactOf(u),
        status,
        statusText:
          status === 'removed'
            ? 'No access'
            : status === 'invited'
              ? 'Invited · hasn’t signed in'
              : u.lastSyncedAt
                ? `Active · synced ${when(u.lastSyncedAt)}`
                : 'Active',
        // "Heritage Walk · Sat 5 Dec 09:00 (today)": what they'd leave without a guide.
        upcoming: coming
          .filter((d) => d.guideId === u.id)
          .map((d) => ({
            id: d.id,
            text: `${d.product.shortTitle ?? d.product.title} · ${formatAt(d.startsAt.getTime(), tz)}${
              localDate(d.startsAt, tz) === localDate(now, tz) ? ' (today)' : ''
            }`,
          })),
        // What their phone said was waiting when it last synced (removal refuses it after).
        waiting:
          u.isActive && waiting > 0 && u.lastSyncedAt
            ? `${waiting} ${waiting === 1 ? 'change' : 'changes'} waiting on their phone at its last sync (${when(u.lastSyncedAt)})`
            : null,
      };
    });
  }

  /**
   * Sends the invitation: by email for an email address (when this server has email), else
   * the words for the owner to copy and send. The words always come back, either way.
   * @param {any} user  with role @param {string} operatorId @param {string} invitedById
   */
  async function invite(user, operatorId, invitedById) {
    const [operator, by] = await Promise.all([
      prisma.operator.findUniqueOrThrow({ where: { id: operatorId } }),
      prisma.user.findUniqueOrThrow({ where: { id: invitedById } }),
    ]);
    const i = {
      name: user.name,
      operatorName: operator.name,
      roleName: user.role.name,
      invitedBy: by.name,
      contact: contactOf(user),
      appUrl,
    };
    const words = inviteWords(i);
    if (!user.email) return { how: 'copy', to: i.contact, words, problem: null };
    if (!mailer) {
      return {
        how: 'copy',
        to: i.contact,
        words,
        problem:
          'Email isn’t set up on this OkapiGo server yet. Copy the words and send them yourself.',
      };
    }
    try {
      const e = inviteEmail(i);
      await mailer.send({
        from: { name: operator.name, email: emailFrom },
        to: { name: user.name, email: user.email },
        replyTo: by.email,
        ...e,
      });
      return { how: 'email', to: i.contact, words, problem: null };
    } catch (err) {
      return {
        how: 'copy',
        to: i.contact,
        words,
        problem: `The email didn’t go (${/** @type {Error} */ (err).message}). Copy the words and send them yourself.`,
      };
    }
  }

  /**
   * Refuses taking away the last owner. @param {any} target with role @param {string} operatorId
   * @param {{ roleKey: string, isActive: boolean }} after
   */
  async function assertKeepsAnOwner(target, operatorId, after) {
    const wasOwner = target.isActive && target.role.key === 'owner';
    const staysOwner = after.isActive && after.roleKey === 'owner';
    if (!wasOwner || staysOwner) return;
    const others = await prisma.user.count({
      where: { operatorId, isActive: true, role: { key: 'owner' }, id: { not: target.id } },
    });
    if (others === 0) {
      throw new HttpError(409, 'LAST_OWNER', 'There must always be at least one owner.');
    }
  }

  router.get('/staff', requirePermission('settings', 'view'), async (req, res) => {
    const { operatorId, userId } = authOf(req);
    res.json({ staff: await rows(operatorId), you: userId });
  });

  router.post(
    '/staff',
    requirePermission('settings', 'edit'),
    validate({ body: CreateStaffSchema }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const { name, contact, roleId } = req.body;
      await ownRole(operatorId, roleId);
      await assertContactFree(contact, null);
      const field = contact.channel === 'email' ? 'email' : 'phone';
      const user = await prisma.user.create({
        data: { operatorId, roleId, name, [field]: contact.destination },
        include: { role: true },
      });
      const sent = await invite(user, operatorId, userId);
      res.status(201).json({ user: (await rows(operatorId, [user.id]))[0], invite: sent });
    },
  );

  router.post(
    '/staff/:id/invite',
    requirePermission('settings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const target = await prisma.user.findFirst({
        where: { id: req.params.id, operatorId },
        include: { role: true },
      });
      if (!target) throw new HttpError(404, 'NOT_FOUND', 'Staff member not found.');
      if (!target.isActive) {
        throw new HttpError(409, 'NO_ACCESS', 'Give them access again before inviting them.');
      }
      res.json({ invite: await invite(target, operatorId, userId) });
    },
  );

  router.patch(
    '/staff/:id',
    requirePermission('settings', 'edit'),
    validate({ params: IdParamsSchema, body: UpdateStaffSchema }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const target = await prisma.user.findFirst({
        where: { id: req.params.id, operatorId },
        include: { role: true },
      });
      if (!target) throw new HttpError(404, 'NOT_FOUND', 'Staff member not found.');
      const { name, contact, roleId, isActive } = req.body;

      // Stop people locking themselves (perhaps the only owner) out by accident. Their own
      // name and contact are fine.
      if (target.id === userId && (roleId !== undefined || isActive !== undefined)) {
        throw new HttpError(
          400,
          'CANNOT_CHANGE_SELF',
          'You cannot change your own role or status.',
        );
      }
      const role = roleId ? await ownRole(operatorId, roleId) : target.role;
      await assertKeepsAnOwner(target, operatorId, {
        roleKey: role.key,
        isActive: isActive ?? target.isActive,
      });

      /** @type {Record<string, any>} */
      const data = { name, roleId, isActive };
      if (contact) {
        await assertContactFree(contact, target.id);
        // The contact shown is the one replaced ("Email or phone"): the same kind, or the other
        // kind in its place. A second one they have (a phone besides the email) stays.
        const field = contact.channel === 'email' ? 'email' : 'phone';
        const shown = target.email ? 'email' : 'phone';
        data[field] = contact.destination;
        if (field !== shown) data[shown] = null;
      }

      // (Removing someone already removed finds nothing more to take them off.)
      const removing = isActive === false;
      const unguided = removing
        ? (await rows(operatorId, [target.id]))[0].upcoming
        : /** @type {{ id: string, text: string }[]} */ ([]);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: target.id }, data });
        if (!removing) return;
        // Off the departures they were going to guide (each now shows "no guide").
        await tx.departure.updateMany({
          where: { id: { in: unguided.map((d) => d.id) } },
          data: { guideId: null, guideAssignedById: null, guideAssignedAt: null },
        });
        // Chats they'd taken over: back to "Needs a person", for someone else to answer.
        await tx.conversation.updateMany({
          where: { operatorId, handledById: target.id },
          data: {
            handledBy: 'bot',
            handledById: null,
            handledSince: null,
            needsPersonSince: new Date(),
          },
        });
      });
      if (removing) await sessions.revokeAllForUser(target.id);

      res.json({ user: (await rows(operatorId, [target.id]))[0], unguided });
    },
  );

  return router;
}
