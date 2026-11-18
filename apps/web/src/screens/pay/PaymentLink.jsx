// @ts-check
/**
 * E · Payment link page (designs: file 02, screen E and "Payment link · states").
 * /pay/:token         a link staff sent by WhatsApp or email (a deposit, a balance, any amount)
 * /pay/:token/done    where Paystack sends the guest back afterwards
 *
 * Anyone with the link can open it, so it shows NO personal details: the business, the tour,
 * the date, the booking reference and the amount. Its state comes from the server:
 * open · paid · expired · cancelled · out_of_date. "Open your trip page" appears only if THIS
 * phone has opened the trip before (lib/trips.js).
 */
import { useEffect, useState } from 'react';
import { formatNaira } from '@okapigo/shared/money';
import { formatLocalDay } from '@okapigo/shared/preview';
import { api, ApiError } from '../../lib/api.js';
import { useApi } from '../../lib/data.js';
import { usePolling } from '../../lib/polling.js';
import { tripTokenFor } from '../../lib/trips.js';
import { Shell } from '../../components/Shell.jsx';
import { StatusPanel } from '../../components/StatusPanel.jsx';
import { Bar } from '../../components/Skeleton.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { useLook } from '../../lib/look.js';

const TITLE = {
  deposit: 'Pay your deposit',
  balance: 'Pay your balance',
  custom: 'Payment request',
};

/** When the link page starts asking Paystack itself, if the webhook hasn't landed. */
const CHECK_AFTER_MS = 8_000;

