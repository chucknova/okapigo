// @ts-check
/**
 * F · Pay your balance (designs: file 02, screen F).
 * /trip/:token/pay     from "Pay balance now", the trip page, or a reminder message
 *
 * The guest is on THEIR OWN booking (the token), so it can show more than a payment link:
 * the trip total, what was paid when, and the due date. Pay asks the server for the
 * "balance" option (never an amount) and comes back to /trip/:token/confirm.
 */
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { formatNaira } from '@okapigo/shared/money';
import { formatDay, formatLocalDay } from '@okapigo/shared/preview';
import { balanceDueDate } from '@okapigo/shared/deposits';
import { ApiError } from '../../lib/api.js';
import { useApi } from '../../lib/data.js';
import { startPayment } from '../../lib/checkout-actions.js';
import { rememberTrip } from '../../lib/trips.js';
import { Shell } from '../../components/Shell.jsx';
import { StatusPanel } from '../../components/StatusPanel.jsx';
import { Notice } from '../../components/Feedback.jsx';
import { Bar } from '../../components/Skeleton.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';

/** @param {{ params: { token: string } }} props */
export function PayBalance({ params }) {
  const { token } = params;
  const booking = useApi(`/public/bookings/${token}`);
  const [paying, setPaying] = useState(/** @type {'idle' | 'starting' | 'unavailable'} */ ('idle'));
  const b = booking.data?.booking;

  useEffect(() => {
    if (b?.reference) rememberTrip(b.reference, token);
  }, [b?.reference, token]);

  if (!b) {
    return (
      <Shell operatorName="">
        {booking.error ? (
          <ErrorState error={booking.error} onRetry={booking.retry} />
        ) : (
          <Bar height={28} />
        )}
      </Shell>
    );
  }

  const option = b.paymentOptions.find((o) => o.type === 'balance');
  const context = `${b.tour.title} · ${formatLocalDay(b.departure.localDate)} · ${b.reference}`;
  if (!option) {
    return (
      <Shell operatorName={b.operator.name}>
        <StatusPanel
          tone={b.balanceKobo <= 0 ? 'success' : 'warning'}
          title={
            b.balanceKobo <= 0 ? 'Nothing more to pay' : 'This booking can’t take payments now'
          }
          context={context}
          actions={
            <Link className="okg-btn okg-btn--secondary" href={`/trip/${token}`}>
              Back to your trip page
            </Link>
          }
        >
          {b.balanceKobo <= 0
            ? 'Your trip is paid in full. Thank you!'
            : `Please contact ${b.operator.name}.`}
        </StatusPanel>
      </Shell>
    );
  }

  const due = formatLocalDay(balanceDueDate(b.departure.localDate));
  const paid = b.payments.filter((p) => p.status === 'succeeded' && p.paidAt);

  const pay = async () => {
    if (paying === 'starting') return;
    setPaying('starting');
    try {
      window.location.assign(await startPayment(token, 'balance'));
    } catch (err) {
      setPaying(
        err instanceof ApiError && err.code === 'PAYMENT_STARTING' ? 'idle' : 'unavailable',
      );
    }
  };

  return (
    <Shell operatorName={b.operator.name}>
      <p className="okg-test-bar">Test mode · no real money moves</p>
      <div>
        <p className="okg-label okg-strong">Your trip</p>
        <h1 className="okg-title">Pay your balance</h1>
      </div>
      <p>
        Balance for your <strong>{b.tour.title}</strong> on {formatLocalDay(b.departure.localDate)}.
      </p>
      <section className="okg-card okg-review">
        <div className="okg-price-lines">
          <div className="okg-price-lines__row">
            <span className="okg-muted">Trip total</span>
            <span className="okg-money">{formatNaira(b.totalKobo)}</span>
          </div>
          {paid.map((p) => (
            <div key={p.reference} className="okg-price-lines__row">
              <span className="okg-muted">
                Paid on {formatDay(new Date(p.paidAt), b.operator.timeZone)}
              </span>
              <span className="okg-money">− {formatNaira(p.amountKobo)}</span>
            </div>
          ))}
          <div className="okg-price-lines__total">
            <span>Balance</span>
            <span className="okg-money">{formatNaira(option.amountKobo)}</span>
          </div>
        </div>
        <span className="okg-chip okg-chip--warning okg-chip--start">Due by {due}</span>
      </section>
      <p className="okg-status__context">
        {b.lead.name} · {b.travellers.length}{' '}
        {b.travellers.length === 1 ? 'traveller' : 'travellers'} · Reference {b.reference}
      </p>
      {paying === 'unavailable' && (
        <Notice tone="danger" title="Payment is temporarily unavailable">
          This isn’t your fault. Please try again in a few minutes.
        </Notice>
      )}
      <button
        type="button"
        className="okg-btn okg-btn--primary okg-btn--pay"
        onClick={pay}
        disabled={paying === 'starting'}
      >
        {paying === 'starting'
          ? 'Setting up your payment…'
          : `Pay ${formatNaira(option.amountKobo)}`}
      </button>
      <p className="okg-muted okg-small">
        Card or bank transfer on the next step, secured by Paystack.
      </p>
      <p className="okg-muted okg-small">
        Can’t pay by {due}? Tell {b.operator.name}. Your booking isn’t cancelled automatically.
      </p>
    </Shell>
  );
}
