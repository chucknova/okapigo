// @ts-check
/**
 * The manager's Today (designs: "Manager’s Today", desktop and phone; stage 16a).
 *
 *   Needs you · 5        what to do now, most urgent first (red, then amber, then blue)
 *   Departures today     time, tour, guide and van, "11 of 12 checked in", where it's at
 *   Guides’ phones       (wide screens) when each guide's phone last synced; on a phone, it's
 *                        the line under each departure instead
 *
 * Read live from /api/today (lib/live.js): never shown as current when it isn't.
 */
import { Link } from 'wouter';
import { LiveFrame } from '../components/LiveFrame.jsx';
import { useLive } from '../lib/live.js';
import { useSync } from '../lib/engine.jsx';
import { localTime } from '@okapigo/shared/time';

/** The design's greeting, by the hour. @param {Date} now @param {string} tz */
const greeting = (now, tz) => {
  const h = Number(localTime(now, tz).slice(0, 2));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/**
 * The state, short, for a phone's line: "under way", "Ikoyi next", "starts in 1 h 20" (the
 * sync time is already on the line above).
 * @param {string} text
 */
const phoneState = (text) =>
  text.startsWith('Picking up · ')
    ? text.slice('Picking up · '.length)
    : text.split(' · ')[0].toLowerCase();

export function ManagerToday() {
  const s = useSync();
  const live = useLive('/api/today');
  const tz = s.me?.operator?.timeZone ?? 'Africa/Lagos';
  const name = (s.me?.user?.name ?? s.session?.user?.name ?? '').split(/\s+/)[0];
  const role = (s.me?.user?.role?.name ?? s.session?.user?.role?.name ?? '').toLowerCase();
  return (
    <LiveFrame live={live} what="Today" tz={tz}>
      {({ today: t }) => (
        <main className="page office-today">
          <header className="office-head">
            <div>
              <div className="sm muted strong-ish">
                <span className="wide-only">
                  {greeting(new Date(), tz)}, {name}
                </span>
                <span className="narrow-only">
                  {name}
                  {role ? ` · ${role}` : ''}
                </span>
              </div>
              <h1 className="h-display">Today, {t.date}</h1>
            </div>
            <div className="muted wide-only">{t.summary}</div>
          </header>

          {t.needs.length > 0 && (
            <section aria-labelledby="needs-h">
              <h2 id="needs-h" className="h-md">
                Needs you · {t.needs.length}
              </h2>
              <div className="needs">
                {t.needs.map((/** @type {any} */ n, /** @type {number} */ i) => (
                  <Link key={i} href={n.href} className={`need need--${n.tone}`}>
                    <span className="need-key">{n.key}</span>
                    <strong className="need-title">{n.title}</strong>
                    <span className="need-detail wide-only">{n.detail}</span>
                    <span className="need-action">{n.action} ›</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {t.needs.length === 0 && <p className="card sm muted">Nothing needs you right now.</p>}

          <div className="office-columns">
            <section className="panel" aria-labelledby="deps-h">
              <h2 id="deps-h" className="panel-h">
                <span className="wide-only">Departures today</span>
                <span className="narrow-only">Departures</span>
              </h2>
              {t.departures.length === 0 && (
                <p className="panel-empty sm muted">No departures with guests today.</p>
              )}
              {t.departures.map((/** @type {any} */ d) => (
                <Link key={d.id} href={`/departures/${d.id}`} className="dep-row">
                  <strong className="dep-time">{d.time}</strong>
                  <span className="dep-what">
                    <strong>{d.tour}</strong>
                    <span className={`dep-guide${d.hasGuide ? '' : ' urgent'}`}>
                      <span className="wide-only">{d.guide}</span>
                      <span className="narrow-only">
                        {d.hasGuide ? `${d.guide.split(' · ')[0]} · ${d.guideSynced}` : d.guide}
                      </span>
                    </span>
                    <span className="narrow-only small muted">
                      {d.progress}
                      {d.state.tone !== 'urgent' ? ` · ${phoneState(d.state.text)}` : ''}
                    </span>
                  </span>
                  <span className="dep-progress wide-only">
                    <span className="small strong">{d.progress}</span>
                    <span className="bar" aria-hidden="true">
                      <span style={{ width: `${d.pct}%` }} />
                    </span>
                  </span>
                  <span className={`dep-state wide-only tone--${d.state.tone}`}>
                    {d.state.text}
                  </span>
                </Link>
              ))}
            </section>

            <section className="panel wide-only" aria-labelledby="phones-h">
              <h2 id="phones-h" className="panel-h">
                Guides’ phones
              </h2>
              {t.phones.length === 0 && (
                <p className="panel-empty sm muted">No guides out today.</p>
              )}
              {t.phones.map((/** @type {any} */ p) => (
                <div key={p.name} className="phone-row">
                  <span>
                    <strong>{p.name}</strong>
                    <span className="block small muted">{p.trip}</span>
                  </span>
                  <span className={`phone-status tone--${p.tone}`}>{p.status}</span>
                </div>
              ))}
              <p className="panel-note small muted">
                Check-ins appear here as each phone syncs. A phone behind by more than an hour is
                flagged.
              </p>
            </section>
          </div>
          <p className="narrow-only small muted">
            Each guide’s phone sync is under their departure; tap a departure for more.
          </p>
        </main>
      )}
    </LiveFrame>
  );
}
