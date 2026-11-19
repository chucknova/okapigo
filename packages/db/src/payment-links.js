// @ts-check
/**
 * payment-links.js — "pay ₦X towards booking ILT-7K4Q2M" as a URL (PAY-05, stage 10d).
 *
 *   createPaymentLink  staff choose an amount (≤ what's owed) → a URL with a random token
 *   findPaymentLink    the public page looks the link up by its token
 *   payWithLink        the guest clicks Pay → startPayment() with the link's amount
 *   cancelPaymentLink  staff withdraw a link
 *
 * THE TOKEN is 24 random bytes (192 bits) in the URL. Like session tokens (session 3), only
 * its SHA-256 hash is stored: a database leak doesn't hand out working links, and the full
 * URL is shown once, when the link is made. Anyone holding the link can only PAY money
 * towards the booking, and the page shows no personal details.
 */
import { createHash, randomBytes } from 'node:crypto';
import { BookingError } from './booking-lifecycle.js';
import { payableBalance, startPayment } from './payments.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {string} token */
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{
 *   operatorId: string,
 *   bookingId: string,
 *   amountKobo?: number,      // default: the whole balance
 *   expiresInDays?: number,
 *   actor: import('./booking-lifecycle.js').Actor,
 *   now?: Date,
 * }} input
 * @returns {Promise<{ link: import('@prisma/client').PaymentLink, token: string }>}
 */
export async function createPaymentLink(
  prisma,
  { operatorId, bookingId, amountKobo, expiresInDays = 7, actor, now = new Date() },
) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, operatorId },
    include: { hold: true },
  });
  if (!booking) throw new BookingError('NOT_FOUND', 'Booking not found.');
  const { balanceKobo } = payableBalance(booking, now);

  const amount = amountKobo ?? balanceKobo;
  if (amount > balanceKobo) {
    throw new BookingError('AMOUNT_TOO_HIGH', 'A link can’t ask for more than is owed.', {
      balanceKobo,
    });
  }
  // full: the whole price, nothing paid yet (the WhatsApp assistant's link, stage 13b)
  // balance: what's left after a deposit · deposit: part, before anything was paid · custom
  const purpose =
    amount === balanceKobo
      ? booking.amountPaidKobo === 0
        ? 'full'
        : 'balance'
      : booking.status === 'held'
        ? 'deposit'
        : 'custom';

  const token = randomBytes(24).toString('base64url');
  const link = await prisma.paymentLink.create({
    data: {
      operatorId,
      bookingId,
      tokenHash: hashToken(token),
      amountKobo: amount,
      purpose,
      expiresAt: new Date(now.getTime() + expiresInDays * DAY_MS),
      createdById: actor.type === 'user' ? actor.userId : null,
    },
  });
  await prisma.bookingEvent.create({
    data: {
      operatorId,
      bookingId,
      type: 'payment_link_created',
      actorType: actor.type,
      actorUserId: actor.type === 'user' ? actor.userId : null,
      data: { paymentLinkId: link.id, amountKobo: amount, purpose },
    },
  });
  return { link, token };
}

/**
 * Looks a link up by the token in its URL, with what the public page needs to show.
 * Returns null for unknown tokens.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} token
 */
export function findPaymentLink(prisma, token) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return Promise.resolve(null);
  return prisma.paymentLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { booking: { include: { product: true, departure: true } }, operator: true },
  });
}

/**
 * The guest clicked "Pay" on the link's page.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ name: string, initializeTransaction: Function }} provider
 * @param {{ token: string, method?: 'card' | 'bank_transfer' | 'any', callbackUrl: string, now?: Date }} input
 */
export async function payWithLink(
  prisma,
  provider,
  { token, method = 'any', callbackUrl, now = new Date() },
) {
  const link = await findPaymentLink(prisma, token);
  if (!link) throw new BookingError('NOT_FOUND', 'This payment link doesn’t exist.');
  if (link.status !== 'active') {
    throw new BookingError(
      `LINK_${link.status.toUpperCase()}`,
      `This payment link is ${link.status}.`,
    );
  }
  if (link.expiresAt <= now) {
    await prisma.paymentLink.updateMany({
      where: { id: link.id, status: 'active' },
      data: { status: 'expired' },
    });
    throw new BookingError('LINK_EXPIRED', 'This payment link has expired. Ask for a new one.');
  }

  // startPayment re-checks everything (still payable? amount ≤ what's owed NOW?), so a link
  // made before someone paid part of the balance can't overcharge the guest.
  return startPayment(prisma, provider, {
    operatorId: link.operatorId,
    bookingId: link.bookingId,
    method,
    amountKobo: link.amountKobo,
    paymentLink: { id: link.id, purpose: link.purpose },
    callbackUrl,
    actor: { type: 'guest' },
    now,
  });
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, linkId: string }} input
 */
export async function cancelPaymentLink(prisma, { operatorId, linkId }) {
  const { count } = await prisma.paymentLink.updateMany({
    where: { id: linkId, operatorId, status: 'active' },
    data: { status: 'cancelled' },
  });
  if (count === 0) {
    const exists = await prisma.paymentLink.findFirst({ where: { id: linkId, operatorId } });
    throw new BookingError(
      exists ? 'LINK_NOT_ACTIVE' : 'NOT_FOUND',
      exists ? `This link is already ${exists.status}.` : 'Link not found.',
    );
  }
}
