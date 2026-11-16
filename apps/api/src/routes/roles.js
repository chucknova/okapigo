// @ts-check
/**
 * Roles (ACC-05): the three presets plus custom roles with view/edit rights per module.
 *
 *   GET    /api/roles       settings: view
 *   POST   /api/roles       settings: edit   create a custom role
 *   PATCH  /api/roles/:id   settings: edit   rename / change permissions (custom roles only)
 *   DELETE /api/roles/:id   settings: edit   (custom roles only, and only if nobody holds it)
 *
 * TENANT RULE: every query includes `operatorId: req.auth.operatorId`. A role id from another
 * operator is simply "not found". We never reveal that it exists elsewhere.
 */
import { Router } from 'express';
import { CreateRoleSchema, UpdateRoleSchema } from '@okapigo/shared/schemas/roles';
import { slugify } from '@okapigo/shared/slug';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { serializeRole } from './serializers.js';

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function rolesRouter({ prisma }) {
  const router = Router();

  /**
   * Loads a role belonging to the caller's operator, or 404s.
   * @param {import('express').Request} req
   */
  async function findOwnRole(req) {
    // @ts-ignore
    const where = { id: req.params.id, operatorId: req.auth.operatorId };
    const role = await prisma.role.findFirst({ where });
    if (!role) throw new HttpError(404, 'NOT_FOUND', 'Role not found.');
    return role;
  }

  /** Presets are the shared vocabulary of every operator. Nobody may change them. */
  function assertCustom(role) {
    if (role.isPreset) {
      throw new HttpError(403, 'PRESET_ROLE_LOCKED', 'Preset roles cannot be changed.');
    }
  }

  router.get('/roles', requirePermission('settings', 'view'), async (req, res) => {
    const roles = await prisma.role.findMany({
      // @ts-ignore
      where: { operatorId: req.auth.operatorId },
      orderBy: [{ isPreset: 'desc' }, { name: 'asc' }],
    });
    res.json({ roles: roles.map(serializeRole) });
  });

  router.post(
    '/roles',
    requirePermission('settings', 'edit'),
    validate({ body: CreateRoleSchema }),
    async (req, res) => {
      // @ts-ignore
      const { operatorId } = req.auth;
      const key = slugify(req.body.name);
      if (await prisma.role.findFirst({ where: { operatorId, key } })) {
        throw new HttpError(409, 'ROLE_EXISTS', 'A role with that name already exists.');
      }
      const role = await prisma.role.create({
        data: { operatorId, key, name: req.body.name, permissions: req.body.permissions },
      });
      res.status(201).json({ role: serializeRole(role) });
    },
  );

  router.patch(
    '/roles/:id',
    requirePermission('settings', 'edit'),
    validate({ params: IdParamsSchema, body: UpdateRoleSchema }),
    async (req, res) => {
      const role = await findOwnRole(req);
      assertCustom(role);
      const updated = await prisma.role.update({
        where: { id: role.id },
        // The key stays fixed once created; only the display name changes.
        data: { name: req.body.name, permissions: req.body.permissions },
      });
      res.json({ role: serializeRole(updated) });
    },
  );

  router.delete(
    '/roles/:id',
    requirePermission('settings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const role = await findOwnRole(req);
      assertCustom(role);
      const holders = await prisma.user.count({ where: { roleId: role.id } });
      if (holders > 0) {
        throw new HttpError(409, 'ROLE_IN_USE', `${holders} staff still have this role.`);
      }
      // (If someone is given this role in the split second between the count and the
      // delete, the database's ON DELETE RESTRICT refuses the delete anyway.)
      await prisma.role.delete({ where: { id: role.id } });
      res.status(204).end();
    },
  );

  return router;
}
