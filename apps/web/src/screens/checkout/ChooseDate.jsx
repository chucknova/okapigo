// @ts-check
/**
 * Checkout step 1 · Choose a date (designs: file 01, "1 · Choose a date" and its states).
 * /irin-lagos-tours/lagos-island-heritage-walk/book            (?departure=… skips ahead)
 *
 * Month tabs (this month and the next two), dates grouped Monday–Sunday, sold-out dates
 * LISTED but disabled ("so you can see what's popular"). Choosing one saves it and goes to
 * step 2. Coming from a date tile on the tour page (?departure=id) chooses it at once.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { addDays, localDate } from '@okapigo/shared/time';
import { formatLocalDay } from '@okapigo/shared/preview';
import { formatDurationShort } from '@okapigo/shared/tour-facts';
import { useApi } from '../../lib/data.js';
import { ApiError } from '../../lib/api.js';
import { monthTabs, initialMonth, groupByWeek, seatsChip } from '../../lib/checkout.js';
import { dateParts } from '../../lib/dates.js';
import { useCheckout } from '../../lib/checkout-state.js';
import { Bar } from '../../components/Skeleton.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { NotFound } from '../NotFound.jsx';
import { CheckoutFrame, useTourForCheckout } from './CheckoutFrame.jsx';

/** Rows shown per month before "Show more dates". */
const FIRST_ROWS = 10;
/** The API allows 92 days per request: three months from today fit. */
const WINDOW_DAYS = 91;

