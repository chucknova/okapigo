// @ts-check
/**
 * O8 · Bookings, the desk (designs: O8 Bookings — desktop; phone and states; every status;
 * Booking actions. Stage 16c-1).
 *
 *   wide screen   the list on the left (search, filters, a row per booking with its status),
 *                 the open booking on the right
 *   phone         the list; tap a booking for its page, "‹ Bookings" to go back
 *
 * A booking's page: who and what, its status and the banner saying what needs doing, the
 * money, the travellers, the messages sent and whether they arrived, the timeline, and the
 * actions (16c-1: notes, no-shows, releasing held seats; the money in 16c-2; changing
 * travellers in 16c-3). The words come from the server (packages/db/src/desk.js) and
 * lib/desk.js; changes go straight to the server (lib/office.js).
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { LiveFrame } from '../components/LiveFrame.jsx';
import { Sheet } from '../components/Sheet.jsx';
import { useLive } from '../lib/live.js';
import { useEngine, useSync } from '../lib/engine.jsx';
import { act, actionError } from '../lib/office.js';
import {
  FILTERS,
  actionButtons,
  chipText,
  heldLeft,
  listPath,
  noMatch,
  noShowLabel,
  resultsLine,
} from '../lib/desk.js';

/** The time now, every `ms` (the held countdown). @param {number} ms @param {boolean} on */
function useNow(ms, on) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}

