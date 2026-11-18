// @ts-check
/**
 * Checkout step 4 · Review and pay (designs: file 01, "4 · Review and pay", the Badagry
 * deposit version, and the states "Hold expired" and "Setting up payment · unavailable").
 * /irin-lagos-tours/lagos-island-heritage-walk/book/review
 *
 * Everything shown comes from the HELD BOOKING on the server (GET /public/bookings/:token):
 * the price snapshot, the travellers, the payment options (full, or a deposit on Badagry),
 * and when the hold ends. "Pay" asks the server for a Paystack checkout for the chosen
 * OPTION (never an amount) and sends the browser there.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { formatNaira } from '@okapigo/shared/money';
import { formatPhoneForDisplay } from '@okapigo/shared/contact';
import { formatDuration, formatLocalDay } from '@okapigo/shared/preview';
import { freeCancellationUntil, policyDeadlines } from '@okapigo/shared/tour-facts';
import { useApi } from '../../lib/data.js';
import { ApiError } from '../../lib/api.js';
import { formatCountdown, lineLabel, travellerSlots } from '../../lib/checkout.js';
import { holdAndBook, startPayment } from '../../lib/checkout-actions.js';
import { useCheckout } from '../../lib/checkout-state.js';
import { Notice } from '../../components/Feedback.jsx';
import { Bar } from '../../components/Skeleton.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { CheckoutFrame, useTourForCheckout } from './CheckoutFrame.jsx';

/** A tick every second while mounted (for the hold countdown). */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** @param {{ params: { operator: string, tour: string } }} props */
export function Review({ params }) {
  const { operator: opSlug, tour: tourSlug } = params;
  const [, navigate] = useLocation();
  const { state, update } = useCheckout(opSlug, tourSlug);
  const token = state.booking?.token ?? null;
  const { data: tourView } = useTourForCheckout(opSlug, tourSlug);
  const bookingApi = useApi(token ? `/public/bookings/${token}` : null);
  const now = useNow();
  const [paying, setPaying] = useState(/** @type {'idle' | 'starting' | 'unavailable'} */ ('idle'));
  const [reholding, setReholding] = useState(false);
  const [reholdProblem, setReholdProblem] = useState(/** @type {string | null} */ (null));

  // No held booking (a bookmarked link, or the details were never sent): back to step 3.
  useEffect(() => {
    if (!token) navigate(`/${opSlug}/${tourSlug}/book/details`, { replace: true });
  }, [token, opSlug, tourSlug, navigate]);

  const booking = bookingApi.data?.booking;
  if (!booking || !tourView) {
    return (
      <div className="okg-page">
        {bookingApi.error ? (
          <ErrorState error={bookingApi.error} onRetry={bookingApi.retry} />
        ) : (
          <Bar height={28} />
        )}
      </div>
    );
  }

  const { operator, tour } = tourView;
  const remaining = booking.holdExpiresAt ? new Date(booking.holdExpiresAt).getTime() - now : 0;
  // The hold is over when the clock says so, or the server says nothing can be paid now.
  const expired = remaining <= 0 || booking.paymentOptions.length === 0;
  const deposit = booking.paymentOptions.find((o) => o.type === 'deposit') ?? null;
  const full = booking.paymentOptions.find((o) => o.type === 'full') ?? null;
  const option = deposit && state.payOption === 'deposit' ? deposit : full;
  const dateLine = `${formatLocalDay(booking.departure.localDate)} · ${booking.departure.localTime}`;
  const policy = booking.cancellationPolicy;
  const freeUntil = policy
    ? freeCancellationUntil(policy, booking.departure.startsAt, operator.timeZone)
    : null;
  const contacts = [
    booking.lead.email,
    booking.lead.phone && formatPhoneForDisplay(booking.lead.phone),
  ]
    .filter(Boolean)
    .join(' and ');

  const pay = async () => {
    if (!option || paying === 'starting') return; // a second tap does nothing
    setPaying('starting');
    // "This payment is being set up" (a double tap reached the server): ask again shortly.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const url = await startPayment(/** @type {string} */ (token), option.type);
        window.location.assign(url); // off to Paystack's page (or the simulator's)
        return;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'PAYMENT_STARTING') {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        if (
          err instanceof ApiError &&
          (err.code === 'OPTION_NOT_AVAILABLE' || err.code === 'HOLD_EXPIRED')
        ) {
          bookingApi.retry(); // the server will show the hold as over
          setPaying('idle');
          return;
        }
        setPaying('unavailable');
        return;
      }
    }
    setPaying('unavailable');
  };

  const holdAgain = async () => {
    setReholding(true);
    setReholdProblem(null);
    try {
      const slots = travellerSlots(state.counts, tour.priceCategories);
      update({ booking: await holdAndBook(opSlug, state, slots) });
    } catch (err) {
      setReholdProblem(
        err instanceof ApiError && err.code === 'SOLD_OUT'
          ? 'Those seats have gone. Please choose another date.'
          : 'We couldn’t hold the seats. Please try again.',
      );
    } finally {
      setReholding(false);
    }
  };

  const holdChip = (
    <div className={`okg-hold-chip${expired ? ' okg-hold-chip--ended' : ''}`} aria-live="off">
      <span className="okg-label">{expired ? 'Hold ended' : 'Seats held'}</span>
      {!expired && <span className="okg-strong okg-money">{formatCountdown(remaining)}</span>}
    </div>
  );

  return (
    <CheckoutFrame
      step={4}
      title="Review and pay"
      subtitle="Step 4 of 4"
      operatorName={operator.name}
      backHref={`/${opSlug}/${tourSlug}/book/details`}
      headerExtra={holdChip}
    >
      {expired && (
        <div className="okg-card okg-problem" role="alert">
          <h2 className="okg-h2">Your 15 minutes are up</h2>
          <p className="okg-muted okg-small">
            The seats were released so others could book. If they’re still free, you can hold them
            again with everything you entered.
          </p>
          {reholdProblem ? (
            <>
              <p className="okg-field__error">{reholdProblem}</p>
              <Link className="okg-btn okg-btn--primary" href={`/${opSlug}/${tourSlug}/book`}>
                Choose another date
              </Link>
            </>
          ) : (
            <button
              type="button"
              className="okg-btn okg-btn--primary"
              onClick={holdAgain}
              disabled={reholding}
            >
              {reholding ? 'Holding your seats…' : 'Hold my seats again'}
            </button>
          )}
        </div>
      )}

      <div className={`okg-review-body${expired ? ' okg-review-body--dimmed' : ''}`}>
        <section className="okg-card okg-review">
          <div className="okg-review__head">
            <h2 className="okg-h2">{booking.tour.title}</h2>
            <Link className="okg-link okg-review__edit" href={`/${opSlug}/${tourSlug}/book`}>
              Edit
            </Link>
          </div>
          <div>
            <p className="okg-strong">{dateLine}</p>
            <p className="okg-muted okg-small">{formatDuration(tour.durationMinutes)}</p>
          </div>
          <div>
            <p className="okg-strong">
              {booking.pickupPoint?.name ?? booking.tour.meetingPoint.name}
            </p>
            <p className="okg-muted okg-small">
              {booking.pickupPoint
                ? [booking.pickupPoint.address, booking.pickupPoint.time]
                    .filter(Boolean)
                    .join(' · ')
                : booking.tour.meetingPoint.address}
            </p>
          </div>
        </section>

        <section className="okg-card okg-review">
          <div className="okg-review__head">
            <h2 className="okg-h3">Travellers</h2>
            <Link className="okg-link" href={`/${opSlug}/${tourSlug}/book/details`}>
              Edit
            </Link>
          </div>
          <ul className="okg-plain-list">
            {booking.travellers.map((t, i) => {
              const category = tour.priceCategories.find((c) => c.key === t.categoryKey);
              const kind = category?.name.replace(/\s*\(.*\)\s*$/, '') ?? t.categoryKey;
              // "Adult" · "Child, 8 · No peanuts": ages only for categories with an upper age.
              const who = category && category.maxAge !== null ? `${kind}, ${t.age}` : kind;
              return (
                <li key={i}>
                  {t.name}{' '}
                  <span className="okg-muted">
                    · {[who, t.dietaryNeeds].filter(Boolean).join(' · ')}
                  </span>
                </li>
              );
            })}
          </ul>
          {contacts && <p className="okg-muted okg-small">Ticket to {contacts}</p>}
        </section>

        <section className="okg-card">
          <div className="okg-price-lines">
            {booking.quote.lines.map((l) => (
              <div key={`${l.type}-${l.categoryKey ?? l.addOnId}`} className="okg-price-lines__row">
                <span className="okg-muted">{lineLabel(l)}</span>
                <span className="okg-money">{formatNaira(l.totalKobo)}</span>
              </div>
            ))}
            <div className="okg-price-lines__total okg-price-lines__total--large">
              <span>{deposit ? 'Trip total' : 'Total'}</span>
              <span className="okg-money">{formatNaira(booking.totalKobo)}</span>
            </div>
            {booking.quote.tax?.inclusive && booking.quote.taxKobo > 0 && (
              <p className="okg-label">
                Includes {formatNaira(booking.quote.taxKobo)} {booking.quote.tax.name}
              </p>
            )}
          </div>
        </section>

        {deposit && full && (
          <fieldset className="okg-card okg-pickup">
            <legend className="okg-h2">How much to pay now?</legend>
            <label
              className={`okg-radio-card okg-radio-card--tall${option === full ? ' okg-radio-card--selected' : ''}`}
            >
              <input
                type="radio"
                name="pay"
                checked={option === full}
                onChange={() => update({ payOption: 'full' })}
              />
              <span>
                <span className="okg-strong">Pay in full: {formatNaira(full.amountKobo)}</span>
                <span className="okg-muted okg-small">Nothing more to pay.</span>
              </span>
            </label>
            <label
              className={`okg-radio-card okg-radio-card--tall${option === deposit ? ' okg-radio-card--selected' : ''}`}
            >
              <input
                type="radio"
                name="pay"
                checked={option === deposit}
                onChange={() => update({ payOption: 'deposit' })}
              />
              <span>
                <span className="okg-strong">
                  Pay a {Math.round((deposit.amountKobo / booking.totalKobo) * 100)}% deposit now:{' '}
                  {formatNaira(deposit.amountKobo)}
                </span>
                <span className="okg-muted okg-small">
                  The balance of {formatNaira(deposit.balanceKobo)} is due by{' '}
                  {formatLocalDay(deposit.balanceDueDate)}. We’ll remind you by email and WhatsApp,
                  with a link to pay.
                </span>
              </span>
            </label>
            {policy && policy.depositRefundable === false && (
              <p className="okg-label">Deposits are non-refundable.</p>
            )}
          </fieldset>
        )}

        {policy && (
          <details className="okg-card okg-faqs">
            <summary>
              {freeUntil ? `Free cancellation until ${freeUntil}` : 'Cancellation policy'}
            </summary>
            <ul className="okg-list okg-muted">
              {policyDeadlines(
                policy,
                booking.departure.startsAt,
                operator.timeZone,
                operator.name,
              ).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        )}

        {paying === 'unavailable' && (
          <Notice tone="danger" title="Payment is temporarily unavailable">
            Your seats are still held for {formatCountdown(remaining)}. Try again in a moment.
          </Notice>
        )}
        <p className="okg-muted okg-small okg-pay-note">
          You’ll choose card or bank transfer on the next step, secured by Paystack.
        </p>
        <button
          type="button"
          className="okg-btn okg-btn--primary okg-btn--pay"
          onClick={pay}
          disabled={expired || !option || paying === 'starting'}
          aria-busy={paying === 'starting'}
        >
          {paying === 'starting'
            ? 'Setting up your payment…'
            : paying === 'unavailable'
              ? `Try again · Pay ${option ? formatNaira(option.amountKobo) : ''}`
              : option?.type === 'deposit'
                ? `Pay deposit ${formatNaira(option.amountKobo)}`
                : `Pay ${option ? formatNaira(option.amountKobo) : ''}`}
        </button>
      </div>
    </CheckoutFrame>
  );
}
