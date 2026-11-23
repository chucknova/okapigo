// @ts-check
/**
 * Dashboard (design D1, stage 18c): today's departures, bookings, money in and check-ins; the
 * last 30 days of money in and bookings against the 30 before; where bookings came from; how
 * full each tour's departures were. For the owner and managers (it shows money).
 *
 * Every number and its words come from GET /api/dashboard; this file draws them.
 */
import { LiveFrame } from '../components/LiveFrame.jsx';
import { useLive } from '../lib/live.js';
import { useSync } from '../lib/engine.jsx';
import { MONEY_IN_NOTE, updatedWords } from '../lib/dashboard.js';

export function Dashboard() {
  const s = useSync();
  const live = useLive('/api/dashboard');
  const tz = s.me?.operator?.timeZone ?? 'Africa/Lagos';
  return (
    <main className="page stack-md dashboard">
      <LiveFrame live={live} what="The dashboard" forWhom="the owner and managers" tz={tz}>
        {({ dashboard: d }) => (
          <div className="stack-md">
            <header>
              <h1 className="h-xl">Dashboard</h1>
              <p className="muted">{updatedWords(d.updatedAt)}</p>
            </header>

            <section aria-label="Today" className="dash-tiles">
              {d.today.map((/** @type {any} */ t) => (
                <div key={t.key} className="panel panel--pad dash-tile">
                  <span className="small strong muted">{t.label}</span>
                  <span className="dash-value">{t.value}</span>
                  <span className="small muted">{t.note}</span>
                </div>
              ))}
            </section>

            <section className="panel panel--pad stack-md" aria-labelledby="dash-trend">
              <div className="row-between">
                <h2 className="h-lg" id="dash-trend">
                  The last 30 days
                </h2>
                <span className="small muted">{d.range.words}</span>
              </div>
              <div className="dash-charts">
                <Trend title="Money in" series={d.money} range={d.range} />
                <Trend title="Bookings" series={d.bookings} range={d.range} />
              </div>
              <p className="small muted">{MONEY_IN_NOTE}</p>
            </section>

            <div className="dash-pair">
              <section className="panel panel--pad stack-sm" aria-labelledby="dash-channels">
                <h2 className="h-md" id="dash-channels">
                  Where bookings came from · 30 days
                </h2>
                {d.channels.length === 0 ? (
                  <p className="muted">No bookings in the last 30 days.</p>
                ) : (
                  <div className="table-scroll">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th scope="col">Channel</th>
                          <th scope="col">Bookings</th>
                          <th scope="col">Money in</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.channels.map((/** @type {any} */ c) => (
                          <tr key={c.name}>
                            <td>{c.name}</td>
                            <td>{c.bookings}</td>
                            <td>{c.money}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="panel panel--pad stack-sm" aria-labelledby="dash-tours">
                <h2 className="h-md" id="dash-tours">
                  Seats filled, by tour · 30 days
                </h2>
                {d.tours.length === 0 ? (
                  <p className="muted">No departures in the last 30 days.</p>
                ) : (
                  <ul className="plain-list stack-sm">
                    {d.tours.map((/** @type {any} */ t) => (
                      <li key={t.title} className="stack-xs">
                        <span className="row-between">
                          <span>{t.title}</span>
                          <strong>{t.fill}</strong>
                        </span>
                        <span className="dash-fill" aria-hidden="true">
                          <span style={{ width: t.fill }} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        )}
      </LiveFrame>
    </main>
  );
}

/**
 * One 30-day chart: the total, its change on the 30 days before, a bar a day.
 * @param {{ title: string, series: { total: string, change: { text: string, tone: string } | null, bars: string[] }, range: { from: string, middle: string, to: string } }} props
 */
function Trend({ title, series, range }) {
  return (
    <figure className="dash-chart">
      <figcaption className="row-between">
        <strong>{title}</strong>
        <span>
          <strong>{series.total}</strong>
          {series.change && (
            <>
              {' '}
              <span className={`dash-change dash-change--${series.change.tone}`}>
                {series.change.text}
              </span>
              <span className="muted"> on the 30 days before</span>
            </>
          )}
        </span>
      </figcaption>
      <div
        className="dash-bars"
        role="img"
        aria-label={`${title} each day, the last 30 days: ${series.total} in all`}
      >
        {series.bars.map((h, i) => (
          <span
            key={i}
            className={i === series.bars.length - 1 ? 'is-today' : undefined}
            style={{ height: h }}
          />
        ))}
      </div>
      <div className="row-between small muted">
        <span>{range.from}</span>
        <span>{range.middle}</span>
        <span>{range.to}</span>
      </div>
    </figure>
  );
}
