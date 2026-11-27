// @ts-check
/**
 * B · Tour page (docs/designs, file 01): phone and desktop.
 * /irin-lagos-tours/lagos-island-heritage-walk
 *
 * ONE set of elements, two layouts (screens.css): on a phone everything is one column with
 * a sticky "Book" bar at the bottom; from 960 px the booking panel (price, dates, Book)
 * becomes a card on the right. No duplicated content, so screen readers hear it once.
 *
 * Data: the page's embedded tour on first load, else GET /public/:operator/tours/:tour.
 * Dates: always fetched live (seat counts are never cached), next 8 weeks.
 * States: loading · not found / no longer sold · sold out for 2 weeks · no dates · offline.
 */
import { formatNaira } from '@okapigo/shared/money';
import { formatLocalDay } from '@okapigo/shared/preview';
import { describePolicy, formatDurationShort, priceNote } from '@okapigo/shared/tour-facts';
import { addDays, localDate } from '@okapigo/shared/time';
import { takeEmbedded, useApi } from '../lib/data.js';
import { ApiError } from '../lib/api.js';
import { summariseDates, seatsLabel } from '../lib/dates.js';
import { Icon } from '../components/Icon.jsx';
import { Mark } from '../components/Shell.jsx';
import { TourPhotos } from '../components/Photos.jsx';
import { Bar } from '../components/Skeleton.jsx';
import { ErrorState } from '../components/ErrorState.jsx';
import { NotFound } from './NotFound.jsx';
import { useLook } from '../lib/look.js';

/** How far ahead the page looks for dates (the API allows up to 92 days per request). */
const LOOK_AHEAD_DAYS = 56;

