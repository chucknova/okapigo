/** Sign-in (O1): tries counted per code, "Send again in 0:24", the 10-minute wait. */
import { describe, it, expect } from 'vitest';
import { ApiError } from '../src/lib/api.js';
import {
  start,
  sendCode,
  tryCode,
  resendIn,
  lockedFor,
  triesLeftText,
  signInError,
  channelOf,
} from '../src/lib/sign-in.js';

const wrong = async () => {
  throw new ApiError('api', 'That code is wrong or has expired.', {
    status: 400,
    code: 'INVALID_CODE',
  });
};

describe('sign-in', () => {
  it('sends a code; "Send again" after 30 seconds', async () => {
    /** @type {any[]} */
    const sent = [];
    const s = await sendCode(start(' femi@irin.example '), {
      now: 1_000,
      send: async (path, o) => (sent.push([path, o?.body]), { status: 202, body: {}, etag: null }),
    });
    expect(sent).toEqual([['/auth/otp/request', { contact: 'femi@irin.example' }]]);
    expect(s.step).toBe('code');
    expect(resendIn(s, 7_000)).toBe('0:24');
    expect(resendIn(s, 31_000)).toBeNull();
  });

  it('the right code: signed in, with the token', async () => {
    const s = { ...start('femi@irin.example'), step: /** @type {const} */ ('code'), sentAt: 0 };
    const r = await tryCode(s, '482917', {
      now: 0,
      send: async () => ({
        status: 200,
        etag: null,
        body: { token: 'tok', user: { name: 'Femi' } },
      }),
    });
    expect(r).toEqual({
      session: { token: 'tok', user: { name: 'Femi' }, contact: 'femi@irin.example' },
    });
  });

  it('wrong: tries left counted down; the 5th wrong try locks for 10 minutes', async () => {
    /** @type {any} */
    let s = { ...start('femi@irin.example'), step: 'code', sentAt: 0 };
    for (let i = 1; i <= 4; i++)
      s = /** @type {any} */ (await tryCode(s, '000000', { now: 0, send: wrong })).state;
    expect(triesLeftText(s)).toBe('You have 1 try left.');
    s = /** @type {any} */ (await tryCode(s, '000000', { now: 60_000, send: wrong })).state;
    expect(s.step).toBe('locked');
    expect(lockedFor(s, 60_000 + 19_000)).toBe('9:41');
    expect(lockedFor(s, 60_000 + 600_000)).toBeNull();
    // A new code starts the count again.
    const fresh = await sendCode(s, {
      now: 700_000,
      send: async () => ({ status: 202, body: {}, etag: null }),
    });
    expect(fresh).toMatchObject({ step: 'code', wrong: 0, lockedUntil: null });
  });

  it('no signal, too many codes, and other refusals, in words', () => {
    expect(signInError(new ApiError('offline', 'x'))).toBe('NO_SIGNAL');
    expect(signInError(new ApiError('unreachable', 'x'))).toBe('NO_SIGNAL');
    expect(signInError(new ApiError('api', 'x', { code: 'TOO_MANY_REQUESTS' }))).toMatch(
      /^Too many codes/,
    );
    expect(signInError(new Error('bug'))).toMatch(/our side/);
    expect(channelOf('femi@irin.example')).toBe('email');
    expect(channelOf('0803 123 4567')).toBe('phone');
  });
});
