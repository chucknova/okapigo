/**
 * Signed guest links: they round-trip, and anything not signed by us is refused.
 * Pure functions, no database.
 */
import { describe, it, expect } from 'vitest';
import {
  guestToken,
  bookingIdFromGuestToken,
  ticketCode,
  bookingIdFromTicketCode,
} from '../src/guest-links.js';

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

describe('ticket codes (the QR on the trip hub)', () => {
  it('is 42 characters, starts OKG1, and leads back to the booking', () => {
    const code = ticketCode(SECRET, ID);
    expect(code).toMatch(/^OKG1[A-Za-z0-9_-]{38}$/);
    expect(bookingIdFromTicketCode(SECRET, code)).toBe(ID);
  });

  it('never contains the guest link, and neither can stand in for the other', () => {
    const code = ticketCode(SECRET, ID);
    const token = guestToken(SECRET, ID);
    expect(code).not.toContain(token.slice(22)); // the link's signature isn't in the ticket
    // A ticket's signature doesn't make a guest link, and a guest link isn't a ticket.
    expect(
      bookingIdFromGuestToken(SECRET, code.slice(4, 26) + code.slice(26).padEnd(22, 'A')),
    ).toBeNull();
    expect(bookingIdFromTicketCode(SECRET, 'OKG1' + token.slice(0, 38))).toBeNull();
  });

  it('refuses every single-character change, another secret, and junk', () => {
    const code = ticketCode(SECRET, ID);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let i = 4; i < code.length; i++) {
      const other = alphabet[(alphabet.indexOf(code[i]) + 1) % alphabet.length];
      expect(
        bookingIdFromTicketCode(SECRET, code.slice(0, i) + other + code.slice(i + 1)),
      ).toBeNull();
    }
    expect(bookingIdFromTicketCode('another-secret-that-is-at-least-32-chars', code)).toBeNull();
    for (const bad of ['', 'OKG1', code + 'A', code.replace('OKG1', 'OKG2'), null]) {
      expect(bookingIdFromTicketCode(SECRET, /** @type {any} */ (bad))).toBeNull();
    }
  });
});
