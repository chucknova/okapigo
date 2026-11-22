// @ts-check
/**
 * M5 · Sojourna's back office (designs: "Sojourna — Partner bookings", 17d-2): every booking
 * Sojourna made with this business, each status asked of the business through OCTO just now.
 * A cancellation by the business (weather) shows here by itself: "Cancelled by supplier".
 *
 *   Cancel          asks first, with what goes back under the business's policy (the
 *                   business's own preview of that booking), then cancels through OCTO
 *   too late        once the trip has started: "can't be cancelled online any more"
 */
import { useState } from 'react';
import { Link } from 'wouter';
import { useLoad } from '../lib/use-load.js';
import { api } from '../lib/api.js';
import { bookingRow, cancelWords, firstWord, lastSyncWords, startedWhen } from '../lib/words.js';
import { offline, tooLate } from '../lib/states.js';
import { StatePanel } from '../components/StatePanel.jsx';

export function Bookings() {
  const list = useLoad('/api/bookings');
  const [asking, setAsking] = useState(/** @type {{ row: any, booking: any } | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const supplier = list.data?.supplier;
  const name = supplier?.name ?? 'The operator';
  const rows = (list.data?.rows ?? []).map((/** @type {any} */ r) => ({
    view: bookingRow(r),
    booking: r.booking,
  }));

  const cancel = async () => {
    if (!asking) return;
    setBusy(true);
    setProblem(null);
    try {
      await api(`/api/bookings/${encodeURIComponent(asking.row.ref)}/cancel`, { method: 'POST' });
      setAsking(null);
      await list.reload();
    } catch (err) {
      setProblem(/** @type {any} */ (err).message);
      if (/** @type {any} */ (err).problem === 'too_late') await list.reload();
    }
    setBusy(false);
  };

  return (
    <div className="office">
      <header className="office-top">
        <div className="top-inner">
          <span className="wordmark wordmark--white">
            sojourna<span className="wordmark-dot">.</span>
          </span>
          <span className="office-badge">Back office</span>
          <Link href="/" className="office-link">
            View the storefront
          </Link>
        </div>
      </header>
      <main className="page stack-md">
        {list.error ? (
          list.error.problem === 'offline' ? (
            <StatePanel {...offline('The supplier')}>
              <button type="button" className="btn btn--blue" onClick={() => list.reload()}>
                Try again
              </button>
            </StatePanel>
          ) : (
            <StatePanel
              tone="bad"
              tag="SOMETHING WENT WRONG"
              title="We couldn’t load the bookings"
              body={list.error.message}
            />
          )
        ) : !list.data ? (
          <div aria-busy="true" />
        ) : (
          <>
            <div className="row-between office-head">
              <div>
                <h1 className="h1 h1--small">Bookings · {name}</h1>
                <div className="muted">
                  Supplier connected through OCTO · {lastSyncWords(list.data.lastSyncAt)}
                </div>
              </div>
              <div className="small muted">
                {rows.length} {rows.length === 1 ? 'booking' : 'bookings'}
              </div>
            </div>
            {rows.length === 0 ? (
              <StatePanel
                tone="info"
                tag="NO BOOKINGS YET"
                title="Nothing booked yet"
                body="Bookings made on Sojourna show here."
              >
                <Link href="/" className="btn btn--blue">
                  View the storefront
                </Link>
              </StatePanel>
            ) : (
              <div className="table-box">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Guest</th>
                      <th>Experience</th>
                      <th>Date</th>
                      <th>Who</th>
                      <th className="right">Total</th>
                      <th>Status</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ view: r, booking }) => (
                      <tr key={r.ref}>
                        <td data-label="Reference">
                          <strong>{r.ref}</strong>
                          <br />
                          <span className="tiny muted">
                            {firstWord(name)}: {r.ilt}
                          </span>
                        </td>
                        <td data-label="Guest">{r.guest}</td>
                        <td data-label="Experience">{r.tour}</td>
                        <td data-label="Date">{r.date}</td>
                        <td data-label="Who">{r.who}</td>
                        <td data-label="Total" className="right num">
                          {r.total}
                        </td>
                        <td data-label="Status">
                          <span className={`status status--${r.status.tone}`}>{r.status.text}</span>
                        </td>
                        <td className="right">
                          {r.action && (
                            <button
                              type="button"
                              className="btn-cancel"
                              aria-label={`Cancel ${r.ref}`}
                              onClick={() => {
                                setProblem(null);
                                setAsking({ row: r, booking });
                              }}
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="small muted">
              Statuses come from {firstWord(name)} through OCTO. A cancellation by {firstWord(name)}{' '}
              (for example weather) appears here by itself as “Cancelled by supplier · full refund”.
            </p>
          </>
        )}
      </main>

      {asking && (
        <div className="scrim" onClick={() => !busy && setAsking(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            {asking.row.action === 'too_late' ? (
              <div className="dialog" role="alertdialog" aria-label="Too late to cancel online">
                <StatePanel
                  {...tooLate(
                    asking.row.ref,
                    asking.row.tour,
                    startedWhen(asking.booking.availability.localDateTimeStart),
                    name,
                  )}
                >
                  {supplier?.contact?.telephone && (
                    <a href={`tel:${supplier.contact.telephone}`} className="btn btn--blue">
                      Contact {name}
                    </a>
                  )}
                  <button type="button" className="btn btn--line" onClick={() => setAsking(null)}>
                    Close
                  </button>
                </StatePanel>
              </div>
            ) : (
              <CancelDialog
                words={cancelWords(asking.row, asking.booking, name)}
                busy={busy}
                problem={problem}
                onKeep={() => setAsking(null)}
                onCancel={cancel}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * @param {{ words: ReturnType<typeof cancelWords>, busy: boolean, problem: string | null, onKeep: () => void, onCancel: () => void }} props
 */
function CancelDialog({ words, busy, problem, onKeep, onCancel }) {
  return (
    <div className="dialog stack-md" role="alertdialog" aria-labelledby="cx-t">
      <h2 id="cx-t" className="state-title">
        {words.title}
      </h2>
      <div className="ink-soft">{words.line}</div>
      <div className={`refund refund--${words.tone}`}>
        <strong>{words.headline}</strong>
        <br />
        {words.money}
      </div>
      <div className="small muted">{words.note}</div>
      {problem && (
        <p role="alert" className="note note--bad">
          {problem}
        </p>
      )}
      <div className="dialog-buttons">
        <button type="button" className="btn btn--line" onClick={onKeep} disabled={busy}>
          Keep booking
        </button>
        <button type="button" className="btn btn--red" onClick={onCancel} disabled={busy}>
          {busy ? 'Cancelling…' : words.button}
        </button>
      </div>
    </div>
  );
}
