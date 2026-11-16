// @ts-check
/**
 * auth.js — sign-up, sign-in and sign-out (ACC-01). These routes are PUBLIC: you can't be
 * signed in before you've signed in.
 *
 *   POST /auth/signup          { businessName, name, contact } → 202, code sent
 *   POST /auth/signup/verify   { contact, code }               → 201 { token, user, operator }
 *   POST /auth/otp/request     { contact }                     → 202, code sent (if account exists)
 *   POST /auth/otp/verify      { contact, code }               → 200 { token, user }
 *   POST /auth/logout          (signed in)                     → 204
 */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { createOperatorWithPresetRoles } from '@okapigo/db';
import {
  SignupRequestSchema,
  OtpRequestSchema,
  OtpVerifySchema,
} from '@okapigo/shared/schemas/auth';
import { slugify } from '@okapigo/shared/slug';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { serializeUser } from './serializers.js';

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   otp: ReturnType<typeof import('../auth/otp-service.js').createOtpService>,
 *   sessions: ReturnType<typeof import('../auth/session-service.js').createSessionService>,
 *   requireAuth: import('express').RequestHandler,
 * }} deps
 */
export function authRouter({ prisma, otp, sessions, requireAuth }) {
  const router = Router();

  // --- Sign-up: a new business and its owner -----------------------------------------
  router.post('/auth/signup', validate({ body: SignupRequestSchema }), async (req, res) => {
    await otp.requestSignupCode(req.body);
    res.status(202).json({ message: 'We sent you a 6-digit code.' });
  });

  router.post('/auth/signup/verify', validate({ body: OtpVerifySchema }), async (req, res) => {
    const { contact, code } = req.body;
    const challenge = await otp.verifyCode({
      purpose: 'signup',
      destination: contact.destination,
      code,
    });
    const { businessName, name } = /** @type {{ businessName: string, name: string }} */ (
      challenge.payload
    );

    // Create the business, its roles, the owner and their first session, all or nothing.
    const result = await prisma.$transaction(async (tx) => {
      const slug = await uniqueSlug(tx, businessName);
      const { operator, roleIds } = await createOperatorWithPresetRoles(tx, {
        name: businessName,
        slug,
      });
      const owner = await tx.user.create({
        data: {
          operatorId: operator.id,
          roleId: roleIds.owner,
          name,
          [contact.channel === 'email' ? 'email' : 'phone']: contact.destination,
        },
        include: { role: true },
      });
      const token = await sessions.createSession(
        { userId: owner.id, userAgent: req.headers['user-agent'] },
        tx,
      );
      return { operator, owner, token };
    });

    res.status(201).json({
      token: result.token,
      user: serializeUser(result.owner),
      operator: { id: result.operator.id, name: result.operator.name, slug: result.operator.slug },
    });
  });

  // --- Sign-in: existing staff ------------------------------------------------------
  router.post('/auth/otp/request', validate({ body: OtpRequestSchema }), async (req, res) => {
    await otp.requestLoginCode(req.body.contact);
    // Same answer whether or not the account exists (see otp-service.js).
    res.status(202).json({ message: 'If that account exists, we sent it a 6-digit code.' });
  });

  router.post('/auth/otp/verify', validate({ body: OtpVerifySchema }), async (req, res) => {
    const { contact, code } = req.body;
    await otp.verifyCode({ purpose: 'login', destination: contact.destination, code });

    // The code was right. Check the person is still active staff: they could have been
    // deactivated in the 10 minutes since the code was sent.
    const user = await otp.findActiveUser(contact);
    if (!user) throw new HttpError(400, 'INVALID_CODE', 'That code is wrong or has expired.');

    const token = await sessions.createSession({
      userId: user.id,
      userAgent: req.headers['user-agent'],
    });
    const withRole = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { role: true },
    });
    res.json({ token, user: serializeUser(withRole) });
  });

  // --- Sign-out ----------------------------------------------------------------------
  router.post('/auth/logout', requireAuth, async (req, res) => {
    // @ts-ignore: req.auth is added by requireAuth
    await sessions.revokeSession(req.auth.sessionId);
    res.status(204).end();
  });

  return router;
}

/**
 * "Ìrìn Lagos Tours" → "irin-lagos-tours", or "irin-lagos-tours-3f9a" if that's taken.
 * (If two sign-ups race for the same slug, the unique index rejects one; the error handler
 * turns that into a 409 and the person retries.)
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} businessName
 */
async function uniqueSlug(tx, businessName) {
  const base = slugify(businessName, 40) || 'tours';
  const taken = await tx.operator.findUnique({ where: { slug: base }, select: { id: true } });
  return taken ? `${base}-${randomBytes(2).toString('hex')}` : base;
}
