// @ts-check
/**
 * The booking widget, inside another website's <iframe> (BKG-01, stage 12h; designs: file 03,
 * "Inline widget on light and dark host sites").
 *
 *   /embed/:operator          all tours: a list, Book → checkout
 *   /embed/:operator/:tour    one tour: title, from price, the next dates as tiles
 *   /embed/:operator/:tour/book…   the SAME checkout screens as the website (flow 01)
 *
 * App.jsx mounts these under <Route path="/embed" nest>: inside a nest, wouter treats every
 * link and navigation as relative to /embed, so the checkout screens stay in the frame without
 * changing a line of them.
 *
 * The frame tells the host page how tall it is (embed.js resizes the <iframe>), every time
 * its content changes. It sends only a number, so it can send it to any page ('*').
 */
import { createContext, useContext, useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { formatNaira } from '@okapigo/shared/money';
import { formatLocalDay } from '@okapigo/shared/preview';
import { describePolicy, formatDurationShort } from '@okapigo/shared/tour-facts';
import { takeEmbedded, useApi } from '../../lib/data.js';
import { useLook } from '../../lib/look.js';
import { seatsLabel, summariseDates } from '../../lib/dates.js';
import { Bar } from '../../components/Skeleton.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { useTourForCheckout } from '../checkout/CheckoutFrame.jsx';

/** True inside the widget: Pay opens Paystack in a new tab instead of in the frame. */
const EmbeddedContext = createContext(false);
export const useEmbedded = () => useContext(EmbeddedContext);

/** How many date tiles the one-tour widget shows (designs: six, then ›). */
const TILES = 6;

/**
 * The frame around every widget screen: its own surface and border (designs: "it reads as a
 * card, never as a hole in the page"), and the height reports.
 * @param {{ children: import('react').ReactNode }} props
 */
export function EmbedFrame({ children }) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  // The page behind the card is see-through (embed.css). The server marks its widget pages,
  // but the dev server's page and in-app navigation need the mark set here too.
  useEffect(() => {
    document.documentElement.dataset.embed = '';
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.parent === window) return; // opened on its own, not in a frame
    const report = () =>
      window.parent.postMessage({ type: 'okapigo:resize', height: el.offsetHeight }, '*');
    report();
    // Old phone browsers without ResizeObserver: look twice a second instead.
    if (typeof ResizeObserver === 'undefined') {
      const id = setInterval(report, 500);
      return () => clearInterval(id);
    }
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <EmbeddedContext.Provider value={true}>
      <div className="okg-embed" ref={ref}>
        {children}
      </div>
    </EmbeddedContext.Provider>
  );
}

/** "Bookings by OkapiGo", the widget's only branding. */
const Credit = () => <p className="okg-embed__credit">Bookings by OkapiGo</p>;

/** @param {{ params: { operator: string, tour: string } }} props */
export function EmbedTour({ params }) {
  const { operator: opSlug, tour: tourSlug } = params;
  const { data: view, error, retry } = useTourForCheckout(opSlug, tourSlug);
  const dates = useApi(
    `/public/${encodeURIComponent(opSlug)}/tours/${encodeURIComponent(tourSlug)}/departures`,
  );
  if (!view) {
    return error ? <ErrorState error={error} onRetry={retry} /> : <WidgetSkeleton />;
  }
  const { operator, tour } = view;
  const bookHref = `/${opSlug}/${tourSlug}/book`;
  const list = dates.data?.departures ?? null;
  const today = dates.data?.from ?? null;
  const summary = list && today ? summariseDates(list, today) : null;
  const shortOp = operator.name.split(/\s+/)[0];
  const headline = tour.cancellationPolicy
    ? describePolicy(tour.cancellationPolicy, operator.name).headline
    : null;

  return (
    <section className="okg-embed__tour" aria-label={tour.title}>
      <div className="okg-embed__head">
        <h1 className="okg-embed__title">{tour.title}</h1>
        {tour.fromPriceKobo !== null && (
          <p className="okg-embed__from">
            <span className="okg-muted">from</span>{' '}
            <strong className="okg-money">{formatNaira(tour.fromPriceKobo)}</strong>
          </p>
        )}
      </div>

      {!summary ? (
        <div className="okg-embed__tiles" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="okg-embed__tile okg-embed__tile--loading" />
          ))}
        </div>
      ) : summary.kind === 'none' ? (
        <p className="okg-muted">No dates scheduled yet. Ask {shortOp} on WhatsApp.</p>
      ) : summary.kind === 'soldOutUntil' ? (
        <div className="okg-embed__soldout">
          <p className="okg-strong">Sold out until {formatLocalDay(summary.until)}.</p>
          <Link className="okg-link" href={bookHref}>
            See later dates
          </Link>
        </div>
      ) : (
        <div className="okg-embed__tiles">
          {
            /** @type {any[]} */ (list).slice(0, TILES).map((d) => (
              <DateTile key={d.id} d={d} href={`${bookHref}?departure=${d.id}`} />
            ))
          }
          <Link className="okg-embed__more" href={bookHref} aria-label="More dates">
            ›
          </Link>
        </div>
      )}
      <p className="okg-muted okg-small">
        Times in {operator.city ?? 'local'} time
        {headline ? ` · ${headline.charAt(0).toLowerCase()}${headline.slice(1)}` : ''}
      </p>
      <Credit />
    </section>
  );
}

