// @ts-check
/**
 * O2 · Today, the guide's home (designs: O2 Today, O2 Today — states; Sync edge cases,
 * "Saved copy older than 72 hours"). My departures today, big, then tomorrow's.
 *
 * Everything comes from the saved package with this phone's unsent changes on top, so it's
 * the same with or without signal. The facts on each card are worked out in lib/today.js.
 */
import { Link } from 'wouter';
import { Icon } from '../components/Icon.jsx';
import { useNow, useSync, useEngine } from '../lib/engine.jsx';
import { withChanges } from '../lib/outbox.js';
import { daysOf, cardFacts } from '../lib/today.js';
import { isStale } from '../lib/status.js';
import { cashToday } from '../lib/money.js';
import { firstName } from '../lib/manifest.js';
import { formatAt } from '@okapigo/shared/tour-facts';
import { localDate } from '@okapigo/shared/time';

/** "Sat 5 Dec" @param {string} date YYYY-MM-DD */
const dayName = (date) => formatAt(Date.parse(`${date}T12:00:00Z`), 'UTC').split(',')[0];

export function Today() {
  const s = useSync();
  const engine = useEngine();
  const now = useNow(30_000);
  const pkg = withChanges(s.pkg, s.outbox);
  const tz = pkg?.operator?.timeZone ?? 'Africa/Lagos';
  const { today, tomorrow, tomorrowDate, coversToday } = daysOf(pkg, now);
  const todayDate = localDate(now, tz);
  const who = [pkg?.operator?.name, s.session?.user?.name].filter(Boolean).join(' · ');
  const conflict = s.conflicts[0];
  // "Femi’s cash today" (designs: Money owed on the day 3), so nothing is forgotten.
  const cash = cashToday(pkg, s.outbox);
  const me = firstName(s.session?.user?.name ?? 'Your');
  const stale = !coversToday && pkg && s.connection !== 'online' && isStale(s, now);

  return (
    <main className="page">
      {conflict && (
        <Link href="/sync" className="banner banner--conflict">
          <strong className="banner-title">
            {s.conflicts.length === 1
              ? '1 change needs a look'
              : `${s.conflicts.length} changes need a look`}
          </strong>
          <span className="sm">{conflict.explanation?.title ?? conflict.message}.</span>
          <span className="sm strong primary-ink">See what happened</span>
        </Link>
      )}
      <header className="page-head">
        <div className="sm muted strong-ish">{who}</div>
        <h1 className="h-display">Today, {dayName(todayDate)}</h1>
      </header>

      {stale ? (
        <>
          <section className="card card--alert stack-sm">
            <strong className="h-sm">No saved trips for today</strong>
            <span className="sm">
              This phone last had signal on{' '}
              <strong>{formatAt(Date.parse(/** @type {string} */ (s.savedAt)), tz)}</strong>. It
              only saved{' '}
              {pkg.days
                .map(dayName)
                .map((d) => d.split(' ')[0])
                .join(' and ')}
              , so it doesn’t know your trips for today or any changes since.
            </span>
            {s.outbox.length > 0 && (
              <span className="sm">
                Your <strong>{s.outbox.length} changes are safe</strong> and send as soon as there’s
                signal.
              </span>
            )}
          </section>
          <div className="stack-sm">
            <button type="button" className="btn btn--dark" onClick={() => engine.sync()}>
              Try to refresh
            </button>
            {pkg.operator.phone && (
              <a className="btn btn--outline" href={`tel:${pkg.operator.phone}`}>
                Call the office for today’s list
              </a>
            )}
          </div>
          <p className="small muted">
            Nothing on the phone is ever deleted while changes are waiting.
          </p>
        </>
      ) : !pkg ? (
        <section className="card stack-sm center">
          <div className="h-sm">Nothing saved yet</div>
          <div className="sm muted">
            Your departures appear here once this phone has had signal.
          </div>
        </section>
      ) : (
        <>
          {today.length === 0 && (
            <section className="card center stack-sm">
              <div className="h-sm">No departures for you today</div>
              <div className="sm muted">
                {tomorrow.length
                  ? 'Enjoy the day off. Your next one is below.'
                  : 'Nothing in the next 2 days.'}
              </div>
            </section>
          )}
          {today.map((/** @type {any} */ m) => (
            <TodayCard key={m.departure.id} m={m} now={now} tz={tz} />
          ))}
          {tomorrow.length > 0 && tomorrowDate && (
            <>
              <h2 className="h-section">
                {today.length ? 'Tomorrow' : 'Next'}, {dayName(tomorrowDate)}
              </h2>
              {tomorrow.map((/** @type {any} */ m) => {
                const f = cardFacts(m, now, tz);
                return (
                  <Link
                    key={m.departure.id}
                    href={`/departures/${m.departure.id}`}
                    className="card card--link stack-xs"
                  >
                    <div className="row-between">
                      <span className="h-time">{f.time}</span>
                      <span className="sm muted strong">{f.booked}</span>
                    </div>
                    <div className="h-card">{f.title}</div>
                    <div className="sm muted">
                      {[f.resource, f.meetingPoint].filter(Boolean).join(' · ')}
                    </div>
                  </Link>
                );
              })}
            </>
          )}
          {cash && (
            <section className="card stack-xs">
              <strong>{me === 'Your' ? 'Your' : `${me}’s`} cash today</strong>
              <span className="sm">{cash}</span>
              <span className="small muted">Not a payment until the office confirms it.</span>
            </section>
          )}
          {today.length + tomorrow.length > 0 && (
            <p className="small muted">
              {today.length + tomorrow.length === 1 ? 'This departure is' : 'These departures are'}{' '}
              saved on this phone, so{' '}
              {today.length + tomorrow.length === 1 ? 'it works' : 'they work'} without signal.
            </p>
          )}
        </>
      )}
    </main>
  );
}

/** One of today's departures: the big card. @param {{ m: any, now: Date, tz: string }} props */
function TodayCard({ m, now, tz }) {
  const f = cardFacts(m, now, tz);
  return (
    <Link href={`/departures/${m.departure.id}`} className="card card--today">
      <div className="row-between row-baseline">
        <span className="h-time-lg">{f.time}</span>
        {f.when && <span className="pill pill--primary">{f.when}</span>}
      </div>
      <div className="h-card-lg">{f.title}</div>
      <div className="facts">
        {f.meetingPoint && (
          <>
            <Icon name="pin" size={20} width={2} className="muted" />
            <span>{f.meetingPoint}</span>
          </>
        )}
        {f.resource && (
          <>
            <Icon name="van" size={20} width={2} className="muted" />
            <span>{f.resource}</span>
          </>
        )}
      </div>
      <div>
        <div className="row-between strong">
          <span>{f.countText}</span>
          <span className="muted strong-ish">{f.back}</span>
        </div>
        <div className="progress" aria-hidden="true">
          <div className="progress-bar" style={{ width: `${f.pct}%` }} />
        </div>
      </div>
      {f.notes && <div className="sm warning strong">{f.notes}</div>}
      <span className="btn btn--main" aria-hidden="true">
        Open manifest
      </span>
    </Link>
  );
}
