// @ts-check
/**
 * "Move to another date" (16d-2): the tour's other dates with their seats free; pick one, then
 * "Move to Sun 6 Dec, 09:00". Used on a booking's page and on a guest's request. The guest is
 * told by the server ("Date changed", WhatsApp and email).
 */
import { useState } from 'react';
import { Sheet } from './Sheet.jsx';
import { useLive } from '../lib/live.js';

/**
 * @param {{ bookingId: string, reference: string, error: string | null, onClose: () => void, onMove: (departureId: string, when: string) => Promise<boolean> }} props
 */
export function MoveSheet({ bookingId, reference, error, onClose, onMove }) {
  const live = useLive(`/api/bookings/${bookingId}/move-options`);
  const o = live.entry.data?.options ?? null;
  const [picked, setPicked] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const chosen = o?.dates.find((/** @type {any} */ d) => d.id === picked) ?? null;
  return (
    <Sheet title="Move to another date" onClose={onClose}>
      <form
        className="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!chosen) return;
          setBusy(true);
          await onMove(chosen.id, chosen.when);
          setBusy(false);
        }}
      >
        <h2 className="h-lg">Move {reference}</h2>
        {!o && !live.entry.error && <p className="muted">Finding dates…</p>}
        {live.entry.error && (
          <p role="alert" className="field-error">
            {live.entry.error.message}
          </p>
        )}
        {o && (
          <>
            <p className="muted">
              Now on {o.from} · {o.travellers} {o.travellers === 1 ? 'traveller' : 'travellers'}
            </p>
            {o.dates.length === 0 ? (
              <p className="sm muted">No other dates in the next 90 days.</p>
            ) : (
              <fieldset className="plain-fieldset stack-xs move-dates">
                <legend className="visually-hidden">Dates</legend>
                {o.dates.map((/** @type {any} */ d) => (
                  <label key={d.id} className={`check-row${d.fits ? '' : ' is-off'}`}>
                    <input
                      type="radio"
                      name="date"
                      disabled={!d.fits}
                      checked={picked === d.id}
                      onChange={() => setPicked(d.id)}
                    />
                    <span className="grow">{d.when}</span>
                    <span className="small muted">{d.text}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--dark" disabled={busy || !chosen}>
          {busy ? 'Moving…' : chosen ? `Move to ${chosen.when}` : 'Choose a date'}
        </button>
        <p className="small muted">
          The price stays what was booked. The guest is told by WhatsApp and email; their ticket
          stays the same.
        </p>
      </form>
    </Sheet>
  );
}
