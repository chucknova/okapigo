// @ts-check
/**
 * C · Confirming your payment → D · Booking confirmed (designs: file 02, screens C and D and
 * "Confirming · states").
 * /trip/:token/confirm?reference=OKG-…      (Paystack sends the guest back here)
 *
 * Arriving here proves nothing: anyone can type this address. The booking is confirmed only
 * by Paystack's signed webhook (stage 10c), usually 2–5 seconds later. So this page WAITS:
 *
 *   every 2 s   GET the booking (its payments list says how this payment is doing)
 *   from 8 s    also ask the provider directly (a declined card sends no webhook)
 *   after 30 s  "We'll send your confirmation as soon as it's done. You can close this page."
 *               (and keeps checking quietly: bank transfers can take a while)
 *
 * and then shows: confirmed (full or deposit) · didn't go through · paid after the hold ended.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { formatNaira } from '@okapigo/shared/money';
import { formatDuration, formatLocalDay } from '@okapigo/shared/preview';
import { formatPhoneForDisplay } from '@okapigo/shared/contact';
import { balanceDueDate } from '@okapigo/shared/deposits';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/data.js';
import { usePolling } from '../../lib/polling.js';
import { rememberTrip } from '../../lib/trips.js';
import { useEmbedded } from '../../lib/embedded.js';
import { Shell } from '../../components/Shell.jsx';
import { StatusPanel } from '../../components/StatusPanel.jsx';
import { Bar } from '../../components/Skeleton.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { useLook } from '../../lib/look.js';

const POLL_MS = 2_000;
const CHECK_AFTER_MS = 8_000;
const SLOW_AFTER_MS = 30_000;
/** Booking statuses after a successful payment (or staff confirmation). */
const BOOKED = ['confirmed', 'part_paid', 'paid', 'amended', 'completed'];

