// @ts-check
/**
 * O7 · A departure, for the office (designs: O7 Departure — desktop; phone and states; 16b).
 *
 *   the numbers     booked · held right now · seats left · van/boat seats
 *   who's booked    lead, people, extras and dietary needs, paid or owing
 *   notes           for the guide: shown on their manifest and the PDF
 *   guide           free ones to choose; busy ones say where ("on the Badagry trip until 17:00")
 *   van or boat     only the tour's kind; busy, too small or wrong say why, and can't be chosen
 *   cancel          for weather: everyone refunded in full, guests told, guide and van freed
 *
 * Changes go straight to the server (lib/office.js) and every screen reloads. If two people
 * assign at once, the server says who got there first, and the lists refresh.
 */
import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { LiveFrame } from '../components/LiveFrame.jsx';
import { Sheet } from '../components/Sheet.jsx';
import { useLive } from '../lib/live.js';
import { useEngine, useSync } from '../lib/engine.jsx';
import { act, actionError } from '../lib/office.js';
import { assignLabel, cancelSentence, cancelledText } from '../lib/board.js';
import { openPrintable } from '../lib/print.js';

export function Departure() {
  const { id } = useParams();
  const s = useSync();
  const tz = s.me?.operator?.timeZone ?? 'Africa/Lagos';
  const overview = useLive(`/api/departures/${id}/overview`);
  const options = useLive(`/api/departures/${id}/options`);
  return (
    <LiveFrame live={overview} what="This departure" tz={tz}>
      {({ departure: d }) => <DeparturePage d={d} options={options.entry.data?.options ?? null} />}
    </LiveFrame>
  );
}

