// @ts-check
/**
 * The catalogue API (INV-01, INV-05, INV-10): products, their price categories and add-ons.
 *
 *   GET   /api/products                          products: view   (?status=published), each
 *                                                with `runs` ("Daily 09:00 · 15 seats", 16e-4)
 *   GET   /api/products/:id                      products: view   with `pricesNote` and
 *                                                `upcomingBookings` (16e-4b)
 *   POST  /api/products                          products: edit
 *   PATCH /api/products/:id                      products: edit
 *   POST  /api/products/:id/price-categories     products: edit
 *   PATCH /api/price-categories/:id              products: edit
 *   PUT   /api/products/:id/price-categories     products: edit   all of them at once (16e-4b)
 *   PUT   /api/products/:id/add-ons              products: edit   all of them at once (16e-4c)
 *   POST  /api/products/:id/add-ons              products: edit
 *   PATCH /api/add-ons/:id                       products: edit
 *
 * There is no DELETE for price categories or add-ons: set `isActive: false` to archive one.
 * Bookings will point at them (session 7), and deleting would rewrite history.
 * Products are retired the same way, with `status: "archived"`.
 *
 * Photos (19b-1): up to 8, uploaded first (POST /api/uploads/photo), and only this server's
 * own picture addresses are accepted. PUTTING a tour on sale needs a price and 3 photos.
 *
 * Money in and out is integer kobo (fields ending in "Kobo"). See packages/shared/src/money.js.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateProductSchema,
  UpdateProductSchema,
  CreatePriceCategorySchema,
  UpdatePriceCategorySchema,
  CreateAddOnSchema,
  UpdateAddOnSchema,
  PutPriceCategoriesSchema,
  PutAddOnsSchema,
  PRODUCT_STATUSES,
} from '@okapigo/shared/schemas/products';
import { SEAT_CONSUMING_STATUSES } from '@okapigo/shared/booking-status';
import { BALANCE_DUE_DAYS_BEFORE } from '@okapigo/shared/deposits';
import { WHATSAPP_HOLD_MINUTES } from '../whatsapp/engine.js';
import { findAgeOverlap } from '@okapigo/shared/catalogue';
import { scheduleSummary } from '@okapigo/shared/tour-facts';
import { slugify, RESERVED_TOUR_SLUGS } from '@okapigo/shared/slug';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { serializeProduct, serializePriceCategory, serializeAddOn } from './serializers.js';
import { notReadyMessage } from '@okapigo/shared/ready-to-sell';
import { assertOwnPictures } from './uploads.js';

/**
 * Children are always returned in the operator's chosen order. The second sort key is a
 * TIE-BREAKER: when two rows have the same sortOrder, PostgreSQL may return them in any
 * order, and that order can change between requests (a flaky test caught this). Sorting by
 * creation time as well makes the order stable.
 */
const stableOrder = [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }];
const withChildren = {
  priceCategories: { orderBy: stableOrder },
  addOns: { orderBy: stableOrder },
};

const ListQuerySchema = z.object({ status: z.enum(PRODUCT_STATUSES).optional() });

/**
 * Where a city is, for a meeting point with no pin yet (16e-4): the trip page then shows no
 * map until the owner pastes the real one. Lagos when the city isn't known.
 */
const CITY_PINS = /** @type {Record<string, [number, number]>} */ ({
  lagos: [6.4541, 3.3947],
  abuja: [9.0579, 7.4951],
  ibadan: [7.3775, 3.947],
  'port harcourt': [4.8156, 7.0498],
  calabar: [4.9757, 8.3417],
  kano: [12.0022, 8.592],
  enugu: [6.4584, 7.5464],
  'benin city': [6.335, 5.6037],
});

/**
 * The meeting point as stored: its own pin when given; otherwise the city's, marked
 * approximate. @param {any} mp @param {string | null} city
 */
