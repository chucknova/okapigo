// @ts-check
/**
 * secrets.js — generating and checking one-time codes and session tokens.
 *
 * Three rules from security basics, all applied here:
 *  1. Use a CRYPTOGRAPHIC random generator (node:crypto), never Math.random(), which is
 *     predictable enough that an attacker can sometimes guess what comes next.
 *  2. Store only a HASH of a secret, never the secret. A database leak then doesn't leak
 *     working codes or sessions.
 *  3. Compare secrets in CONSTANT TIME. A normal `===` stops at the first different
 *     character, so an attacker measuring response times could learn the secret
 *     character by character. timingSafeEqual always takes the same time.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** A 6-digit code like "042917". A string, so leading zeros are kept. */
export function generateOtpCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * A session token: 32 random bytes (256 bits) as URL-safe text. Unguessable.
 * The client keeps it; we keep only sha256(token).
 */
export function generateSessionToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Hash for session tokens. Plain SHA-256 is enough here because the token is already 256
 * random bits: there's nothing to brute-force.
 * @param {string} token
 */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Hash for one-time codes. A 6-digit code has only 1,000,000 possible values, so plain
 * SHA-256 could be reversed by hashing all of them. HMAC mixes in our server-side secret
 * (AUTH_SECRET), so without that secret the hashes are useless.
 * @param {string} secret
 * @param {string} code
 */
export function hashOtpCode(secret, code) {
  return createHmac('sha256', secret).update(code).digest('hex');
}

/**
 * Constant-time comparison of two hex hashes.
 * @param {string} a
 * @param {string} b
 */
export function safeEqual(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  // timingSafeEqual throws if lengths differ, so check that first.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
