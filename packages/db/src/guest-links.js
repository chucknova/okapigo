// @ts-check
/**
 * guest-links.js — the private link a guest uses to come back to their booking
 * (review and pay now; the trip hub in session 12; links in every message from session 14).
 *
 * Guests have no accounts, so the link IS the key, like a payment link. But unlike payment
 * links (a random token whose hash is stored), a guest token is SIGNED:
 *
 *   token = base64url(booking id, 16 bytes) + base64url(HMAC-SHA256(key, booking id), 16 bytes)
 *           └──────── 22 characters ─────────┘ └──────────────── 22 characters ────────────────┘
 *
 * Why signed instead of random-and-stored?
 *   - ANY part of the server can rebuild the link at any time from the booking id and the
 *     secret. The worker that sends the confirmation message (session 14) runs long after
 *     the booking was created, and a random token would be gone by then (we'd only have its
 *     hash).
 *   - Nothing secret is stored in the database, so a database leak gives no working links.
 *   - Forging one needs the secret: the HMAC is 128 bits, far beyond guessing.
 * The trade-off: a single link can't be revoked on its own (only by changing the secret,
 * which changes them all). Fine for the MVP; noted in the learning note.
 *
 * The key is derived from the server's AUTH_SECRET with a fixed label ("domain separation"),
 * so a guest-link signature can never be reused as any other kind of signature.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const LABEL = 'okapigo:guest-booking-link:v1';
const SIG_BYTES = 16; // 128 bits
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{44}$/;

/** @param {string} secret */
const keyFrom = (secret) => createHmac('sha256', secret).update(LABEL).digest();

/** @param {string} uuid */
const uuidToBytes = (uuid) => Buffer.from(uuid.replaceAll('-', ''), 'hex');

/** @param {Buffer} bytes */
function bytesToUuid(bytes) {
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * @param {string} secret
 * @param {Buffer} idBytes
 */
const sign = (secret, idBytes) =>
  createHmac('sha256', keyFrom(secret)).update(idBytes).digest().subarray(0, SIG_BYTES);

/**
 * The guest token for a booking.
 * @param {string} secret  AUTH_SECRET
 * @param {string} bookingId  a uuid
 */
export function guestToken(secret, bookingId) {
  const id = uuidToBytes(bookingId);
  return id.toString('base64url') + sign(secret, id).toString('base64url');
}

/**
 * The booking id inside a valid token, or null for anything forged, mangled or malformed.
 * @param {string} secret
 * @param {string} token
 * @returns {string | null}
 */
export function bookingIdFromGuestToken(secret, token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  const id = Buffer.from(token.slice(0, 22), 'base64url');
  if (id.length !== 16) return null;
  // Rebuild the ONE correct token for this id and compare whole strings. Comparing decoded
  // bytes isn't enough: 16 bytes need 22 base64 characters, and the last character carries
  // 4 spare bits that decoding ignores, so several spellings would decode alike. (A test
  // that changes single characters caught this.)
  const expected = Buffer.from(id.toString('base64url') + sign(secret, id).toString('base64url'));
  // timingSafeEqual takes the same time however many leading bytes match, so an attacker
  // can't discover the signature byte by byte from response times.
  return timingSafeEqual(Buffer.from(token), expected) ? bytesToUuid(id) : null;
}

// ---------------------------------------------------------------------------------------------
// THE TICKET CODE (the QR on the trip hub, stage 12f)
// ---------------------------------------------------------------------------------------------
// What the guide scans at check-in (OPS-08, session 15). It must NOT be the guest link:
// anyone who photographs a ticket would then have the private booking page (and, from
// stage 12f-2, its Cancel button). So it is its own signature, with its own label:
//
//   code = "OKG1" + base64url(booking id, 16 bytes) + base64url(HMAC(ticket key, id), 12 bytes)
//          └ 4 ┘   └────────── 22 characters ──────────┘ └──────────── 16 characters ──────────┘
//
// 42 characters fits a small (29×29) QR code that phones scan easily. 96 bits of signature:
// forging a ticket needs the secret. The guide's app (signed in) turns it back into a
// booking with bookingIdFromTicketCode(), and shows the names to check against.

const TICKET_LABEL = 'okapigo:ticket:v1';
const TICKET_PREFIX = 'OKG1';
const TICKET_SIG_BYTES = 12;
const TICKET_PATTERN = /^OKG1[A-Za-z0-9_-]{38}$/;

/**
 * @param {string} secret
 * @param {Buffer} idBytes
 */
const ticketSig = (secret, idBytes) =>
  createHmac('sha256', createHmac('sha256', secret).update(TICKET_LABEL).digest())
    .update(idBytes)
    .digest()
    .subarray(0, TICKET_SIG_BYTES);

/**
 * The ticket code for a booking.
 * @param {string} secret  AUTH_SECRET
 * @param {string} bookingId
 */
export function ticketCode(secret, bookingId) {
  const id = uuidToBytes(bookingId);
  return TICKET_PREFIX + id.toString('base64url') + ticketSig(secret, id).toString('base64url');
}

/**
 * The booking id inside a valid ticket code, or null (forged, mangled, or a guest link).
 * @param {string} secret
 * @param {string} code
 * @returns {string | null}
 */
export function bookingIdFromTicketCode(secret, code) {
  if (typeof code !== 'string' || !TICKET_PATTERN.test(code)) return null;
  const id = Buffer.from(code.slice(4, 26), 'base64url');
  if (id.length !== 16) return null;
  // Whole-string comparison, for the same reason as guest tokens above.
  const expected = Buffer.from(ticketCode(secret, bytesToUuid(id)));
  return timingSafeEqual(Buffer.from(code), expected) ? bytesToUuid(id) : null;
}
