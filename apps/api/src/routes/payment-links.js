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
 *   GET  /public/payment-links/:token        the link page's data (the page is the guest web's
 *                                            /pay/:token, stage 12e)
 *   POST /public/payment-links/:token/pay    start the payment → the provider's checkout URL
 *
 * Sending a link by WhatsApp or email arrives with automated messages (session 14).
 */
import { readSite } from '@okapigo/shared/schemas/website';
import { Router } from 'express';
import { z } from 'zod';
import {
  planGuestMessage,
  createPaymentLink,
  findPaymentLink,
  payWithLink,
  cancelPaymentLink,
  allocateReceipt,
  checkPayment,
  BookingError,
  PAYABLE_STATUSES,
} from '@okapigo/db';
import { ProviderError } from '@okapigo/payments';
import { localDate, localTime } from '@okapigo/shared/time';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { serializePayment, serializePaymentLink } from './serializers.js';

const CreateLinkSchema = z.object({
  amountKobo: z.number().int().positive().max(2_000_000_000).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
  // Send it to the guest too (stage 14a: WhatsApp and/or email). false = just make the
  // link, to share some other way.
  send: z.boolean().default(true),
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
 *   webPublicUrl?: string,   // where guests open links (the guest web); default apiPublicUrl
 * }} deps
 */
export function paymentLinksRouters({
  prisma,
  provider,
  apiPublicUrl,
  webPublicUrl = apiPublicUrl,
}) {
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
        const url = `${webPublicUrl}/pay/${token}`;
        // "Here's your payment link" (stage 14a). The link travels in the message's row until
        // it's sent, then the row forgets it: only the message the guest got holds it.
        if (req.body.send) {
          const booking = await prisma.booking.findUniqueOrThrow({
            where: { id: req.params.id },
            include: { product: true, departure: true },
          });
          await planGuestMessage(prisma, {
            booking,
            kind: 'payment_link',
            key: `payment_link:${link.id}`,
            data: {
              url,
              amountKobo: link.amountKobo,
              purpose: link.purpose,
              expiresAt: link.expiresAt.toISOString(),
            },
          });
        }
        // The ONLY time the full URL is revealed: the token isn't stored, only its hash.
        res.status(201).json({ link: serializePaymentLink(link), url });
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
      where: {
        operatorId: authOf(req).operatorId,
        bookingId: null,
        status: 'succeeded',
        // Not already (being) refunded in full. Comparing two COLUMNS of the same row needs a
        // "field reference": prisma.payment.fields.amountKobo.
        refundedKobo: { lt: prisma.payment.fields.amountKobo },
      },
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

  // --- The public link page (the guest web draws it; these are its data, stage 12e) ---------
  const publicRouter = Router();

  /**
   * What the link page shows. Deliberately NO personal details (names, emails, phones):
   * anyone with the link can open it. One `state` the page can show directly:
   *   open · paid · expired · cancelled · out_of_date (the booking now owes less than the
   *   link asks, e.g. someone already paid part: "We never charge more than the booking owes")
   * @param {NonNullable<Awaited<ReturnType<typeof findPaymentLink>>>} link
   * @param {Date} now
   */
  async function linkView(link, now) {
    const { booking, operator } = link;
    const tz = operator.timeZone;
    const owed = booking.totalKobo - booking.amountPaidKobo;
    const paid = await prisma.payment.findFirst({
      where: { paymentLinkId: link.id, status: 'succeeded' },
      orderBy: { paidAt: 'desc' },
    });
    const state =
      link.status === 'paid' || paid
        ? 'paid'
        : link.status === 'cancelled'
          ? 'cancelled'
          : link.status === 'expired' || link.expiresAt <= now
            ? 'expired'
            : owed < link.amountKobo || !PAYABLE_STATUSES.includes(booking.status)
              ? 'out_of_date'
              : 'open';
    return {
      state,
      amountKobo: link.amountKobo,
      purpose: link.purpose, // full · deposit · balance · custom
      operator: {
        slug: operator.slug,
        name: operator.name,
        websiteStyle: operator.websiteStyle, // the look (stage 12g)
        websiteMode: operator.websiteMode,
        logo: readSite(operator.site).logo ?? null, // beside the name (19b-2b)
      },
      tour: { title: booking.product.title },
      departure: {
        localDate: localDate(booking.departure.startsAt, tz),
        localTime: localTime(booking.departure.startsAt, tz),
      },
      reference: booking.reference,
      expiresOn: localDate(link.expiresAt, tz),
      paidOn: paid?.paidAt ? localDate(paid.paidAt, tz) : null,
    };
  }

  publicRouter.get('/public/payment-links/:token', async (req, res) => {
    const link = await findPaymentLink(prisma, req.params.token);
    if (!link) throw new HttpError(404, 'NOT_FOUND', 'This payment link doesn’t exist.');
    res.set('Cache-Control', 'private, no-store').json({ link: await linkView(link, new Date()) });
  });

  /**
   * "Has my payment gone through?" asked by the page Paystack sends the guest back to. Like
   * the booking check (public-checkout.js), it asks the PROVIDER about the link's unfinished
   * payment, because the webhook may never come (a declined card sends none; a computer
   * without a public address gets none). checkPayment settles it through the same webhook path
   * as everything else. Answers with the link's page data, so the page just redraws.
   */
  publicRouter.post('/public/payment-links/:token/check', async (req, res) => {
    const link = await findPaymentLink(prisma, req.params.token);
    if (!link) throw new HttpError(404, 'NOT_FOUND', 'This payment link doesn’t exist.');
    const open = await prisma.payment.findFirst({
      where: { paymentLinkId: link.id, status: 'initiated' },
      orderBy: { createdAt: 'desc' },
    });
    if (open) {
      await checkPayment(prisma, provider, open).catch((err) => {
        req.log.warn({ err, reference: open.reference }, 'payment check failed');
      });
    }
    const fresh = await findPaymentLink(prisma, req.params.token);
    res
      .set('Cache-Control', 'private, no-store')
      .json({ link: await linkView(/** @type {NonNullable<typeof fresh>} */ (fresh), new Date()) });
  });

  publicRouter.post('/public/payment-links/:token/pay', async (req, res) => {
    try {
      const { payment } = await payWithLink(prisma, provider, {
        token: req.params.token,
        method: 'any',
        // Back to the link page, which then says "This link has been paid".
        callbackUrl: `${webPublicUrl}/pay/${req.params.token}/done`,
      });
      if (!payment.authorizationUrl) {
        // A double tap: the first tap's checkout is still being set up.
        throw new HttpError(
          409,
          'PAYMENT_STARTING',
          'Your payment is being set up. Try again in a moment.',
        );
      }
      res.status(201).json({ payment: { authorizationUrl: payment.authorizationUrl } });
    } catch (err) {
      if (err instanceof BookingError) {
        throw new HttpError(err.code === 'NOT_FOUND' ? 404 : 409, err.code, err.message);
      }
      if (err instanceof ProviderError) {
        throw new HttpError(
          502,
          err.code,
          'The payment service is busy. Please try again in a moment.',
        );
      }
      throw err;
    }
  });

  return { apiRouter, publicRouter };
}