/** @param {{ params: { operator: string, tour: string } }} props */
export function ChooseDate({ params }) {
  const { operator: opSlug, tour: tourSlug } = params;
  const [, navigate] = useLocation();
  const wanted = new URLSearchParams(useSearch()).get('departure');
  const { update } = useCheckout(opSlug, tourSlug);

  const { data: view, error, retry } = useTourForCheckout(opSlug, tourSlug);
  const today = view ? localDate(new Date(), view.operator.timeZone) : null;
  const dates = useApi(
    today
      ? `/public/${opSlug}/tours/${tourSlug}/departures?from=${today}&to=${addDays(today, WINDOW_DAYS)}`
      : null,
  );
  /** @type {import('../../lib/checkout.js').Departure[]} */
  const departures = useMemo(() => dates.data?.departures ?? [], [dates.data]);

  const tabs = today ? monthTabs(today) : [];
  const [month, setMonth] = useState(/** @type {string | null} */ (null));
  const [showAll, setShowAll] = useState(false);
  const shownMonth = month ?? (dates.data ? initialMonth(departures, tabs) : null);

  /** @param {import('../../lib/checkout.js').Departure} d */
  const choose = (d) => {
    update({ departure: d });
    navigate(`/${opSlug}/${tourSlug}/book/who`);
  };

  // From a tour-page date tile: choose that date straight away (if it still has seats).
  useEffect(() => {
    if (!wanted || departures.length === 0) return;
    const d = departures.find((x) => x.id === wanted && !x.soldOut);
    if (d) {
      update({ departure: d });
      navigate(`/${opSlug}/${tourSlug}/book/who`, { replace: true });
    }
  }, [wanted, departures, opSlug, tourSlug, update, navigate]);

  if (error instanceof ApiError && error.status === 404) return <NotFound operatorSlug={opSlug} />;
  if (!view) {
    return (
      <div className="okg-page">
        {error ? <ErrorState error={error} onRetry={retry} /> : <Bar height={28} />}
      </div>
    );
  }

  const { operator, tour } = view;
  const inMonth = departures.filter((d) => d.localDate.startsWith(shownMonth ?? ''));
  const visible = showAll ? inMonth : inMonth.slice(0, FIRST_ROWS);
  const nextOpen = departures.find((d) => !d.soldOut);
  const monthLabel = tabs.find((t) => t.key === shownMonth)?.long ?? '';

  return (
    <CheckoutFrame
      step={1}
      title="Choose a date"
      subtitle={`${tour.title} · Step 1 of 4`}
      operatorName={operator.name}
      logo={operator.logo}
      backHref={`/${opSlug}/${tourSlug}`}
      aside={<TourSummary tour={tour} />}
    >
      <div className="okg-month-tabs" role="tablist" aria-label="Month">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === shownMonth}
            className={`okg-pill${t.key === shownMonth ? ' okg-pill--selected' : ''}`}
            onClick={() => {
              setMonth(t.key);
              setShowAll(false);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {dates.error ? (
        <ErrorState error={dates.error} onRetry={dates.retry} />
      ) : !dates.data ? (
        <div className="okg-card" role="status" aria-label="Loading dates">
          {[0, 1, 2, 3].map((i) => (
            <Bar key={i} height={40} />
          ))}
        </div>
      ) : inMonth.every((d) => d.soldOut) ? (
        <EmptyMonth
          monthLabel={monthLabel}
          allFull={inMonth.length > 0}
          runs={tour.scheduleSummary}
          next={nextOpen ?? null}
          onChoose={choose}
        />
      ) : null}

      {dates.data &&
        groupByWeek(visible).map((week) => (
          <section key={week.label} className="okg-week">
            <h2 className="okg-week__label">{week.label}</h2>
            <ul className="okg-date-list">
              {week.departures.map((d) => (
                <DateRow key={d.id} d={d} onChoose={choose} />
              ))}
            </ul>
          </section>
        ))}

      {inMonth.length > visible.length && (
        <button
          type="button"
          className="okg-btn okg-btn--secondary"
          onClick={() => setShowAll(true)}
        >
          Show more dates
        </button>
      )}
      <p className="okg-label">
        All times are {operator.timeZone === 'Africa/Lagos' ? 'Lagos' : operator.timeZone} time.
        Sold-out dates stay listed so you can see what’s popular.
      </p>
    </CheckoutFrame>
  );
}

/**
 * One date row: weekday and day number, time, and a seats chip. A button (it saves the
 * choice and moves on), or a greyed row when sold out.
 * @param {{ d: import('../../lib/checkout.js').Departure, onChoose: (d: any) => void }} props
 */
function DateRow({ d, onChoose }) {
  const chip = seatsChip(d);
  const { weekday, day, month } = dateParts(d.localDate);
  // Its name is its own text, the month hidden in between: "Fri 27 Nov, 09:00, 14 left"
  // (19c-1: an aria-label here didn't contain the words shown, WCAG 2.5.3).
  const content = (
    <>
      <span className="okg-date-row__day">
        <span className="okg-date-row__weekday">{weekday}</span>{' '}
        <span className="okg-date-row__num">{day}</span>{' '}
        {/* The space sits OUTSIDE the hidden text: a name trims each part's own edges. */}
        <span className="okg-visually-hidden">{month},</span>
      </span>{' '}
      <span className="okg-date-row__time">
        {d.localTime}
        {/* Inside the time's own span: in a flex row a browser puts a space between items. */}
        <span className="okg-visually-hidden">,</span>
      </span>{' '}
      {chip.tone === 'soldOut' ? (
        <span className="okg-date-row__sold">Sold out</span>
      ) : (
        <span className={`okg-chip okg-chip--${chip.tone}`}>{chip.text}</span>
      )}
    </>
  );
  return (
    <li>
      {d.soldOut ? (
        <div className="okg-date-row okg-date-row--sold-out">{content}</div>
      ) : (
        <button type="button" className="okg-date-row" onClick={() => onChoose(d)}>
          {content}
        </button>
      )}
    </li>
  );
}

/**
 * "No more trips in December · This trip runs Saturdays 07:00. The next one with seats:
 * [Sat 2 Jan · 07:00]", or the all-sold-out variant.
 * @param {{ monthLabel: string, allFull: boolean, runs: string | null, next: any, onChoose: (d: any) => void }} props
 */
function EmptyMonth({ monthLabel, allFull, runs, next, onChoose }) {
  return (
    <div className="okg-card okg-empty-month">
      <h2 className="okg-h2">
        {allFull ? `Every date in ${monthLabel} is full` : `No more trips in ${monthLabel}`}
      </h2>
      <p className="okg-muted okg-small">
        {runs ? `This trip runs ${runs}. ` : ''}
        {next ? 'The next one with seats:' : 'No dates with seats in the next three months.'}
      </p>
      {next && (
        <button
          type="button"
          className="okg-btn okg-btn--primary okg-btn--auto"
          onClick={() => onChoose(next)}
        >
          {formatLocalDay(next.localDate)} · {next.localTime}
        </button>
      )}
    </div>
  );
}

/**
 * The desktop summary on step 1: what's being booked, before a date is chosen.
 * @param {{ tour: any }} props
 */
export function TourSummary({ tour }) {
  return (
    <div className="okg-summary">
      <h2 className="okg-h2">{tour.title}</h2>
      <p className="okg-small">
        {[formatDurationShort(tour.durationMinutes), tour.scheduleSummary]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="okg-muted okg-small">
        {tour.meetingPoint.name}, {tour.meetingPoint.address}
      </p>
    </div>
  );
}