/** @param {{ params: { token: string }, done?: boolean }} props */
export function PaymentLink({ params, done = false }) {
  const { token } = params;
  const res = useApi(`/public/payment-links/${token}`);
  const [paying, setPaying] = useState(/** @type {'idle' | 'starting' | 'unavailable'} */ ('idle'));
  const [gaveUp, setGaveUp] = useState(false);
  const link = res.data?.link;
  useLook(link?.operator);

  // Back from Paystack: the link turns "paid" once the webhook lands (a few seconds). Look
  // every 2 s for a minute, then stop (the confirmation also goes out by message). From 8 s,
  // also ask Paystack directly: the webhook may never come (like the confirm page, 12e).
  const [startedAt] = useState(() => Date.now());
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setGaveUp(true), 60_000);
    return () => clearTimeout(timer);
  }, [done]);
  usePolling(
    async () => {
      if (Date.now() - startedAt > CHECK_AFTER_MS) {
        await api(`/public/payment-links/${token}/check`, { method: 'POST' }).catch(() => {});
      }
      res.retry();
    },
    2_000,
    done && link?.state === 'open' && !gaveUp,
  );

  if (!link) {
    if (res.error instanceof ApiError && res.error.status === 404) {
      return (
        <Shell operatorName="OkapiGo">
          <StatusPanel tone="danger" title="This payment link doesn’t exist">
            Check you copied all of it, or ask for a new one.
          </StatusPanel>
        </Shell>
      );
    }
    return (
      <Shell operatorName="">
        {res.error ? <ErrorState error={res.error} onRetry={res.retry} /> : <Bar height={28} />}
      </Shell>
    );
  }

  const name = link.operator.name;
  const context = `${link.tour.title} · ${formatLocalDay(link.departure.localDate)} · ${link.reference}`;
  const tripToken = tripTokenFor(link.reference);
  const ask = (
    <p className="okg-muted okg-small">Ask {name} for a new one. It only takes them a moment.</p>
  );

  if (link.state === 'paid') {
    return (
      <Shell operatorName={name}>
        <StatusPanel
          tone="success"
          title="This link has been paid. Thank you!"
          context={context}
          actions={
            tripToken && (
              <a className="okg-btn okg-btn--primary" href={`/trip/${tripToken}`}>
                Open your trip page
              </a>
            )
          }
        >
          {formatNaira(link.amountKobo)} was received
          {link.paidOn ? ` on ${formatLocalDay(link.paidOn)}` : ''}. Nothing more to pay.
        </StatusPanel>
      </Shell>
    );
  }
  if (link.state !== 'open') {
    const states = {
      expired: { tone: 'warning', title: 'This link has expired', body: ask },
      cancelled: {
        tone: 'danger',
        title: 'This link is no longer active',
        body: (
          <p className="okg-muted okg-small">
            {name} cancelled this payment request. If you still need to pay, ask them for a new
            link.
          </p>
        ),
      },
      out_of_date: {
        tone: 'warning',
        title: 'This link is out of date',
        body: (
          <>
            <p className="okg-muted okg-small">
              Part of this amount has already been paid, so the link can’t be used. Ask {name} for a
              new one.
            </p>
            <p className="okg-label">We never charge more than the booking owes.</p>
          </>
        ),
      },
    }[link.state];
    return (
      <Shell operatorName={name}>
        <StatusPanel tone={states.tone} title={states.title} context={context}>
          {states.body}
        </StatusPanel>
      </Shell>
    );
  }

  if (done) {
    // Came back from Paystack but the money isn't confirmed yet.
    return (
      <Shell operatorName={name}>
        <StatusPanel tone="pending" title="Confirming your payment…" context={context}>
          This takes a few seconds. If it takes longer, we’ll confirm by message. You can close this
          page.
        </StatusPanel>
      </Shell>
    );
  }

  const pay = async () => {
    if (paying === 'starting') return; // tapping again won't charge twice
    setPaying('starting');
    try {
      const { payment } = await api(`/public/payment-links/${token}/pay`, { method: 'POST' });
      window.location.assign(payment.authorizationUrl);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PAYMENT_STARTING') return; // keep "Setting up…"
      if (err instanceof ApiError && err.kind === 'api') {
        res.retry(); // the link's state changed (paid, expired…): show it
        setPaying('idle');
        return;
      }
      setPaying('unavailable');
    }
  };

  if (paying === 'starting') {
    return (
      <Shell operatorName={name}>
        <p className="okg-test-bar">Test mode · no real money moves</p>
        <StatusPanel tone="pending" title="Setting up your payment…" context={context}>
          You’ll be taken to Paystack in a moment. Tapping again won’t charge you twice.
        </StatusPanel>
      </Shell>
    );
  }
  if (paying === 'unavailable') {
    return (
      <Shell operatorName={name}>
        <p className="okg-test-bar">Test mode · no real money moves</p>
        <StatusPanel
          tone="warning"
          title="Payment is temporarily unavailable"
          context={context}
          actions={
            <button type="button" className="okg-btn okg-btn--primary" onClick={pay}>
              Try again
            </button>
          }
        >
          This isn’t your fault. Please try again in a few minutes; the link still works.
        </StatusPanel>
      </Shell>
    );
  }

  return (
    <Shell operatorName={name}>
      <p className="okg-test-bar">Test mode · no real money moves</p>
      <div>
        <p className="okg-label okg-strong">Payment request</p>
        <h1 className="okg-title">
          {TITLE[/** @type {'deposit'} */ (link.purpose)] ?? TITLE.custom}
        </h1>
      </div>
      <section className="okg-card okg-link-card">
        <div>
          <div className="okg-label">
            {link.purpose === 'custom'
              ? 'Amount'
              : link.purpose === 'deposit'
                ? 'Deposit'
                : 'Balance'}
          </div>
          <div className="okg-link-card__amount okg-money">{formatNaira(link.amountKobo)}</div>
        </div>
        <dl className="okg-facts">
          <dt>Tour</dt>
          <dd>{link.tour.title}</dd>
          <dt>Date</dt>
          <dd>
            {formatLocalDay(link.departure.localDate)}, {link.departure.localTime}
          </dd>
          <dt>Reference</dt>
          <dd>{link.reference}</dd>
          <dt>Link valid</dt>
          <dd className="okg-facts__plain">until {formatLocalDay(link.expiresOn)}</dd>
        </dl>
      </section>
      <button type="button" className="okg-btn okg-btn--primary okg-btn--pay" onClick={pay}>
        Pay {formatNaira(link.amountKobo)}
      </button>
      <p className="okg-muted okg-small">
        Card or bank transfer on the next step, secured by Paystack.
      </p>
      <p className="okg-muted okg-small">Not expecting this? Ask {name} before paying.</p>
    </Shell>
  );
}

/** @param {{ params: { token: string } }} props */
export function PaymentLinkDone({ params }) {
  return <PaymentLink params={params} done />;
}