/** @param {{ params: { token: string } }} props */
export function Confirm({ params }) {
  const { token } = params;
  const reference = new URLSearchParams(useSearch()).get('reference');
  const booking = useApi(`/public/bookings/${token}`);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  const b = booking.data?.booking;
  useLook(b?.operator);
  const payment = b && (b.payments.find((p) => p.reference === reference) ?? b.payments[0]);
  // A payment that succeeded on a booking still "held" is a moment in between (the booking is
  // being secured right now), not an outcome: keep looking. (Seen as a flaky browser test:
  // stopping here left the page on "after your seats were released" for good.)
  const between = payment?.status === 'succeeded' && b?.status === 'held';
  const settled = payment && payment.status !== 'initiated' && !between;
  const waited = now - startedAt;

  // Keep looking until the payment is settled one way or the other.
  usePolling(
    async () => {
      setNow(Date.now());
      if (payment && Date.now() - startedAt > CHECK_AFTER_MS) {
        await api(`/public/bookings/${token}/payments/${payment.reference}/check`, {
          method: 'POST',
        }).catch(() => {}); // a hiccup: the next round asks again
      }
      booking.retry();
    },
    POLL_MS,
    Boolean(b) && !settled,
  );

  // This phone now knows this trip (the payment link page offers "Open your trip page").
  useEffect(() => {
    if (b?.reference) rememberTrip(b.reference, token);
  }, [b?.reference, token]);

  // IN THE WIDGET (stage 12h-2): tell the host page a booking was made, once. Only what a
  // host needs for its own records (the reference, tour, amount): nothing personal. '*' is
  // safe: only the operator's approved websites can hold this frame (frame-ancestors).
  const embedded = useEmbedded();
  const booked = Boolean(b && BOOKED.includes(b.status));
  const told = useRef(false);
  useEffect(() => {
    if (!embedded || !booked || told.current || !b || window.parent === window) return;
    told.current = true;
    window.parent.postMessage(
      {
        type: 'okapigo:booking-completed',
        booking: {
          reference: b.reference,
          operator: b.operator.slug,
          tour: b.tour.slug,
          amountPaidKobo: b.amountPaidKobo,
          currency: 'NGN',
        },
      },
      '*',
    );
  }, [embedded, booked, b]);

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

  const operatorName = b.operator.name;
  const contacts = sentTo(b.lead);
  const context = `${b.tour.title} · ${formatLocalDay(b.departure.localDate)} · ${b.reference}`;

  // --- Paid ---------------------------------------------------------------------------------
  if (payment?.status === 'succeeded' && BOOKED.includes(b.status)) {
    return <Confirmed b={b} token={token} contacts={contacts} />;
  }
  if (payment?.status === 'succeeded' && !between) {
    // The money arrived after the seats were released (rare): the booking couldn't be kept.
    return (
      <Shell operatorName={operatorName} logo={b.operator.logo}>
        <StatusPanel
          tone="warning"
          title="We got your payment after your seats were released"
          context={context}
        >
          Our team will contact you to rebook. If we can’t, you’ll get a full refund of{' '}
          {formatNaira(payment.amountKobo)}.
        </StatusPanel>
      </Shell>
    );
  }

  // --- Didn't go through --------------------------------------------------------------------
  if (payment && (payment.status === 'failed' || payment.status === 'abandoned')) {
    const holdOn =
      b.status === 'held' && b.holdExpiresAt && new Date(b.holdExpiresAt).getTime() > now;
    const minutes = holdOn
      ? Math.max(1, Math.round((new Date(b.holdExpiresAt).getTime() - now) / 60_000))
      : 0;
    return (
      <Shell operatorName={operatorName} logo={b.operator.logo}>
        <p className="okg-test-bar">Test mode · no real money moves</p>
        <StatusPanel
          tone="danger"
          title="Your payment didn’t go through"
          context={context}
          actions={
            <Link
              className="okg-btn okg-btn--primary"
              href={`/${b.operator.slug}/${b.tour.slug}/book/review`}
            >
              {holdOn ? 'Try again' : 'Hold my seats again'}
            </Link>
          }
        >
          {holdOn
            ? `No money was taken. Your seats are still held for about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
            : 'No money was taken. Your 15-minute hold has ended, but you can hold the seats again if they’re still free.'}
          <p className="okg-label">Try another card, or pay by bank transfer instead.</p>
        </StatusPanel>
      </Shell>
    );
  }

  // --- Still waiting ------------------------------------------------------------------------
  return (
    <Shell operatorName={operatorName} logo={b.operator.logo}>
      <p className="okg-test-bar">Test mode · no real money moves</p>
      {waited < SLOW_AFTER_MS ? (
        <StatusPanel
          tone="pending"
          title="Confirming your payment…"
          context={`Booking reference ${b.reference}`}
        >
          This takes a few seconds. Please keep this page open.
        </StatusPanel>
      ) : (
        <StatusPanel
          tone="pending"
          title="Your payment is being confirmed"
          context={`Booking reference ${b.reference}`}
        >
          Bank transfers can take a little longer.{' '}
          {contacts ? `We’ll send your confirmation to ${contacts} as soon as it’s done. ` : ''}
          You can close this page.
        </StatusPanel>
      )}
    </Shell>
  );
}

/**
 * "adaeze@example.com and 0803 123 4567" / "0805 987 6543 on WhatsApp" / the email alone.
 * @param {{ email: string | null, phone: string | null }} lead
 */
function sentTo(lead) {
  const phone = lead.phone ? formatPhoneForDisplay(lead.phone) : null;
  if (lead.email && phone) return `${lead.email} and ${phone}`;
  if (phone) return `${phone} on WhatsApp`;
  return lead.email;
}

/**
 * A link to the guest's trip pages. In the widget they open in their own tab: they're private
 * pages of their own, not steps of the widget.
 * @param {{ href: string, className: string, children: import('react').ReactNode }} props
 */
function TripLink({ href, className, children }) {
  const embedded = useEmbedded();
  return embedded ? (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <Link className={className} href={href}>
      {children}
    </Link>
  );
}

/**
 * D · Booking confirmed: full payment or deposit (designs: file 02, both D screens).
 * @param {{ b: any, token: string, contacts: string | null }} props
 */
function Confirmed({ b, token, contacts }) {
  const [copied, setCopied] = useState(false);
  const balance = b.balanceKobo;
  const deposit = balance > 0;
  const place = b.pickupPoint ?? b.tour.meetingPoint;
  // The pin, unless it's only the city's (16e-4: not set yet); then the place's name and address.
  const mapsUrl =
    'lat' in place && !place.approximate
      ? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name}, ${place.address}`)}`;
  const tourUrl = `${window.location.origin}/${b.operator.slug}/${b.tour.slug}`;
  const shareText = `I’ve booked the ${b.tour.title} on ${formatLocalDay(b.departure.localDate)}! ${tourUrl}`;
  const due = deposit ? balanceDueDate(b.departure.localDate) : null;
  const paidKobo = b.amountPaidKobo;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(b.reference);
      setCopied(true);
    } catch {
      // No clipboard (an old browser): the reference is on screen to write down.
    }
  };

  return (
    <Shell operatorName={b.operator.name} logo={b.operator.logo}>
      <section className="okg-confirmed-band">
        <div className="okg-confirmed-band__title">
          <span className="okg-confirmed-band__check" aria-hidden="true">
            ✓
          </span>
          <h1>Booking confirmed</h1>
        </div>
        <div className="okg-confirmed-band__ref">
          <div>
            <div className="okg-confirmed-band__label">Booking reference</div>
            <div className="okg-confirmed-band__code">{b.reference}</div>
          </div>
          <button type="button" className="okg-confirmed-band__copy" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        {contacts && (
          <p className="okg-confirmed-band__sent">A confirmation was sent to {contacts}.</p>
        )}
      </section>

      {deposit && (
        <section className="okg-card okg-review">
          <div className="okg-review__head">
            <h2 className="okg-h3">Balance due</h2>
            <span className="okg-strong okg-money">{formatNaira(balance)}</span>
          </div>
          <p className="okg-muted okg-small">
            Pay by {formatLocalDay(/** @type {string} */ (due))}. We’ll remind you on WhatsApp with
            a link before then.
          </p>
          <TripLink className="okg-btn okg-btn--primary" href={`/trip/${token}/pay`}>
            Pay balance now
          </TripLink>
        </section>
      )}

      <TripLink className="okg-btn okg-btn--primary okg-btn--pay" href={`/trip/${token}`}>
        Open your trip page
      </TripLink>
      <p className="okg-label">Your QR ticket, what to bring and the map</p>

      <section className="okg-card okg-review">
        <h2 className="okg-h2">{b.tour.title}</h2>
        <div>
          <p className="okg-strong">
            {formatLocalDay(b.departure.localDate)}, {b.departure.localTime}
          </p>
          <p className="okg-muted okg-small">{formatDuration(b.tour.durationMinutes)}</p>
        </div>
        <div>
          <p className="okg-strong">{place.name}</p>
          <p className="okg-muted okg-small">
            {[place.address, b.pickupPoint?.time ?? place.note].filter(Boolean).join(' · ')}
          </p>
          <a className="okg-link okg-review__edit" href={mapsUrl} target="_blank" rel="noreferrer">
            Open in Maps
          </a>
        </div>
      </section>

      <section className="okg-card okg-review">
        <h2 className="okg-h3">
          {b.travellers.length} {b.travellers.length === 1 ? 'traveller' : 'travellers'}
        </h2>
        <ul className="okg-plain-list">
          {b.travellers.map((t, i) => (
            <li key={i}>
              {t.name}{' '}
              <span className="okg-muted">
                · {[categoryWord(t.categoryKey), t.dietaryNeeds].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="okg-card okg-review">
        {deposit ? (
          <>
            <h2 className="okg-h3">Payment</h2>
            <div className="okg-price-lines">
              <div className="okg-price-lines__row">
                <span className="okg-muted">Trip total</span>
                <span className="okg-money">{formatNaira(b.totalKobo)}</span>
              </div>
              <div className="okg-price-lines__row">
                <span className="okg-muted">Deposit paid</span>
                <span className="okg-money">{formatNaira(paidKobo)}</span>
              </div>
              <div className="okg-price-lines__total">
                <span>Still to pay</span>
                <span className="okg-money">{formatNaira(balance)}</span>
              </div>
            </div>
            {b.cancellationPolicy?.depositRefundable === false && (
              <p className="okg-label">Deposits are non-refundable.</p>
            )}
          </>
        ) : (
          <div className="okg-review__head">
            <div>
              <div className="okg-label">Paid</div>
              <div className="okg-price okg-money">{formatNaira(paidKobo)}</div>
              {b.quote.tax?.inclusive && b.quote.taxKobo > 0 && (
                <div className="okg-label">
                  includes {formatNaira(b.quote.taxKobo)} {b.quote.tax.name}
                </div>
              )}
            </div>
            <span className="okg-chip okg-chip--success">Paid in full</span>
          </div>
        )}
      </section>

      <div className="okg-two-buttons">
        <a className="okg-btn okg-btn--secondary" href={`/public/bookings/${token}/calendar.ics`}>
          Add to calendar
        </a>
        <a
          className="okg-btn okg-btn--secondary"
          href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
          target="_blank"
          rel="noreferrer"
        >
          Share on WhatsApp
        </a>
      </div>
      <p className="okg-label">Sharing sends the tour’s link, never your trip page.</p>
    </Shell>
  );
}

/** "adult" → "Adult" (the confirmation lists categories without their ages). @param {string} key */
function categoryWord(key) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}
