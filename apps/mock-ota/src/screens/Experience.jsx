// @ts-check
/**
 * M2 · One experience (designs: "Sojourna — Tarkwa Bay Beach and Lagoon Trip").
 *
 *   1. a date      a month at a time: open days bold, few seats "4 left", sold out struck
 *   2. a time      that day's departures, with the seats left
 *   3. who         a counter per unit (adult, child, infant), with the supplier's rules: a child
 *                  or infant needs an adult; nobody beyond the seats left (infants need a seat)
 *   pickup         a tour that collects guests asks where (M2 state "choose a pickup point")
 *   Continue       holds the seats for 15 minutes (OCTO reserve) and goes to checkout; seats
 *                  that went meanwhile say so ("Someone just took the last seats")
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useLoad } from '../lib/use-load.js';
import { api } from '../lib/api.js';
import {
  checkWho,
  dateLabel,
  durationWords,
  firstWord,
  meetingPointOf,
  monthGrid,
  monthLabel,
  monthRange,
  naira,
  policyWords,
  seatsLabel,
  shiftMonth,
  timeOf,
  totalKobo,
  unitPrice,
  whoWords,
} from '../lib/words.js';
import { justTaken, offline } from '../lib/states.js';
import { StatePanel } from '../components/StatePanel.jsx';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Today's year and month where the tour is. @param {string} tz */
function thisMonth(tz) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()).split('-');
  return { year: Number(y), month: Number(m) };
}