/** @param {{ d: any, href: string }} props */
function DateTile({ d, href }) {
  const seats = seatsLabel(d);
  const weekday = formatLocalDay(d.localDate).split(' ')[0]; // "Wed"
  const day = Number(d.localDate.slice(8, 10)); // 18
  const label = `${formatLocalDay(d.localDate)}, ${d.localTime}: ${seats.text}`;
  if (seats.tone === 'soldOut') {
    return (
      <span className="okg-embed__tile okg-embed__tile--full" aria-label={label}>
        <span className="okg-embed__wd">{weekday}</span>
        <span className="okg-embed__day">{day}</span>
        <span className="okg-embed__seats">Full</span>
      </span>
    );
  }
  return (
    <Link className="okg-embed__tile" href={href} aria-label={label}>
      <span className="okg-embed__wd">{weekday}</span>
      <span className="okg-embed__day">{day}</span>
      <span className={`okg-embed__seats${seats.tone === 'few' ? ' okg-embed__seats--few' : ''}`}>
        {seats.text}
      </span>
    </Link>
  );
}

/** @param {{ params: { operator: string } }} props */
export function EmbedTours({ params }) {
  const slug = params.operator;
  const initial = takeEmbedded((d) => d.kind === 'catalogue' && d.operatorSlug === slug);
  const {
    data: view,
    error,
    retry,
  } = useApi(`/public/${encodeURIComponent(slug)}`, initial?.view ?? null);
  useLook(view?.operator);
  if (!view) return error ? <ErrorState error={error} onRetry={retry} /> : <WidgetSkeleton />;
  const { operator, tours } = view;
  return (
    <section className="okg-embed__tours" aria-label={`${operator.name}: tours`}>
      {tours.length === 0 ? (
        <p className="okg-muted">New tours coming soon.</p>
      ) : (
        <ul className="okg-plain-list">
          {tours.map((/** @type {any} */ t) => (
            <li key={t.slug}>
              <Link className="okg-embed__row" href={`/${slug}/${t.slug}/book`}>
                <span className="okg-embed__row-text">
                  <span className="okg-strong">{t.title}</span>
                  <span className="okg-muted okg-small">
                    {[
                      formatDurationShort(t.durationMinutes),
                      t.scheduleSummary?.replace(
                        /^(Daily|Weekends|Weekdays)\b/,
                        (/** @type {string} */ w) => w.toLowerCase(),
                      ),
                      t.nextDeparture ? `next ${formatLocalDay(t.nextDeparture.localDate)}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {t.fromPriceKobo !== null && (
                  <span className="okg-embed__row-price">
                    <span className="okg-label">from</span>
                    <span className="okg-strong okg-money">{formatNaira(t.fromPriceKobo)}</span>
                  </span>
                )}
                <span className="okg-btn okg-btn--primary okg-embed__row-book">Book</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Credit />
    </section>
  );
}

function WidgetSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="okg-embed__tour">
      <Bar width="60%" height={20} />
      <Bar width="90%" height={56} />
      <Bar width="40%" />
    </div>
  );
}
