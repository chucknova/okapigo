// @ts-check
/**
 * contact.js — turns whatever someone types into ONE canonical email or phone number.
 *
 * Why it matters: staff sign in with "email or phone" (ACC-01). If "0803 123 4567",
 * "+234 803 123 4567" and "2348031234567" were stored as three different strings, the same
 * person could end up with three accounts, or be unable to sign in. So every contact detail
 * is normalised BEFORE it is saved or looked up. The database's CHECK constraints
 * (lowercase email, E.164 phone) are the safety net if any code forgets.
 */

const E164 = /^\+[1-9][0-9]{7,14}$/;
// Deliberately simple: "something@something.something", no spaces. The real test of an
// email address is whether the one-time code arrives.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "  Kemi@Example.COM " → "kemi@example.com". Returns null if it isn't an email.
 * @param {string} input
 */
export function normalizeEmail(input) {
  const email = input.trim().toLowerCase();
  return EMAIL.test(email) ? email : null;
}

/**
 * Normalises a phone number to E.164 (+2348031234567). Returns null if it can't.
 * Nigerian local formats are understood because that's who OkapiGo serves:
 *   "0803 123 4567" → "+2348031234567"   (local: leading 0 + 10 digits)
 *   "2348031234567" → "+2348031234567"   (country code without +)
 *   "+44 20 7946 0958" → "+442079460958" (any international number with +)
 * @param {string} input
 */
export function normalizePhone(input) {
  // Keep a leading +, drop spaces, dashes, dots and brackets.
  const compact = input.trim().replace(/[\s\-.()]/g, '');

  let phone = compact;
  if (/^0\d{10}$/.test(compact)) phone = `+234${compact.slice(1)}`;
  else if (/^234\d{10}$/.test(compact)) phone = `+${compact}`;

  return E164.test(phone) ? phone : null;
}

/**
 * Works out whether a single "email or phone" field is an email or a phone, and normalises it.
 * Contains "@" → treated as email; otherwise → phone.
 * @param {string} input
 * @returns {{ channel: 'email' | 'phone', destination: string } | null}
 */
export function parseContact(input) {
  if (input.includes('@')) {
    const email = normalizeEmail(input);
    return email ? { channel: 'email', destination: email } : null;
  }
  const phone = normalizePhone(input);
  return phone ? { channel: 'phone', destination: phone } : null;
}
