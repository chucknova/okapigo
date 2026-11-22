// @ts-check
/**
 * The OCTO API (session 17a, DST-01): how an OTA (an online travel agency, like the mock OTA,
 * Viator or GetYourGuide) reads a business's tours and what's free, in the OCTO standard
 * (Open Connectivity for Tours, Activities and Attractions; docs.octo.travel). Mounted at
 * /octo, so a channel's OCTO endpoint is `${API_PUBLIC_URL}/octo`.
 *
 *   GET  /octo/supplier                the business
 *   GET  /octo/products                the tours this channel may sell (published ones)
 *   GET  /octo/products/:id            one of them
 *   POST /octo/availability            departures and seats left: a date range, or ids
 *   POST /octo/availability/calendar   day by day: open, how many seats at most
 *   (bookings: 17b)
 *   /octo/notifications/subscriptions  the OTA's own address for what changed (17c-2; OCTO's
 *                                      "notifications" capability): create, list, read,
 *                                      change, delete. The sync job does the telling
 *                                      (packages/db/src/channel-sync.js).
 *
 * Who's asking: `Authorization: Bearer octo_…`, the channel's own key (channels.js). The key
 * decides the business and which of its tours (channel_products) can be seen; another
 * business's tour is simply "invalid", never "not yours".
 *
 * Capabilities: `Octo-Capabilities: octo/pricing` (or "pricing"; the docs use both) adds prices:
 * the guest's price and the net the OTA owes. Every answer says which capabilities it used
 * (the `Octo-Capabilities` response header).
 *
 * Errors, in OCTO's shape `{ error, errorMessage, …ids }`: 400 for a request we can't answer
 * (INVALID_PRODUCT_ID, BAD_REQUEST…), 401 UNAUTHORIZED without a key, 403 FORBIDDEN for an
 * unknown or switched-off one (the docs contradict themselves here; see the learning note).
 *
 * Seats are worked out exactly as for the website and WhatsApp (listAvailability, seatsLeft):
 * holds from every channel count, so a seat is never sold twice (INV-02).
 */
import express, { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  BookingError,
  HoldError,
  cancelChannelBooking,
  channelByKey,
  confirmChannelBooking,
  extendChannelBooking,
  guestToken,
  holdMinutesFor,
  listAvailability,
  octoStatusOf,
  previewCancellation,
  reserveChannelBooking,
  seatsLeft,
  ticketCode,
} from '@okapigo/db';
import {
  AvailabilityCalendarBodySchema,
  AvailabilityCheckBodySchema,
  BookingCancellationBodySchema,
  BookingConfirmationBodySchema,
  BookingExtendBodySchema,
  BookingReservationBodySchema,
  BookingUpdateBodySchema,
  CAPABILITY_CONTENT,
  CAPABILITY_PICKUPS,
  CAPABILITY_PRICING,
  SubscriptionBodySchema,
  SubscriptionUpdateBodySchema,
  checkNotificationUrl,
} from '@okapigo/shared/octo';
import { normalizeEmail, normalizePhone } from '@okapigo/shared/contact';
import { slugify } from '@okapigo/shared/slug';
import { OperatorPricingSchema } from '@okapigo/shared/schemas/pricing';
import { addDays, localDate } from '@okapigo/shared/time';
import {
  OPTION_ID,
  availabilityOf,
  basketPricing,
  bookingOf,
  productOf,
  statusOf,
  unitsOf,
} from './views.js';

/** The longest stretch one request may ask about, like the staff API (lib/date-range.js). */
export const MAX_DAYS = 92;

class OctoError extends Error {
  /**
   * @param {number} status @param {string} code @param {string} message
   * @param {Record<string, unknown>} [extra] e.g. { productId }
   */
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   apiPublicUrl: string,
 *   log?: any,
 *   quotes?: ReturnType<typeof import('../pricing/quote-service.js').createQuoteService>,
 *   jobs?: { scheduleHoldExpiry: (holdId: string, expiresAt: Date) => Promise<void> },
 *   authSecret?: string,
 *   webPublicUrl?: string,
 *   production?: boolean,   notification addresses: public https only
 * }} deps
 */