/** @param {{ params: { operator: string, tour: string } }} props */
export function TourPage({ params }) {
  const { operator: opSlug, tour: tourSlug } = params;
  const initial = takeEmbedded(
    (d) => d.kind === 'tour' && d.operatorSlug === opSlug && d.tourSlug === tourSlug,
  );
  const base = `/public/${encodeURIComponent(opSlug)}/tours/${encodeURIComponent(tourSlug)}`;
  const { data: view, error, retry } = useApi(base, initial?.view ?? null);
  useLook(view?.operator);

  // Dates need the operator's "today", so they wait for the tour (and its time zone).
  const today = view ? localDate(new Date(), view.operator.timeZone) : null;
  const dates = useApi(
    today ? `${base}/departures?from=${today}&to=${addDays(today, LOOK_AHEAD_DAYS)}` : null,
  );

  if (error instanceof ApiError && error.status === 404) {
    return <NotFound operatorSlug={opSlug} />;
  }
  if (!view) {
    return error ? (
      <div className="okg-page">
        <ErrorState error={error} onRetry={retry} />
      </div>
    ) : (
      <TourSkeleton />
    );
  }

  const { operator, tour } = view;
  const policy = tour.cancellationPolicy
    ? describePolicy(tour.cancellationPolicy, operator.name)
    : null;
  const note = priceNote(tour.priceCategories);
  const bookHref = `/${operator.slug}/${tour.slug}/book`;
  const chips = [
    tour.durationMinutes % 60 === 0
      ? `${tour.durationMinutes / 60} hours`
      : formatDurationShort(tour.durationMinutes),
    tour.activityLabel,
    `Up to ${tour.maxGuests} guests`,
    tour.scheduleSummary,
  ].filter(Boolean);

  return (
    <div className="okg-tour">
      <header className="okg-header okg-tour__header">
        <a
          className="okg-icon-btn okg-icon-btn--plain"
          href={`/${operator.slug}`}
          aria-label={`All ${operator.name} tours`}
        >
          <Icon name="back" size={22} />
        </a>
        <Mark name={operator.name} logo={operator.logo} className="okg-desktop-only" />
        <span className="okg-header__name">{operator.name}</span>
        <a className="okg-link okg-desktop-only" href={`/${operator.slug}`}>
          All tours
        </a>
        <ShareButton title={tour.title} />
      </header>

      {/* The page's main content (19c-3: screen readers jump straight here). */}
      <main className="okg-tour__layout">
        {/* The photos swipe; with none, the style's pattern (desktop) as before (19b-2b). */}
        <div
          className={`okg-tour__band${tour.photos.length ? ' okg-tour__band--photos' : ' okg-tour__band--pattern'}`}
        >
          {tour.photos.length > 0 && <TourPhotos photos={tour.photos} />}
        </div>

        <section className="okg-tour__hero">
          <ul className="okg-chips" aria-label="About this tour">
            {chips.map((c) => (
              <li key={c} className="okg-chip okg-chip--neutral okg-chip--fact">
                {c}
              </li>
            ))}
          </ul>
          <h1 className="okg-tour__title">{tour.title}</h1>
          <p className="okg-tour__description">{tour.description}</p>
        </section>

        <aside className="okg-tour__book" aria-label="Price and dates">
          <div className="okg-tour__price-block">
            <div className="okg-tour__price-row">
              {tour.fromPriceKobo !== null && (
                <div>
                  <div className="okg-label">from</div>
                  <div className="okg-tour__price okg-money">{formatNaira(tour.fromPriceKobo)}</div>
                  <div className="okg-label">
                    <span className="okg-phone-only">
                      {[note.per, operator.pricesInclude && `includes ${operator.pricesInclude}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span className="okg-desktop-only">
                      {[
                        note.per,
                        ...note.others,
                        operator.pricesInclude && `includes ${operator.pricesInclude}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                </div>
              )}
              <a className="okg-btn okg-btn--primary okg-btn--auto okg-phone-only" href={bookHref}>
                Book
              </a>
            </div>
            {policy?.headline && (
              <p className="okg-success-line okg-phone-only">
                <Icon name="check" size={18} />
                {policy.headline}
              </p>
            )}
          </div>
          <Dates dates={dates} today={today} bookHref={bookHref} />
          <a className="okg-btn okg-btn--primary okg-desktop-only" href={bookHref}>
            See all dates and book
          </a>
          <p className="okg-muted okg-xs okg-desktop-only">
            Card or bank transfer, secured by Paystack
          </p>
        </aside>

        <div className="okg-tour__content">
          <MeetingPoint meetingPoint={tour.meetingPoint} />
          {(tour.inclusions.length > 0 || tour.exclusions.length > 0) && (
            <section className="okg-card okg-two-col">
              <div>
                <h2 className="okg-h3">Included</h2>
                <ul className="okg-list">
                  {tour.inclusions.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h2 className="okg-h3">Not included</h2>
                <ul className="okg-list okg-muted">
                  {tour.exclusions.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            </section>
          )}
          {tour.stops.length > 0 && (
            <section className="okg-card">
              <h2 className="okg-h2">The route</h2>
              <ol className="okg-route">
                {tour.stops.map((s, i) => (
                  <li key={s.name}>
                    <span className="okg-route__n" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="okg-route__name">{s.name}</span>
                    {s.description && <span className="okg-muted okg-small">{s.description}</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {tour.whatToBring.length > 0 && (
            <section className="okg-card">
              <h2 className="okg-h2">What to bring</h2>
              <ul className="okg-list">
                {tour.whatToBring.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </section>
          )}
          {tour.faqs.length > 0 && (
            <section className="okg-card okg-faqs">
              <h2 className="okg-h2">Questions</h2>
              {tour.faqs.map((f) => (
                <details key={f.question}>
                  <summary>{f.question}</summary>
                  <p className="okg-muted okg-small">{f.answer}</p>
                </details>
              ))}
            </section>
          )}
          {policy && (
            <section className="okg-card">
              <h2 className="okg-h2">Cancellation</h2>
              {policy.headline && <p className="okg-strong">{policy.headline}.</p>}
              <ul className="okg-list okg-muted">
                {policy.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>

      {/* Phone: the price and Book stay in reach at the bottom of the screen. A named region,
          so nothing on the page sits outside one (19c-3). */}
      <section className="okg-sticky-bar okg-phone-only" aria-label="Price and book">
        {tour.fromPriceKobo !== null && (
          <div>
            <div className="okg-label">from</div>
            <div className="okg-strong okg-money">{formatNaira(tour.fromPriceKobo)}</div>
          </div>
        )}
        <a className="okg-btn okg-btn--primary okg-btn--auto" href={bookHref}>
          Book
        </a>
      </section>
    </div>
  );
}

/**
 * "Next dates": tiles to pick a date, or the sold-out / no-dates states.
 * @param {{ dates: ReturnType<typeof useApi>, today: string | null, bookHref: string }} props
 */
function Dates({ dates, today, bookHref }) {
  const heading = (
    <div className="okg-dates__head">
      <h2 className="okg-h2">
        <span className="okg-phone-only">Next dates</span>
        <span className="okg-desktop-only">Choose a date</span>
      </h2>
      <a className="okg-link okg-phone-only" href={bookHref}>
        All dates
      </a>
    </div>
  );
  if (dates.error) {
    return (
      <section className="okg-dates">
        {heading}
        <ErrorState error={dates.error} onRetry={dates.retry} />
      </section>
    );
  }
  if (!dates.data || !today) {
    return (
      <section className="okg-dates" role="status" aria-label="Loading dates">
        {heading}
        <div className="okg-dates__grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="okg-date">
              <Bar width="70%" height={14} />
              <Bar width="50%" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  const summary = summariseDates(dates.data.departures, today);
  if (summary.kind === 'none') {
    return (
      <section className="okg-dates">
        {heading}
        <p className="okg-strong">No dates scheduled yet</p>
        <p className="okg-muted okg-small">Ask the operator, or look at their other tours.</p>
      </section>
    );
  }
  if (summary.kind === 'soldOutUntil') {
    return (
      <section className="okg-dates">
        {heading}
        <span className="okg-chip okg-chip--warning">Popular</span>
        <p className="okg-strong">Sold out until {formatLocalDay(summary.until)}</p>
        <p className="okg-muted okg-small">
          Every date before then is full. Next dates with seats:
        </p>
        <div className="okg-dates__grid">
          {summary.next.map((d) => (
            <DateTile key={d.id} d={d} bookHref={bookHref} />
          ))}
        </div>
        <a className="okg-link" href={bookHref}>
          See later dates
        </a>
      </section>
    );
  }
  return (
    <section className="okg-dates">
      {heading}
      <div className="okg-dates__grid">
        {summary.tiles.map((d) => (
          <DateTile key={d.id} d={d} bookHref={bookHref} />
        ))}
      </div>
    </section>
  );
}

/**
 * One date: a link into checkout with that date chosen, or a disabled tile when sold out.
 * @param {{ d: import('../lib/dates.js').Departure, bookHref: string }} props
 */
function DateTile({ d, bookHref }) {
  const seats = seatsLabel(d);
  const day = formatLocalDay(d.localDate);
  const sub = seats.tone === 'soldOut' ? seats.text : `${d.localTime} · ${seats.text}`;
  if (seats.tone === 'soldOut') {
    return (
      <div className="okg-date okg-date--sold-out" aria-label={`${day}: sold out`}>
        <span className="okg-date__day">{day}</span>
        <span className="okg-date__seats">{sub}</span>
      </div>
    );
  }
  return (
    <a className="okg-date" href={`${bookHref}?departure=${d.id}`}>
      <span className="okg-date__day">
        {day}
        <span className="okg-desktop-only"> · {d.localTime}</span>
      </span>
      <span className={`okg-date__seats${seats.tone === 'few' ? ' okg-date__seats--few' : ''}`}>
        <span className="okg-phone-only">{sub}</span>
        <span className="okg-desktop-only">{seats.text}</span>
      </span>
    </a>
  );
}

/** @param {{ meetingPoint: { name: string, address: string, note?: string } }} props */
function MeetingPoint({ meetingPoint }) {
  return (
    <section className="okg-card okg-meeting">
      <span className="okg-meeting__icon">
        <Icon name="pin" size={24} />
      </span>
      <div>
        <h2 className="okg-h2">Meeting point</h2>
        <p className="okg-strong">{meetingPoint.name}</p>
        <p className="okg-muted okg-small">
          {[meetingPoint.address, meetingPoint.note].filter(Boolean).join('. ')}
        </p>
      </div>
    </section>
  );
}

/**
 * Share the tour: the phone's own share sheet where there is one (WhatsApp, Instagram…),
 * otherwise copy the link.
 * @param {{ title: string }} props
 */
function ShareButton({ title }) {
  const share = async () => {
    const url = window.location.href.split('?')[0];
    try {
      if (navigator.share) await navigator.share({ title, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      // The guest closed the share sheet: nothing to do.
    }
  };
  return (
    <button type="button" className="okg-icon-btn" onClick={share} aria-label={`Share ${title}`}>
      <Icon name="share" size={20} />
    </button>
  );
}

function TourSkeleton() {
  return (
    <div className="okg-page" role="status" aria-label="Loading the tour">
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Bar width={64} height={24} pill />
        <Bar width={64} height={24} pill />
      </div>
      <Bar width="85%" height={28} />
      <Bar width="95%" />
      <Bar width="90%" />
      <Bar width="60%" />
    </div>
  );
}
