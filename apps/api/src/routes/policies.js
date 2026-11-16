// @ts-check
/**
 * Cancellation policies (BKG-26).
 *
 *   GET  /api/cancellation-policies                products: view   with every version
 *   POST /api/cancellation-policies                products: edit   new policy (version 1)
 *   POST /api/cancellation-policies/:id/versions   products: edit   change the rules = new version
 *
 * There is deliberately no PATCH or DELETE: versions are immutable (a database trigger
 * enforces it), so bookings always keep the exact terms they were sold under.
 * Products choose a policy with `cancellationPolicyId` (PATCH /api/products/:id).
 */
import { Router } from 'express';
import { createPolicy, addPolicyVersion } from '@okapigo/db';
import { CreatePolicySchema, PolicyTermsSchema } from '@okapigo/shared/schemas/cancellation';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { serializePolicy } from './serializers.js';

const WITH_VERSIONS = {
  versions: { orderBy: { version: /** @type {const} */ ('desc') } },
  _count: { select: { products: true } },
};

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function policiesRouter({ prisma }) {
  const router = Router();
  // @ts-ignore: req.auth is set by requireAuth
  const operatorIdOf = (req) => req.auth.operatorId;

  router.get('/cancellation-policies', requirePermission('products', 'view'), async (req, res) => {
    const policies = await prisma.cancellationPolicy.findMany({
      where: { operatorId: operatorIdOf(req) },
      include: WITH_VERSIONS,
      orderBy: { name: 'asc' },
    });
    res.json({ policies: policies.map(serializePolicy) });
  });

  router.post(
    '/cancellation-policies',
    requirePermission('products', 'edit'),
    validate({ body: CreatePolicySchema }),
    async (req, res) => {
      const operatorId = operatorIdOf(req);
      const { name, ...terms } = req.body;
      if (await prisma.cancellationPolicy.findFirst({ where: { operatorId, name } })) {
        throw new HttpError(409, 'POLICY_EXISTS', `There is already a policy called "${name}".`);
      }
      const { policy } = await prisma.$transaction((tx) =>
        createPolicy(tx, { operatorId, name, terms }),
      );
      const full = await prisma.cancellationPolicy.findUniqueOrThrow({
        where: { id: policy.id },
        include: WITH_VERSIONS,
      });
      res.status(201).json({ policy: serializePolicy(full) });
    },
  );

  router.post(
    '/cancellation-policies/:id/versions',
    requirePermission('products', 'edit'),
    validate({ params: IdParamsSchema, body: PolicyTermsSchema }),
    async (req, res) => {
      const policy = await prisma.cancellationPolicy.findFirst({
        where: { id: req.params.id, operatorId: operatorIdOf(req) },
      });
      if (!policy) throw new HttpError(404, 'NOT_FOUND', 'Policy not found.');

      await prisma.$transaction((tx) => addPolicyVersion(tx, policy.id, req.body));
      const full = await prisma.cancellationPolicy.findUniqueOrThrow({
        where: { id: policy.id },
        include: WITH_VERSIONS,
      });
      res.status(201).json({ policy: serializePolicy(full) });
    },
  );

  return router;
}
