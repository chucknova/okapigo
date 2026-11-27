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
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { formatNaira } from '@okapigo/shared/money';
import { formatLocalDay } from '@okapigo/shared/preview';
import { describePolicy, formatDurationShort } from '@okapigo/shared/tour-facts';
import { takeEmbedded, useApi } from '../../lib/data.js';
import { useLook } from '../../lib/look.js';
import { seatsLabel, summariseDates, dateParts } from '../../lib/dates.js';
import { Bar } from '../../components/Skeleton.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { useTourForCheckout } from '../checkout/CheckoutFrame.jsx';
import {
  EmbeddedContext,
  closeOverlay,
  overlayVisit,
  useOverlayClose,
} from '../../lib/embedded.js';
import { Icon } from '../../components/Icon.jsx';

export { useEmbedded } from '../../lib/embedded.js';

/** How many date tiles the one-tour widget shows (designs: six, then ›). */
const TILES = 6;

/**
 * The frame around every widget screen: its own surface and border (designs: "it reads as a
 * card, never as a hole in the page"), and the height reports.
 * @param {{ children: import('react').ReactNode }} props
 */
export function EmbedFrame({ children }) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [overlay] = useState(() => overlayVisit(location.search));
  // The page behind the card is see-through (embed.css). The server marks its widget pages,
  // but the dev server's page and in-app navigation need the mark set here too.
  useEffect(() => {
    document.documentElement.dataset.embed = '';
    if (overlay) document.documentElement.dataset.overlay = '';
  }, [overlay]);
  // In the overlay, Escape closes it (pressed in here, the host page never hears it).
  useEffect(() => {
    if (!overlay) return;
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') closeOverlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay]);
  useEffect(() => {
    const el = ref.current;
    // Not in a frame, or in the overlay (a fixed size that scrolls): nothing to report.
    if (!el || window.parent === window || overlay) return;
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
  }, [overlay]);
  return (
    <EmbeddedContext.Provider value={{ embedded: true, overlay }}>
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
    <main className="okg-embed__tour" aria-label={tour.title}>
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
    </main>
  );
}

/** @param {{ d: any, href: string }} props */
function DateTile({ d, href }) {
  const seats = seatsLabel(d);
  const { weekday, day, month } = dateParts(d.localDate);
  // Its name is its own text, the hidden parts in between: "Wed 18 Nov, 09:00, 12 left"
  // (19c-1: an aria-label here didn't contain the words shown, WCAG 2.5.3).
  const parts = (/** @type {string} */ seatsText) => (
    <>
      <span className="okg-embed__wd">{weekday}</span> <span className="okg-embed__day">{day}</span>{' '}
      {/* The spaces sit OUTSIDE the hidden text: a name trims each part's own edges. */}
      <span className="okg-visually-hidden">
        {month}, {d.localTime},
      </span>{' '}
      <span className={`okg-embed__seats${seats.tone === 'few' ? ' okg-embed__seats--few' : ''}`}>
        {seatsText}
      </span>
    </>
  );
  if (seats.tone === 'soldOut') {
    return <span className="okg-embed__tile okg-embed__tile--full">{parts('Full')}</span>;
  }
  return (
    <Link className="okg-embed__tile" href={href}>
      {parts(seats.text)}
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
  const close = useOverlayClose(); // in the overlay: a top bar with Close
  if (!view) return error ? <ErrorState error={error} onRetry={retry} /> : <WidgetSkeleton />;
  const { operator, tours } = view;
  return (
    // The widget's main content, with its main heading (hidden: the design shows the rows
    // alone). 19c-3.
    <main className="okg-embed__tours" aria-label={`${operator.name}: tours`}>
      <h1 className="okg-visually-hidden">{operator.name}: tours</h1>
      {close && (
        <div className="okg-embed__bar">
          <span className="okg-strong">{operator.name}</span>
          <button
            type="button"
            className="okg-icon-btn okg-icon-btn--plain"
            onClick={close}
            aria-label="Close"
          >
            <Icon name="close" size={22} />
          </button>
        </div>
      )}
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
    </main>
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
