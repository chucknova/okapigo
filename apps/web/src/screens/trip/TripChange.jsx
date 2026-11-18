// @ts-check
/**
 * Change or cancel, from the trip hub (journey 4, stage 12f-2; designs: file 05, "Cancel
 * yourself" and "Ask the operator"). Three pages:
 *
 *   /trip/:token/change   the two choices side by side: cancelling yourself is INSTANT,
 *                         asking the operator is NOT ("Reply in a few hours")
 *   /trip/:token/cancel   the refund first, then confirm → "Cancelled · ₦31,250 on its way"
 *   /trip/:token/ask      change the date · cancel · something else, a message → "Sent"
 *
 * The refund shown comes from tripSituation() (shared), the same rules the server applies.
 * Cancelling sends that amount back as `expectRefundKobo`: if time has moved the guest into a
 * different policy tier, the server cancels NOTHING and the page shows the new amount first.
 * Cancelling isn't offered on the day of the trip (contact the operator then).
 */
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { formatNaira } from '@okapigo/shared/money';
import { formatLocalDay } from '@okapigo/shared/preview';
import { formatAt } from '@okapigo/shared/tour-facts';
import { formatPhoneForDisplay } from '@okapigo/shared/contact';
import { tripSituation, refundReason } from '@okapigo/shared/trip-hub';
import { useApi } from '../../lib/data.js';
import { api, ApiError, describeError } from '../../lib/api.js';
import { Shell } from '../../components/Shell.jsx';
import { StatusPanel } from '../../components/StatusPanel.jsx';
import { Notice } from '../../components/Feedback.jsx';
import { Bar } from '../../components/Skeleton.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { useLook } from '../../lib/look.js';

/** "Ìrìn Lagos Tours" → "Ìrìn". @param {string} name */
const shortName = (name) => name.split(/\s+/)[0] || name;

/**
 * The booking, or a loading/error frame to show instead.
 * @param {string} token
 */
function useTrip(token) {
  const res = useApi(`/public/bookings/${token}`);
  const b = res.data?.booking ?? null;
  useLook(b?.operator);
  const frame = b ? null : (
    <Shell operatorName="">
      {res.error ? <ErrorState error={res.error} onRetry={res.retry} /> : <Bar height={28} />}
    </Shell>
  );
  return { b, frame, retry: res.retry };
}

/** "Heritage Walk · Sat 5 Dec, 09:00 · ILT-7K4Q2M" @param {any} b */
const contextLine = (b) =>
  `${b.tour.title} · ${formatLocalDay(b.departure.localDate)}, ${b.departure.localTime} · ${b.reference}`;

/** When cancelling yourself isn't possible (on the day, after, already cancelled). */
function NotNow(/** @type {{ b: any, token: string }} */ { b, token }) {
  const op = shortName(b.operator.name);
  return (
    <Shell operatorName={b.operator.name}>
      <StatusPanel
        tone="warning"
        title={
          b.status === 'cancelled' || b.status === 'refunded'
            ? 'Already cancelled'
            : `Please contact ${op}`
        }
        context={contextLine(b)}
        actions={
          <Link className="okg-btn okg-btn--secondary" href={`/trip/${token}`}>
            Back to your trip page
          </Link>
        }
      >
        {b.status === 'cancelled' || b.status === 'refunded'
          ? 'This booking is already cancelled.'
          : `On the day of the trip, changes go through ${op}: use Call or WhatsApp on your trip page.`}
      </StatusPanel>
    </Shell>
  );
}

// --- 1 · Change or cancel --------------------------------------------------------------------

