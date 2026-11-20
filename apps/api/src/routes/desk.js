// @ts-check
/**
 * The office's bookings desk (stage 16c; designs O8 Bookings).
 *
 *   GET  /api/desk/bookings?filter=&q=   bookings: edit   find: today · upcoming · owes · cash ·
 *                                                         cancelled · all; reference, name or phone
 *   GET  /api/desk/bookings/:id          bookings: edit   one booking's page, in words
 *   POST /api/bookings/:id/notes         bookings: edit   a note on the timeline (and the manifest)
 *   POST /api/cash-reports/:id/confirm   payments: edit   cash handed in (or another amount) (16c-2)
 *   POST /api/cash-reports/:id/not-received  payments: edit   not handed in: the owner is alerted
 *   POST /api/bookings/:id/refunds/bank-transfer  payments: edit   a refund the business sent itself
 *   GET  /api/bookings/:id/move-options       bookings: edit   the tour's other dates, seats free (16d-2)
 *   POST /api/bookings/:id/move               bookings: edit   { departureId, requestId? }: moved,
 *                                                               the guest told ("Date changed")
 *   POST /api/bookings/:id/travellers/preview  bookings: edit   what a change would do (16c-3)
 *   POST /api/bookings/:id/travellers/change   bookings: edit   do it; send a link for the extra,
 *                                                               or start the policy's refund
 *
 * Changes go through the routes already there: DELETE /api/holds/:id (release the seats),
 * POST /api/departures/:id/check-ins (no-shows from the desk, 15a), and in 16c-2 the money.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  deskList,
  deskBooking,
  addNote,
  confirmCash,
  cashNotReceived,
  recordBankRefund,
  previewTravellerChange,
  saveTravellerChange,
  requestBookingRefund,
  createPaymentLink,
  planGuestMessage,
  moveOptions,
  moveBooking,
  DESK_FILTERS,
} from '@okapigo/db';
import { zonedTimeToUtc } from '@okapigo/shared/time';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { toHttp } from './bookings.js';

const ListQuery = z.object({
  filter: z.enum(DESK_FILTERS).default('today'),
  q: z.string().trim().max(100).default(''),
});
const ConfirmCashBody = z.object({
  // What was really handed in, if not what the guide reported.
  amountKobo: z.number().int().positive().max(2_000_000_000).optional(),
});
const BankRefundBody = z.object({
  amountKobo: z.number().int().positive().max(2_000_000_000),
  sentOn: z.iso.date(),
  reference: z.string().trim().min(3).max(60),
});
const ChangeBody = z.object({
  remove: z.array(z.uuid()).max(50).default([]),
  add: z
    .array(
      z.object({
        categoryKey: z.string().trim().min(1).max(40),
        name: z.string().max(200).optional(),
        age: z.number().int().min(0).max(120).nullable().optional(),
      }),
    )
    .max(50)
    .default([]),
});
const SaveChangeBody = ChangeBody.extend({
  // The refund the office saw and confirmed (fewer travellers): must still be the policy's.
  refundKobo: z.number().int().min(0).optional(),
  // "Save and send a link for ₦35,000": the extra, to the guest (WhatsApp and email).
  sendLink: z.boolean().default(true),
});
const MoveBody = z.object({ departureId: z.uuid(), requestId: z.uuid().optional() });
const NoteBody = z.object({
  text: z.string().trim().min(1).max(1000),
  onManifest: z.boolean().default(false),
});

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   provider?: import('@okapigo/payments').PaymentProvider,
 *   webPublicUrl?: string,
 * }} deps
 */