function withPin(mp, city) {
  if (!mp) return mp;
  const { approximate: _ignored, ...rest } = mp;
  if (Number.isFinite(mp.lat) && Number.isFinite(mp.lng)) return rest;
  const [lat, lng] = CITY_PINS[(city ?? '').trim().toLowerCase()] ?? CITY_PINS.lagos;
  return { ...rest, lat, lng, approximate: true };
}

/**
 * Above the prices: whether they include the tax (designs: "Prices · include 7.5% VAT").
 * @param {{ name: string, basisPoints: number, inclusive: boolean } | null | undefined} tax
 */
export function taxLine(tax) {
  if (!tax || !tax.basisPoints) return 'No tax is added to these prices.';
  const rate = `${tax.basisPoints / 100}% ${tax.name}`;
  return tax.inclusive
    ? `Prices include ${rate}.`
    : `${rate} is added to these prices at checkout.`;
}

/**
 * When it runs and how many seats, for the tour list (designs: "Daily 09:00 · 15 seats",
 * "Not scheduled yet"). @param {any} p  with its ACTIVE schedules only
 */
function runsLine(p) {
  const active = p.schedules ?? []; // only the active ones are loaded (GET /api/products)
  if (active.length === 0) return 'Not scheduled yet';
  const seats = active[0].capacity ?? p.defaultCapacity;
  return `${scheduleSummary(active) ?? 'Several schedules'} · ${seats} ${seats === 1 ? 'seat' : 'seats'}`;
}

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
/**
 * @param {{ prisma: import('@prisma/client').PrismaClient, media: import('@okapigo/media').Storage }} deps
 */
