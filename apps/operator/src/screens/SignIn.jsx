// @ts-check
/**
 * O1 · Sign in (designs: O1, states 1–5). Also the "sign in again to send your changes"
 * sheet (Sync edge cases), with `again`.
 *
 * The rules (tries, the 30-second resend, the 10-minute wait) live in lib/sign-in.js; this
 * screen only shows them.
 */
import { useRef, useState } from 'react';
import { Icon } from '../components/Icon.jsx';
import { useEngine, useNow } from '../lib/engine.jsx';
import {
  CODE_LENGTH,
  start,
  sendCode,
  tryCode,
  resendIn,
  lockedFor,
  triesLeftText,
  signInError,
  channelOf,
} from '../lib/sign-in.js';

/** The time, for the rules (outside render, in the event handlers). */
const clock = () => Date.now();

/**
 * @param {{ contact?: string, again?: { waiting: number, name: string, onLater: () => void } }} props
 */
export function SignIn({ contact = '', again }) {
  const engine = useEngine();
  const now = useNow(1000).getTime();
  const [s, setS] = useState(() => start(contact));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [digits, setDigits] = useState(() => Array(CODE_LENGTH).fill(''));
  const [wrongCode, setWrongCode] = useState(false);
  const boxes = useRef(/** @type {(HTMLInputElement | null)[]} */ ([]));

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      setS(await sendCode(s, { now: clock() }));
      setDigits(Array(CODE_LENGTH).fill(''));
      setWrongCode(false);
      setTimeout(() => boxes.current[0]?.focus(), 0);
    } catch (err) {
      setError(signInError(err));
    } finally {
      setBusy(false);
    }
  }

  /** @param {string} code */
  async function submit(code) {
    setBusy(true);
    setError(null);
    try {
      const r = await tryCode(s, code, { now: clock() });
      if ('session' in r) return void (await engine.signedIn(r.session));
      setS(r.state);
      setWrongCode(true);
    } catch (err) {
      setError(signInError(err));
    } finally {
      setBusy(false);
    }
  }

  /** @param {number} i @param {string} value */
  function typed(i, value) {
    const clean = value.replace(/\D/g, '');
    const next = [...digits];
    // A pasted or autofilled code fills every box from here.
    clean.split('').forEach((d, k) => {
      if (i + k < CODE_LENGTH) next[i + k] = d;
    });
    if (!clean) next[i] = '';
    setDigits(next);
    setWrongCode(false);
    const filled = next.findIndex((d) => !d);
    if (filled === -1) void submit(next.join(''));
    else if (clean) boxes.current[Math.min(i + clean.length, CODE_LENGTH - 1)]?.focus();
  }

  // 5 · No signal on the first sign-in.
  if (error === 'NO_SIGNAL' && !again) {
    return (
      <div className="frame">
        <div className="strip strip--offline" role="status">
          Offline
        </div>
        <main className="center-stack">
          <Icon name="no-signal" size={56} width={1.8} />
          <h1 className="h-xl">You need signal to sign in the first time</h1>
          <p className="muted">
            After that, the app works for 3 days without signal. Try near Wi-Fi or where you have
            data.
          </p>
          <button
            type="button"
            className="btn btn--main"
            onClick={() => (s.step === 'contact' ? ask() : setError(null))}
          >
            Try again
          </button>
        </main>
      </div>
    );
  }

  // 4 · Too many tries.
  if (s.step === 'locked') {
    const wait = lockedFor(s, now);
    return (
      <div className="frame">
        <main className="center-stack center-stack--high">
          <span className="badge-circle badge-circle--warning">
            <Icon name="lock" size={30} />
          </span>
          <h1 className="h-xl">Too many tries</h1>
          <p className="muted">
            For safety, wait <strong className="ink">10 minutes</strong>, then ask for a new code.
          </p>
          <button
            type="button"
            className="btn btn--main"
            disabled={Boolean(wait) || busy}
            onClick={ask}
          >
            {wait ? `Send a new code in ${wait}` : 'Send a new code'}
          </button>
          <p className="small muted">
            Still stuck? Ask the business owner to check your email or phone number.
          </p>
        </main>
      </div>
    );
  }

  // 2 and 3 · Enter the code (and wrong code).
  if (s.step === 'code') {
    const wait = resendIn(s, now);
    const where = channelOf(s.contact);
    return (
      <div className={again ? '' : 'frame'}>
        <main className="stack">
          <button
            type="button"
            className="icon-btn icon-btn--edge"
            aria-label="Back"
            onClick={() => setS({ ...s, step: 'contact' })}
          >
            <Icon name="back" size={24} />
          </button>
          <div>
            <h1 className="h-2xl">
              {where === 'email' ? 'Check your email' : 'Check your messages'}
            </h1>
            <p className="muted lead-gap">
              We sent a code to <strong className="ink">{s.contact.trim()}</strong>.
            </p>
          </div>
          <fieldset className="code">
            <legend className="label">6-digit code</legend>
            <div className="code-boxes">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    boxes.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  maxLength={i === 0 ? CODE_LENGTH : 1}
                  aria-label={`Digit ${i + 1} of 6`}
                  aria-invalid={wrongCode || undefined}
                  className={`code-box${wrongCode ? ' code-box--wrong' : ''}`}
                  value={d}
                  disabled={busy}
                  // Typing into a filled box replaces its digit (after a wrong code, say).
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => typed(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
                  }}
                />
              ))}
            </div>
          </fieldset>
          {wrongCode ? (
            <>
              <div role="alert" className="field-error">
                <Icon name="alert" size={20} />
                That code isn’t right. {triesLeftText(s)}
              </div>
              <button
                type="button"
                className="text-link"
                disabled={Boolean(wait) || busy}
                onClick={ask}
              >
                {wait ? `Send a new code in ${wait}` : 'Send a new code'}
              </button>
            </>
          ) : (
            <>
              <p className="sm muted">
                Didn’t get it?{' '}
                {wait ? (
                  <span className="strong">Send again in {wait}</span>
                ) : (
                  <button
                    type="button"
                    className="text-link text-link--inline"
                    onClick={ask}
                    disabled={busy}
                  >
                    Send again
                  </button>
                )}
              </p>
              <p className="small muted">
                The code works for 10 minutes. It signs in by itself once all 6 digits are in.
              </p>
            </>
          )}
          {error && error !== 'NO_SIGNAL' && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          {error === 'NO_SIGNAL' && (
            <p role="alert" className="field-error">
              No signal. Your code still works for 10 minutes: try again when you have signal.
            </p>
          )}
        </main>
      </div>
    );
  }

  // 1 · Email or phone (or, signed out while offline: sign in again to send).
  return (
    <div className={again ? '' : 'frame'}>
      <main className={again ? 'stack' : 'stack stack--first'}>
        {again ? (
          <>
            <h2 className="h-lg">Sign in again to send your {again.waiting} changes</h2>
            <p className="sm muted">
              Your 30-day sign-in ran out while you were offline. Everything you did is saved and
              will be sent as {again.name}.
            </p>
          </>
        ) : (
          <>
            <div className="brand">
              <span className="mark" aria-hidden="true">
                O
              </span>
              <span className="brand-name">OkapiGo</span>
            </div>
            <div>
              <h1 className="h-2xl">Staff sign-in</h1>
              <p className="muted lead-gap">We’ll send you a 6-digit code.</p>
            </div>
          </>
        )}
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (s.contact.trim()) void ask();
          }}
        >
          <label className="field">
            {again ? 'Email or phone' : 'Email or phone number'}
            <input
              type="text"
              inputMode="email"
              autoComplete="username"
              className="input"
              value={s.contact}
              onChange={(e) => setS({ ...s, contact: e.target.value })}
              aria-invalid={error ? true : undefined}
            />
          </label>
          {error && (
            <p role="alert" className="field-error">
              {error === 'NO_SIGNAL'
                ? 'No signal yet. Keep working; sign in when you have signal.'
                : error}
            </p>
          )}
          <button type="submit" className="btn btn--main" disabled={busy || !s.contact.trim()}>
            {busy ? 'Sending…' : 'Send me a code'}
          </button>
        </form>
        {again ? (
          <button type="button" className="text-link text-link--plain" onClick={again.onLater}>
            Later (keep working offline)
          </button>
        ) : (
          <p className="small muted push-bottom">
            You’ll stay signed in on this phone for 30 days, so the app works on tour without
            signal.
          </p>
        )}
      </main>
    </div>
  );
}