/** What was typed, once typing pauses (one request per search, not per letter). @param {string} value */
function useSettled(value, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export function Bookings() {
  const { id } = useParams();
  const s = useSync();
  const tz = s.me?.operator?.timeZone ?? 'Africa/Lagos';
  const [filter, setFilter] = useState('today');
  const [typed, setTyped] = useState('');
  const q = useSettled(typed);
  const list = useLive(listPath(filter, q));
  return (
    <main className={`page desk${id ? ' desk--open' : ''}`}>
      <section className="desk-list" aria-label="Bookings">
        <div className="desk-list-head">
          <h1 className="h-xl">Bookings</h1>
          <label className="field field--tight">
            Search
            <input
              className="input input--search"
              type="search"
              placeholder="Reference, name or phone"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
          <div role="group" aria-label="Filters" className="filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="filter"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <LiveFrame live={list} what="Bookings" tz={tz}>
          {({ list: l }) => (
            <>
              {l.rows.length > 0 && resultsLine(l.rows.length, l.q) && (
                <p className="small muted desk-results">{resultsLine(l.rows.length, l.q)}</p>
              )}
              {l.rows.length === 0 ? (
                <div className="desk-none">
                  <p className="strong">{noMatch(l.filter, l.q)}</p>
                  {l.q && (
                    <p className="small muted">
                      Try a phone number, a reference, or another spelling.
                    </p>
                  )}
                  {l.filter !== 'all' && l.q && (
                    <button type="button" className="text-link" onClick={() => setFilter('all')}>
                      Search all bookings (past and cancelled)
                    </button>
                  )}
                </div>
              ) : (
                <ul className="desk-rows">
                  {l.rows.map((/** @type {any} */ r) => (
                    <li key={r.id}>
                      <DeskRow r={r} open={r.id === id} />
                    </li>
                  ))}
                </ul>
              )}
              {l.more && (
                <p className="small muted desk-results">
                  Showing the first 100. Search to find others.
                </p>
              )}
            </>
          )}
        </LiveFrame>
      </section>
      {id ? (
        <BookingPane id={id} tz={tz} />
      ) : (
        <p className="desk-pick wide-only muted">Choose a booking to see it here.</p>
      )}
    </main>
  );
}

/** One row: lead, status, reference · tour (and the phone, on a phone). @param {{ r: any, open: boolean }} props */
function DeskRow({ r, open }) {
  const now = useNow(1000, r.chip.key === 'held');
  return (
    <Link
      href={`/bookings/${r.id}`}
      className={`desk-row${open ? ' is-open' : ''}`}
      aria-current={open ? 'page' : undefined}
    >
      <span className="row-between">
        <strong>{r.lead}</strong>
        <span className={`status-chip status-chip--${r.chip.tone}`}>{chipText(r.chip, now)}</span>
      </span>
      <span className="small muted">
        {r.reference} · {r.tour}
      </span>
      {r.phone && <span className="small muted narrow-only">{r.phone}</span>}
    </Link>
  );
}

/** @param {{ id: string, tz: string }} props */
function BookingPane({ id, tz }) {
  const live = useLive(`/api/desk/bookings/${id}`);
  return (
    <section className="desk-page" aria-label="Booking">
      <Link href="/bookings" className="back-link narrow-only">
        ‹ Bookings
      </Link>
      <LiveFrame live={live} what="This booking" tz={tz}>
        {({ booking: b }) => <BookingPage key={b.id} b={b} />}
      </LiveFrame>
    </section>
  );
}

/** @param {{ b: any }} props */
function BookingPage({ b }) {
  const engine = useEngine();
  const [sheet, setSheet] = useState(/** @type {'note' | 'noShow' | null} */ (null));
  const [done, setDone] = useState(/** @type {string | null} */ (null));
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const now = useNow(1000, b.chip.key === 'held');
  const buttons = actionButtons(b.actions);

  /** @param {string} path @param {{ method: 'POST' | 'DELETE', body?: unknown }} o @param {string} said */
  const change = async (path, o, said) => {
    setError(null);
    const r = await act(engine, path, o);
    if (!r.ok) {
      setError(actionError(r.error));
      return false;
    }
    setSheet(null);
    setDone(said);
    return true;
  };

  return (
    <article className="stack-md">
      <header>
        <div className="eyebrow">{b.refLine}</div>
        <div className="row-between row-start">
          <h2 className="h-xl">{b.lead}</h2>
          <span className={`status-chip status-chip--${b.chip.tone} status-chip--big`}>
            {chipText(b.chip, now)}
          </span>
        </div>
        <div className="muted">{b.sub}</div>
      </header>
      {done && (
        <p role="status" className="done-note">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}

      {b.banner && (
        <section
          className={`desk-banner desk-banner--${b.banner.tone}`}
          aria-label={b.banner.title}
        >
          <strong className="desk-banner-title">
            {b.banner.kind === 'held'
              ? `${b.banner.title} (${heldLeft(b.banner.expiresAt, now)} left)`
              : b.banner.title}
          </strong>
          <p>{b.banner.text}</p>
          <div className="desk-banner-btns">
            {b.banner.kind === 'held' && (
              <button
                type="button"
                className="btn btn--outline btn--compact"
                onClick={() =>
                  change(`/api/holds/${b.holdId}`, { method: 'DELETE' }, 'Seats released.')
                }
              >
                Release the seats now
              </button>
            )}
            {b.banner.call && (
              <a
                className="btn btn--outline btn--compact"
                href={`tel:${b.banner.call.replace(/\s/g, '')}`}
              >
                Call {b.banner.call}
              </a>
            )}
          </div>
        </section>
      )}

      <div className="desk-grid">
        <section className="panel panel--pad">
          <h3 className="h-md">Money</h3>
          <table className="money-table">
            <tbody>
              {b.money.map((/** @type {any} */ m, /** @type {number} */ i) => (
                <tr key={i} className={m.total ? 'money-total' : ''}>
                  <td>{m.label}</td>
                  <td className={`right tone--${m.tone}`}>{m.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel panel--pad">
          <h3 className="h-md">Travellers</h3>
          <ul className="plain-list">
            {b.travellers.map((/** @type {any} */ t) => (
              <li key={t.id} className="row-between">
                <span>
                  <span className="strong">{t.name}</span> · {t.kind}
                </span>
                <span className={`strong tone--${t.state.tone}`}>{t.state.text}</span>
              </li>
            ))}
          </ul>
          {b.checkedInBy && <p className="small muted">{b.checkedInBy}</p>}
        </section>
      </div>

      <section className="panel panel--pad">
        <h3 className="h-md">Messages sent</h3>
        {b.messages.length === 0 ? (
          <p className="sm muted">Nothing sent yet.</p>
        ) : (
          <ul className="plain-list messages-list">
            {b.messages.map((/** @type {any} */ m) => (
              <li key={m.id}>
                <span className="muted">{m.date}</span>
                <span>{m.what}</span>
                <span className={`strong tone--${m.tone}`}>{m.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel panel--pad">
        <h3 className="h-md">Timeline</h3>
        <ol className="timeline">
          {b.timeline.map((/** @type {string} */ t, /** @type {number} */ i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      </section>

      <div className="desk-actions">
        {buttons.map((x) => (
          <span key={x.key} className={`desk-action${x.enabled ? '' : ' is-off'}`}>
            <button
              type="button"
              className="btn btn--outline btn--compact"
              disabled={!x.enabled}
              onClick={() => setSheet(/** @type {any} */ (x.key === 'addNote' ? 'note' : 'noShow'))}
            >
              {x.label}
            </button>
            {!x.enabled && x.why && <span className="small muted">{x.why}</span>}
          </span>
        ))}
      </div>

      {sheet === 'note' && (
        <NoteSheet
          b={b}
          error={error}
          onClose={() => setSheet(null)}
          onSave={(text, onManifest) =>
            change(
              `/api/bookings/${b.id}/notes`,
              { method: 'POST', body: { text, onManifest } },
              onManifest ? 'Note saved, and on the guide’s manifest.' : 'Note saved.',
            )
          }
        />
      )}
      {sheet === 'noShow' && (
        <NoShowSheet
          b={b}
          error={error}
          onClose={() => setSheet(null)}
          onMark={(ids) =>
            change(
              `/api/departures/${b.departureId}/check-ins`,
              { method: 'POST', body: { bookingId: b.id, travellerIds: ids, status: 'no_show' } },
              `${ids.length} marked a no-show.`,
            )
          }
        />
      )}
    </article>
  );
}

/** "Add a note" (designs: Booking actions). @param {{ b: any, error: string | null, onClose: () => void, onSave: (text: string, onManifest: boolean) => Promise<boolean> }} props */
function NoteSheet({ b, error, onClose, onSave }) {
  const [text, setText] = useState('');
  const [onManifest, setOnManifest] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Add a note" onClose={onClose}>
      <form
        className="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onSave(text, onManifest);
          setBusy(false);
        }}
      >
        <h2 className="h-lg">Note on {b.reference}</h2>
        <label className="field">
          Note
          <textarea
            className="textarea"
            rows={4}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={onManifest}
            onChange={(e) => setOnManifest(e.target.checked)}
          />
          Show on the guide’s manifest
        </label>
        <p className="small muted">
          Guests never see notes. Each note shows who wrote it and when, on the timeline.
        </p>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--dark" disabled={busy || !text.trim()}>
          {busy ? 'Saving…' : 'Save note'}
        </button>
      </form>
    </Sheet>
  );
}

/** "Who didn't come?" (designs: Mark no-show from the desk). @param {{ b: any, error: string | null, onClose: () => void, onMark: (ids: string[]) => Promise<boolean> }} props */
function NoShowSheet({ b, error, onClose, onMark }) {
  const [picked, setPicked] = useState(
    /** @type {string[]} */ (
      b.travellers
        .filter((/** @type {any} */ t) => t.checkInStatus === 'pending')
        .map((/** @type {any} */ t) => t.id)
    ),
  );
  const [busy, setBusy] = useState(false);
  const label = noShowLabel(b.travellers, picked);
  return (
    <Sheet title="Who didn’t come?" onClose={onClose}>
      <form
        className="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onMark(picked);
          setBusy(false);
        }}
      >
        <h2 className="h-lg">Who didn’t come?</h2>
        <p className="muted">{b.sub}</p>
        {b.travellers.map((/** @type {any} */ t) =>
          t.checkInStatus === 'pending' ? (
            <label key={t.id} className="check-row">
              <input
                type="checkbox"
                checked={picked.includes(t.id)}
                onChange={(e) =>
                  setPicked(e.target.checked ? [...picked, t.id] : picked.filter((x) => x !== t.id))
                }
              />
              {t.name} · not checked in
            </label>
          ) : (
            <p key={t.id} className="check-row is-off">
              {t.name} · {t.state.text.toLowerCase() || t.checkInStatus}
            </p>
          ),
        )}
        {b.noShowLine && <p className="small">{b.noShowLine}</p>}
        <p className="small muted">
          If the guide’s phone marks someone later, yours stands and theirs shows as a conflict. To
          undo, set them back on the manifest.
        </p>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="btn btn--danger"
          disabled={busy || label === 'Choose who didn’t come'}
        >
          {busy ? 'Marking…' : label}
        </button>
      </form>
    </Sheet>
  );
}
