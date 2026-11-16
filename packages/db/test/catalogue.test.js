/**
 * The catalogue tables (products, price categories, add-ons) and the seeded tours.
 * Same approach as schema.test.js: throwaway operators, real database.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  CreateProductSchema,
  CreatePriceCategorySchema,
  CreateAddOnSchema,
} from '@okapigo/shared/schemas/products';
import { findAgeOverlap } from '@okapigo/shared/catalogue';
import { createPrismaClient, seedDemoOperator } from '../src/index.js';
import { TOURS } from '../src/seed/tours.js';

let prisma;
const created = [];

beforeAll(() => {
  prisma = createPrismaClient(process.env.DATABASE_URL);
});
afterAll(() => prisma.$disconnect());
afterEach(async () => {
  await prisma.operator.deleteMany({ where: { id: { in: created.splice(0) } } });
});

async function seed() {
  const operator = await seedDemoOperator(prisma, { slug: `test-${randomUUID().slice(0, 8)}` });
  created.push(operator.id);
  return operator;
}

describe('seed content', () => {
  // If someone edits tours.js and breaks a rule, this fails before the demo does.
  it.each(TOURS.map((t) => [t.title, t]))('%s passes the API validation rules', (_title, tour) => {
    const { prices, addOns, ...product } = tour;

    expect(CreateProductSchema.safeParse(product).error).toBeUndefined();
    for (const p of prices) expect(CreatePriceCategorySchema.safeParse(p).error).toBeUndefined();
    for (const a of addOns) expect(CreateAddOnSchema.safeParse(a).error).toBeUndefined();
    expect(findAgeOverlap(prices)).toBeNull();
  });

  it('creates five published tours with prices and add-ons', async () => {
    const operator = await seed();
    const products = await prisma.product.findMany({
      where: { operatorId: operator.id },
      include: { priceCategories: true, addOns: true },
    });

    expect(products).toHaveLength(5);
    expect(products.every((p) => p.status === 'published')).toBe(true);
    expect(products.every((p) => p.priceCategories.length === 3)).toBe(true);

    const heritage = products.find((p) => p.slug === 'lagos-island-heritage-walk');
    const adult = heritage.priceCategories.find((c) => c.key === 'adult');
    expect(adult.amountKobo).toBe(2_500_000); // ₦25,000 stored as kobo
    expect(heritage.meetingPoint).toMatchObject({ name: expect.stringContaining('Tinubu') });

    const foodCrawl = products.find((p) => p.slug === 'lagos-street-food-crawl');
    expect(foodCrawl.addOns.map((a) => a.stockPerDeparture)).toEqual([10, 10]);
  });
});

describe('catalogue constraints', () => {
  /** The Heritage Walk of a fresh seeded operator. */
  async function heritageWalk() {
    const operator = await seed();
    return prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug: 'lagos-island-heritage-walk' },
    });
  }

  it('refuses a negative price', async () => {
    const product = await heritageWalk();
    await expect(
      prisma.priceCategory.create({
        data: {
          operatorId: product.operatorId,
          productId: product.id,
          key: 'student',
          name: 'Student',
          minAge: 18,
          maxAge: 25,
          amountKobo: -100,
        },
      }),
    ).rejects.toThrow(/price_categories_amount_non_negative/);
  });

  it('refuses an age range that ends before it starts', async () => {
    const product = await heritageWalk();
    await expect(
      prisma.priceCategory.create({
        data: {
          operatorId: product.operatorId,
          productId: product.id,
          key: 'odd',
          name: 'Odd',
          minAge: 12,
          maxAge: 3,
          amountKobo: 100,
        },
      }),
    ).rejects.toThrow(/price_categories_age_range_valid/);
  });

  it('refuses an unknown product status', async () => {
    const product = await heritageWalk();
    await expect(
      prisma.product.update({ where: { id: product.id }, data: { status: 'deleted' } }),
    ).rejects.toThrow(/products_status_valid/);
  });

  it("refuses an add-on that points at another operator's product", async () => {
    const product = await heritageWalk();
    const other = await seed();

    await expect(
      prisma.addOn.create({
        data: {
          operatorId: other.id, // wrong tenant for this product
          productId: product.id,
          name: 'Sneaky add-on',
          priceKobo: 100,
        },
      }),
    ).rejects.toThrow(/add_ons_product_id_operator_id_fkey/);
  });

  it('deleting an operator removes its whole catalogue', async () => {
    const operator = await seed();
    await prisma.operator.delete({ where: { id: operator.id } });

    expect(await prisma.product.count({ where: { operatorId: operator.id } })).toBe(0);
    expect(await prisma.priceCategory.count({ where: { operatorId: operator.id } })).toBe(0);
  });
});
