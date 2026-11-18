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

/**
 * The "from ₦…" price shown on tour cards and link previews.
 *
 * Rule: the cheapest ACTIVE category with no upper age (the adult-style price), because
 * "from ₦12,500" (a child's price) would mislead an adult reading the card. If a product
 * has no open-ended category (e.g. a kids-only workshop), it falls back to the cheapest
 * active price above zero. Free categories (infants) never count: "from ₦0" helps nobody.
 *
 *   fromPriceKobo([{adult 13+ ₦25,000}, {child 3–12 ₦12,500}, {infant ₦0}])  → 2_500_000
 *
 * @param {Array<AgeRanged & { amountKobo: number }>} categories
 * @returns {number | null}  null when nothing is priced (the card shows no price)
 */
export function fromPriceKobo(categories) {
  const priced = categories.filter((c) => c.isActive !== false && c.amountKobo > 0);
  const openEnded = priced.filter(isAdultCategory);
  const pool = openEnded.length > 0 ? openEnded : priced;
  if (pool.length === 0) return null;
  return Math.min(...pool.map((c) => c.amountKobo));
}

/**
 * Is this an ADULT category? One with no upper age ("13 and over"). The operator decides
 * where adulthood starts by setting the category's minimum age (13 at Ìrìn), so the rule
 * below follows each tour's own prices instead of a fixed number like 18.
 * @param {{ maxAge: number | null }} category
 */
export function isAdultCategory(category) {
  return category.maxAge === null;
}

/**
 * "Children and infants can't book without an adult" (decided 2026-11-17).
 *
 * Returns why a basket can't be booked, or null if it's fine:
 *   - the basket must include at least one traveller charged in an adult category
 *   - a tour with NO adult category (e.g. a kids-only workshop) has no adult to require,
 *     so the rule doesn't apply there
 *
 * It returns a problem instead of throwing, because a QUOTE for a child-only basket is still
 * useful (the guest is halfway through choosing). Only holding and booking refuse it.
 *
 * @param {Array<AgeRanged>} categories   the tour's price categories
 * @param {string[]} chargedKeys           the category key each traveller was charged as
 * @returns {{ code: 'ADULT_REQUIRED', message: string } | null}
 */
export function accompanimentProblem(categories, chargedKeys) {
  const adults = categories.filter((c) => c.isActive !== false && isAdultCategory(c));
  if (adults.length === 0) return null;
  const adultKeys = new Set(adults.map((c) => c.key));
  if (chargedKeys.some((k) => adultKeys.has(k))) return null;
  const youngest = Math.min(...adults.map((c) => c.minAge));
  return {
    code: 'ADULT_REQUIRED',
    // The checkout design's wording (stage 12c): the screen shows this message as it is.
    message: `Children must travel with an adult. Add at least one adult (${youngest} or over).`,
  };
}