export function deskRouter({ prisma, provider, webPublicUrl = '' }) {
  const router = Router();
  /** @param {any} req */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;
  /** @param {() => Promise<any>} fn */
  const domain = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      throw toHttp(err);
    }
  };
  const fresh = (/** @type {any} */ res) => res.set('Cache-Control', 'private, no-store');

  router.get(
    '/desk/bookings',
    requirePermission('bookings', 'edit'),
    validate({ query: ListQuery }),
    async (req, res) => {
      const { filter, q } = /** @type {any} */ (req.query);
      fresh(res).json({
        list: await deskList(prisma, { operatorId: authOf(req).operatorId, filter, q }),
      });
    },
  );

  router.get(
    '/desk/bookings/:id',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const booking = await domain(() =>
        deskBooking(prisma, { operatorId: authOf(req).operatorId, bookingId: req.params.id }),
      );
      fresh(res).json({ booking });
    },
  );

  router.post(
    '/bookings/:id/notes',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema, body: NoteBody }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const note = await domain(() =>
        addNote(prisma, { operatorId, bookingId: req.params.id, userId, ...req.body }),
      );
      res.status(201).json({ note: { id: note.id, createdAt: note.createdAt } });
    },
  );

  router.post(
    '/cash-reports/:id/confirm',
    requirePermission('payments', 'edit'),
    validate({ params: IdParamsSchema, body: ConfirmCashBody }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const result = await domain(() =>
        confirmCash(prisma, {
          operatorId,
          cashReportId: req.params.id,
          userId,
          amountKobo: req.body.amountKobo,
        }),
      );
      res.json({ cash: result });
    },
  );

  router.post(
    '/cash-reports/:id/not-received',
    requirePermission('payments', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const result = await domain(() =>
        cashNotReceived(prisma, { operatorId, cashReportId: req.params.id, userId }),
      );
      res.json({ cash: result });
    },
  );

  router.post(
    '/bookings/:id/refunds/bank-transfer',
    requirePermission('payments', 'edit'),
    validate({ params: IdParamsSchema, body: BankRefundBody }),
    async (req, res) => {
      const { operatorId, userId, timeZone } = authOf(req);
      const result = await domain(() =>
        recordBankRefund(prisma, {
          operatorId,
          bookingId: req.params.id,
          userId,
          amountKobo: req.body.amountKobo,
          // The start of that day where the business is: "today" is never in the future.
          sentOn: zonedTimeToUtc(req.body.sentOn, '00:00', timeZone),
          reference: req.body.reference,
        }),
      );
      res.status(201).json({ refund: result });
    },
  );

  router.get(
    '/bookings/:id/move-options',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const options = await domain(() =>
        moveOptions(prisma, { operatorId: authOf(req).operatorId, bookingId: req.params.id }),
      );
      fresh(res).json({ options });
    },
  );

  router.post(
    '/bookings/:id/move',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema, body: MoveBody }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const moved = await domain(() =>
        moveBooking(prisma, {
          operatorId,
          bookingId: req.params.id,
          departureId: req.body.departureId,
          requestId: req.body.requestId,
          userId,
        }),
      );
      res.json({ moved });
    },
  );

  router.post(
    '/bookings/:id/travellers/preview',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema, body: ChangeBody }),
    async (req, res) => {
      const plan = await domain(() =>
        previewTravellerChange(prisma, {
          operatorId: authOf(req).operatorId,
          bookingId: req.params.id,
          change: req.body,
        }),
      );
      fresh(res).json({ plan: shownPlan(plan) });
    },
  );

  router.post(
    '/bookings/:id/travellers/change',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema, body: SaveChangeBody }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const bookingId = req.params.id;
      const plan = await domain(() =>
        saveTravellerChange(prisma, {
          operatorId,
          bookingId,
          change: { remove: req.body.remove, add: req.body.add },
          userId,
          refundKobo: req.body.refundKobo,
        }),
      );
      // Then the money, after the change is saved (each can fail without undoing it).
      /** @type {{ sent: boolean, amountKobo?: number, problem?: string } | null} */
      let link = null;
      if (req.body.sendLink && plan.extraKobo > 0 && plan.owedAfterKobo > 0) {
        const amountKobo = Math.min(plan.extraKobo, plan.owedAfterKobo);
        try {
          const made = await createPaymentLink(prisma, {
            operatorId,
            bookingId,
            amountKobo,
            actor: { type: 'user', userId },
          });
          const booking = await prisma.booking.findUniqueOrThrow({
            where: { id: bookingId },
            include: { product: true, departure: true },
          });
          await planGuestMessage(prisma, {
            booking,
            kind: 'payment_link',
            key: `payment_link:${made.link.id}`,
            data: {
              url: `${webPublicUrl}/pay/${made.token}`,
              amountKobo,
              purpose: made.link.purpose,
              expiresAt: made.link.expiresAt.toISOString(),
            },
          });
          link = { sent: true, amountKobo };
        } catch (err) {
          link = { sent: false, problem: /** @type {Error} */ (err).message };
        }
      }
      /** @type {{ started: boolean, problem?: string } | null} */
      let refundStart = null;
      if (plan.refund && plan.refund.policyKobo > 0 && provider) {
        try {
          await requestBookingRefund(prisma, provider, {
            operatorId,
            bookingId,
            amountKobo: plan.refund.policyKobo,
            reason: 'Fewer travellers',
            actor: { type: 'user', userId },
          });
          refundStart = { started: true };
        } catch (err) {
          refundStart = { started: false, problem: /** @type {Error} */ (err).message };
        }
      }
      res.json({ plan: shownPlan(plan), link, refundStart });
    },
  );

  return router;
}

/** The plan without the full quote (the sheet needs the totals). @param {any} plan */
const shownPlan = ({ quote: _quote, adding: _adding, ...rest }) => rest;
