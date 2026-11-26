// @ts-check
/**
 * Checkout step 2 · Who's coming, and extras (designs: file 01, "2 · Who's coming" for
 * Heritage, Street Food and Lekki, "Checkout on desktop", and the step-2 states).
 * /irin-lagos-tours/lagos-island-heritage-walk/book/who
 *
 * The guest sets counters; the SERVER prices the basket (useQuote) and says whether it can
 * be booked (the adult rule). Limits come from the quote's availability: seats left on the
 * date, stock left per extra. Continue is enabled only when the newest price has arrived,
 * so the total on screen is always the one the guest agrees to.
 */
import { useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { formatNaira } from '@okapigo/shared/money';
import { formatLocalDay } from '@okapigo/shared/preview';
import { formatDurationShort, freeCancellationUntil } from '@okapigo/shared/tour-facts';
import { isAdultCategory } from '@okapigo/shared/catalogue';
import {
  travellersFromCounts,
  addOnSelections,
  travellerCount,
  addOnStockLabel,
  seatsNote,
  continueState,
  lineLabel,
} from '../../lib/checkout.js';
import { useCheckout, useQuote } from '../../lib/checkout-state.js';
import { Stepper } from '../../components/Stepper.jsx';
import { Bar } from '../../components/Skeleton.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { CheckoutFrame, useTourForCheckout } from './CheckoutFrame.jsx';

/** @param {{ params: { operator: string, tour: string } }} props */
export function WhoComing({ params }) {
  const { operator: opSlug, tour: tourSlug } = params;
  const [, navigate] = useLocation();
  const { state, update } = useCheckout(opSlug, tourSlug);
  const { data: view, error, retry } = useTourForCheckout(opSlug, tourSlug);
  const { departure } = state;

  // No date chosen (a bookmarked or shared step-2 link): back to step 1.
  useEffect(() => {
    if (!departure) navigate(`/${opSlug}/${tourSlug}/book`, { replace: true });
  }, [departure, opSlug, tourSlug, navigate]);

  const tour = view?.tour;
  // Start with one adult the first time (the most common booking).
  const counts =
    Object.keys(state.counts).length > 0 || !tour
      ? state.counts
      : { [tour.priceCategories.find(isAdultCategory)?.key ?? tour.priceCategories[0]?.key]: 1 };
  const travellers = tour ? travellersFromCounts(counts, tour.priceCategories) : [];
  const quote = useQuote(
    `/public/${opSlug}/tours/${tourSlug}/quote`,
    departure && travellers.length > 0
      ? { departureId: departure.id, travellers, addOns: addOnSelections(state.addOns) }
      : null,
  );

  if (!view || !tour || !departure) {
    return (
      <div className="okg-page">
        {error ? <ErrorState error={error} onRetry={retry} /> : <Bar height={28} />}
      </div>
    );
  }

  const { operator } = view;
  const availability = quote.data?.availability;
  const seatsAvailable = availability?.seatsAvailable ?? departure.seatsAvailable;
  const total = travellerCount(counts);
  const blocker = !quote.updating ? (quote.data?.blocker ?? null) : null;
  const pickupRequired = tour.pickupPoints.length > 0;
  const status = continueState({
    travellers: total,
    seatsAvailable,
    blocker,
    pickupRequired,
    pickup: state.pickup,
    updating: quote.updating,
    quoteError: Boolean(quote.error),
  });
  const extrasCount = Object.values(state.addOns).reduce((a, b) => a + b, 0);
  const priced = quote.data?.quote ?? null;
  const showPrice = !quote.updating && priced && total > 0;

  /** @param {Record<string, number>} next */
  const setCounts = (next) => update({ counts: next });
  const goOn = () => {
    update({ counts });
    navigate(`/${opSlug}/${tourSlug}/book/details`);
  };
  const dateLine = `${formatLocalDay(departure.localDate)} · ${departure.localTime}`;
  const freeUntil =
    tour.cancellationPolicy && departure.startsAt
      ? freeCancellationUntil(tour.cancellationPolicy, departure.startsAt, operator.timeZone)
      : null;

  const summaryLine = `${total} ${total === 1 ? 'traveller' : 'travellers'}${
    extrasCount ? ` · ${extrasCount} ${extrasCount === 1 ? 'extra' : 'extras'}` : ''
  }`;
  const continueButton = (
    <button
      type="button"
      className="okg-btn okg-btn--primary okg-btn--auto"
      disabled={status.disabled}
      onClick={goOn}
    >
      Continue
    </button>
  );

  return (
    <CheckoutFrame
      step={2}
      title="Who’s coming?"
      subtitle={`${tour.title} · ${dateLine} · Step 2 of 4`}
      operatorName={operator.name}
      logo={operator.logo}
      backHref={`/${opSlug}/${tourSlug}/book`}
      aside={
        <div className="okg-summary">
          <h2 className="okg-h2">{tour.title}</h2>
          <p className="okg-small">
            {dateLine} · {formatDurationShort(tour.durationMinutes)}
          </p>
          <p className="okg-muted okg-small">
            {tour.meetingPoint.name}, {tour.meetingPoint.address}
          </p>
          <PriceLines quote={priced} updating={quote.updating || total === 0} large />
          {freeUntil && <p className="okg-success-line">Free cancellation until {freeUntil}</p>}
        </div>
      }
      bottomBar={
        <>
          <div>
            <div className="okg-label">{summaryLine}</div>
            <div className="okg-strong okg-money">
              {showPrice ? (
                formatNaira(priced.totalKobo)
              ) : (
                <span className="okg-muted">Updating…</span>
              )}
            </div>
          </div>
          <div className="okg-continue">
            {continueButton}
            {status.reason && <p className="okg-continue__reason">{status.reason}</p>}
          </div>
        </>
      }
    >
      <section className="okg-card okg-counters" aria-label="Travellers">
        {tour.priceCategories.map((c) => (
          <Stepper
            key={c.key}
            label={c.name}
            price={c.amountKobo === 0 ? 'Free' : formatNaira(c.amountKobo)}
            value={counts[c.key] ?? 0}
            // Every traveller needs a seat: the others' seats count against this one's limit.
            max={seatsAvailable - (total - (counts[c.key] ?? 0))}
            onChange={(n) => setCounts({ ...counts, [c.key]: Math.max(0, n) })}
          />
        ))}
        {blocker?.code === 'ADULT_REQUIRED' ? (
          <p className="okg-counters__error" role="alert">
            {blocker.message}
          </p>
        ) : total >= seatsAvailable && seatsAvailable > 0 ? (
          <p className="okg-counters__limit">
            Only {seatsAvailable} {seatsAvailable === 1 ? 'seat' : 'seats'} left on this date. You
            have all of them.
          </p>
        ) : (
          <p className="okg-label okg-counters__note">
            {seatsNote({ ...departure, seatsAvailable }, tour.priceCategories)}
          </p>
        )}
      </section>

      {tour.addOns.length > 0 ? (
        <section className="okg-card okg-counters" aria-label="Extras">
          <h2 className="okg-h3 okg-counters__head">
            Extras <span className="okg-muted okg-small">· optional</span>
          </h2>
          {tour.addOns.map((a) => {
            const left = availability?.addOns.find((x) => x.id === a.id)?.left ?? null;
            const stock = addOnStockLabel(left, departure.localTime);
            const qty = state.addOns[a.id] ?? 0;
            const description = [a.description, formatNaira(a.priceKobo)]
              .filter(Boolean)
              .join(' · ');
            if (stock?.soldOut && qty === 0) {
              return (
                <div key={a.id} className="okg-addon okg-addon--sold-out">
                  <div>
                    <div className="okg-strong">{a.name}</div>
                    <div className="okg-small">{description}</div>
                  </div>
                  <span className="okg-chip okg-chip--neutral">{stock.text}</span>
                </div>
              );
            }
            return (
              <Stepper
                key={a.id}
                label={a.name}
                price={description}
                note={stock?.text}
                value={qty}
                max={left === null ? 20 : left}
                onChange={(n) => update({ addOns: { ...state.addOns, [a.id]: Math.max(0, n) } })}
              />
            );
          })}
          <p className="okg-label okg-counters__note">
            You can tell us about allergies on the next step.
          </p>
        </section>
      ) : (
        <p className="okg-label">This tour has no extras.</p>
      )}

      {pickupRequired && (
        <fieldset className="okg-card okg-pickup">
          <legend className="okg-h3">Pickup point</legend>
          <p className="okg-label">Required. The van collects you here.</p>
          {tour.pickupPoints.map((p) => (
            <label
              key={p.name}
              className={`okg-radio-card${state.pickup === p.name ? ' okg-radio-card--selected' : ''}`}
            >
              <input
                type="radio"
                name="pickup"
                value={p.name}
                checked={state.pickup === p.name}
                onChange={() => update({ pickup: p.name })}
              />
              <span>
                <span className="okg-strong">{p.name}</span>
                <span className="okg-label">{[p.address, p.time].filter(Boolean).join(' · ')}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <section className="okg-card okg-phone-only" aria-label="Price">
        <h2 className="okg-h3">Price</h2>
        {quote.error ? (
          <ErrorState error={quote.error} onRetry={quote.retry} />
        ) : (
          <PriceLines quote={priced} updating={quote.updating || total === 0} />
        )}
      </section>
      {quote.updating && total > 0 && (
        <p className="okg-visually-hidden" role="status">
          Updating the price
        </p>
      )}

      <div className="okg-checkout__actions okg-desktop-only">
        <Link
          className="okg-btn okg-btn--secondary okg-btn--auto"
          href={`/${opSlug}/${tourSlug}/book`}
        >
          Back
        </Link>
        <div className="okg-continue">
          {continueButton}
          {status.reason && <p className="okg-continue__reason">{status.reason}</p>}
        </div>
      </div>
    </CheckoutFrame>
  );
}

/**
 * "2 × Adult ₦50,000 · Total ₦62,500 · Includes ₦4,360 VAT". While a newer price is on its
 * way the amounts become grey bars and the total says "Updating…" (designs: "Price updating").
 * @param {{ quote: any, updating: boolean, large?: boolean }} props
 */
function PriceLines({ quote, updating, large = false }) {
  if (!quote) {
    return (
      <div className="okg-price-lines">
        <Bar width="70%" />
        <div className="okg-price-lines__total">
          <span>Total</span>
          <span className="okg-muted okg-small">Updating…</span>
        </div>
      </div>
    );
  }
  return (
    <div className="okg-price-lines">
      {quote.lines.map((l) => (
        <div key={`${l.type}-${l.categoryKey ?? l.addOnId}`} className="okg-price-lines__row">
          <span className="okg-muted">{lineLabel(l)}</span>
          {updating ? (
            <Bar width={64} height={14} />
          ) : (
            <span className="okg-money">{formatNaira(l.totalKobo)}</span>
          )}
        </div>
      ))}
      <div className={`okg-price-lines__total${large ? ' okg-price-lines__total--large' : ''}`}>
        <span>Total</span>
        {updating ? (
          <span className="okg-muted okg-small">Updating…</span>
        ) : (
          <span className="okg-money">{formatNaira(quote.totalKobo)}</span>
        )}
      </div>
      {!updating && quote.tax?.inclusive && quote.taxKobo > 0 && (
        <p className="okg-label">
          Includes {formatNaira(quote.taxKobo)} {quote.tax.name}
        </p>
      )}
    </div>
  );
}