/** @param {{ params: { token: string } }} props */
export function ChangeOrCancel({ params }) {
  const { token } = params;
  const { b, frame } = useTrip(token);
  if (!b) return frame;
  const s = tripSituation(b, new Date());
  if (s.phase !== 'upcoming' || !s.cancelNow) return <NotNow b={b} token={token} />;
  const c = s.cancelNow;
  const op = shortName(b.operator.name);
  const amount = formatNaira(c.refundKobo);
  return (
    <Shell operatorName={b.operator.name}>
      <section className="okg-change">
        <h1 className="okg-change__title">Change or cancel</h1>
        <p className="okg-muted">{contextLine(b)}</p>
        <div className="okg-change__choices">
          <Link className="okg-choice" href={`/trip/${token}/cancel`}>
            <span className="okg-chip okg-chip--primary">Instant</span>
            <span className="okg-choice__title">Cancel now</span>
            <span className="okg-muted okg-small">
              {c.refundKobo > 0
                ? `Done in one tap. You get ${amount} back.`
                : 'Done in one tap. Nothing is refunded now.'}
            </span>
          </Link>
          <Link className="okg-choice" href={`/trip/${token}/ask`}>
            <span className="okg-chip okg-chip--neutral">Reply in a few hours</span>
            <span className="okg-choice__title">Ask {op}</span>
            <span className="okg-muted okg-small">
              Change the date, or ask about more back. {op} decides.
            </span>
          </Link>
        </div>
        <div className="okg-card okg-change__why">
          <h2 className="okg-trip__h2">Why {amount}?</h2>
          <p className="okg-muted okg-small">
            {refundReason(c, c.until ? formatAt(Date.parse(c.until), b.operator.timeZone) : '')}
          </p>
        </div>
        <Link className="okg-link okg-change__back" href={`/trip/${token}`}>
          Back to your trip page
        </Link>
      </section>
    </Shell>
  );
}

// --- 2 · Confirm, refund shown first · 3 · Cancelled ----------------------------------------

/** @param {{ params: { token: string } }} props */
export function CancelBooking({ params }) {
  const { token } = params;
  const { b, frame, retry } = useTrip(token);
  const [state, setState] = useState(
    /** @type {{ step: 'confirm' | 'sending' | 'done', problem?: string, refundKobo?: number, started?: boolean }} */ ({
      step: 'confirm',
    }),
  );
  if (state.step === 'done' && b) return <Cancelled b={b} token={token} state={state} />;
  if (!b) return frame;
  const s = tripSituation(b, new Date());
  if (s.phase !== 'upcoming' || !s.cancelNow) return <NotNow b={b} token={token} />;

  const c = s.cancelNow;
  const op = shortName(b.operator.name);
  const amount = formatNaira(c.refundKobo);
  const n = b.travellers.length;

  const confirm = async () => {
    if (state.step === 'sending') return; // a second tap does nothing
    setState({ step: 'sending' });
    try {
      const res = await api(`/public/bookings/${token}/cancel`, {
        method: 'POST',
        body: { expectRefundKobo: c.refundKobo },
      });
      setState({ step: 'done', refundKobo: res.refundKobo, started: res.refundStarted });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REFUND_CHANGED') {
        retry(); // show the new figures before anything is cancelled
        setState({
          step: 'confirm',
          problem: `Time has moved on: the refund is now ${formatNaira(Number(err.details.refundKobo ?? 0))}. Nothing was cancelled. Check the amount below.`,
        });
        return;
      }
      setState({
        step: 'confirm',
        problem:
          err instanceof ApiError && err.kind === 'api'
            ? err.message
            : `${describeError(err).title}. Nothing was cancelled. Please try again.`,
      });
    }
  };

  return (
    <Shell operatorName={b.operator.name}>
      <section className="okg-change">
        <h1 className="okg-change__title">Cancel booking</h1>
        <p className="okg-strong">
          Cancel your {b.tour.title} on {formatLocalDay(b.departure.localDate)}?
        </p>
        <div className="okg-card okg-price-lines">
          <div className="okg-price-lines__row">
            <span>You paid</span>
            <span className="okg-money">{formatNaira(b.amountPaidKobo)}</span>
          </div>
          {c.keptDepositKobo > 0 && (
            <div className="okg-price-lines__row">
              <span>Deposit (not refundable)</span>
              <span className="okg-money">−{formatNaira(c.keptDepositKobo)}</span>
            </div>
          )}
          <div className="okg-price-lines__row">
            <span>Refund ({c.basisPoints / 100}%)</span>
            <span className="okg-money">{amount}</span>
          </div>
          <div className="okg-price-lines__row okg-price-lines__total">
            <span>You’ll get back</span>
            <span className="okg-money">{amount}</span>
          </div>
        </div>
        <p>
          {c.refundKobo > 0
            ? `You’ll get ${amount} back (${c.basisPoints / 100}%) because the trip is in ${c.hoursToGo >= 72 ? `${Math.round(c.hoursToGo / 24)} days` : `${c.hoursToGo} hours`}. It goes back to the card or account you paid with.`
            : 'Under the cancellation policy, nothing is refunded if you cancel now.'}
        </p>
        <p className="okg-strong">
          {n === 1 ? 'The traveller is cancelled.' : `All ${n} travellers are cancelled.`} This
          can’t be undone.
        </p>
        {state.problem && (
          <Notice tone="warning" title="Not cancelled">
            {state.problem}
          </Notice>
        )}
        <button
          type="button"
          className="okg-btn okg-btn--danger"
          onClick={confirm}
          disabled={state.step === 'sending'}
          aria-busy={state.step === 'sending'}
        >
          {state.step === 'sending'
            ? 'Cancelling…'
            : c.refundKobo > 0
              ? `Cancel and get ${amount} back`
              : 'Cancel booking'}
        </button>
        <Link className="okg-btn okg-btn--secondary" href={`/trip/${token}`}>
          Keep my booking
        </Link>
        <Link className="okg-link okg-change__back" href={`/trip/${token}/ask?kind=cancel`}>
          Ask {op} instead
        </Link>
      </section>
    </Shell>
  );
}

