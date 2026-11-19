// @ts-check
/**
 * sign-in.js — staff sign-in with a 6-digit code (O1; the API is session 3's).
 *
 *   1 · email or phone   POST /auth/otp/request   "We'll send you a 6-digit code."
 *   2 · the code         POST /auth/otp/verify    signs in by itself once all 6 are in
 *   3 · wrong code       "That code isn’t right. You have 2 tries left."
 *   4 · too many tries   "For safety, wait 10 minutes, then ask for a new code."
 *   5 · no signal        "You need signal to sign in the first time"
 *
 * The server allows 5 guesses per code and says only "wrong or expired" (so nobody can learn
 * whether an account exists). The tries left are counted HERE, per code: it's the same
 * number for this person, without the server telling strangers anything. The 10-minute wait
 * after the 5th wrong try is this app's own; the server's limits (a new code every 30 s,
 * 5 an hour) still apply underneath.
 */
import { ApiError, request } from './api.js';

export const CODE_LENGTH = 6;
export const TRIES_PER_CODE = 5;
export const RESEND_AFTER_MS = 30_000;
export const LOCKED_FOR_MS = 10 * 60_000;

/**
 * @typedef {{
 *   step: 'contact' | 'code' | 'locked',
 *   contact: string,
 *   wrong: number,            // wrong tries with this code
 *   sentAt: number | null,    // when the code was sent (ms)
 *   lockedUntil: number | null,
 * }} SignInState
 */

/** @returns {SignInState} */
export const start = (contact = '') => ({
  step: 'contact',
  contact,
  wrong: 0,
  sentAt: null,
  lockedUntil: null,
});

/** "Send again in 0:24", or null once it can be sent. @param {SignInState} s @param {number} now */
export function resendIn(s, now) {
  if (s.sentAt === null) return null;
  const left = s.sentAt + RESEND_AFTER_MS - now;
  return left > 0 ? clock(left) : null;
}

/** "9:41" until a new code may be asked for, or null. @param {SignInState} s @param {number} now */
export function lockedFor(s, now) {
  if (s.lockedUntil === null) return null;
  const left = s.lockedUntil - now;
  return left > 0 ? clock(left) : null;
}

/** @param {number} ms */
const clock = (ms) => {
  const secs = Math.ceil(ms / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
};

/** "email" or "phone": what the code screen calls it ("Check your email"). @param {string} contact */
export const channelOf = (contact) => (contact.includes('@') ? 'email' : 'phone');

/**
 * Asks for a code. Returns the next state, or throws an ApiError (offline: screen 5).
 * @param {SignInState} s @param {{ now: number, send?: typeof request }} o
 * @returns {Promise<SignInState>}
 */
export async function sendCode(s, { now, send = request }) {
  await send('/auth/otp/request', { method: 'POST', body: { contact: s.contact.trim() } });
  return { ...s, step: 'code', wrong: 0, sentAt: now, lockedUntil: null };
}

/**
 * Tries a code. Signed in → { session }; wrong → the next state (step 'locked' after the 5th).
 * @param {SignInState} s @param {string} code @param {{ now: number, send?: typeof request }} o
 * @returns {Promise<{ session: { token: string, user: any, contact: string } } | { state: SignInState }>}
 */
export async function tryCode(s, code, { now, send = request }) {
  try {
    const { body } = await send('/auth/otp/verify', {
      method: 'POST',
      body: { contact: s.contact.trim(), code },
    });
    return { session: { token: body.token, user: body.user, contact: s.contact.trim() } };
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'INVALID_CODE') throw err;
    const wrong = s.wrong + 1;
    if (wrong >= TRIES_PER_CODE) {
      return { state: { ...s, step: 'locked', wrong, lockedUntil: now + LOCKED_FOR_MS } };
    }
    return { state: { ...s, wrong } };
  }
}

/** "You have 2 tries left." @param {SignInState} s */
export function triesLeftText(s) {
  const left = TRIES_PER_CODE - s.wrong;
  return `You have ${left} ${left === 1 ? 'try' : 'tries'} left.`;
}

/** The words for a failed request on the sign-in screens. @param {unknown} err */
export function signInError(err) {
  if (err instanceof ApiError) {
    if (err.kind === 'offline' || err.kind === 'unreachable') return 'NO_SIGNAL';
    if (err.code === 'TOO_MANY_REQUESTS') return 'Too many codes asked for. Try again in a minute.';
    if (err.code === 'VALIDATION_ERROR') return 'Enter a valid email or phone number.';
    if (err.kind === 'api') return err.message;
  }
  return 'Something went wrong on our side. Try again in a moment.';
}
