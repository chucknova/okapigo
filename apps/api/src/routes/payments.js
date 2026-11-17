// @ts-check
/**
 * Payments (PAY-02, stage 10b).
 *
 * Staff API (signed in):
 *   POST /api/bookings/:id/payments   bookings: edit   start a card payment → checkout URL
 *   GET  /api/bookings/:id/payments   bookings: view   the booking's payment attempts
 *
 * Public pages (no sign-in; the guest's browser lands here):
 *   GET /payments/callback?reference=…   where Paystack sends the guest back afterwards
 *   GET /simulator/checkout/:reference   the simulator's stand-in for Paystack's page
 *
 * IMPORTANT: the callback page changes NOTHING. Anyone can type that URL, so arriving there
 * proves nothing. A payment becomes "succeeded" only through a verified webhook (stage 10c).
 * The page just says "we're confirming your payment".
 */
import { Router } from 'express';
import { z } from 'zod';
import { startPayment, BookingError } from '@okapigo/db';
import { ProviderError } from '@okapigo/payments';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { serializePayment } from './serializers.js';

const StartPaymentSchema = z.object({ method: z.enum(['card']).default('card') });

/**
 * Makes text safe to put inside HTML. Without this, a link like
 *   /payments/callback?reference=<script>steal()</script>
 * would run the attacker's script on OUR page ("cross-site scripting", XSS).
 * @param {unknown} value
 */
export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );
}

/** A tiny, self-contained page (the real guest pages arrive with the guest web, session 11). */
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5">
${body}</body></html>`;
}

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   provider: import('@okapigo/payments').PaymentProvider,
 *   apiPublicUrl: string,
 * }} deps
 * @returns {{ publicRouter: import('express').Router, apiRouter: import('express').Router }}
 */
export function paymentsRouters({ prisma, provider, apiPublicUrl }) {
  // --- Staff API -------------------------------------------------------------------------
  const apiRouter = Router();
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;

  apiRouter.post(
    '/bookings/:id/payments',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema, body: StartPaymentSchema }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      try {
        const { payment, reused } = await startPayment(prisma, provider, {
          operatorId,
          bookingId: req.params.id,
          method: req.body.method,
          callbackUrl: `${apiPublicUrl}/payments/callback`,
          actor: { type: 'user', userId },
        });
        // 200 when an unfinished checkout was reused, 201 when a new one was made.
        res.status(reused ? 200 : 201).json({ payment: serializePayment(payment), reused });
      } catch (err) {
        if (err instanceof BookingError) {
          throw new HttpError(err.code === 'NOT_FOUND' ? 404 : 409, err.code, err.message);
        }
        if (err instanceof ProviderError) {
          // 502 Bad Gateway: WE are fine; the service we depend on failed or refused.
          throw new HttpError(502, err.code, `The payment provider said: ${err.message}`);
        }
        throw err;
      }
    },
  );

  apiRouter.get(
    '/bookings/:id/payments',
    requirePermission('bookings', 'view'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const booking = await prisma.booking.findFirst({
        where: { id: req.params.id, operatorId: authOf(req).operatorId },
        include: { payments: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] } },
      });
      if (!booking) throw new HttpError(404, 'NOT_FOUND', 'Booking not found.');
      res.json({ payments: booking.payments.map(serializePayment) });
    },
  );

  // --- Public pages ------------------------------------------------------------------------
  const publicRouter = Router();

  publicRouter.get('/payments/callback', (req, res) => {
    // Paystack appends ?trxref=…&reference=…; we only DISPLAY it (escaped), never trust it.
    const reference = String(req.query.reference ?? req.query.trxref ?? '').slice(0, 64);
    res.type('html').send(
      page(
        'Confirming your payment',
        `<h1>Thank you</h1>
<p>We're confirming your payment with the bank. Your booking confirmation will arrive by
email or WhatsApp in a moment. You can close this page.</p>
<p style="color: #555">Payment reference: <code>${escapeHtml(reference || 'unknown')}</code></p>`,
      ),
    );
  });

  if (provider.name === 'simulator') {
    publicRouter.get('/simulator/checkout/:reference', (req, res) => {
      res.type('html').send(
        page(
          'Simulated checkout',
          `<h1>Simulated checkout</h1>
<p>This stands in for Paystack's payment page (no real money, no network).</p>
<p>Reference: <code>${escapeHtml(req.params.reference)}</code></p>
<p>Stage 10c adds "Pay" and "Decline" buttons here that send webhooks, just like Paystack.</p>`,
        ),
      );
    });
  }

  return { publicRouter, apiRouter };
}
