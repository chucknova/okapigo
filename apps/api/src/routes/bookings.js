// @ts-check
/**
 * Bookings (BKG-23, BKG-25). Staff routes; the public checkout (session 11) reuses the same
 * createBooking() with channel "web".
 *
 *   POST  /api/bookings                                bookings: edit   create (status "held")
 *   GET   /api/bookings                                bookings: view   list / search
 *   GET   /api/bookings/:id                            bookings: view   full detail + timeline
 *   POST  /api/bookings/:id/confirm                    bookings: edit   pay later: held → confirmed
 *   POST  /api/bookings/:id/status                     bookings: edit   completed
 *   GET   /api/bookings/:id/cancellation-quote         bookings: view   what a cancel WOULD refund
 *   POST  /api/bookings/:id/cancel                     bookings: edit   (+ payments: edit to override)
 *   POST  /api/bookings/:id/no-show                    bookings: edit
 *   PATCH /api/bookings/:id/travellers/:travellerId    bookings: edit   correct details
 *
 * Every status change goes through the lifecycle module (packages/db/src/booking-lifecycle.js),
 * which enforces the allowed moves and writes the timeline.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  createBooking,
  confirmBooking,
  setBookingStatus,
  updateTraveller,
  previewCancellation,
  cancelBooking,
  markNoShow,
  BookingError,
  HoldError,
} from '@okapigo/db';
import { hasAccess } from '@okapigo/shared/permissions';
import { CancelBookingSchema } from '@okapigo/shared/schemas/cancellation';
import { findCategoryForAge } from '@okapigo/shared/catalogue';
import {
  CreateBookingSchema,
  UpdateTravellerSchema,
  SetBookingStatusSchema,
  ListBookingsQuerySchema,
} from '@okapigo/shared/schemas/bookings';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { serializeBooking, serializeBookingSummary } from './serializers.js';

const PAGE_SIZE = 50;

/** Everything the detail view shows. */
const FULL = {
  travellers: { orderBy: { position: 'asc' } },
  addOns: { include: { addOn: true } },
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  hold: true,
  departure: true,
  product: true,
  payments: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
  refunds: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
};

/** Mistakes in the REQUEST (fix the input and resend), as opposed to conflicts with state. */
export const BAD_INPUT_CODES = new Set(['PICKUP_POINT_REQUIRED', 'UNKNOWN_PICKUP_POINT']);

/**
 * Turns domain errors into HTTP errors: "not found" → 404, bad input → 400, everything else
 * (sold out, hold expired…) → 409 Conflict.
 */
export function toHttp(err) {
  if (err instanceof BookingError || err instanceof HoldError) {
    const status =
      err.code === 'NOT_FOUND' || err.code === 'DEPARTURE_NOT_FOUND'
        ? 404
        : BAD_INPUT_CODES.has(err.code)
          ? 400
          : 409;
    return new HttpError(status, err.code, err.message, err.details);
  }
  return err;
}

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   quotes: ReturnType<typeof import('../pricing/quote-service.js').createQuoteService>,
 *   jobs: { scheduleHoldExpiry: (holdId: string, expiresAt: Date) => Promise<void> },
 * }} deps
 */
