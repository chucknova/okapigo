// @ts-check
/**
 * Schedules, departures and availability (INV-03, and the read side of INV-02).
 *
 *   GET   /api/products/:id/schedules        products: view
 *   POST  /api/products/:id/schedules        products: edit   create a rule → departures appear
 *   PATCH /api/schedules/:id                 products: edit   change a rule → departures re-sync
 *   GET   /api/departures                    products: view   staff calendar (?from&to&productId)
 *   POST  /api/products/:id/departures       products: edit   a one-off ("custom") departure
 *   PATCH /api/departures/:id                bookings: edit   change capacity, cancel, reopen
 *   GET   /api/products/:id/availability     products: view   bookable departures + seats left
 *
 * Why is changing a single departure `bookings: edit` and not `products: edit`? Cancelling
 * Saturday's Tarkwa Bay trip for bad weather is the operations MANAGER's job (they have
 * bookings: edit), and it affects guests' bookings. Guides have operations: edit for check-in,
 * so that permission would wrongly let a guide cancel a tour.
 *
 * Dates and times in requests are LOCAL to the operator ('YYYY-MM-DD', 'HH:MM'). Responses
 * include both the UTC instant and the local date/time.
 */
import { Router } from 'express';
import { listAvailability, syncScheduleDepartures, HORIZON_DAYS } from '@okapigo/db';
import {
  CreateScheduleSchema,
  UpdateScheduleSchema,
  CreateDepartureSchema,
  UpdateDepartureSchema,
  DateRangeQuerySchema,
} from '@okapigo/shared/schemas/schedules';
import { addDays, localDate, stringToDate, zonedTimeToUtc } from '@okapigo/shared/time';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { serializeSchedule, serializeDeparture } from './serializers.js';

