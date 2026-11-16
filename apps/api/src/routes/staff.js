// @ts-check
/**
 * Staff management (ACC-05).
 *
 *   GET   /api/staff       settings: view
 *   POST  /api/staff       settings: edit   add a staff member (they then sign in by code)
 *   PATCH /api/staff/:id   settings: edit   change role, or deactivate / reactivate
 *
 * Deactivating someone revokes all their sessions at once. Their phone is signed out on its
 * next request. (Database sessions make this possible; see session-service.js.)
 */
import { Router } from 'express';
import { CreateStaffSchema, UpdateStaffSchema } from '@okapigo/shared/schemas/roles';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { serializeUser } from './serializers.js';

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   sessions: ReturnType<typeof import('../auth/session-service.js').createSessionService>,
 * }} deps
 */
export function staffRouter({ prisma, sessions }) {
  const router = Router();

  /**
   * The role must belong to the caller's own operator. The database would also refuse
   * (composite foreign key, session 2), but checking here gives a clear 400 instead of a 500.
   */
  async function assertOwnRole(operatorId, roleId) {
    const role = await prisma.role.findFirst({ where: { id: roleId, operatorId } });
    if (!role) throw new HttpError(400, 'INVALID_ROLE', 'That role does not exist.');
  }

  router.get('/staff', requirePermission('settings', 'view'), async (req, res) => {
    const staff = await prisma.user.findMany({
      // @ts-ignore
      where: { operatorId: req.auth.operatorId },
      include: { role: true },
      orderBy: { name: 'asc' },
    });
    res.json({ staff: staff.map(serializeUser) });
  });

  router.post(
    '/staff',
    requirePermission('settings', 'edit'),
    validate({ body: CreateStaffSchema }),
    async (req, res) => {
      // @ts-ignore
      const { operatorId } = req.auth;
      const { name, contact, roleId } = req.body;
      await assertOwnRole(operatorId, roleId);

      const field = contact.channel === 'email' ? 'email' : 'phone';
      if (await prisma.user.findFirst({ where: { [field]: contact.destination } })) {
        throw new HttpError(409, 'CONTACT_IN_USE', 'Someone already uses that email or phone.');
      }

      const user = await prisma.user.create({
        data: { operatorId, roleId, name, [field]: contact.destination },
        include: { role: true },
      });
      res.status(201).json({ user: serializeUser(user) });
    },
  );

  router.patch(
    '/staff/:id',
    requirePermission('settings', 'edit'),
    validate({ params: IdParamsSchema, body: UpdateStaffSchema }),
    async (req, res) => {
      // @ts-ignore
      const { operatorId, userId } = req.auth;
      const target = await prisma.user.findFirst({ where: { id: req.params.id, operatorId } });
      if (!target) throw new HttpError(404, 'NOT_FOUND', 'Staff member not found.');

      // Stop people locking themselves (perhaps the only owner) out by accident.
      if (target.id === userId) {
        throw new HttpError(
          400,
          'CANNOT_CHANGE_SELF',
          'You cannot change your own role or status.',
        );
      }
      if (req.body.roleId) await assertOwnRole(operatorId, req.body.roleId);

      const updated = await prisma.user.update({
        where: { id: target.id },
        data: { roleId: req.body.roleId, isActive: req.body.isActive },
        include: { role: true },
      });
      if (req.body.isActive === false) await sessions.revokeAllForUser(target.id);

      res.json({ user: serializeUser(updated) });
    },
  );

  return router;
}