export function bookingsRouter({ prisma, quotes, jobs }) {
  const router = Router();

  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;
  /** The actor recorded on the timeline for staff actions. */
  const actorOf = (req) => ({ type: /** @type {const} */ ('user'), userId: authOf(req).userId });

  async function loadFull(operatorId, id, timeZone) {
    const booking = await prisma.booking.findFirst({ where: { id, operatorId }, include: FULL });
    if (!booking) throw new HttpError(404, 'NOT_FOUND', 'Booking not found.');
    return serializeBooking(booking, timeZone);
  }

  // --- Create -----------------------------------------------------------------------
  router.post(
    '/bookings',
    requirePermission('bookings', 'edit'),
    validate({ body: CreateBookingSchema }),
    async (req, res) => {
      const { operatorId, timeZone } = authOf(req);
      const { departureId, lead, travellers, addOns, notes, pickupPoint } = req.body;

      const departure = await prisma.departure.findFirst({
        where: { id: departureId, operatorId },
        include: { product: { include: { operator: true } } },
      });
      if (!departure) throw new HttpError(404, 'NOT_FOUND', 'Departure not found.');

      // 1. Price it with the shared pipeline (same as every channel).
      const { quote, priceCategories } = await quotes.quoteForBooking({
        operatorId,
        productId: departure.productId,
        travellers: travellers.map((t) => ({ age: t.age })),
        addOns,
      });

      // 2. Record which category each traveller was charged as, and add-on unit prices,
      //    straight from the quote so the booking matches what was priced.
      const withCategories = travellers.map((t) => ({
        ...t,
        categoryKey: /** @type {{ key: string }} */ (findCategoryForAge(priceCategories, t.age))
          .key,
      }));
      const addOnLines = quote.lines.filter((l) => l.type === 'addOn');

      // 3. Hold the seats and create the booking, all-or-nothing.
      let created;
      try {
        created = await createBooking(prisma, {
          operatorId,
          operatorSlug: departure.product.operator.slug,
          departureId,
          productId: departure.productId,
          channel: 'staff',
          lead: {
            name: lead.name,
            email: lead.email ?? null,
            phone: lead.phone ?? null,
            marketingConsent: lead.marketingConsent,
          },
          travellers: withCategories,
          addOns: addOnLines.map((l) => ({
            addOnId: l.addOnId,
            quantity: l.quantity,
            unitKobo: l.unitKobo,
          })),
          quote,
          totalKobo: quote.totalKobo,
          holdMinutes: departure.product.operator.holdMinutes,
          notes,
          pickupPointName: pickupPoint ?? null,
          actor: actorOf(req),
        });
      } catch (err) {
        throw toHttp(err);
      }

      // 4. Schedule the hold's expiry (if this fails, the sweeper is the safety net).
      try {
        await jobs.scheduleHoldExpiry(created.hold.id, created.hold.expiresAt);
      } catch (err) {
        req.log.warn(
          { err, holdId: created.hold.id },
          'could not schedule hold expiry; sweeper will handle it',
        );
      }

      res.status(201).json({ booking: await loadFull(operatorId, created.booking.id, timeZone) });
    },
  );

  // --- Read -------------------------------------------------------------------------
  router.get('/bookings', requirePermission('bookings', 'view'), async (req, res) => {
    const parsed = ListBookingsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid filters.');
    const { status, departureId, q, page } = parsed.data;
    const { operatorId, timeZone } = authOf(req);

    const where = {
      operatorId,
      status,
      departureId,
      ...(q && {
        OR: [
          { reference: { contains: q.toUpperCase() } },
          { leadName: { contains: q, mode: /** @type {const} */ ('insensitive') } },
          { leadEmail: { contains: q.toLowerCase() } },
          { leadPhone: { contains: q.replace(/\s/g, '') } },
        ],
      }),
    };
    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: { departure: true, product: true, _count: { select: { travellers: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.booking.count({ where }),
    ]);
    res.json({
      bookings: bookings.map((b) => serializeBookingSummary(b, timeZone)),
      page,
      pageSize: PAGE_SIZE,
      total,
    });
  });

  router.get(
    '/bookings/:id',
    requirePermission('bookings', 'view'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const { operatorId, timeZone } = authOf(req);
      res.json({ booking: await loadFull(operatorId, req.params.id, timeZone) });
    },
  );

  // --- Lifecycle --------------------------------------------------------------------
  router.post(
    '/bookings/:id/confirm',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const { operatorId, timeZone } = authOf(req);
      try {
        await confirmBooking(prisma, { operatorId, bookingId: req.params.id, actor: actorOf(req) });
      } catch (err) {
        throw toHttp(err);
      }
      res.json({ booking: await loadFull(operatorId, req.params.id, timeZone) });
    },
  );

  router.post(
    '/bookings/:id/status',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema, body: SetBookingStatusSchema }),
    async (req, res) => {
      const { operatorId, timeZone } = authOf(req);
      try {
        await setBookingStatus(prisma, {
          operatorId,
          bookingId: req.params.id,
          to: req.body.status,
          actor: actorOf(req),
        });
      } catch (err) {
        throw toHttp(err);
      }
      res.json({ booking: await loadFull(operatorId, req.params.id, timeZone) });
    },
  );

  // --- Cancelling and no-shows (BKG-26) ---------------------------------------------
  router.get(
    '/bookings/:id/cancellation-quote',
    requirePermission('bookings', 'view'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const initiatedBy = req.query.initiatedBy === 'operator' ? 'operator' : 'guest';
      try {
        const refund = await previewCancellation(prisma, {
          operatorId: authOf(req).operatorId,
          bookingId: req.params.id,
          initiatedBy,
        });
        res.json({ initiatedBy, refund });
      } catch (err) {
        throw toHttp(err);
      }
    },
  );

  router.post(
    '/bookings/:id/cancel',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema, body: CancelBookingSchema }),
    async (req, res) => {
      const { operatorId, timeZone, permissions } = authOf(req);
      // Choosing the refund yourself is a money decision, so it also needs payments: edit
      // (managers and owners have it; a custom "front desk" role might not).
      if (
        req.body.refundOverrideKobo !== undefined &&
        !hasAccess(permissions.payments ?? 'none', 'edit')
      ) {
        throw new HttpError(
          403,
          'FORBIDDEN',
          'You need edit access to payments to set the refund yourself.',
        );
      }
      let refund;
      try {
        refund = await cancelBooking(prisma, {
          operatorId,
          bookingId: req.params.id,
          initiatedBy: req.body.initiatedBy,
          reason: req.body.reason,
          refundOverrideKobo: req.body.refundOverrideKobo,
          actor: actorOf(req),
        });
      } catch (err) {
        throw toHttp(err);
      }
      res.json({ refund, booking: await loadFull(operatorId, req.params.id, timeZone) });
    },
  );

  router.post(
    '/bookings/:id/no-show',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const { operatorId, timeZone } = authOf(req);
      let refund;
      try {
        refund = await markNoShow(prisma, {
          operatorId,
          bookingId: req.params.id,
          actor: actorOf(req),
        });
      } catch (err) {
        throw toHttp(err);
      }
      res.json({ refund, booking: await loadFull(operatorId, req.params.id, timeZone) });
    },
  );

  // --- Travellers (BKG-25) ----------------------------------------------------------
  router.patch(
    '/bookings/:id/travellers/:travellerId',
    requirePermission('bookings', 'edit'),
    validate({
      params: z.object({ id: z.uuid(), travellerId: z.uuid() }),
      body: UpdateTravellerSchema,
    }),
    async (req, res) => {
      const { operatorId, timeZone } = authOf(req);
      try {
        await updateTraveller(prisma, {
          operatorId,
          bookingId: req.params.id,
          travellerId: req.params.travellerId,
          changes: req.body,
          actor: actorOf(req),
        });
      } catch (err) {
        throw toHttp(err);
      }
      res.json({ booking: await loadFull(operatorId, req.params.id, timeZone) });
    },
  );

  return router;
}
