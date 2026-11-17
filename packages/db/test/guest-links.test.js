/**
 * Signed guest links: they round-trip, and anything not signed by us is refused.
 * Pure functions, no database.
 */
import { describe, it, expect } from 'vitest';
import { guestToken, bookingIdFromGuestToken } from '../src/guest-links.js';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('guest links', () => {
  it('gives a 44-character URL-safe token that leads back to the booking', () => {
    const token = guestToken(SECRET, ID);
    expect(token).toMatch(/^[A-Za-z0-9_-]{44}$/);
    expect(bookingIdFromGuestToken(SECRET, token)).toBe(ID);
  });

  it('is the same every time, so a worker can rebuild the link later', () => {
    expect(guestToken(SECRET, ID)).toBe(guestToken(SECRET, ID));
  });

  it('refuses a token signed with another secret', () => {
    const forged = guestToken('another-secret-that-is-also-long-enough-!!', ID);
    expect(bookingIdFromGuestToken(SECRET, forged)).toBeNull();
  });

  it("refuses someone else's booking id with a copied signature", () => {
    const mine = guestToken(SECRET, ID);
    const otherId = guestToken(SECRET, '00000000-0000-4000-8000-000000000000').slice(0, 22);
    expect(bookingIdFromGuestToken(SECRET, otherId + mine.slice(22))).toBeNull();
  });

  it('refuses a token with any single character changed', () => {
    const token = guestToken(SECRET, ID);
    for (const i of [0, 21, 22, 43]) {
      const c = token[i] === 'A' ? 'B' : 'A';
      const changed = token.slice(0, i) + c + token.slice(i + 1);
      expect(bookingIdFromGuestToken(SECRET, changed)).toBeNull();
    }
  });

  it('refuses malformed input without throwing', () => {
    for (const bad of ['', 'short', 'x'.repeat(44).replace('x', '!'), 'x'.repeat(45)]) {
      expect(bookingIdFromGuestToken(SECRET, bad)).toBeNull();
    }
    expect(bookingIdFromGuestToken(SECRET, /** @type {any} */ (undefined))).toBeNull();
  });
});