/** @param {{ b: any, token: string, state: { refundKobo?: number, started?: boolean } }} props */
function Cancelled({ b, token, state }) {
  const refund = state.refundKobo ?? 0;
  const op = shortName(b.operator.name);
  return (
    <Shell operatorName={b.operator.name}>
      <StatusPanel
        tone="success"
        title="Cancelled"
        context={contextLine(b)}
        actions={
          <>
            <Link className="okg-btn okg-btn--primary" href={`/trip/${token}`}>
              Back to your trip page
            </Link>
            <Link
              className="okg-btn okg-btn--secondary"
              href={`/${b.operator.slug}/${b.tour.slug}`}
            >
              Book another date
            </Link>
          </>
        }
      >
        {refund > 0 ? (
          state.started ? (
            <>
              <p className="okg-strong">Your {formatNaira(refund)} refund is on its way.</p>
              <p>It can take 5–10 working days to appear.</p>
            </>
          ) : (
            // The provider didn't take the refund just now: it's owed, and staff see it.
            <>
              <p className="okg-strong">{formatNaira(refund)} is owed back to you.</p>
              <p>{op} will send it. It can take 5–10 working days to appear.</p>
            </>
          )
        ) : (
          <p>Your booking is cancelled. Nothing was refunded under the cancellation policy.</p>
        )}
      </StatusPanel>
    </Shell>
  );
}

// --- Ask the operator ------------------------------------------------------------------------

const KINDS = /** @type {const} */ ([
  ['change_date', 'Change the date'],
  ['cancel', 'Cancel'],
  ['other', 'Something else'],
]);