export function productsRouter({ prisma, media }) {
  const router = Router();
  const canView = requirePermission('products', 'view');
  const canEdit = requirePermission('products', 'edit');

  /** @param {import('express').Request} req */
  // @ts-ignore: req.auth is set by requireAuth
  const operatorIdOf = (req) => req.auth.operatorId;

  /** Loads one of the caller's own products (with children), or 404s. */
  async function findOwnProduct(req, id) {
    const product = await prisma.product.findFirst({
      where: { id, operatorId: operatorIdOf(req) },
      include: withChildren,
    });
    if (!product) throw new HttpError(404, 'NOT_FOUND', 'Product not found.');
    return product;
  }

  /**
   * Refuses a change that would leave two active price categories covering the same age.
   * @param {Array<{ key: string, minAge: number, maxAge: number | null, isActive: boolean }>} categories
   *   every category of the product AS IT WOULD BE after the change
   */
  function assertNoAgeOverlap(categories) {
    const overlap = findAgeOverlap(categories);
    if (overlap) {
      throw new HttpError(
        409,
        'AGE_RANGE_OVERLAP',
        `The "${overlap[0]}" and "${overlap[1]}" prices cover some of the same ages.`,
      );
    }
  }

  /** A product may only point at its own operator's cancellation policy. */
  async function assertOwnPolicy(operatorId, policyId) {
    if (!policyId) return;
    const policy = await prisma.cancellationPolicy.findFirst({
      where: { id: policyId, operatorId },
    });
    if (!policy)
      throw new HttpError(400, 'INVALID_POLICY', 'That cancellation policy does not exist.');
  }

  /**
   * PUTTING a tour on sale (19b-1): it needs a price, and at least 3 photos
   * (@okapigo/shared/ready-to-sell). Checked only at that moment: a tour already on sale
   * with fewer photos keeps selling (decided 2026-11-23).
   * @param {{ priceCategories: Array<{ isActive: boolean }> }} product
   * @param {unknown[]} photos the photos it will have
   */
  function assertReadyToSell(product, photos) {
    const message = notReadyMessage({
      activePrices: product.priceCategories.filter((c) => c.isActive).length,
      photoCount: photos.length,
    });
    if (message) throw new HttpError(400, 'NOT_READY_TO_PUBLISH', message);
  }

  /**
   * A tour ON SALE must keep a price a guest can pay (changing prices, since stage 6).
   * Photos aren't checked here: removing one is allowed (19b-1).
   */
  function assertPublishable(product) {
    if (!product.priceCategories.some((c) => c.isActive)) {
      throw new HttpError(
        400,
        'NOT_READY_TO_PUBLISH',
        'Add at least one price before putting it on sale.',
      );
    }
  }

  // --- Products ----------------------------------------------------------------------

  router.get('/products', canView, async (req, res) => {
    const query = ListQuerySchema.safeParse(req.query);
    if (!query.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown status filter.');

    const products = await prisma.product.findMany({
      where: { operatorId: operatorIdOf(req), status: query.data.status },
      include: { ...withChildren, schedules: { where: { isActive: true } } },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    });
    res.json({ products: products.map((p) => ({ ...serializeProduct(p), runs: runsLine(p) })) });
  });

  router.get('/products/:id', canView, validate({ params: IdParamsSchema }), async (req, res) => {
    const product = await findOwnProduct(req, req.params.id);
    const [operator, upcomingBookings] = await Promise.all([
      prisma.operator.findUniqueOrThrow({ where: { id: product.operatorId } }),
      // "the 26 existing bookings keep their price" (16e-4b): bookings still to travel.
      prisma.booking.count({
        where: {
          productId: product.id,
          status: { in: [...SEAT_CONSUMING_STATUSES] },
          departure: { startsAt: { gt: new Date() } },
        },
      }),
    ]);
    res.json({
      product: {
        ...serializeProduct(product),
        pricesNote: taxLine(/** @type {any} */ (operator.pricing)?.tax),
        upcomingBookings,
        // Business-wide, not per tour (designs: under Cancellation and deposit, 16e-4c).
        balanceDueDays: BALANCE_DUE_DAYS_BEFORE,
        holdsLine: `Seats are held ${operator.holdMinutes} minutes on the website and ${WHATSAPP_HOLD_MINUTES} minutes on WhatsApp, for every tour.`,
      },
    });
  });

  router.post('/products', canEdit, validate({ body: CreateProductSchema }), async (req, res) => {
    const operatorId = operatorIdOf(req);
    // From the title when not given. A title like "Checkout" would make a reserved slug
    // (see slug.js), so it becomes "checkout-tour". (A GIVEN slug is checked by the schema.)
    const derived = slugify(req.body.title);
    const slug = req.body.slug ?? (RESERVED_TOUR_SLUGS.has(derived) ? `${derived}-tour` : derived);
    if (req.body.status === 'published') {
      // A brand-new product has no prices yet, so it can't start out on sale.
      assertReadyToSell({ priceCategories: [] }, req.body.photos);
    }
    assertOwnPictures(media, req.body.photos);
    if (await prisma.product.findFirst({ where: { operatorId, slug }, select: { id: true } })) {
      throw new HttpError(409, 'SLUG_TAKEN', `Another product already uses the link "${slug}".`);
    }
    await assertOwnPolicy(operatorId, req.body.cancellationPolicyId);

    const operator = await prisma.operator.findUniqueOrThrow({ where: { id: operatorId } });
    const product = await prisma.product.create({
      data: {
        ...req.body,
        meetingPoint: withPin(req.body.meetingPoint, operator.city),
        slug,
        operatorId,
      },
      include: withChildren,
    });
    res.status(201).json({ product: serializeProduct(product) });
  });

  router.patch(
    '/products/:id',
    canEdit,
    validate({ params: IdParamsSchema, body: UpdateProductSchema }),
    async (req, res) => {
      const product = await findOwnProduct(req, req.params.id);
      // Putting it on sale now (not when it already was, and saves something else).
      if (req.body.status === 'published' && product.status !== 'published') {
        assertReadyToSell(product, req.body.photos ?? /** @type {unknown[]} */ (product.photos));
      }
      if (req.body.photos) assertOwnPictures(media, req.body.photos);
      await assertOwnPolicy(product.operatorId, req.body.cancellationPolicyId);
      if (req.body.slug && req.body.slug !== product.slug) {
        const taken = await prisma.product.findFirst({
          where: { operatorId: product.operatorId, slug: req.body.slug },
          select: { id: true },
        });
        if (taken)
          throw new HttpError(409, 'SLUG_TAKEN', 'Another product already uses that link.');
      }

      const data = { ...req.body };
      if (req.body.meetingPoint) {
        const operator = await prisma.operator.findUniqueOrThrow({
          where: { id: product.operatorId },
        });
        data.meetingPoint = withPin(req.body.meetingPoint, operator.city);
      }
      const updated = await prisma.product.update({
        where: { id: product.id },
        data,
        include: withChildren,
      });
      res.json({ product: serializeProduct(updated) });
    },
  );

  // --- Price categories (INV-05) -----------------------------------------------------

  router.post(
    '/products/:id/price-categories',
    canEdit,
    validate({ params: IdParamsSchema, body: CreatePriceCategorySchema }),
    async (req, res) => {
      const product = await findOwnProduct(req, req.params.id);
      if (product.priceCategories.some((c) => c.key === req.body.key)) {
        throw new HttpError(
          409,
          'PRICE_CATEGORY_EXISTS',
          `There is already a "${req.body.key}" price.`,
        );
      }
      assertNoAgeOverlap([...product.priceCategories, req.body]);

      const category = await prisma.priceCategory.create({
        data: { ...req.body, productId: product.id, operatorId: product.operatorId },
      });
      res.status(201).json({ priceCategory: serializePriceCategory(category) });
    },
  );

  router.patch(
    '/price-categories/:id',
    canEdit,
    validate({ params: IdParamsSchema, body: UpdatePriceCategorySchema }),
    async (req, res) => {
      const existing = await prisma.priceCategory.findFirst({
        where: { id: req.params.id, operatorId: operatorIdOf(req) },
      });
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Price not found.');
      const product = await findOwnProduct(req, existing.productId);

      // Check the product's prices as they WOULD be after this change.
      const after = product.priceCategories.map((c) =>
        c.id === existing.id ? { ...c, ...req.body } : c,
      );
      const changed = after.find((c) => c.id === existing.id);
      if (changed.maxAge !== null && changed.maxAge < changed.minAge) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'maxAge must be at least minAge.');
      }
      assertNoAgeOverlap(after);
      // Don't let the last active price be archived while the product is on sale.
      if (product.status === 'published') assertPublishable({ priceCategories: after });

      const category = await prisma.priceCategory.update({
        where: { id: existing.id },
        data: req.body,
      });
      res.json({ priceCategory: serializePriceCategory(category) });
    },
  );

  // The tour's prices as a whole (Settings › Tours › Prices, 16e-4b): one change, all or
  // nothing, checked as it will be (no two prices for the same age; on sale keeps a price).
  router.put(
    '/products/:id/price-categories',
    canEdit,
    validate({ params: IdParamsSchema, body: PutPriceCategoriesSchema }),
    async (req, res) => {
      const product = await findOwnProduct(req, req.params.id);
      /** @type {any[]} */
      const sent = req.body.categories;
      const known = new Map(product.priceCategories.map((c) => [c.id, c]));
      for (const c of sent) {
        if (c.id && !known.has(c.id)) throw new HttpError(404, 'NOT_FOUND', 'Price not found.');
      }
      // A new price's key, from its name, unique on this tour: "senior", "senior-2".
      const keys = new Set(product.priceCategories.map((c) => c.key));
      const keyFor = (/** @type {string} */ name) => {
        const base = slugify(name) || 'price';
        let key = base;
        for (let n = 2; keys.has(key); n++) key = `${base}-${n}`;
        keys.add(key);
        return key;
      };
      const kept = new Set(sent.filter((c) => c.id).map((c) => c.id));
      const after = [
        ...sent.map((c, i) => ({
          ...c,
          key: c.id ? known.get(c.id).key : keyFor(c.name),
          sortOrder: i,
          isActive: true,
        })),
        // Left out: archived, after the active ones (so the order never ties with them).
        ...product.priceCategories
          .filter((c) => !kept.has(c.id))
          .map((c, i) => ({ ...c, isActive: false, sortOrder: sent.length + i })),
      ];
      assertNoAgeOverlap(after);
      if (product.status === 'published') assertPublishable({ priceCategories: after });

      await prisma.$transaction(async (tx) => {
        for (const c of after) {
          const data = {
            name: c.name,
            minAge: c.minAge,
            maxAge: c.maxAge,
            amountKobo: c.amountKobo,
            sortOrder: c.sortOrder,
            isActive: c.isActive,
          };
          if (c.id) await tx.priceCategory.update({ where: { id: c.id }, data });
          else {
            await tx.priceCategory.create({
              data: { ...data, key: c.key, productId: product.id, operatorId: product.operatorId },
            });
          }
        }
      });
      res.json({ product: serializeProduct(await findOwnProduct(req, product.id)) });
    },
  );

  // --- Add-ons (INV-10) --------------------------------------------------------------

  // The tour's extras as a whole (Settings › Tours › Extras, 16e-4c): one change, all or
  // nothing. Left out = archived, after the active ones.
  router.put(
    '/products/:id/add-ons',
    canEdit,
    validate({ params: IdParamsSchema, body: PutAddOnsSchema }),
    async (req, res) => {
      const product = await findOwnProduct(req, req.params.id);
      /** @type {any[]} */
      const sent = req.body.addOns;
      const known = new Set(product.addOns.map((a) => a.id));
      for (const a of sent) {
        if (a.id && !known.has(a.id)) throw new HttpError(404, 'NOT_FOUND', 'Extra not found.');
      }
      const kept = new Set(sent.filter((a) => a.id).map((a) => a.id));
      await prisma.$transaction(async (tx) => {
        for (const [i, a] of sent.entries()) {
          const data = {
            name: a.name,
            description: a.description,
            priceKobo: a.priceKobo,
            stockPerDeparture: a.stockPerDeparture,
            sortOrder: i,
            isActive: true,
          };
          if (a.id) await tx.addOn.update({ where: { id: a.id }, data });
          else {
            await tx.addOn.create({
              data: { ...data, productId: product.id, operatorId: product.operatorId },
            });
          }
        }
        for (const [i, a] of product.addOns.filter((x) => !kept.has(x.id)).entries()) {
          await tx.addOn.update({
            where: { id: a.id },
            data: { isActive: false, sortOrder: sent.length + i },
          });
        }
      });
      res.json({ product: serializeProduct(await findOwnProduct(req, product.id)) });
    },
  );

  router.post(
    '/products/:id/add-ons',
    canEdit,
    validate({ params: IdParamsSchema, body: CreateAddOnSchema }),
    async (req, res) => {
      const product = await findOwnProduct(req, req.params.id);
      const addOn = await prisma.addOn.create({
        data: { ...req.body, productId: product.id, operatorId: product.operatorId },
      });
      res.status(201).json({ addOn: serializeAddOn(addOn) });
    },
  );

  router.patch(
    '/add-ons/:id',
    canEdit,
    validate({ params: IdParamsSchema, body: UpdateAddOnSchema }),
    async (req, res) => {
      const existing = await prisma.addOn.findFirst({
        where: { id: req.params.id, operatorId: operatorIdOf(req) },
      });
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Add-on not found.');

      const addOn = await prisma.addOn.update({ where: { id: existing.id }, data: req.body });
      res.json({ addOn: serializeAddOn(addOn) });
    },
  );

  return router;
}
