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
import { channelByKey, listAvailability, seatsLeft } from '@okapigo/db';
import {
  AvailabilityCalendarBodySchema,
  AvailabilityCheckBodySchema,
  CAPABILITY_PRICING,
} from '@okapigo/shared/octo';
import { OperatorPricingSchema } from '@okapigo/shared/schemas/pricing';
import { addDays, localDate } from '@okapigo/shared/time';
import { OPTION_ID, availabilityOf, basketPricing, productOf, statusOf, unitsOf } from './views.js';

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
 * @param {{ prisma: import('@prisma/client').PrismaClient, apiPublicUrl: string, log?: any }} deps
 */
export function octoRouter({ prisma, apiPublicUrl, log }) {
  const router = Router();
  router.use(express.json({ limit: '100kb' }));

  // --- Who's asking, and what they asked for -------------------------------------------------
  router.use(async (req, res, next) => {
    try {
      // Capabilities from the header or `?_capabilities=` (the docs allow either).
      const asked = String(req.get('Octo-Capabilities') ?? req.query._capabilities ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const pricing = asked.includes(CAPABILITY_PRICING) || asked.includes('pricing');
      res.set('Octo-Capabilities', pricing ? CAPABILITY_PRICING : '');
      res.locals.pricing = pricing;

      const auth = req.get('Authorization') ?? '';
      const key = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
      if (!key) {
        throw new OctoError(401, 'UNAUTHORIZED', 'Send your API key: Authorization: Bearer <key>.');
      }
      const channel = await channelByKey(prisma, key);
      if (!channel)
        throw new OctoError(403, 'FORBIDDEN', 'That API key is not valid, or it was switched off.');
      res.locals.channel = channel;
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
