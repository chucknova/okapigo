// @ts-check
/**
 * O6 · Schedule (designs: O6 Schedule, desktop and phone; stage 16b).
 *
 *   wide screen   a week, Monday to Sunday, seven columns of departure cards; ‹ › and This week;
 *                 tours to filter by; "1 departure without a guide"
 *   phone         the seven days as tabs (a red dot: a departure needing a guide), one day's
 *                 departures below; tours to filter by
 *
 * Each card: time, tour, seats sold of what it can sell (its van's seats, if smaller), guide,
 * van or boat; tags SOLD OUT · NEEDS GUIDE · CANCELLED. Tap one: its page (O7).
 * Read live (lib/live.js); the wording comes from lib/board.js.
 */
import { useState } from 'react';
import { Link } from 'wouter';
import { LiveFrame } from '../components/LiveFrame.jsx';
import { useLive } from '../lib/live.js';
import { useSync } from '../lib/engine.jsx';
import { cardView, departuresText, filterWeek, firstDay } from '../lib/board.js';

export function Schedule() {
  const s = useSync();
  const tz = s.me?.operator?.timeZone ?? 'Africa/Lagos';
  const [start, setStart] = useState(/** @type {string | null} */ (null));
  const [tour, setTour] = useState(/** @type {string | null} */ (null));
  const [day, setDay] = useState(/** @type {string | null} */ (null));
  const live = useLive(`/api/schedule/week${start ? `?start=${start}` : ''}`);
  return (
    <LiveFrame live={live} what="The schedule" tz={tz}>
      {({ week: raw }) => {
        const week = filterWeek(raw, tour);
        const shown =
          day && week.days.some((/** @type {any} */ d) => d.date === day) ? day : firstDay(week);
        const today = week.days.find((/** @type {any} */ d) => d.date === shown);
        return (
          <main className="page schedule">
            <header className="schedule-head">
              <h1 className="h-xl grow">Schedule</h1>
              <div className="week-nav wide-only">
                <button
                  type="button"
                  className="square-btn"
                  aria-label="Previous week"
                  onClick={() => setStart(week.previous)}
                >
                  ‹
                </button>
                <strong>{week.label}</strong>
                <button
                  type="button"
                  className="square-btn"
                  aria-label="Next week"
                  onClick={() => setStart(week.next)}
                >
                  ›
                </button>
                <button
                  type="button"
                  className="btn btn--outline btn--compact"
                  onClick={() => setStart(week.thisWeek)}
                  disabled={week.start === week.thisWeek}
                >
                  This week
                </button>
              </div>
              <label className="narrow-only tour-select">
                <span className="visually-hidden">Tour</span>
                <select value={tour ?? ''} onChange={(e) => setTour(e.target.value || null)}>
                  <option value="">All tours</option>
                  {week.tours.map((/** @type {any} */ t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </header>

            <div role="group" aria-label="Filter by tour" className="filters wide-only">
              {[{ slug: null, name: 'All tours' }, ...week.tours].map((/** @type {any} */ t) => (
                <button
                  key={t.slug ?? 'all'}
                  type="button"
                  className="filter"
                  aria-pressed={tour === t.slug}
                  onClick={() => setTour(t.slug)}
                >
                  {t.name}
                </button>
              ))}
              {week.withoutGuide > 0 && (
                <span className="chip-alert">
                  {week.withoutGuide} {week.withoutGuide === 1 ? 'departure' : 'departures'} without
                  a guide
                </span>
              )}
            </div>

            {/* Wide screens: the whole week. */}
            <div className="week wide-only">
              {week.days.map((/** @type {any} */ d) => (
                <section key={d.date} className="week-day" aria-label={d.long}>
                  <h2 className={`week-day-h${d.isToday ? ' is-today' : ''}`}>
                    <span className="strong-heavy">{d.dow}</span>{' '}
                    <span className="muted strong-ish">{d.day}</span>
                  </h2>
                  {d.cards.map((/** @type {any} */ c) => (
                    <DepartureCard key={c.id} c={c} />
                  ))}
                </section>
              ))}
            </div>

            {/* A phone: one day at a time. */}
            <div className="narrow-only day-picker">
              <div role="tablist" aria-label="Day" className="day-tabs">
                {week.days.map((/** @type {any} */ d) => (
                  <button
                    key={d.date}
                    type="button"
                    role="tab"
                    aria-selected={d.date === shown}
                    className="day-tab"
                    onClick={() => setDay(d.date)}
                  >
                    <span className="day-tab-dow">{d.dow}</span>
                    <span className="day-tab-n">{d.day.split(' ')[0]}</span>
                    {d.flag && <span className="day-tab-flag" aria-label="needs attention" />}
                  </button>
                ))}
              </div>
              <div className="week-mini-nav">
                <button type="button" className="text-link" onClick={() => setStart(week.previous)}>
                  ‹ Previous week
                </button>
                <button type="button" className="text-link" onClick={() => setStart(week.next)}>
                  Next week ›
                </button>
              </div>
              {today && (
                <>
                  <h2 className="h-section">
                    {today.long} · {departuresText(today.cards.length)}
                  </h2>
                  {today.cards.length === 0 && (
                    <p className="card sm muted">No departures this day.</p>
                  )}
                  {today.cards.map((/** @type {any} */ c) => (
                    <DepartureCard key={c.id} c={c} phone />
                  ))}
                </>
              )}
            </div>
          </main>
        );
      }}
    </LiveFrame>
  );
}

/** @param {{ c: any, phone?: boolean }} props */
function DepartureCard({ c, phone = false }) {
  const v = cardView(c, { phone });
  return (
    <Link
      href={`/departures/${c.id}`}
      className={`dep-card${phone ? ' dep-card--phone' : ''}${v.alert ? ' dep-card--alert' : ''}${v.cancelled ? ' dep-card--cancelled' : ''}`}
    >
      {phone ? (
        <>
          <strong className="dep-card-time">{c.time}</strong>
          <span className="dep-card-body">
            <span className="row-between">
              <strong>{c.tour}</strong>
              {v.tag && <span className={`dep-tag tone--${v.tagTone}`}>{v.tag}</span>}
            </span>
            <span className="sm muted">
              {v.seats}
              {c.vehicle ? ` · ${c.vehicle.split(' · ')[0]}` : ''}
            </span>
            <span className={`sm strong tone--${v.guideTone}`}>{v.guide}</span>
          </span>
        </>
      ) : (
        <>
          <span className="row-between row-baseline">
            <strong className={`dep-card-time${v.cancelled ? ' struck' : ''}`}>{c.time}</strong>
            {v.tag && <span className={`dep-tag tone--${v.tagTone}`}>{v.tag}</span>}
          </span>
          <span className={`dep-card-tour${v.cancelled ? ' struck' : ''}`}>{c.tour}</span>
          <span className="dep-card-seats">{v.seats}</span>
          <span className="bar" aria-hidden="true">
            <span
              className={v.barTone === 'warning' ? 'bar-full' : ''}
              style={{ width: `${c.pct}%` }}
            />
          </span>
          <span className={`dep-card-guide tone--${v.guideTone}`}>{v.guide}</span>
          {c.vehicle && <span className="tiny muted">{c.vehicle}</span>}
        </>
      )}
    </Link>
  );
}
