// @ts-check
/**
 * reference.js — booking references people can read over the phone: "IRN-7K4Q2M".
 *
 * The alphabet is Crockford's Base32 without the letters that look like digits
 * (no I, L, O, U): 0-9 and A-Z minus those, 32 symbols. 6 symbols = 32⁶ ≈ 1 billion
 * combinations, so collisions are rare, and the database's unique index catches the rare
 * one (the caller retries with a new reference).
 *
 * Randomness comes from crypto.getRandomValues (cryptographically strong, so references
 * can't be guessed in sequence). It exists in Node AND in browsers; this package also runs
 * in the operator app and checkout, where `node:crypto` doesn't exist.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A short prefix from the operator's slug: the initials of up to three words, so staff can
 * tell at a glance which business a reference belongs to.
 *   referencePrefix('irin-lagos-tours') → 'ILT'
 * @param {string} slug
 */
export function referencePrefix(slug) {
  const initials = slug
    .split('-')
    .map((word) => word[0]?.toUpperCase() ?? '')
    // Letters only: "lagos-360-tours" must give "LT", not "L3T", because references are
    // LETTERS-dash-code, and the database's format check enforces it (it caught this bug).
    .filter((ch) => ch >= 'A' && ch <= 'Z')
    .join('');
  return (initials || 'BK').slice(0, 3);
}

/**
 * A new reference like "ILT-7K4Q2M".
 * @param {string} prefix
 */
export function generateReference(prefix) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  // 256 possible byte values ÷ 32 symbols = exactly 8 each, so `% 32` picks every symbol
  // with equal probability (no "modulo bias").
  const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${prefix}-${code}`;
}
