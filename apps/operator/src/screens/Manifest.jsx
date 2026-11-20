// @ts-check
/**
 * O3 · The manifest, one departure (designs: O3 Manifest, O3 Manifest — states).
 *
 *   header      back · "Sat 5 Dec · started 07:00" · PDF; the tour; who and what; "8 of 12
 *               checked in"; Scan a ticket; Search by name
 *   bookings    the lead (call), reference, where it came from, Paid / still to pay, extras;
 *               each traveller with their state: a tap moves it on, a long press opens the
 *               choices; "Add a name (optional)"; "Mark the rest of this booking no-show"
 *   cancelled   struck through: "Cancelled yesterday · don’t check in"
 *
 * Works the same offline: every tap goes into the outbox (the row says "Not sent yet ·
 * 07:08"). What a tap means is decided in lib/manifest.js; this screen only shows it.
 */
import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { Icon } from '../components/Icon.jsx';
import { Sheet } from '../components/Sheet.jsx';
import { MoneyOwed } from '../components/MoneyOwed.jsx';
import { cashChange } from '../lib/money.js';
import { stopsView, everyoneHere } from '../lib/stops.js';
import { useEngine, useNow, useSync } from '../lib/engine.jsx';
import { withChanges } from '../lib/outbox.js';
import { useLongPress } from '../lib/long-press.js';
import { openPrintable } from '../lib/print.js';
import {
  manifestView,
  stateChange,
  needsOweQuestion,
  restNoShowChange,
  nameChange,
  noShowQuestion,
  firstName,
} from '../lib/manifest.js';

/**
 * @typedef {{ kind: 'owe', b: any, t: any, to: string }
 *   | { kind: 'state', b: any, t: any }
 *   | { kind: 'name', b: any, t: any }
 *   | { kind: 'no-show', b: any }} Open
 */

