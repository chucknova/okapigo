// @ts-check
/**
 * catalogue.js — rules about a product's price categories (INV-05).
 *
 * Each price category covers an inclusive age range: adult 13+, child 3–12, infant 0–2.
 * Two rules keep "which price does a 7-year-old pay?" unambiguous:
 *   1. Active categories of one product must NOT overlap (otherwise a 12-year-old could
 *      match both "child" and "teen").
 *   2. findCategoryForAge picks the one category whose range contains the age.
 * Gaps are allowed: a product without an infant category simply doesn't take infants.
 */

/**
 * @typedef {{ key: string, minAge: number, maxAge: number | null, isActive?: boolean }} AgeRanged
 */

/**
 * Returns the first pair of overlapping ACTIVE categories, or null if none overlap.
 *   findAgeOverlap([{key:'child',minAge:3,maxAge:12},{key:'teen',minAge:12,maxAge:17}])
 *     → ['child', 'teen']   (both include age 12)
 * @param {AgeRanged[]} categories
 * @returns {[string, string] | null}
 */
export function findAgeOverlap(categories) {
  const active = categories.filter((c) => c.isActive !== false);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      // Two inclusive ranges overlap if each starts before the other ends.
      // A null maxAge means "no upper limit" (Infinity).
      const aMax = a.maxAge ?? Infinity;
      const bMax = b.maxAge ?? Infinity;
      if (a.minAge <= bMax && b.minAge <= aMax) return [a.key, b.key];
    }
  }
  return null;
}

/**
 * Finds the active category for a traveller's age, or null if no category covers it.
 * @template {AgeRanged} T
 * @param {T[]} categories
 * @param {number} age
 * @returns {T | null}
 */
export function findCategoryForAge(categories, age) {
  return (
    categories.find(
      (c) => c.isActive !== false && age >= c.minAge && (c.maxAge === null || age <= c.maxAge),
    ) ?? null
  );
}