export function octoRouter({
  prisma,
  apiPublicUrl,
  log,
  quotes,
  jobs,
  authSecret = '',
  webPublicUrl = apiPublicUrl,
  production = false,
}) {
  const router = Router();
  router.use(express.json({ limit: '100kb' }));

  // --- Who's asking, and what they asked for -------------------------------------------------
  router.use(async (req, res, next) => {
    try {
      // Capabilities from the header or `?_capabilities=` (the docs allow either), each with or
      // without "octo/" (the docs use both).
      const asked = String(req.get('Octo-Capabilities') ?? req.query._capabilities ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const has = (/** @type {string} */ name) =>
        asked.includes(name) || asked.includes(`octo/${name}`);
      const pricing = has('pricing');
      // 17d-1: content (what's included, where to meet…) and pickups (where the van collects).
      const content = has('content');
      const pickups = has('pickups');
      res.set(
        'Octo-Capabilities',
        [
          pricing && CAPABILITY_PRICING,
          content && CAPABILITY_CONTENT,
          pickups && CAPABILITY_PICKUPS,
        ]
          .filter(Boolean)
          .join(', '),
      );
      res.locals.pricing = pricing;
      res.locals.content = content;
      res.locals.pickups = pickups;

      const auth = req.get('Authorization') ?? '';
      const key = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
      if (!key) {
        throw new OctoError(401, 'UNAUTHORIZED', 'Send your API key: Authorization: Bearer <key>.');
      }
      const channel = await channelByKey(prisma, key);
      if (!channel)
        throw new OctoError(403, 'FORBIDDEN', 'That API key is not valid, or it was switched off.');
      res.locals.channel = channel;
      // "last used 10:42" on Settings › Channels: at most one write a minute per key.
      const now = new Date();
      if (
        !channel.apiKeyLastUsedAt ||
        now.getTime() - channel.apiKeyLastUsedAt.getTime() > 60_000
      ) {
        await prisma.channel.update({
          where: { id: channel.id },
          data: { apiKeyLastUsedAt: now },
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  /** @param {import('express').Response} res */
  const ctx = (res) => {
    const channel = res.locals.channel;
    const settings = OperatorPricingSchema.parse(channel.operator.pricing);
    return {
      channel,
      operator: channel.operator,
      tz: channel.operator.timeZone,
      settings,
      pricing: Boolean(res.locals.pricing),
      content: Boolean(res.locals.content),
      pickups: Boolean(res.locals.pickups),
    };
  };

  /**
   * One of this channel's tours (published, on the channel), with what productOf needs.
   * @param {any} c @param {unknown} id
   */
  async function productFor(c, id) {
    const parsed = z.uuid().safeParse(id);
    const product = parsed.success
      ? await prisma.product.findFirst({
          where: {
            id: parsed.data,
            operatorId: c.operator.id,
            status: 'published',
            channels: { some: { channelId: c.channel.id } },
          },
          include: withWhatOctoNeeds,
        })
      : null;
    if (!product) {
      throw new OctoError(400, 'INVALID_PRODUCT_ID', 'The Product ID was invalid or missing', {
        productId: id ?? null,
      });
    }
    return product;
  }

  const withWhatOctoNeeds = {
    priceCategories: {
      where: { isActive: true },
      orderBy: [
        { sortOrder: /** @type {const} */ ('asc') },
        { createdAt: /** @type {const} */ ('asc') },
      ],
    },
    schedules: { where: { isActive: true } },
    cancellationPolicy: {
      include: { versions: { orderBy: { version: /** @type {const} */ ('desc') }, take: 1 } },
    },
  };

  /** @param {any} product @param {any} c */
  const asProduct = (product, c) =>
    productOf(
      { ...product, policy: product.cancellationPolicy?.versions[0] ?? null },
      {
        timeZone: c.tz,
        startTimes: [
          ...new Set(product.schedules.flatMap((/** @type {any} */ s) => s.times)),
        ].sort(),
        settings: c.settings,
        commissionBasisPoints: c.channel.commissionBasisPoints,
        pricing: c.pricing,
        content: c.content,
        pickups: c.pickups,
      },
    );

  /** @param {any} product @param {unknown} optionId */
  const checkOption = (product, optionId) => {
    if (optionId !== OPTION_ID) {
      throw new OctoError(400, 'INVALID_OPTION_ID', 'The Option ID was invalid or missing', {
        optionId: optionId ?? null,
      });
    }
  };

  /**
   * The units asked about, as travellers for pricing; unknown unit ids refused.
   * @param {any} product @param {Array<{ id: string, quantity: number }> | undefined} units
   */
  function travellersOf(product, units = []) {
    const keys = new Set(product.priceCategories.map((/** @type {any} */ c) => c.key));
    const out = [];
    for (const u of units) {
      if (!keys.has(u.id)) {
        throw new OctoError(400, 'INVALID_UNIT_ID', 'The Unit ID was invalid or missing', {
          unitId: u.id,
        });
      }
      for (let i = 0; i < u.quantity; i++) out.push({ categoryKey: u.id });
    }
    return out;
  }

  /** @param {unknown} body @param {z.ZodType} schema */
  const parse = (body, schema) => {
    const r = schema.safeParse(body ?? {});
    if (!r.success) {
      throw new OctoError(
        400,
        'BAD_REQUEST',
        r.error.issues[0]?.message ?? 'The request was not valid',
      );
    }
    return /** @type {any} */ (r.data);
  };

  /** A local date range, at most MAX_DAYS. @param {string} from @param {string} to */
  const checkRange = (from, to) => {
    if (to < from) throw new OctoError(400, 'BAD_REQUEST', 'localDateEnd is before localDateStart');
    if (to > addDays(from, MAX_DAYS)) {
      throw new OctoError(400, 'BAD_REQUEST', `Ask for at most ${MAX_DAYS} days at a time`);
    }
  };

  // --- Endpoints -----------------------------------------------------------------------------

  router.get('/supplier', (req, res) => {
    const { operator } = ctx(res);
    const site = /** @type {any} */ (operator.site ?? {});
    res.json({
      id: operator.id,
      name: operator.name,
      endpoint: `${apiPublicUrl.replace(/\/+$/, '')}/octo`,
      contact: {
        website: site.website ?? null,
        email: site.email ?? null,
        telephone: operator.phone ?? null,
        address: site.address ?? null,
      },
      shortDescription: site.tagline ?? null,
    });
  });

  router.get('/products', async (req, res) => {
    const c = ctx(res);
    const products = await prisma.product.findMany({
      where: {
        operatorId: c.operator.id,
        status: 'published',
        channels: { some: { channelId: c.channel.id } },
      },
      include: withWhatOctoNeeds,
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    });
    res.json(products.map((p) => asProduct(p, c)));
  });

  router.get('/products/:id', async (req, res) => {
    const c = ctx(res);
    res.json(asProduct(await productFor(c, req.params.id), c));
  });

  router.post('/availability', async (req, res) => {
    const c = ctx(res);
    const body = parse(req.body, AvailabilityCheckBodySchema);
    const product = await productFor(c, body.productId);
    checkOption(product, body.optionId);
    const travellers = travellersOf(product, body.units);

    /** @type {any[]} */
    let departures;
    if (body.availabilityIds) {
      const ids = body.availabilityIds.filter(
        (/** @type {string} */ id) => z.uuid().safeParse(id).success,
      );
      const found = await prisma.departure.findMany({
        where: {
          id: { in: ids },
          productId: product.id,
          status: 'scheduled',
          startsAt: { gt: new Date() },
        },
        include: { resource: true },
        orderBy: { startsAt: 'asc' },
      });
      const missing = body.availabilityIds.find(
        (/** @type {string} */ id) => !found.some((d) => d.id === id),
      );
      if (missing) {
        throw new OctoError(
          400,
          'INVALID_AVAILABILITY_ID',
          'The Availability ID was invalid or missing',
          {
            availabilityId: missing,
          },
        );
      }
      departures = found.map((d) => ({ ...d, seatsAvailable: seatsLeft(d) }));
    } else {
      checkRange(body.localDateStart, body.localDateEnd);
      departures = await listAvailability(prisma, {
        operatorId: c.operator.id,
        productId: product.id,
        from: body.localDateStart,
        to: body.localDateEnd,
        timeZone: c.tz,
      });
    }

    const units = c.pricing
      ? unitsOf(product.priceCategories, c.settings, c.channel.commissionBasisPoints, true)
      : [];
    const unitPricing = units.map((u) => ({
      unitId: u.id,
      .../** @type {any} */ (u).pricingFrom[0],
    }));
    const pricing =
      c.pricing && travellers.length
        ? basketPricing(
            product.priceCategories,
            travellers,
            c.settings,
            c.channel.commissionBasisPoints,
          )
        : undefined;
    res.json(
      departures.map((d) =>
        availabilityOf(d, {
          timeZone: c.tz,
          pax: travellers.length,
          ...(c.pricing && { unitPricing }),
          ...(pricing && { pricing }),
        }),
      ),
    );
  });

  router.post('/availability/calendar', async (req, res) => {
    const c = ctx(res);
    const body = parse(req.body, AvailabilityCalendarBodySchema);
    const product = await productFor(c, body.productId);
    checkOption(product, body.optionId);
    const travellers = travellersOf(product, body.units);
    checkRange(body.localDateStart, body.localDateEnd);
    const departures = await listAvailability(prisma, {
      operatorId: c.operator.id,
      productId: product.id,
      from: body.localDateStart,
      to: body.localDateEnd,
      timeZone: c.tz,
    });
    const units = c.pricing
      ? unitsOf(product.priceCategories, c.settings, c.channel.commissionBasisPoints, true)
      : [];
    const unitPricingFrom = units.map((u) => ({
      unitId: u.id,
      .../** @type {any} */ (u).pricingFrom[0],
    }));
    const pricingFrom =
      c.pricing && travellers.length
        ? [
            basketPricing(
              product.priceCategories,
              travellers,
              c.settings,
              c.channel.commissionBasisPoints,
            ),
          ]
        : undefined;

    // Every day in the range: a day with no departure is CLOSED.
    const days = [];
    for (let day = body.localDateStart; day <= body.localDateEnd; day = addDays(day, 1)) {
      const that = departures.filter((d) => localDate(d.startsAt, c.tz) === day);
      const best = Math.max(0, ...that.map((d) => d.seatsAvailable));
      const capacity = that.length ? Math.max(...that.map((d) => d.capacity)) : null;
      days.push({
        localDate: day,
        available: best > 0 && best >= travellers.length,
        status: that.length === 0 ? 'CLOSED' : statusOf(best, /** @type {number} */ (capacity)),
        vacancies: that.length ? best : null,
        capacity,
        openingHours: [],
        ...(c.pricing && that.length && { unitPricingFrom }),
        ...(pricingFrom && that.length && { pricingFrom }),
      });
    }
    res.json(days);
  });

  // --- Bookings (17b) -----------------------------------------------------------------------

  /** A pickup point's OCTO id: its name, made URL-safe ("victoria-island"). @param {any} p */
  const pickupIdOf = (p) => slugify(p.name);

  /** This channel's booking with that uuid, or INVALID_BOOKING_UUID. @param {any} c @param {string} uuid */
  async function channelBookingFor(c, uuid) {
    const cb = await prisma.channelBooking.findUnique({
      where: { channelId_uuid: { channelId: c.channel.id, uuid } },
    });
    if (!cb) {
      throw new OctoError(400, 'INVALID_BOOKING_UUID', 'The Booking UUID was invalid or missing', {
        uuid,
      });
    }
    return cb;
  }

  /** The OCTO booking, as it stands now. @param {any} c @param {any} cb */
  async function viewOf(c, cb) {
    const now = new Date();
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: cb.bookingId },
      include: {
        hold: true,
        departure: { include: { resource: true } },
        travellers: { orderBy: { position: 'asc' } },
        events: {
          where: { toStatus: 'cancelled' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    const status = octoStatusOf(booking, booking.hold, now);
    const confirmed = status === 'CONFIRMED' || status === 'REDEEMED';
    const cancelEvent = booking.events[0];
    // Not in the spec (17d-2): what cancelling now would give back, by the policy this booking
    // was sold under (an OTA shows its guest before they confirm).
    const preview =
      status === 'CONFIRMED' && booking.departure.startsAt > now
        ? /** @type {any} */ (
            await previewCancellation(prisma, {
              operatorId: c.operator.id,
              bookingId: booking.id,
              initiatedBy: 'guest',
              now,
            })
          )
        : null;
    return bookingOf({
      refundIfCancelledNow: preview
        ? {
            amount: preview.refundKobo,
            percent: (preview.refundBasisPoints ?? 0) / 100,
            hoursBefore: preview.hoursBefore ?? null,
          }
        : null,
      channelBooking: cb,
      booking,
      status,
      cancelled: cancelEvent
        ? {
            reason: /** @type {any} */ (cancelEvent.data)?.reason ?? null,
            at: cancelEvent.createdAt,
          }
        : null,
      timeZone: c.tz,
      seatsAvailable: seatsLeft(booking.departure),
      ticketCode: confirmed ? ticketCode(authSecret, booking.id) : null,
      tripUrl: confirmed
        ? `${webPublicUrl.replace(/\/+$/, '')}/trip/${guestToken(authSecret, booking.id)}`
        : null,
      pricing: c.pricing,
      pickups: c.pickups,
      taxName: c.settings.tax?.name ?? null,
      now,
    });
  }

  /** Our errors, in OCTO's words. @param {unknown} err */
  function asOcto(err) {
    if (err instanceof OctoError) return err;
    const e = /** @type {any} */ (err);
    if (err instanceof HoldError) {
      if (e.code === 'SOLD_OUT')
        return new OctoError(400, 'UNPROCESSABLE_ENTITY', e.message, {
          vacancies: e.details?.seatsAvailable ?? 0,
        });
      return new OctoError(400, 'INVALID_AVAILABILITY_ID', e.message);
    }
    if (err instanceof BookingError) {
      if (e.code === 'HOLD_EXPIRED') return new OctoError(400, 'INVALID_BOOKING_UUID', e.message);
      return new OctoError(400, 'UNPROCESSABLE_ENTITY', e.message);
    }
    // The pricing service's refusals (a child without an adult…).
    if (e?.status === 400 && e?.code) return new OctoError(400, 'UNPROCESSABLE_ENTITY', e.message);
    return err;
  }

  // Reserve: seats held for the OTA while its guest pays it.
  router.post('/bookings', async (req, res) => {
    const c = ctx(res);
    const body = parse(req.body, BookingReservationBodySchema);
    const product = await productFor(c, body.productId);
    checkOption(product, body.optionId);
    const travellers = travellersOf(
      product,
      body.unitItems.map((/** @type {any} */ u) => ({ id: u.unitId, quantity: 1 })),
    );
    const departure = z.uuid().safeParse(body.availabilityId).success
      ? await prisma.departure.findFirst({
          where: { id: body.availabilityId, productId: product.id },
        })
      : null;
    if (!departure) {
      throw new OctoError(
        400,
        'INVALID_AVAILABILITY_ID',
        'The Availability ID was invalid or missing',
        {
          availabilityId: body.availabilityId,
        },
      );
    }
    // A tour that picks guests up needs to know where (the pickups capability, in part).
    const points = /** @type {any[]} */ (product.pickupPoints ?? []);
    let pickupPointName = null;
    if (points.length) {
      // The standard's pickupLocationId (17d-1), or 17b's pickupPointId: the same ids.
      const wanted = body.pickupLocationId ?? body.pickupPointId;
      const chosen = points.find((p) => pickupIdOf(p) === wanted);
      if (!chosen) {
        throw new OctoError(
          400,
          'BAD_REQUEST',
          `This tour picks guests up: send pickupLocationId, one of ${points.map(pickupIdOf).join(', ')}`,
        );
      }
      pickupPointName = chosen.name;
    }
    try {
      if (!quotes) throw new Error('OCTO bookings need the quote service');
      const { quote } = await quotes.quoteForBooking({
        operatorId: c.operator.id,
        productId: product.id,
        travellers,
        addOns: [],
      });
      const r = await reserveChannelBooking(prisma, {
        channel: c.channel,
        operatorSlug: c.operator.slug,
        productId: product.id,
        departureId: departure.id,
        uuid: body.uuid ?? randomUUID(),
        unitItems: body.unitItems.map((/** @type {any} */ u) => ({
          uuid: u.uuid ?? randomUUID(),
          unitId: u.unitId,
        })),
        quote,
        totalKobo: quote.totalKobo,
        holdMinutes: holdMinutesFor(body.expirationMinutes),
        notes: body.notes ?? null,
        pickupPointName,
      });
      if (r.created && /** @type {any} */ (r).holdId) {
        jobs
          ?.scheduleHoldExpiry(/** @type {any} */ (r).holdId, /** @type {any} */ (r).expiresAt)
          .catch((/** @type {unknown} */ err) =>
            log?.warn({ err }, 'hold expiry not scheduled; the sweeper will'),
          );
      }
      res.json(await viewOf(c, r.channelBooking));
    } catch (err) {
      throw asOcto(err);
    }
  });

  // Confirm: the OTA's guest, and the OTA's payment.
  router.post('/bookings/:uuid/confirm', async (req, res) => {
    const c = ctx(res);
    const cb = await channelBookingFor(c, req.params.uuid);
    const body = parse(req.body, BookingConfirmationBodySchema);
    const k = body.contact;
    const name = (
      k.fullName?.trim() || [k.firstName, k.lastName].filter(Boolean).join(' ').trim()
    ).slice(0, 200);
    if (!name)
      throw new OctoError(
        400,
        'BAD_REQUEST',
        'The contact needs a name (fullName, or firstName and lastName)',
      );
    const email = k.emailAddress ? normalizeEmail(k.emailAddress) : null;
    if (k.emailAddress && !email)
      throw new OctoError(400, 'BAD_REQUEST', 'The contact’s emailAddress is not valid');
    if (!email) throw new OctoError(400, 'BAD_REQUEST', 'The contact needs an emailAddress');
    const phone = k.phoneNumber ? normalizePhone(k.phoneNumber) : null;
    try {
      await confirmChannelBooking(prisma, {
        channelBooking: cb,
        channelName: c.channel.name,
        lead: { name, email, phone },
        resellerReference: body.resellerReference ?? null,
      });
    } catch (err) {
      throw asOcto(err);
    }
    res.json(
      await viewOf(c, await prisma.channelBooking.findUniqueOrThrow({ where: { id: cb.id } })),
    );
  });

  // Cancel: held → seats back; sold → the business's policy, settled with the OTA.
  router.post('/bookings/:uuid/cancel', async (req, res) => {
    const c = ctx(res);
    const cb = await channelBookingFor(c, req.params.uuid);
    const body = parse(req.body, BookingCancellationBodySchema);
    try {
      await cancelChannelBooking(prisma, {
        channelBooking: cb,
        channelName: c.channel.name,
        reason: body.reason ?? null,
      });
    } catch (err) {
      throw asOcto(err);
    }
    res.json(await viewOf(c, cb));
  });

  // Extend: more time on the hold, up to 30 minutes from now.
  router.post('/bookings/:uuid/extend', async (req, res) => {
    const c = ctx(res);
    const cb = await channelBookingFor(c, req.params.uuid);
    const body = parse(req.body, BookingExtendBodySchema);
    try {
      const expiresAt = await extendChannelBooking(prisma, {
        channelBooking: cb,
        minutes: body.expirationMinutes,
      });
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: cb.bookingId } });
      jobs
        ?.scheduleHoldExpiry(booking.holdId, expiresAt)
        .catch((/** @type {unknown} */ err) =>
          log?.warn({ err }, 'hold expiry not scheduled; the sweeper will'),
        );
    } catch (err) {
      throw asOcto(err);
    }
    res.json(await viewOf(c, cb));
  });

  // Update: the OTA's reference, the notes, the contact. Changing the date or who's coming
  // isn't offered through OCTO (cancel and book again, or ask the business).
  router.patch('/bookings/:uuid', async (req, res) => {
    const c = ctx(res);
    const cb = await channelBookingFor(c, req.params.uuid);
    const body = parse(req.body, BookingUpdateBodySchema);
    if (body.productId || body.optionId || body.availabilityId || body.unitItems) {
      throw new OctoError(
        400,
        'UNPROCESSABLE_ENTITY',
        'Changing the tour, the date or who’s coming isn’t possible here: cancel and book again',
      );
    }
    /** @type {Record<string, unknown>} */
    const booking = {};
    if (body.notes !== undefined) booking.notes = body.notes;
    if (body.contact && cb.confirmedAt) {
      const k = body.contact;
      const name = k.fullName?.trim() || [k.firstName, k.lastName].filter(Boolean).join(' ').trim();
      if (name) booking.leadName = name.slice(0, 200);
      if (k.emailAddress) {
        const email = normalizeEmail(k.emailAddress);
        if (!email)
          throw new OctoError(400, 'BAD_REQUEST', 'The contact’s emailAddress is not valid');
        booking.leadEmail = email;
      }
      if (k.phoneNumber) booking.leadPhone = normalizePhone(k.phoneNumber);
    }
    if (Object.keys(booking).length) {
      await prisma.booking.update({ where: { id: cb.bookingId }, data: booking });
    }
    const updated =
      body.resellerReference !== undefined
        ? await prisma.channelBooking.update({
            where: { id: cb.id },
            data: { resellerReference: body.resellerReference },
          })
        : cb;
    res.json(await viewOf(c, updated));
  });

  router.get('/bookings/:uuid', async (req, res) => {
    const c = ctx(res);
    res.json(await viewOf(c, await channelBookingFor(c, req.params.uuid)));
  });

  // This channel's bookings: by its reference, ours, or the day of the tour (newest first).
  router.get('/bookings', async (req, res) => {
    const c = ctx(res);
    const q = parse(
      req.query,
      z.object({
        resellerReference: z.string().max(100).optional(),
        supplierReference: z.string().max(40).optional(),
        localDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    );
    const list = await prisma.channelBooking.findMany({
      where: {
        channelId: c.channel.id,
        ...(q.resellerReference && { resellerReference: q.resellerReference }),
        ...(q.supplierReference && { booking: { reference: q.supplierReference } }),
      },
      include: { booking: { include: { departure: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const chosen = q.localDate
      ? list.filter((cb) => localDate(cb.booking.departure.startsAt, c.tz) === q.localDate)
      : list;
    const out = [];
    for (const cb of chosen) out.push(await viewOf(c, cb));
    res.json(out);
  });

  // --- Notifications (17c-2) -------------------------------------------------------------------
  // The spec writes "subcriptions" (sic): both spellings work.
  const SUBS = ['/notifications/subscriptions', '/notifications/subcriptions'];

  /** @param {any} s */
  const subscriptionOf = (s) => ({
    id: s.id,
    url: s.url,
    notificationTypes: s.notificationTypes,
    headers: s.headers,
  });

  /** The address, if we may send there. @param {string} url */
  const allowedUrl = (url) => {
    const r = checkNotificationUrl(url, production);
    if (!r.ok) throw new OctoError(400, 'BAD_REQUEST', r.problem, { url });
    return r.url;
  };

  /** One of this channel's subscriptions. @param {any} c @param {unknown} id */
  async function subscriptionFor(c, id) {
    const parsed = z.uuid().safeParse(id);
    const sub = parsed.success
      ? await prisma.channelSubscription.findFirst({
          where: { id: parsed.data, channelId: c.channel.id },
        })
      : null;
    if (!sub) throw new OctoError(400, 'BAD_REQUEST', 'No subscription with that id', { id });
    return sub;
  }

  router.post(SUBS, async (req, res) => {
    const c = ctx(res);
    const body = parse(req.body, SubscriptionBodySchema);
    const sub = await prisma.channelSubscription.create({
      data: {
        operatorId: c.operator.id,
        channelId: c.channel.id,
        url: allowedUrl(body.url),
        notificationTypes: [...new Set(body.notificationTypes)],
        headers: body.headers,
      },
    });
    res.json(subscriptionOf(sub));
  });

  router.get(SUBS, async (req, res) => {
    const c = ctx(res);
    const subs = await prisma.channelSubscription.findMany({
      where: { channelId: c.channel.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(subs.map(subscriptionOf));
  });

  router.get(
    SUBS.map((p) => `${p}/:id`),
    async (req, res) => {
      res.json(subscriptionOf(await subscriptionFor(ctx(res), req.params.id)));
    },
  );

  router.patch(
    SUBS.map((p) => `${p}/:id`),
    async (req, res) => {
      const c = ctx(res);
      const sub = await subscriptionFor(c, req.params.id);
      const body = parse(req.body, SubscriptionUpdateBodySchema);
      const updated = await prisma.channelSubscription.update({
        where: { id: sub.id },
        data: {
          ...(body.url !== undefined && { url: allowedUrl(body.url), lastPushError: null }),
          ...(body.notificationTypes && {
            notificationTypes: [...new Set(body.notificationTypes)],
          }),
          ...(body.headers && { headers: body.headers }),
        },
      });
      res.json(subscriptionOf(updated));
    },
  );

  router.delete(
    SUBS.map((p) => `${p}/:id`),
    async (req, res) => {
      const sub = await subscriptionFor(ctx(res), req.params.id);
      await prisma.channelSubscription.delete({ where: { id: sub.id } });
      res.json(subscriptionOf(sub));
    },
  );

  // --- OCTO's error shape, for everything above ----------------------------------------------
  router.use(
    /** @type {import('express').ErrorRequestHandler} */
    (err, req, res, _next) => {
      if (err instanceof OctoError) {
        res.status(err.status).json({ error: err.code, errorMessage: err.message, ...err.extra });
        return;
      }
      // Body that isn't JSON (express.json's own error).
      if (err?.type === 'entity.parse.failed') {
        res.status(400).json({ error: 'BAD_REQUEST', errorMessage: 'The body was not valid JSON' });
        return;
      }
      log?.error({ err }, 'octo request failed');
      res
        .status(500)
        .json({ error: 'INTERNAL_SERVER_ERROR', errorMessage: 'Something went wrong on our side' });
    },
  );

  // A path OCTO doesn't have here.
  router.use((req, res) => {
    res.status(400).json({
      error: 'BAD_REQUEST',
      errorMessage: `No OCTO endpoint at ${req.method} ${req.path}`,
    });
  });

  return router;
}