export function Manifest() {
  const { id } = useParams();
  const s = useSync();
  const engine = useEngine();
  const now = useNow(30_000);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(/** @type {Open | null} */ (null));
  const [pdfError, setPdfError] = useState(false);

  const pkg = withChanges(s.pkg, s.outbox);
  const m = pkg?.departures.find((/** @type {any} */ d) => d.departure.id === id);
  const tz = pkg?.operator?.timeZone ?? 'Africa/Lagos';
  if (!m) {
    return (
      <main className="page">
        <BackToToday />
        <h1 className="h-xl">This departure isn’t saved on this phone</h1>
        <p className="muted">
          Only today’s and tomorrow’s departures you guide are saved. Ask the office if it should be
          yours.
        </p>
      </main>
    );
  }
  const v = manifestView(m, { now, tz, query });
  // A pickup tour (Lekki): by stop, in the van's order (lib/stops.js).
  const stops = stopsView(m, tz);
  /** The booking and traveller, as in the manifest (not the view): what a change is made from. */
  const raw = (/** @type {string} */ bookingId) =>
    m.bookings.find((/** @type {any} */ b) => b.id === bookingId);
  const online = s.connection === 'online';
  // "Cash reported by Femi": the person signed in on this phone.
  const guide = firstName(s.session?.user?.name ?? 'you');

  /** A tap on a traveller's pill. @param {any} bv @param {any} pv */
  function tap(bv, pv) {
    const b = raw(bv.id);
    const t = b.travellers.find((/** @type {any} */ x) => x.id === pv.id);
    if (needsOweQuestion(b, t, pv.next)) return setOpen({ kind: 'owe', b, t, to: pv.next });
    void engine.record(stateChange(m, b, t, pv.next));
  }
  /** @param {any} b @param {any} t @param {string} to @param {{ confirmOwed?: boolean, paidBy?: 'link' }} [o] */
  function setState(b, t, to, o) {
    setOpen(null);
    void engine.record(stateChange(m, b, t, /** @type {any} */ (to), o));
  }

  /** One booking's section (the same alone, or under its pickup stop). @param {any} b */
  const bookingSection = (b) => (
    <section key={b.id} className="booking">
      <div className="booking-head">
        <div className="grow">
          <div className="booking-lead">{b.lead}</div>
          <div className="small muted">
            {b.ref}
            {b.via ? ` · ${b.via}` : ''}
          </div>
          <div className="chips">
            <span className={`chip chip--${b.pay.tone}`}>{b.pay.text}</span>
            {b.extras && <span className="chip">{b.extras}</span>}
          </div>
          {b.notes.map((/** @type {string} */ n, /** @type {number} */ i) => (
            <p key={i} className="booking-note small">
              Note: {n}
            </p>
          ))}
        </div>
        {b.phone && (
          <a className="call-btn" href={`tel:${b.phone}`} aria-label={`Call ${b.lead}, ${b.phone}`}>
            <Icon name="phone" size={22} width={2} />
          </a>
        )}
      </div>
      {b.people.map((p) => (
        <div key={p.id} className="traveller">
          <div className="grow">
            <div className={p.unnamed ? 'strong muted' : 'strong'}>{p.name}</div>
            {p.unsent ? (
              <div className="small muted with-icon">
                <Icon name="clock" size={14} />
                {p.unsent}
              </div>
            ) : (
              <div className="small muted">
                {p.meta}
                {p.diet && (
                  <>
                    {' · '}
                    <strong className="warning">{p.diet}</strong>
                  </>
                )}
              </div>
            )}
            {p.unnamed && !b.locked && (
              <button
                type="button"
                className="text-link text-link--small"
                onClick={() => {
                  const rb = raw(b.id);
                  setOpen({
                    kind: 'name',
                    b: rb,
                    t: rb.travellers.find((/** @type {any} */ x) => x.id === p.id),
                  });
                }}
              >
                Add a name (optional)
              </button>
            )}
          </div>
          <StatePill
            person={p}
            locked={b.locked}
            onTap={() => tap(b, p)}
            onLong={() => {
              const rb = raw(b.id);
              setOpen({
                kind: 'state',
                b: rb,
                t: rb.travellers.find((/** @type {any} */ x) => x.id === p.id),
              });
            }}
          />
        </div>
      ))}
      {b.canMarkRest && (
        <button
          type="button"
          className="rest-no-show"
          onClick={() =>
            b.restIsWholeBooking
              ? setOpen({ kind: 'no-show', b })
              : void engine.record(restNoShowChange(m, raw(b.id)))
          }
        >
          Mark the rest of this booking no-show
        </button>
      )}
    </section>
  );

  return (
    <>
      <header className="manifest-head">
        <div className="manifest-bar">
          <BackToToday />
          <span className="grow sm muted strong-ish">{v.dateLine}</span>
          <button
            type="button"
            className="pdf-btn"
            disabled={!online}
            onClick={async () =>
              setPdfError(!(await openPrintable(m.departure.id, s.session?.token ?? '')))
            }
          >
            <Icon name="print" size={20} />
            {online ? 'PDF' : 'Needs signal'}
          </button>
        </div>
        {pdfError && (
          <p role="alert" className="field-error sm">
            The PDF didn’t open. Try again when the signal is better.
          </p>
        )}
        <h1 className="h-lg">{v.title}</h1>
        {v.sub && <div className="sm muted">{v.sub}</div>}
        <div className="count-line">
          <span className="h-time-lg">{v.checkedIn}</span>
          <span className="h-sm">
            of {v.total} {stops ? 'picked up' : 'checked in'}
          </span>
        </div>
        {stops?.next && stops.next.time && !query.trim() && (
          <div role="status" className="next-stop">
            <span className="grow">
              <span className="next-stop-tag">NEXT STOP · {stops.next.time}</span>
              <strong className="block">
                {[stops.next.area, stops.next.place].filter(Boolean).join(' · ')}
              </strong>
            </span>
            {stops.next.directions && (
              <a
                className="directions"
                href={stops.next.directions}
                target="_blank"
                rel="noreferrer"
              >
                Directions
              </a>
            )}
          </div>
        )}
        <div className="progress" aria-hidden="true">
          <div className="progress-bar" style={{ width: `${v.pct}%` }} />
        </div>
        <Link href={`/scan/${m.departure.id}`} className="btn btn--main btn--scan">
          <Icon name="scan" size={24} width={2.2} />
          Scan a ticket
        </Link>
        <label className="field field--tight">
          Search by name
          <input
            type="search"
            className="input input--search"
            placeholder="e.g. Okafor"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {v.matches !== null && (
          <div className="tiny muted" role="status">
            {v.matches} {v.matches === 1 ? 'match' : 'matches'}
          </div>
        )}
      </header>

      <main className="manifest-list">
        {stops && !query.trim()
          ? stops.stops.map((st) => (
              <section key={st.key} className={`stop stop--${st.state}`}>
                <div className="stop-head">
                  <div className="grow">
                    <div className={`eyebrow stop-tag stop-tag--${st.state}`}>{st.tag}</div>
                    <div className="booking-lead">
                      {[st.time, st.area].filter(Boolean).join(' · ')}
                    </div>
                    {st.place && <div className="small muted">{st.place}</div>}
                  </div>
                  <span className="small strong nowrap">{st.count}</span>
                </div>
                {st.bookingIds.map((id) => {
                  const b = v.bookings.find((x) => x.id === id);
                  return b ? bookingSection(b) : null;
                })}
                {st.state === 'next' && (
                  <EveryoneHere
                    stop={st}
                    onGo={(changes) => {
                      for (const c of changes) void engine.record(c);
                    }}
                    m={m}
                  />
                )}
              </section>
            ))
          : v.bookings.map((b) => bookingSection(b))}
        {v.cancelled.map((c) => (
          <section key={c.id} className="booking booking--gone">
            <div className="strong struck">{c.line}</div>
            <div className="small">{c.sub}</div>
          </section>
        ))}
        {v.bookings.length === 0 && v.cancelled.length === 0 && (
          <p className="muted center">
            {query ? `No one called “${query.trim()}” on this trip.` : 'No bookings yet.'}
          </p>
        )}
        <p className="small muted">
          Tap a traveller’s state to change it: Not yet → Present → Late → No-show. Late and No-show
          only from {v.startTime}. Hold it for all the choices.
        </p>
      </main>

      {open?.kind === 'owe' && (
        <Sheet title="Money still owed" alert center onClose={() => setOpen(null)}>
          <MoneyOwed
            b={open.b}
            guide={guide}
            onClose={() => setOpen(null)}
            onStillOwing={() => setState(open.b, open.t, open.to, { confirmOwed: true })}
            onPaidByLink={() =>
              setState(open.b, open.t, open.to, { confirmOwed: true, paidBy: 'link' })
            }
            onCash={(kobo) => {
              void engine.record(cashChange(m, open.b, kobo));
              setState(open.b, open.t, open.to, { confirmOwed: true });
            }}
          />
        </Sheet>
      )}

      {open?.kind === 'state' && (
        <Sheet title={open.t.displayName} onClose={() => setOpen(null)}>
          <div className="dialog">
            <h2 className="h-lg">{open.t.displayName}</h2>
            {[
              ['present', '✓ Present', 'btn--present'],
              ['late', v.started ? 'Late' : `Late · from ${v.startTime}`, 'btn--late'],
              [
                'no_show',
                v.started ? '✕ No-show' : `No-show · from ${v.startTime}`,
                'btn--no-show',
              ],
              ['pending', 'Not yet', 'btn--outline'],
            ]
              .filter(([state]) => state !== open.t.checkInStatus)
              .map(([state, label, look]) => (
                <button
                  key={state}
                  type="button"
                  className={`btn ${look}`}
                  disabled={!v.started && (state === 'late' || state === 'no_show')}
                  onClick={() =>
                    needsOweQuestion(open.b, open.t, /** @type {any} */ (state))
                      ? setOpen({ kind: 'owe', b: open.b, t: open.t, to: state })
                      : setState(open.b, open.t, state)
                  }
                >
                  {label}
                </button>
              ))}
            {!v.started && (
              <p className="small muted">Late and No-show unlock at the start time.</p>
            )}
            <button
              type="button"
              className="text-link text-link--plain"
              onClick={() => setOpen(null)}
            >
              Cancel
            </button>
          </div>
        </Sheet>
      )}

      {open?.kind === 'name' && (
        <NameSheet
          t={open.t}
          onClose={() => setOpen(null)}
          onSave={(name, alsoPresent) => {
            const r = nameChange(m, open.t, name);
            if (!r.ok) return r.error;
            void engine.record(r.change);
            if (alsoPresent) {
              if (needsOweQuestion(open.b, open.t, 'present'))
                setOpen({ kind: 'owe', b: open.b, t: open.t, to: 'present' });
              else setState(open.b, open.t, 'present');
            } else setOpen(null);
            return null;
          }}
        />
      )}

      {open?.kind === 'no-show' && (
        <NoShowDialog
          b={open.b}
          business={pkg.operator.name}
          onClose={() => setOpen(null)}
          onConfirm={() => {
            setOpen(null);
            void engine.record(restNoShowChange(m, raw(open.b.id)));
          }}
        />
      )}
    </>
  );
}

