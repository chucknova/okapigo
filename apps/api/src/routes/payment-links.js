// @ts-check
/**
 * Payment links (PAY-05) and unmatched receipts (PAY-03's manual match), stage 10d.
 *
 * Staff API (signed in):
 *   POST /api/bookings/:id/payment-links   bookings: edit    make a link (≤ balance) → URL, ONCE
 *   GET  /api/bookings/:id/payment-links   bookings: view    the booking's links (no URLs)
 *   POST /api/payment-links/:id/cancel     bookings: edit
 *   GET  /api/payments/unmatched           payments: view    money waiting to be matched
 *   POST /api/payments/:id/allocate        payments: edit    "this receipt is for booking X"
 *
 * Public (the guest's browser):
 *   GET  /pay/:token    amount, tour, date, booking reference, and a Pay button
 *   POST /pay/:token    start the payment → redirect to the provider's checkout
 *
 * Sending a link by WhatsApp or email arrives with automated messages (session 14).
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  createPaymentLink,
  findPaymentLink,
  payWithLink,
  cancelPaymentLink,
  allocateReceipt,
  BookingError,
} from '@okapigo/db';
import { ProviderError } from '@okapigo/payments';
import { formatNaira } from '@okapigo/shared/money';
import { localDate, localTime } from '@okapigo/shared/time';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { serializePayment, serializePaymentLink } from './serializers.js';
import { escapeHtml, page } from './payments.js';

const CreateLinkSchema = z.object({
  amountKobo: z.number().int().positive().max(2_000_000_000).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});
const AllocateSchema = z.object({ bookingId: z.uuid() });

/** Domain errors → HTTP. */
function toHttp(err) {
  if (err instanceof BookingError) {
    return new HttpError(err.code === 'NOT_FOUND' ? 404 : 409, err.code, err.message, err.details);
  }
  if (err instanceof ProviderError)
    return new HttpError(502, err.code, `The payment provider said: ${err.message}`);
  return err;
}

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   provider: import('@okapigo/payments').PaymentProvider,
 *   apiPublicUrl: string,
 * }} deps
 */
export function paymentLinksRouters({ prisma, provider, apiPublicUrl }) {
  const apiRouter = Router();
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;

  // --- Links ------------------------------------------------------------------------------
  apiRouter.post(
    '/bookings/:id/payment-links',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema, body: CreateLinkSchema }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      try {
        const { link, token } = await createPaymentLink(prisma, {
          operatorId,
          bookingId: req.params.id,
          amountKobo: req.body.amountKobo,
          expiresInDays: req.body.expiresInDays,
          actor: { type: 'user', userId },
        });
        // The ONLY time the full URL is revealed: the token isn't stored, only its hash.
        res
          .status(201)
          .json({ link: serializePaymentLink(link), url: `${apiPublicUrl}/pay/${token}` });
      } catch (err) {
        throw toHttp(err);
      }
    },
  );

  apiRouter.get(
    '/bookings/:id/payment-links',
    requirePermission('bookings', 'view'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const links = await prisma.paymentLink.findMany({
        where: { bookingId: req.params.id, operatorId: authOf(req).operatorId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      res.json({ links: links.map(serializePaymentLink) });
    },
  );

  apiRouter.post(
    '/payment-links/:id/cancel',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      try {
        await cancelPaymentLink(prisma, {
          operatorId: authOf(req).operatorId,
          linkId: req.params.id,
        });
      } catch (err) {
        throw toHttp(err);
      }
      res.status(204).end();
    },
  );

  // --- Unmatched receipts: the manual-match fallback (PAY-03) ------------------------------
  apiRouter.get('/payments/unmatched', requirePermission('payments', 'view'), async (req, res) => {
    const receipts = await prisma.payment.findMany({
      where: { operatorId: authOf(req).operatorId, bookingId: null, status: 'succeeded' },
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
    });
    // Help staff: show the reference of the booking a receipt was probably meant for.
    const suggestedIds = receipts.map((r) => r.suggestedBookingId).filter((id) => id !== null);
    const suggested = await prisma.booking.findMany({
      where: { id: { in: /** @type {string[]} */ (suggestedIds) } },
      select: { id: true, reference: true },
    });
    const refById = new Map(suggested.map((b) => [b.id, b.reference]));
    res.json({
      receipts: receipts.map((r) => ({
        ...serializePayment(r),
        suggestedBookingReference: r.suggestedBookingId
          ? (refById.get(r.suggestedBookingId) ?? null)
          : null,
      })),
    });
  });

  apiRouter.post(
    '/payments/:id/allocate',
    requirePermission('payments', 'edit'),
    validate({ params: IdParamsSchema, body: AllocateSchema }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      try {
        const { receipt, review } = await allocateReceipt(prisma, {
          operatorId,
          paymentId: req.params.id,
          bookingId: req.body.bookingId,
          actor: { type: 'user', userId },
        });
        res.json({ receipt: serializePayment(receipt), review });
      } catch (err) {
        throw toHttp(err);
      }
    },
  );

  // --- The public link page -----------------------------------------------------------------
  const publicRouter = Router();

  /** A friendly page for a link that can't be used. */
  const unusable = (res, status, message) =>
    res
      .status(status)
      .type('html')
      .send(page('Payment link', `<h1>Payment link</h1><p>${escapeHtml(message)}</p>`));

  publicRouter.get('/pay/:token', async (req, res) => {
    const link = await findPaymentLink(prisma, req.params.token);
    if (!link)
      return unusable(res, 404, 'This payment link doesn’t exist. Check you copied all of it.');
    if (link.status !== 'active' || link.expiresAt <= new Date()) {
      const why =
        link.status === 'paid'
          ? 'has already been paid. Thank you!'
          : link.status === 'active'
            ? 'has expired. Ask the operator for a new one.'
            : `is ${link.status}.`;
      return unusable(res, 410, `This payment link ${why}`);
    }
    // Deliberately NO personal details (no names, emails, phones): anyone with the link can see this page.
    const { booking, operator } = link;
    const tz = operator.timeZone;
    res.type('html').send(
      page(
        `Pay ${operator.name}`,
        `<p style="color:#555">${escapeHtml(operator.name)}</p>
<h1>${escapeHtml(booking.product.title)}</h1>
<p>${escapeHtml(localDate(booking.departure.startsAt, tz))} at ${escapeHtml(localTime(booking.departure.startsAt, tz))} · Booking <code>${escapeHtml(booking.reference)}</code></p>
<p style="font-size:1.5rem">Amount: <strong>${escapeHtml(formatNaira(link.amountKobo))}</strong> (${escapeHtml(link.purpose)})</p>
<form method="post"><button style="padding:.6rem 1.2rem;font-size:1rem">Pay ${escapeHtml(formatNaira(link.amountKobo))}</button></form>
<p style="color:#555">You'll choose card or bank transfer on the next page.</p>`,
      ),
    );
  });

  publicRouter.post('/pay/:token', async (req, res) => {
    try {
      const { payment } = await payWithLink(prisma, provider, {
        token: req.params.token,
        method: 'any',
        callbackUrl: `${apiPublicUrl}/payments/callback`,
      });
      res.redirect(303, /** @type {string} */ (payment.authorizationUrl));
    } catch (err) {
      if (err instanceof BookingError) {
        return unusable(res, err.code === 'NOT_FOUND' ? 404 : 409, err.message);
      }
      if (err instanceof ProviderError)
        return unusable(res, 502, 'The payment service is busy. Please try again in a moment.');
      throw err;
    }
  });

  return { apiRouter, publicRouter };
}
