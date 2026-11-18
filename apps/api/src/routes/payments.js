// @ts-check
/**
 * Payments (PAY-02, stage 10b).
 *
 * Staff API (signed in):
 *   POST /api/bookings/:id/payments   bookings: edit   start a payment (any amount ≤ balance) → checkout URL
 *   GET  /api/bookings/:id/payments   bookings: view   the booking's payment attempts
 *
 * Public pages (no sign-in; the guest's browser lands here):
 *   GET /payments/callback?reference=…   where Paystack sends the guest back afterwards
 *   GET  /simulator/checkout/:reference           the simulator's stand-in for Paystack's page
 *   POST /simulator/checkout/:reference/pay       approve: sends a signed webhook, like Paystack
 *   POST /simulator/checkout/:reference/decline   decline: no webhook, like Paystack
 *   POST /simulator/checkout/:reference/pay-transfer(-short)   a bank transfer (or ₦100 short)
 *   POST /api/simulator/unmatched-transfer          staff demo: money with no reference
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

const StartPaymentSchema = z.object({
  // card, bank_transfer, or "any" (the guest picks on the provider's page)
  method: z.enum(['card', 'bank_transfer', 'any']).default('card'),
  // Default: the whole balance. Less = a deposit (held booking) or part of the balance.
  amountKobo: z.number().int().positive().max(2_000_000_000).optional(),
});

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
export function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5">
${body}</body></html>`;
}

/**
 * startPayment() with its outcomes turned into HTTP answers. Shared by the staff route here
 * and the guest's "Pay" (routes/public-checkout.js), so both answer the same way:
 *   - 409 PAYMENT_STARTING  another click's checkout is still being set up (a second or so):
 *                           try again, rather than making a second checkout
 *   - 404 / 409             booking problems (not found, hold expired, nothing to pay…)
 *   - 502                   the provider failed or refused (WE are fine; it isn't)
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {import('@okapigo/payments').PaymentProvider} provider
 * @param {Parameters<typeof startPayment>[2]} input
 */