function BackToToday() {
  return (
    <Link href="/" className="icon-btn icon-btn--edge" aria-label="Back to Today">
      <Icon name="back" size={24} />
    </Link>
  );
}

/** @param {{ person: any, locked: boolean, onTap: () => void, onLong: () => void }} props */
function StatePill({ person, locked, onTap, onLong }) {
  const press = useLongPress({ onTap, onLong });
  return (
    <button
      type="button"
      className={`state state--${person.pill.tone}`}
      aria-label={`${person.name}: ${person.pill.label}.${locked ? '' : ' Tap to change.'}`}
      disabled={locked}
      {...(locked ? {} : press)}
    >
      {person.pill.label}
    </button>
  );
}

/** @param {{ t: any, onClose: () => void, onSave: (name: string, alsoPresent: boolean) => string | null }} props */
function NameSheet({ t, onClose, onSave }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const pending = t.checkInStatus === 'pending';
  return (
    <Sheet title={t.displayName} onClose={onClose}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          setError(onSave(name, pending));
        }}
      >
        <h2 className="h-lg">{t.displayName}</h2>
        <label className="field">
          Name
          <input
            className="input"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </label>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <p className="small muted">Optional. It goes on the booking when this phone syncs.</p>
        {pending && (
          <button type="submit" className="btn btn--present">
            Save and mark present
          </button>
        )}
        <button
          type="button"
          className="btn btn--outline"
          onClick={() => setError(onSave(name, false))}
        >
          Save name only
        </button>
        <button type="button" className="text-link text-link--plain" onClick={onClose}>
          Skip
        </button>
      </form>
    </Sheet>
  );
}

