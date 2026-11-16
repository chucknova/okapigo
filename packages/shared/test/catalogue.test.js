import { describe, it, expect } from 'vitest';
import { nairaToKobo, formatNaira } from '../src/money.js';
import { findAgeOverlap, findCategoryForAge } from '../src/catalogue.js';
import { CreateProductSchema, CreatePriceCategorySchema } from '../src/schemas/products.js';

describe('money', () => {
  it('converts naira to whole kobo, fixing float noise', () => {
    expect(nairaToKobo(25000)).toBe(2_500_000);
    expect(nairaToKobo(99.99)).toBe(9999); // 99.99 * 100 = 9998.999999999998 without rounding
    expect(nairaToKobo(0.1 + 0.2)).toBe(30);
  });

  it('formats kobo for people', () => {
    expect(formatNaira(2_500_000)).toBe('₦25,000');
    expect(formatNaira(9999)).toBe('₦99.99');
    expect(formatNaira(0)).toBe('₦0');
  });

  it('refuses fractional kobo', () => {
    expect(() => formatNaira(10.5)).toThrow(TypeError);
  });
});

const IRIN_CATEGORIES = [
  { key: 'adult', minAge: 13, maxAge: null },
  { key: 'child', minAge: 3, maxAge: 12 },
  { key: 'infant', minAge: 0, maxAge: 2 },
];

describe('findCategoryForAge', () => {
  it.each([
    [0, 'infant'],
    [2, 'infant'],
    [3, 'child'],
    [12, 'child'],
    [13, 'adult'],
    [80, 'adult'],
  ])('a %i-year-old pays the %s price', (age, key) => {
    expect(findCategoryForAge(IRIN_CATEGORIES, age)?.key).toBe(key);
  });

  it('returns null when no category covers the age (e.g. no infants on this tour)', () => {
    const noInfants = IRIN_CATEGORIES.filter((c) => c.key !== 'infant');
    expect(findCategoryForAge(noInfants, 1)).toBeNull();
  });

  it('ignores archived categories', () => {
    const archivedChild = IRIN_CATEGORIES.map((c) =>
      c.key === 'child' ? { ...c, isActive: false } : c,
    );
    expect(findCategoryForAge(archivedChild, 7)).toBeNull();
  });
});

describe('findAgeOverlap', () => {
  it("finds no overlap in Ìrìn's standard categories", () => {
    expect(findAgeOverlap(IRIN_CATEGORIES)).toBeNull();
  });

  it('spots two ranges that share an age', () => {
    const withTeen = [...IRIN_CATEGORIES, { key: 'teen', minAge: 12, maxAge: 17 }];
    expect(findAgeOverlap(withTeen)).toEqual(['adult', 'teen']);
  });

  it('treats an open-ended range (maxAge null) as going on forever', () => {
    expect(
      findAgeOverlap([
        { key: 'adult', minAge: 13, maxAge: null },
        { key: 'senior', minAge: 65, maxAge: null },
      ]),
    ).toEqual(['adult', 'senior']);
  });
});

describe('product schemas', () => {
  const minimal = {
    title: 'Lagos Island Heritage Walk',
    summary: 'Three hours through old Lagos.',
    description: 'A walk.',
    durationMinutes: 180,
    defaultCapacity: 15,
    meetingPoint: { name: 'Tinubu Square', address: 'Lagos Island', lat: 6.4541, lng: 3.3893 },
  };

  it('fills in defaults for a new product', () => {
    const parsed = CreateProductSchema.parse(minimal);
    expect(parsed.status).toBe('draft');
    expect(parsed.stops).toEqual([]);
  });

  it('requires alt text on photos', () => {
    const result = CreateProductSchema.safeParse({
      ...minimal,
      photos: [{ url: 'https://example.com/a.jpg' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects money that is not whole kobo', () => {
    const result = CreatePriceCategorySchema.safeParse({
      key: 'adult',
      name: 'Adult',
      minAge: 13,
      maxAge: null,
      amountKobo: 2500.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an age range that ends before it starts', () => {
    const result = CreatePriceCategorySchema.safeParse({
      key: 'child',
      name: 'Child',
      minAge: 12,
      maxAge: 3,
      amountKobo: 100,
    });
    expect(result.success).toBe(false);
  });
});