/** The longest date range one calendar request may ask for. */
const MAX_RANGE_DAYS = 92;

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function schedulesRouter({ prisma }) {
  const router = Router();

  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;

  async function findOwnProduct(req, id) {
    const product = await prisma.product.findFirst({
      where: { id, operatorId: authOf(req).operatorId },
    });
    if (!product) throw new HttpError(404, 'NOT_FOUND', 'Product not found.');
    return product;
  }

  /** Converts the API's 'YYYY-MM-DD' strings into the Date objects Prisma wants for @db.Date. */
  function scheduleData(body) {
    const data = { ...body };
    if (body.startDate) data.startDate = stringToDate(body.startDate);
    if (body.endDate !== undefined) data.endDate = body.endDate ? stringToDate(body.endDate) : null;
    if (body.skipDates) data.skipDates = body.skipDates.map(stringToDate);
    return data;
  }

  /**
   * Reads ?from&to as local dates, defaulting to the next 14 days, capped at 92 days.
   * @param {import('express').Request} req
   */
  function dateRange(req) {
    const parsed = DateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid date range.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const today = localDate(new Date(), authOf(req).timeZone);
    const from = parsed.data.from ?? today;
    const to = parsed.data.to ?? addDays(from, 13);
    if (to > addDays(from, MAX_RANGE_DAYS)) {
      throw new HttpError(
        400,
        'RANGE_TOO_LONG',
        `Ask for at most ${MAX_RANGE_DAYS} days at a time.`,
      );
    }
    return { from, to, productId: parsed.data.productId };
  }

  // --- Schedules -----------------------------------------------------------------------

  router.get(
    '/products/:id/schedules',
    requirePermission('products', 'view'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const product = await findOwnProduct(req, req.params.id);
      const schedules = await prisma.schedule.findMany({
        where: { productId: product.id },
        orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
      });
      res.json({ schedules: schedules.map(serializeSchedule) });
    },
  );

  router.post(
    '/products/:id/schedules',
    requirePermission('products', 'edit'),
    validate({ params: IdParamsSchema, body: CreateScheduleSchema }),
    async (req, res) => {
      const product = await findOwnProduct(req, req.params.id);
      const schedule = await prisma.schedule.create({
        data: { ...scheduleData(req.body), productId: product.id, operatorId: product.operatorId },
      });
      // The new rule's departures for the next 60 days appear straight away.
      const sync = await syncScheduleDepartures(prisma, schedule.id);
      res.status(201).json({ schedule: serializeSchedule(schedule), sync });
    },
  );

  router.patch(
    '/schedules/:id',
    requirePermission('products', 'edit'),
    validate({ params: IdParamsSchema, body: UpdateScheduleSchema }),
    async (req, res) => {
      const existing = await prisma.schedule.findFirst({
        where: { id: req.params.id, operatorId: authOf(req).operatorId },
        include: { product: true },
      });
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Schedule not found.');

      // The combined start/end dates must still be in order after a partial update.
      const startDate = req.body.startDate ?? existing.startDate.toISOString().slice(0, 10);
      const endDate =
        req.body.endDate !== undefined
          ? req.body.endDate
          : (existing.endDate?.toISOString().slice(0, 10) ?? null);
      if (endDate && endDate < startDate) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'endDate must be on or after startDate.');
      }

      const schedule = await prisma.schedule.update({
        where: { id: existing.id },
        data: scheduleData(req.body),
      });
      const sync = await syncScheduleDepartures(prisma, schedule.id, {
        // What capacity its departures were created with, so sync can tell which ones staff
        // changed by hand (see departures.js).
        previousCapacity: existing.capacity ?? existing.product.defaultCapacity,
      });
      // `sync.needsAttention` lists booked departures the change couldn't remove or shrink.
      res.json({ schedule: serializeSchedule(schedule), sync });
    },
  );

  // --- Departures ----------------------------------------------------------------------

  router.get('/departures', requirePermission('products', 'view'), async (req, res) => {
    const { operatorId, timeZone } = authOf(req);
    const { from, to, productId } = dateRange(req);
    const departures = await prisma.departure.findMany({
      where: {
        operatorId,
        productId,
        startsAt: {
          gte: zonedTimeToUtc(from, '00:00', timeZone),
          lt: zonedTimeToUtc(addDays(to, 1), '00:00', timeZone),
        },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    res.json({ from, to, departures: departures.map((d) => serializeDeparture(d, timeZone)) });
  });

  router.post(
    '/products/:id/departures',
    requirePermission('products', 'edit'),
    validate({ params: IdParamsSchema, body: CreateDepartureSchema }),
    async (req, res) => {
      const product = await findOwnProduct(req, req.params.id);
      const { timeZone } = authOf(req);
      const startsAt = zonedTimeToUtc(req.body.date, req.body.time, timeZone);
      if (startsAt <= new Date()) {
        throw new HttpError(400, 'IN_THE_PAST', 'That date and time has already passed.');
      }
      if (await prisma.departure.findFirst({ where: { productId: product.id, startsAt } })) {
        throw new HttpError(409, 'DEPARTURE_EXISTS', 'There is already a departure at that time.');
      }

      const departure = await prisma.departure.create({
        data: {
          operatorId: product.operatorId,
          productId: product.id,
          scheduleId: null, // one-off: not generated by any schedule
          startsAt,
          endsAt: new Date(startsAt.getTime() + product.durationMinutes * 60_000),
          capacity: req.body.capacity ?? product.defaultCapacity,
        },
      });
      res.status(201).json({ departure: serializeDeparture(departure, timeZone) });
    },
  );

  router.patch(
    '/departures/:id',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema, body: UpdateDepartureSchema }),
    async (req, res) => {
      const { operatorId, timeZone } = authOf(req);
      const existing = await prisma.departure.findFirst({
        where: { id: req.params.id, operatorId },
      });
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Departure not found.');

      // Cancelling a departure with guests means refunds under the cancellation policy,
      // which arrives with bookings (session 7). Until then, only empty ones can be cancelled.
      if (req.body.status === 'cancelled' && existing.seatsSold + existing.seatsHeld > 0) {
        throw new HttpError(
          409,
          'HAS_GUESTS',
          'This departure has guests. Cancel their bookings first.',
        );
      }

      if (req.body.capacity !== undefined) {
        // Shrink capacity ONLY if the guests already on board still fit. The condition is in
        // the UPDATE itself, so a seat sold between our read and this write can't slip past.
        const updated = await prisma.$executeRaw`
          UPDATE departures SET capacity = ${req.body.capacity}, updated_at = now()
           WHERE id = ${existing.id}::uuid
             AND seats_sold + seats_held <= ${req.body.capacity}`;
        if (updated === 0) {
          throw new HttpError(
            409,
            'CAPACITY_BELOW_BOOKED',
            'More guests are already booked than that capacity allows.',
          );
        }
      }
      if (req.body.status !== undefined) {
        await prisma.departure.update({
          where: { id: existing.id },
          data: { status: req.body.status },
        });
      }

      const departure = await prisma.departure.findUniqueOrThrow({ where: { id: existing.id } });
      res.json({ departure: serializeDeparture(departure, timeZone) });
    },
  );

  // --- Availability ------------------------------------------------------------------

  router.get(
    '/products/:id/availability',
    requirePermission('products', 'view'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const product = await findOwnProduct(req, req.params.id);
      const { timeZone } = authOf(req);
      const { from, to } = dateRange(req);
      const departures = await listAvailability(prisma, {
        operatorId: product.operatorId,
        productId: product.id,
        from,
        to,
        timeZone,
      });
      res.json({
        productId: product.id,
        from,
        to,
        horizonDays: HORIZON_DAYS,
        departures: departures.map((d) => serializeDeparture(d, timeZone)),
      });
    },
  );

  return router;
}
