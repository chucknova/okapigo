// @ts-check
/**
 * GET /api/me: "who am I?" The PWA calls this after sign-in to show the user's name and
 * business, and to hide screens their role can't open (it gets `permissions`).
 *
 * Any signed-in user may call it, so it needs no requirePermission.
 */
import { Router } from 'express';
import { serializeUser } from './serializers.js';

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function meRouter({ prisma }) {
  const router = Router();

  router.get('/me', async (req, res) => {
    // @ts-ignore: req.auth is set by requireAuth
    const { userId, permissions } = req.auth;
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { role: true, operator: true },
    });
    const owner = await prisma.user.findFirst({
      where: { operatorId: user.operatorId, isActive: true, role: { key: 'owner' } },
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      user: serializeUser(user),
      operator: {
        id: user.operator.id,
        name: user.operator.name,
        slug: user.operator.slug,
        currency: user.operator.currency,
        timeZone: user.operator.timeZone,
      },
      permissions,
      // "Ask Bisola if you need access" (a page your role can't open, 16a).
      owner: owner ? { name: owner.name } : null,
    });
  });

  return router;
}