/** @param {{ params: { token: string } }} props */
export function AskOperator({ params }) {
  const { token } = params;
  const { b, frame } = useTrip(token);
  const preset = new URLSearchParams(useSearch()).get('kind');
  const [kind, setKind] = useState(
    /** @type {'change_date' | 'cancel' | 'other'} */ (
      KINDS.some(([k]) => k === preset) ? preset : 'change_date'
    ),
  );
  const [message, setMessage] = useState('');
  const [state, setState] = useState(
    /** @type {{ step: 'form' | 'sending' | 'sent', error?: string, problem?: string }} */ ({
      step: 'form',
    }),
  );
  const [, navigate] = useLocation();
  // Asking only makes sense for a booking that's still on.
  const closed = b && !['confirmed', 'part_paid', 'paid', 'amended'].includes(b.status);
  useEffect(() => {
    if (closed) navigate(`/trip/${token}`, { replace: true });
  }, [closed, navigate, token]);

  if (!b || closed) return frame ?? null;
  const op = shortName(b.operator.name);

  if (state.step === 'sent') {
    return (
      <Shell operatorName={b.operator.name}>
        <StatusPanel
          tone="success"
          title="Sent"
          context={contextLine(b)}
          actions={
            <Link className="okg-btn okg-btn--primary" href={`/trip/${token}`}>
              Back to your trip page
            </Link>
          }
        >
          <p className="okg-strong">{op} will reply by WhatsApp or email.</p>
          <p>
            Your booking stays as it is until they reply. You can still cancel yourself at any time.
          </p>
        </StatusPanel>
      </Shell>
    );
  }

  const send = async (/** @type {import('react').FormEvent} */ e) => {
    e.preventDefault();
    if (state.step === 'sending') return;
    if (!message.trim()) {
      setState({ step: 'form', error: 'Write a short message.' });
      return;
    }
    setState({ step: 'sending' });
    try {
      await api(`/public/bookings/${token}/requests`, {
        method: 'POST',
        body: { kind, message: message.trim() },
      });
      setState({ step: 'sent' });
    } catch (err) {
      setState({
        step: 'form',
        problem:
          err instanceof ApiError && err.kind === 'api'
            ? err.message
            : `${describeError(err).title}. Your message wasn’t sent; it’s still here.`,
      });
    }
  };

  const contacts = [b.lead.phone && formatPhoneForDisplay(b.lead.phone), b.lead.email]
    .filter(Boolean)
    .join(' and ');
  const hint = {
    change_date: 'Say which date suits you.',
    cancel: 'Say what you’d like back, and why.',
    other: 'Say what you need.',
  }[kind];

  return (
    <Shell operatorName={b.operator.name}>
      <form className="okg-change" onSubmit={send} noValidate>
        <h1 className="okg-change__title">Ask {op}</h1>
        <p className="okg-muted">
          {op} usually replies within a few hours by WhatsApp or email. Your booking doesn’t change
          until they do.
        </p>
        <fieldset className="okg-change__kinds">
          <legend className="okg-strong">What would you like?</legend>
          {KINDS.map(([k, label]) => (
            <label
              key={k}
              className={`okg-radio-card${kind === k ? ' okg-radio-card--selected' : ''}`}
            >
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <label className="okg-field">
          <span className="okg-field__label">Your message</span>
          <span className="okg-field__hint" id="okg-ask-hint">
            {hint}
          </span>
          <textarea
            className="okg-field__input okg-change__message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={1000}
            aria-describedby={state.error ? 'okg-ask-hint okg-ask-error' : 'okg-ask-hint'}
            aria-invalid={state.error ? true : undefined}
          />
          {state.error && (
            <span className="okg-field__error" id="okg-ask-error">
              {state.error}
            </span>
          )}
        </label>
        {state.problem && (
          <Notice tone="warning" title="Not sent">
            {state.problem}
          </Notice>
        )}
        <button
          type="submit"
          className="okg-btn okg-btn--primary"
          disabled={state.step === 'sending'}
          aria-busy={state.step === 'sending'}
        >
          {state.step === 'sending' ? 'Sending…' : `Send to ${op}`}
        </button>
        {contacts && <p className="okg-muted okg-small">Replies go to {contacts}.</p>}
        <Link className="okg-link okg-change__back" href={`/trip/${token}`}>
          Back to your trip page
        </Link>
      </form>
    </Shell>
  );
}