export async function startPaymentForHttp(prisma, provider, input) {
  let result;
  try {
    result = await startPayment(prisma, provider, input);
  } catch (err) {
    if (err instanceof BookingError) {
      throw new HttpError(err.code === 'NOT_FOUND' ? 404 : 409, err.code, err.message, err.details);
    }
    if (err instanceof ProviderError) {
      throw new HttpError(502, err.code, `The payment provider said: ${err.message}`);
    }
    throw err;
  }
  if (!result.payment.authorizationUrl) {
    throw new HttpError(
      409,
      'PAYMENT_STARTING',
      'This payment is being set up. Try again in a moment.',
    );
  }
  return result;
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
  /**
   * Where the simulator sends the guest after paying or declining: the callback address the
   * payment was started with (as Paystack does), plus ?reference=…&trxref=…, Paystack's own
   * query. Payments started without one return to the plain callback page below.
   * @param {string} reference
   */
  async function returnAddress(reference) {
    const tx = await /** @type {any} */ (provider).store?.get(reference);
    const base = tx?.callbackUrl ?? `${apiPublicUrl}/payments/callback`;
    const ref = encodeURIComponent(reference);
    return `${base}${base.includes('?') ? '&' : '?'}reference=${ref}&trxref=${ref}`;
  }

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
      const { payment, reused } = await startPaymentForHttp(prisma, provider, {
        operatorId,
        bookingId: req.params.id,
        method: req.body.method,
        amountKobo: req.body.amountKobo,
        callbackUrl: `${apiPublicUrl}/payments/callback`,
        actor: { type: 'user', userId },
      });
      // 200 when an unfinished checkout was reused, 201 when a new one was made.
      res.status(reused ? 200 : 201).json({ payment: serializePayment(payment), reused });
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
    const sim = /** @type {any} */ (provider);
    const webhookUrl = `${apiPublicUrl}/webhooks/paystack`;

    // The simulator's stand-in for Paystack's checkout page: an amount and two buttons.
    publicRouter.get('/simulator/checkout/:reference', async (req, res) => {
      const reference = req.params.reference;
      const tx = await sim.store.get(reference);
      if (!tx) {
        res.status(404).type('html').send(page('Not found', '<h1>No such payment</h1>'));
        return;
      }
      const naira = (tx.amountKobo / 100).toLocaleString('en-NG');
      const action = (verb) => `/simulator/checkout/${encodeURIComponent(reference)}/${verb}`;
      res.type('html').send(
        page(
          'Simulated checkout',
          `<h1>Simulated checkout</h1>
<p>This stands in for Paystack's payment page. <strong>No real money, no real card.</strong></p>
<p style="font-size: 1.5rem">Pay <strong>₦${escapeHtml(naira)}</strong></p>
<p style="color: #555">Reference: <code>${escapeHtml(reference)}</code> · Status: ${escapeHtml(tx.status)}</p>
<form method="post" action="${escapeHtml(action('pay'))}" style="display: inline">
  <button style="padding: .6rem 1.2rem; font-size: 1rem">Pay ₦${escapeHtml(naira)}</button>
</form>
<form method="post" action="${escapeHtml(action('pay-transfer'))}" style="display: inline; margin-left: 1rem">
  <button style="padding: .6rem 1.2rem; font-size: 1rem">Pay by bank transfer</button>
</form>
<form method="post" action="${escapeHtml(action('pay-transfer-short'))}" style="display: inline; margin-left: 1rem">
  <button style="padding: .6rem 1.2rem; font-size: 1rem">Transfer ₦100 too little</button>
</form>
<form method="post" action="${escapeHtml(action('decline'))}" style="display: inline; margin-left: 1rem">
  <button style="padding: .6rem 1.2rem; font-size: 1rem">Decline</button>
</form>`,
        ),
      );
    });

    // "Pay": what Paystack does when a card is approved. Mark it paid, send the SIGNED
    // charge.success webhook to our own webhook URL, then send the browser back.
    publicRouter.post('/simulator/checkout/:reference/pay', async (req, res) => {
      const { reference } = req.params;
      if (!(await sim.store.get(reference))) {
        res.status(404).end();
        return;
      }
      await sim.complete(reference);
      const status = await sim.sendWebhook(reference, webhookUrl);
      req.log.info(
        { reference, webhookStatus: status },
        'simulator: payment approved, webhook sent',
      );
      // 303 See Other: "now GET this page", the standard answer to a submitted form.
      res.redirect(303, await returnAddress(reference));
    });

    // Transfers (stage 10d): the right amount, or ₦100 short, as a guest's typo might be.
    for (const [path, short] of [
      ['pay-transfer', 0],
      ['pay-transfer-short', 10_000],
    ]) {
      publicRouter.post(`/simulator/checkout/:reference/${path}`, async (req, res) => {
        const { reference } = req.params;
        const tx = await sim.store.get(reference);
        if (!tx) {
          res.status(404).end();
          return;
        }
        await sim.complete(reference, {
          channel: 'bank_transfer',
          paidAmountKobo: tx.amountKobo - short,
        });
        await sim.sendWebhook(reference, webhookUrl);
        res.redirect(303, await returnAddress(reference));
      });
    }

    // "Decline": the card was refused. Paystack sends no webhook for that; neither do we.
    publicRouter.post('/simulator/checkout/:reference/decline', async (req, res) => {
      const { reference } = req.params;
      if (!(await sim.store.get(reference))) {
        res.status(404).end();
        return;
      }
      await sim.fail(reference, 'Declined by the simulator');
      res.redirect(303, await returnAddress(reference));
    });
  }

  if (provider.name === 'simulator') {
    // Staff demo tool: money arrives in the operator's account with NO reference (stage 10d),
    // so it lands in "unmatched receipts" for manual matching.
    apiRouter.post(
      '/simulator/unmatched-transfer',
      requirePermission('payments', 'edit'),
      validate({ body: z.object({ amountKobo: z.number().int().positive().max(2_000_000_000) }) }),
      async (req, res) => {
        const sim = /** @type {any} */ (provider);
        const reference = await sim.createUnmatchedTransfer(
          authOf(req).operatorId,
          req.body.amountKobo,
        );
        const status = await sim.sendWebhook(reference, `${apiPublicUrl}/webhooks/paystack`);
        res.status(202).json({ reference, webhookStatus: status });
      },
    );
  }

  return { publicRouter, apiRouter };
}
