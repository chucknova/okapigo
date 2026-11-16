// @ts-check
/**
 * The catalogue API (INV-01, INV-05, INV-10): products, their price categories and add-ons.
 *
 *   GET   /api/products                          products: view   (?status=published)
 *   GET   /api/products/:id                      products: view
 *   POST  /api/products                          products: edit
 *   PATCH /api/products/:id                      products: edit
 *   POST  /api/products/:id/price-categories     products: edit
 *   PATCH /api/price-categories/:id              products: edit
 *   POST  /api/products/:id/add-ons              products: edit
 *   PATCH /api/add-ons/:id                       products: edit
 *
 * There is no DELETE for price categories or add-ons: set `isActive: false` to archive one.
 * Bookings will point at them (session 7), and deleting would rewrite history.
 * Products are retired the same way, with `status: "archived"`.
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
  PRODUCT_STATUSES,
} from '@okapigo/shared/schemas/products';
import { findAgeOverlap } from '@okapigo/shared/catalogue';
import { slugify } from '@okapigo/shared/slug';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { serializeProduct, serializePriceCategory, serializeAddOn } from './serializers.js';

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

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function productsRouter({ prisma }) {
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

  /** A product can only go on sale if a guest can actually pay for it. */
  function assertPublishable(product) {
    if (!product.priceCategories.some((c) => c.isActive)) {
      throw new HttpError(
        400,
        'NOT_READY_TO_PUBLISH',
        'Add at least one active price before publishing.',
      );
    }
  }

  // --- Products ----------------------------------------------------------------------

  router.get('/products', canView, async (req, res) => {
    const query = ListQuerySchema.safeParse(req.query);
    if (!query.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown status filter.');

    const products = await prisma.product.findMany({
      where: { operatorId: operatorIdOf(req), status: query.data.status },
      include: withChildren,
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    });
    res.json({ products: products.map(serializeProduct) });
  });

  router.get('/products/:id', canView, validate({ params: IdParamsSchema }), async (req, res) => {
    res.json({ product: serializeProduct(await findOwnProduct(req, req.params.id)) });
  });

  router.post('/products', canEdit, validate({ body: CreateProductSchema }), async (req, res) => {
    const operatorId = operatorIdOf(req);
    const slug = req.body.slug ?? slugify(req.body.title);
    if (req.body.status === 'published') {
      // A brand-new product has no prices yet, so it can't start out on sale.
      assertPublishable({ priceCategories: [] });
    }
    if (await prisma.product.findFirst({ where: { operatorId, slug }, select: { id: true } })) {
      throw new HttpError(409, 'SLUG_TAKEN', `Another product already uses the link "${slug}".`);
    }
    await assertOwnPolicy(operatorId, req.body.cancellationPolicyId);

    const product = await prisma.product.create({
      data: { ...req.body, slug, operatorId },
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
      if (req.body.status === 'published') assertPublishable(product);
      await assertOwnPolicy(product.operatorId, req.body.cancellationPolicyId);
      if (req.body.slug && req.body.slug !== product.slug) {
        const taken = await prisma.product.findFirst({
          where: { operatorId: product.operatorId, slug: req.body.slug },
          select: { id: true },
        });
        if (taken)
          throw new HttpError(409, 'SLUG_TAKEN', 'Another product already uses that link.');
      }

      const updated = await prisma.product.update({
        where: { id: product.id },
        data: req.body,
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

  // --- Add-ons (INV-10) --------------------------------------------------------------

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