/** @param {{ id: string }} props */
export function Experience({ id }) {
  const [, navigate] = useLocation();
  const supplier = useLoad('/api/supplier');
  const product = useLoad(`/api/experiences/${id}`);
  const p = product.data?.experience;
  const name = supplier.data?.supplier?.name ?? 'The operator';
  const [month, setMonth] = useState(/** @type {{ year: number, month: number } | null} */ (null));
  // What the guest picked (null: not yet; the defaults below are worked out while drawing, so a
  // quick click can never be overwritten by them: found by journey 3).
  const [picked, setDate] = useState(/** @type {string | null} */ (null));
  const [timeId, setTimeId] = useState(/** @type {string | null} */ (null));
  const [chosen, setCounts] = useState(/** @type {Record<string, number> | null} */ (null));
  const [pickup, setPickup] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(/** @type {any} */ (null));

  useEffect(() => {
    if (p && !month) setMonth(thisMonth(p.timeZone ?? 'Africa/Lagos'));
  }, [p, month]);
  const range = month ? monthRange(month.year, month.month) : null;
  const calendar = useLoad(
    range ? `/api/experiences/${id}/calendar?from=${range.from}&to=${range.to}` : null,
  );
  const grid = month && calendar.data ? monthGrid(month.year, month.month, calendar.data.days) : [];
  // The first open day of the month shown, until the guest picks one.
  const date = picked ?? grid.find((c) => c?.state === 'open')?.date ?? null;
  const times = useLoad(date ? `/api/experiences/${id}/times?date=${date}` : null);
  const slots = /** @type {any[]} */ (times.data?.times ?? []);
  const slot = slots.find((t) => t.id === timeId) ?? slots.find((t) => t.available) ?? null;

  const option = p?.options?.[0];
  const units = /** @type {any[]} */ (option?.units ?? []);
  // Two adults to start (designs), until the guest changes it.
  const counts = chosen ?? (units.length ? { [units[0].id]: 2 } : {});

  if (product.error || supplier.error) {
    const e = product.error ?? supplier.error;
    return (
      <main className="page">
        {e?.problem === 'offline' ? (
          <StatePanel {...offline(name)}>
            <button type="button" className="btn btn--blue" onClick={() => product.reload()}>
              Try again
            </button>
          </StatePanel>
        ) : (
          <StatePanel
            tone="info"
            tag="NOT LISTED"
            title="This experience isn’t on Sojourna now"
            body={e?.message ?? ''}
          >
            <Link href="/" className="btn btn--line">
              See other experiences
            </Link>
          </StatePanel>
        )}
      </main>
    );
  }
  if (!p || !month) return <main className="page" aria-busy="true" />;

  const left = slot ? slot.vacancies : null;
  const who = checkWho(units, counts, left);
  const needsPickup = Boolean(option?.pickupRequired);
  const ready = who.ok && slot && (!needsPickup || pickup);
  const meet = meetingPointOf(p);
  const total = totalKobo(units, counts);
  /** @param {string} unitId @param {number} by */
  const change = (unitId, by) =>
    setCounts({ ...counts, [unitId]: Math.max(0, (counts[unitId] ?? 0) + by) });

  const hold = async () => {
    if (!ready || !slot) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await api('/api/holds', {
        method: 'POST',
        body: { productId: p.id, availabilityId: slot.id, units: counts, pickupLocationId: pickup },
      });
      navigate(`/checkout/${r.booking.uuid}`);
    } catch (err) {
      setBusy(false);
      setProblem(err);
      times.reload();
      calendar.reload();
    }
  };

  return (
    <main className="page page--two">
      <div className="stack-md">
        <Link href="/" className="small strong">
          ‹ All experiences by {name}
        </Link>
        <div>
          <div className="small muted">
            by {name}
            {p.durationMinutesFrom ? ` · ${durationWords(p.durationMinutesFrom)}` : ''}
            {meet ? ` · ${meet.name}` : ''}
          </div>
          <h1 className="h1">{p.title}</h1>
        </div>
        {p.description && <p className="lead">{p.description}</p>}

        <section className="box" aria-label="Choose a date">
          <div className="row-between">
            <h2 className="h2">1. Choose a date</h2>
            <div className="month-nav">
              <button
                type="button"
                className="round"
                aria-label="Previous month"
                onClick={() => {
                  setMonth(shiftMonth(month.year, month.month, -1));
                  setDate(null);
                }}
              >
                ‹
              </button>
              <strong>{monthLabel(month.year, month.month)}</strong>
              <button
                type="button"
                className="round"
                aria-label="Next month"
                onClick={() => {
                  setMonth(shiftMonth(month.year, month.month, 1));
                  setDate(null);
                }}
              >
                ›
              </button>
            </div>
          </div>
          <div className="calendar">
            {DOW.map((d) => (
              <div key={d} className="dow">
                {d}
              </div>
            ))}
            {grid.map((c, i) =>
              c ? (
                <button
                  key={c.date}
                  type="button"
                  className={`day day--${c.state}`}
                  disabled={c.state !== 'open'}
                  aria-label={c.aria}
                  aria-pressed={c.date === date}
                  onClick={() => {
                    setDate(c.date);
                    setTimeId(null);
                    setProblem(null);
                  }}
                >
                  <span className="day-n">{c.n}</span>
                  <span className="day-sub">{c.sub}</span>
                </button>
              ) : (
                <span key={`pad-${i}`} />
              ),
            )}
          </div>
          <div className="legend small muted">
            <span>
              <strong className="blue">Bold</strong> = open
            </span>
            <span>Grey = not running</span>
            <span>
              <s>Struck</s> = sold out
            </span>
          </div>
        </section>

        {date && (
          <section className="box" aria-label="Choose a time">
            <h2 className="h2">2. Time on {dateLabel(date)}</h2>
            {slots.length === 0 && !times.loading ? (
              <p className="muted">Nothing running that day.</p>
            ) : (
              <div className="row-wrap">
                {slots.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="slot"
                    disabled={!t.available}
                    aria-pressed={slot?.id === t.id}
                    onClick={() => setTimeId(t.id)}
                  >
                    <strong>{timeOf(t.localDateTimeStart)}</strong>
                    <span className={`small strong ${t.vacancies <= 4 ? 'bad' : 'ok'}`}>
                      {t.available ? seatsLabel(t.vacancies) : 'Sold out'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="box box--units" aria-label="Who’s coming">
          <h2 className="h2">3. Who’s coming</h2>
          {units.map((u) => (
            <div key={u.id} className="unit">
              <div>
                <div className="strong">{u.title}</div>
                <div className="small muted">{unitPrice(u)}</div>
              </div>
              <div className="counter">
                <button
                  type="button"
                  className="round round--big"
                  aria-label={`Fewer: ${u.title}`}
                  onClick={() => change(u.id, -1)}
                >
                  −
                </button>
                <strong className="count">{counts[u.id] ?? 0}</strong>
                <button
                  type="button"
                  className="round round--big"
                  aria-label={`More: ${u.title}`}
                  onClick={() => change(u.id, 1)}
                >
                  +
                </button>
              </div>
            </div>
          ))}
          {who.noAdult && (
            <div role="alert" className="note note--bad">
              {name} requires children and infants to travel with an adult.
            </div>
          )}
          {who.tooMany && slot && (
            <div role="alert" className="note note--warn">
              Only {left} {left === 1 ? 'seat' : 'seats'} left at {timeOf(slot.localDateTimeStart)}.
              Infants need a seat too.
            </div>
          )}
        </section>

        {needsPickup && (
          <section className="box" aria-label="Where should the van collect you?">
            <div className="tag tag--info">REQUIRED</div>
            <h2 className="h2">Where should the van collect you?</h2>
            <div className="row-wrap">
              {option.pickupLocations.map((/** @type {any} */ l) => (
                <button
                  key={l.id}
                  type="button"
                  className="slot"
                  aria-pressed={pickup === l.id}
                  onClick={() => setPickup(l.id)}
                >
                  <strong>{l.title}</strong>
                  {l.shortDescription && <span className="small muted">{l.shortDescription}</span>}
                </button>
              ))}
            </div>
          </section>
        )}

        {problem &&
          (problem.problem === 'taken' ? (
            <StatePanel
              {...justTaken(
                problem.body.vacancies ?? 0,
                slot ? timeOf(slot.localDateTimeStart) : '',
              )}
            >
              <button type="button" className="btn btn--blue" onClick={() => setProblem(null)}>
                Choose again
              </button>
            </StatePanel>
          ) : problem.problem === 'offline' ? (
            <StatePanel {...offline(name)}>
              <button type="button" className="btn btn--blue" onClick={hold}>
                Try again
              </button>
            </StatePanel>
          ) : (
            <p role="alert" className="note note--bad">
              {problem.message}
            </p>
          ))}
      </div>

      <aside className="summary" aria-label="Your selection">
        <div className="small muted">Your selection</div>
        <div className="summary-title">{p.title}</div>
        <div>
          {date ? dateLabel(date) : 'Choose a date'}
          {slot ? ` · ${timeOf(slot.localDateTimeStart)}` : ''}
        </div>
        <div className="muted">{whoWords(units, counts)}</div>
        <div className="summary-total">
          <span className="strong">Total</span>
          <strong className="big">{naira(total)}</strong>
        </div>
        <div className="small muted">Price from {name}, including VAT. No booking fees.</div>
        <div className="policy">
          <strong>Cancellation ({firstWord(name)}’s policy):</strong>{' '}
          {policyWords(option?.refundRules)}
        </div>
        <button
          type="button"
          className="btn btn--blue btn--big"
          disabled={!ready || busy}
          onClick={hold}
        >
          {busy ? 'Holding your seats…' : 'Continue'}
        </button>
        <div className="small muted center">Continue holds your seats for 15 minutes.</div>
      </aside>
    </main>
  );
}
