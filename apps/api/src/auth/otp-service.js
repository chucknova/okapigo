// @ts-check
/**
 * otp-service.js — one-time codes for sign-up and sign-in (ACC-01).
 *
 * The flow:
 *   1. requestLoginCode / requestSignupCode
 *        → creates an OtpChallenge row (storing only an HMAC of the code)
 *        → sends the code through the injected OtpSender
 *   2. verifyCode
 *        → checks the code; on success marks the challenge consumed and returns it
 *   (routes/auth.js then creates the session and, for sign-ups, the business itself)
 *
 * Limits that make a 6-digit code safe:
 *   - expires after 10 minutes
 *   - at most 5 guesses per code, enforced ATOMICALLY (see verifyCode)
 *   - usable once
 *   - at most 1 code per 30 seconds and 5 per hour for any one email/phone
 */
import { HttpError } from '../middleware/errors.js';
import { generateOtpCode, hashOtpCode, safeEqual } from '../lib/secrets.js';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
const MIN_INTERVAL_MS = 30 * 1000;
const MAX_PER_HOUR = 5;

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   otpSender: import('./otp-sender.js').OtpSender,
 *   authSecret: string,
 * }} deps
 */
export function createOtpService({ prisma, otpSender, authSecret }) {
  /**
   * Refuses if this address has asked for codes too often. Without this, anyone could
   * spam a person's phone or inbox with codes (and run up our email/SMS bill).
   * @param {string} destination
   */
  async function enforceRateLimit(destination) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await prisma.otpChallenge.findMany({
      where: { destination, createdAt: { gte: hourAgo } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    const tooSoon = recent[0] && Date.now() - recent[0].createdAt.getTime() < MIN_INTERVAL_MS;
    if (tooSoon || recent.length >= MAX_PER_HOUR) {
      throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many codes requested. Try again shortly.');
    }
  }

  /**
   * Creates the challenge row and sends the code.
   * @param {{ purpose: 'login' | 'signup', channel: 'email' | 'phone', destination: string, payload?: object }} input
   */
  async function issue({ purpose, channel, destination, payload }) {
    const code = generateOtpCode();
    await prisma.otpChallenge.create({
      data: {
        purpose,
        channel,
        destination,
        codeHash: hashOtpCode(authSecret, code),
        payload: payload ?? undefined,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    await otpSender.send({ channel, destination, code, purpose });
  }

  /**
   * Finds an ACTIVE staff member by email or phone.
   * @param {{ channel: 'email' | 'phone', destination: string }} contact
   */
  function findActiveUser({ channel, destination }) {
    return prisma.user.findFirst({
      where: { [channel === 'email' ? 'email' : 'phone']: destination, isActive: true },
    });
  }

  return {
    findActiveUser,

    /**
     * "Send me a sign-in code." Deliberately behaves the SAME whether or not the account
     * exists: the route always answers 202 "if that account exists, we sent a code". So
     * nobody can use this endpoint to discover which emails/phones belong to staff
     * ("account enumeration").
     * @param {{ channel: 'email' | 'phone', destination: string }} contact
     */
    async requestLoginCode(contact) {
      await enforceRateLimit(contact.destination);
      const user = await findActiveUser(contact);
      if (!user) return; // silently do nothing
      await issue({ purpose: 'login', ...contact });
    },

    /**
     * "Create my business." Nothing is created yet: the details wait in the challenge's
     * payload until the code is verified, so abandoned sign-ups leave no half-made data.
     *
     * Unlike login, this DOES say when an email/phone is already registered (409). Telling
     * a real business owner "you already have an account, sign in instead" is worth more
     * than hiding it, and staff contact details aren't very secret. A conscious trade-off.
     * @param {{ businessName: string, name: string, contact: { channel: 'email' | 'phone', destination: string } }} input
     */
    async requestSignupCode({ businessName, name, contact }) {
      await enforceRateLimit(contact.destination);
      if (
        await prisma.user.findFirst({
          where: { [contact.channel === 'email' ? 'email' : 'phone']: contact.destination },
        })
      ) {
        throw new HttpError(
          409,
          'CONTACT_IN_USE',
          'That email or phone already has an account. Sign in instead.',
        );
      }
      await issue({ purpose: 'signup', ...contact, payload: { businessName, name } });
    },

    /**
     * Checks a code. Returns the consumed challenge, or throws 400 INVALID_CODE.
     * Every failure reason (wrong, expired, used, too many tries, no such challenge) gives the
     * SAME error, so an attacker learns nothing about why.
     *
     * The race condition this avoids: a naive version reads `attempts`, compares the code,
     * then increments `attempts`. An attacker who sends 1,000 guesses AT THE SAME TIME
     * would have every request read attempts = 0 before any increment lands: 1,000 tries
     * instead of 5.
     *
     * So each guess first CLAIMS an attempt with one atomic UPDATE:
     *   UPDATE otp_challenges SET attempts = attempts + 1
     *   WHERE id = ? AND attempts < 5 AND consumed_at IS NULL AND expires_at > now()
     * The database applies these one at a time, so only 5 claims can ever succeed. Only a
     * request whose claim succeeded gets to compare the code.
     *
     * @param {{ purpose: 'login' | 'signup', destination: string, code: string }} input
     */
    async verifyCode({ purpose, destination, code }) {
      const invalid = new HttpError(400, 'INVALID_CODE', 'That code is wrong or has expired.');
      const now = new Date();

      // The newest live challenge for this address (asking again replaces older codes).
      const challenge = await prisma.otpChallenge.findFirst({
        where: { purpose, destination, consumedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
      });
      if (!challenge) throw invalid;

      // Step 1: atomically claim one attempt (see the explanation above).
      const claimed = await prisma.otpChallenge.updateMany({
        where: {
          id: challenge.id,
          attempts: { lt: OTP_MAX_ATTEMPTS },
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { attempts: { increment: 1 } },
      });
      if (claimed.count === 0) throw invalid;

      // Step 2: compare in constant time.
      if (!safeEqual(hashOtpCode(authSecret, code), challenge.codeHash)) throw invalid;

      // Step 3: consume it. The `consumedAt: null` condition means if two correct
      // submissions race, only one wins: a code works exactly once.
      const consumed = await prisma.otpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count === 0) throw invalid;

      return challenge;
    },
  };
}