/** @param {{ d: any, options: any }} props */
function DeparturePage({ d, options }) {
  const engine = useEngine();
  const s = useSync();
  const [sheet, setSheet] = useState(/** @type {'guide' | 'vehicle' | 'cancel' | null} */ (null));
  const [done, setDone] = useState(/** @type {string | null} */ (null));
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const cancelled = d.status === 'cancelled';
  const business = s.me?.operator?.name ?? 'We';

  /** @param {Record<string, unknown>} body */
  const assign = async (body) => {
    setError(null);
    const r = await act(engine, `/api/departures/${d.id}/assignment`, { method: 'PUT', body });
    if (!r.ok) setError(actionError(r.error));
    else setSheet(null);
    return r.ok;
  };

  return (
    <main className="page departure">
      <Link href="/schedule" className="back-link">
        ‹ <span className="wide-only">Schedule</span>
        <span className="narrow-only">{d.dayLabel}</span>
      </Link>
      <header className="departure-head">
        <div>
          <h1 className="h-xl">{d.title}</h1>
          <div className="muted">
            <span className="wide-only">{d.when}</span>
            <span className="narrow-only">{d.times}</span>
            {d.meetingPoint ? ` · ${d.meetingPoint}` : ''}
          </div>
          {cancelled && (
            <p className="cancelled-line">
              Cancelled{d.cancelReason ? ` because of ${d.cancelReason}` : ''}. Guests were told and
              refunded.
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn btn--outline btn--compact wide-only"
          onClick={() => openPrintable(d.id, s.session?.token ?? '')}
        >
          Manifest and PDF
        </button>
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

      <div className="departure-grid">
        <div className="stack-md">
          <div className="numbers">
            <Stat value={d.numbers.booked} label="booked" />
            <Stat
              value={d.numbers.held}
              label={
                <>
                  <span className="wide-only">held right now</span>
                  <span className="narrow-only">held</span>
                </>
              }
            />
            <Stat
              value={d.numbers.left}
              label={
                <>
                  <span className="wide-only">seats left</span>
                  <span className="narrow-only">left</span>
                </>
              }
            />
            <span className="wide-only">
              <Stat value={d.numbers.seats} label={d.numbers.seatsLabel} />
            </span>
          </div>

          {/* A phone: the guide and the van as rows that open a sheet. */}
          {!cancelled && (
            <div className="narrow-only stack-sm">
              <button
                type="button"
                className={`pick-row${d.guide ? '' : ' pick-row--alert'}`}
                onClick={() => setSheet('guide')}
              >
                <span>
                  <span className="eyebrow block">Guide</span>
                  <strong className={d.guide ? '' : 'tone--urgent'}>
                    {d.guide ? d.guide.name : 'Not assigned'}
                  </strong>
                </span>
                <span className="strong primary-ink">{d.guide ? 'Change ›' : 'Assign ›'}</span>
              </button>
              {d.transport !== 'on_foot' && (
                <button type="button" className="pick-row" onClick={() => setSheet('vehicle')}>
                  <span>
                    <span className="eyebrow block">Van or boat</span>
                    <strong>
                      {d.resource
                        ? `${d.resource.name} · ${d.resource.seats} seats`
                        : 'Not assigned'}
                    </strong>
                  </span>
                  <span className="strong primary-ink">{d.resource ? 'Change ›' : 'Choose ›'}</span>
                </button>
              )}
              <button
                type="button"
                className="pick-row"
                onClick={() => openPrintable(d.id, s.session?.token ?? '')}
              >
                <strong>
                  {d.rows.length} {d.rows.length === 1 ? 'booking' : 'bookings'} · manifest
                </strong>
                <span className="strong primary-ink">Open ›</span>
              </button>
            </div>
          )}

          <section className="panel panel--pad wide-only">
            <h2 className="h-md">Who’s booked</h2>
            {d.channelsLine && <p className="small muted">{d.channelsLine}</p>}
            {d.rows.length === 0 ? (
              <p className="sm muted">Nobody yet.</p>
            ) : (
              <table className="who-table">
                <tbody>
                  {d.rows.map((/** @type {any} */ r) => (
                    <tr key={r.id}>
                      <td className="strong">{r.lead}</td>
                      <td className="muted">{r.people}</td>
                      <td className={r.via ? 'strong' : 'muted'}>{r.channel}</td>
                      <td className="muted">{r.extras}</td>
                      <td
                        className={`right strong tone--${r.payTone === 'owes' ? 'warning' : 'ok'}`}
                      >
                        {r.pay}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {d.extrasLine && <p className="small muted extras-line">{d.extrasLine}</p>}
          </section>

          <Notes d={d} disabled={cancelled} onError={setError} />

          {!cancelled && (
            <section className="danger-zone">
              <div className="wide-only">
                <h2 className="h-md">Cancel this departure</h2>
                <p className="muted">
                  {d.cancel.bookings} {d.cancel.bookings === 1 ? 'booking' : 'bookings'} refunded in
                  full ({d.cancel.refundText}). {d.cancel.toldLine}.
                </p>
              </div>
              <button
                type="button"
                className="btn btn--danger-outline"
                onClick={() => setSheet('cancel')}
              >
                Cancel departure
              </button>
            </section>
          )}
        </div>

        {/* A wide screen: choosing the guide and the van right here. */}
        {!cancelled && options && (
          <div className="stack-md wide-only">
            <GuidePicker d={d} options={options} onAssign={(guideId) => assign({ guideId })} />
            {d.transport !== 'on_foot' && (
              <VehiclePicker
                d={d}
                options={options}
                onAssign={(resourceId) => assign({ resourceId })}
              />
            )}
          </div>
        )}
      </div>

      {sheet === 'guide' && options && (
        <Sheet title="Choose a guide" onClose={() => setSheet(null)}>
          <div className="dialog">
            <h2 className="h-lg">Guide for {options.title}</h2>
            <GuideList d={d} options={options} onPick={(gid) => assign({ guideId: gid })} />
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
          </div>
        </Sheet>
      )}
      {sheet === 'vehicle' && options && (
        <Sheet title="Choose a van or boat" onClose={() => setSheet(null)}>
          <div className="dialog">
            <h2 className="h-lg">{options.vehicleTitle}</h2>
            <VehicleList options={options} onPick={(rid) => assign({ resourceId: rid })} />
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
          </div>
        </Sheet>
      )}
      {sheet === 'cancel' && (
        <CancelDialog
          d={d}
          business={business}
          onClose={() => setSheet(null)}
          onCancelled={(text) => {
            setSheet(null);
            setDone(text);
          }}
        />
      )}
    </main>
  );
}

/** @param {{ value: number, label: import('react').ReactNode }} props */
function Stat({ value, label }) {
  return (
    <div className="number">
      <div className="number-v">{value}</div>
      <div className="number-l">{label}</div>
    </div>
  );
}

/** Notes for the guide (shown on their manifest and the PDF). @param {{ d: any, disabled: boolean, onError: (e: string | null) => void }} props */
function Notes({ d, disabled, onError }) {
  const engine = useEngine();
  const [text, setText] = useState(d.notes ?? '');
  const [saved, setSaved] = useState(false);
  const changed = text.trim() !== (d.notes ?? '').trim();
  return (
    <section className="panel panel--pad">
      <label className="field">
        Notes for the guide
        <textarea
          className="textarea"
          rows={3}
          maxLength={500}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
        />
        <span className="small muted plain">
          Shown at the top of the guide’s manifest and the PDF.
        </span>
      </label>
      {changed && !disabled && (
        <button
          type="button"
          className="btn btn--dark btn--compact"
          onClick={async () => {
            onError(null);
            const r = await act(engine, `/api/departures/${d.id}/assignment`, {
              method: 'PUT',
              body: { notes: text },
            });
            if (!r.ok) onError(actionError(r.error));
            else setSaved(true);
          }}
        >
          Save the notes
        </button>
      )}
      {saved && !changed && <p className="small success strong">Saved.</p>}
    </section>
  );
}

/** The guide, chosen right on the page (a wide screen). @param {{ d: any, options: any, onAssign: (id: string | null) => Promise<boolean> }} props */
function GuidePicker({ d, options, onAssign }) {
  const free = options.guides.filter((/** @type {any} */ g) => g.state !== 'busy');
  const [picked, setPicked] = useState(
    /** @type {string | null} */ (d.guide?.id ?? free[0]?.id ?? null),
  );
  const guide = options.guides.find((/** @type {any} */ g) => g.id === picked);
  return (
    <fieldset className={`picker${d.guide ? '' : ' picker--alert'}`}>
      <legend className="picker-legend">
        Guide {!d.guide && <span className="tone--urgent small">· not assigned</span>}
      </legend>
      {options.guides.map((/** @type {any} */ g) => (
        <label
          key={g.id}
          className={`option option--${g.state}${picked === g.id ? ' is-picked' : ''}`}
        >
          <input
            type="radio"
            name="guide"
            checked={picked === g.id}
            disabled={g.state === 'busy'}
            onChange={() => setPicked(g.id)}
          />
          <span className="grow">
            <span className="block strong-heavy">{g.name}</span>
            <span className="small">{g.why}</span>
          </span>
        </label>
      ))}
      <button
        type="button"
        className="btn btn--main btn--compact"
        disabled={!guide || d.guide?.id === guide.id}
        onClick={() => guide && onAssign(guide.id)}
      >
        {assignLabel(guide, d.guide)}
      </button>
      <p className="small muted">They’ll see it on their phone next time it syncs.</p>
    </fieldset>
  );
}

/** The van or boat, chosen right on the page (a wide screen). @param {{ d: any, options: any, onAssign: (id: string) => Promise<boolean> }} props */
function VehiclePicker({ d, options, onAssign }) {
  return (
    <fieldset className="picker">
      <legend className="picker-legend">Van or boat</legend>
      {options.resources.length === 0 && <NoVehicles />}
      {options.resources.map((/** @type {any} */ r) => (
        <label
          key={r.id}
          className={`option option--${r.state}${r.state === 'assigned' ? ' is-picked' : ''}`}
        >
          <input
            type="radio"
            name="vehicle"
            checked={d.resource?.id === r.id}
            disabled={r.state !== 'free' && r.state !== 'assigned'}
            onChange={() => onAssign(r.id)}
          />
          <span className="grow">
            <span className="block strong-heavy">{r.label}</span>
            <span className="small">{r.why}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** The guides, in a sheet (a phone): free ones to tap; busy ones say where. @param {{ d: any, options: any, onPick: (id: string) => void }} props */
function GuideList({ d, options, onPick }) {
  const free = options.guides.filter((/** @type {any} */ g) => g.state !== 'busy');
  const busy = options.guides.filter((/** @type {any} */ g) => g.state === 'busy');
  return (
    <>
      {free.map((/** @type {any} */ g) => (
        <button
          key={g.id}
          type="button"
          className={`choice${d.guide?.id === g.id ? ' is-picked' : ''}`}
          onClick={() => onPick(g.id)}
        >
          <strong>{g.name}</strong>
          <span className="block small muted">{g.why}</span>
        </button>
      ))}
      {busy.length > 0 && <div className="eyebrow">Busy then</div>}
      {busy.map((/** @type {any} */ g) => (
        <div key={g.id} className="unavailable">
          <strong>{g.name}</strong> · {g.why.replace(/^Busy: /, '')}
        </div>
      ))}
    </>
  );
}

/** The vans or boats, in a sheet (a phone). @param {{ options: any, onPick: (id: string) => void }} props */
function VehicleList({ options, onPick }) {
  return (
    <>
      {options.resources.length === 0 && <NoVehicles />}
      {options.resources.map((/** @type {any} */ r) =>
        r.state === 'free' || r.state === 'assigned' ? (
          <button
            key={r.id}
            type="button"
            className={`choice${r.state === 'assigned' ? ' is-picked' : ''}`}
            onClick={() => onPick(r.id)}
          >
            <strong>{r.label}</strong>
            <span className="block small muted">{r.why}</span>
          </button>
        ) : r.state === 'small' ? (
          <div key={r.id} className="unavailable unavailable--warning">
            <strong className="block">{r.label}: too small</strong>
            <span className="sm">{r.why.replace(/^Too small: /, '')}</span>
          </div>
        ) : (
          <div key={r.id} className="unavailable">
            <strong>{r.label}</strong> · {r.why}
          </div>
        ),
      )}
      <p className="small muted">Once a van or boat is assigned, sales stop at its seats too.</p>
    </>
  );
}

/** None added yet (a business set up before vans and boats existed, 15a). */
function NoVehicles() {
  return <p className="sm muted">No vans or boats yet. Add them in Settings.</p>;
}

/** "Cancel Tarkwa Bay on Sat 5 Dec?" @param {{ d: any, business: string, onClose: () => void, onCancelled: (text: string) => void }} props */
function CancelDialog({ d, business, onClose, onCancelled }) {
  const engine = useEngine();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const freed = [
    d.guide?.name.split(' ')[0],
    d.resource ? `the ${d.resource.name.toLowerCase()}` : null,
  ].filter(Boolean);
  return (
    <Sheet title={`Cancel ${d.short}?`} alert center onClose={onClose}>
      <form
        className="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const r = await act(engine, `/api/departures/${d.id}/cancel`, {
            method: 'POST',
            body: { reason: reason.trim() },
          });
          setBusy(false);
          if (!r.ok) return setError(actionError(r.error));
          onCancelled(cancelledText(r.body));
        }}
      >
        <h2 className="h-lg">
          Cancel {d.short} on {d.dayLabel}?
        </h2>
        <ul className="ticks">
          <li>
            {d.cancel.bookings} {d.cancel.bookings === 1 ? 'booking' : 'bookings'},{' '}
            {d.cancel.guests} {d.cancel.guests === 1 ? 'guest' : 'guests'}
          </li>
          <li>
            Everyone refunded in full: <strong>{d.cancel.refundText}</strong>
          </li>
          <li>{d.cancel.toldLine}</li>
          {freed.length > 0 && (
            <li>
              {freed.join(' and ')} {freed.length === 1 ? 'is' : 'are'} freed
            </li>
          )}
        </ul>
        <label className="field">
          Reason guests will see
          <input
            className="input"
            type="text"
            maxLength={200}
            placeholder="e.g. the weather on the lagoon"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <span className="small muted plain">
            {business}: {cancelSentence(reason || '…')}
          </span>
        </label>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="btn btn--danger"
          disabled={busy || reason.trim().length < 3}
        >
          {busy ? 'Cancelling…' : 'Cancel and refund everyone'}
        </button>
        <button type="button" className="btn btn--outline" onClick={onClose}>
          Keep the departure
        </button>
      </form>
    </Sheet>
  );
}