/** @param {{ b: any, business: string, onClose: () => void, onConfirm: () => void }} props */
function NoShowDialog({ b, business, onClose, onConfirm }) {
  const q = noShowQuestion(b, business);
  return (
    <Sheet title={q.title} alert center onClose={onClose}>
      <div className="dialog">
        <h2 className="h-lg">{q.title}</h2>
        <p className="muted">{q.body}</p>
        <button type="button" className="btn btn--no-show" onClick={onConfirm}>
          Mark no-show
        </button>
        <button type="button" className="btn btn--outline" onClick={onClose}>
          Wait a bit longer
        </button>
        <p className="tiny muted">Works offline; sends with the other changes.</p>
      </div>
    </Sheet>
  );
}

/**
 * "Everyone here: check in 4" at the next stop. A booking that owes money is left out: its
 * people are checked in one by one, so the money question is asked.
 * @param {{ m: any, stop: any, onGo: (changes: any[]) => void }} props
 */
function EveryoneHere({ m, stop, onGo }) {
  const { changes, count, owing } = everyoneHere(m, stop);
  if (count === 0) {
    return owing.length ? (
      <p className="small muted stop-note">
        {owing.map((b) => b.lead.name).join(', ')} still {owing.length === 1 ? 'owes' : 'owe'}{' '}
        money: tap each name to check in.
      </p>
    ) : null;
  }
  return (
    <>
      <button type="button" className="everyone" onClick={() => onGo(changes)}>
        Everyone here: check in {count}
      </button>
      {owing.length > 0 && (
        <p className="small muted stop-note">
          Not {owing.map((b) => b.lead.name).join(', ')}: still{' '}
          {owing.length === 1 ? 'owes' : 'owe'} money.
        </p>
      )}
    </>
  );
}
