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
import { useNow } from '../lib/now.js';
import { useEngine, useSync } from '../lib/engine.jsx';
import { act, actionError } from '../lib/office.js';
import { formatNaira } from '@okapigo/shared/money';
import { nairaField } from '../lib/money.js';
import { request } from '../lib/api.js';
import { localDate } from '@okapigo/shared/time';
import {
  FILTERS,
  LINK_EXPIRY,
  amountIn,
  canRetryByCard,
  cancelLabel,
  cancelledNote,
  changeBody,
  changedNote,
  nextToRemove,
  saveChangeLabel,
  linkSentText,
  actionButtons,
  chipText,
  heldLeft,
  listPath,
  noMatch,
  noShowLabel,
  resultsLine,
} from '../lib/desk.js';

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
  const [sheet, setSheet] = useState(
    /** @type {'note' | 'noShow' | 'link' | 'cancel' | 'cashAmount' | 'transfer' | 'travellers' | null} */ (
      null
    ),
  );
  const [done, setDone] = useState(/** @type {string | null} */ (null));
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const now = useNow(1000, b.chip.key === 'held');
  const buttons = actionButtons(b.actions);

  /**
   * Sends one change; on success closes the sheet and says what happened.
   * @param {string} path @param {{ method: 'POST' | 'DELETE', body?: unknown }} o
   * @param {string | ((body: any) => string)} said
   */
  const change = async (path, o, said) => {
    setError(null);
    setDone(null);
    const r = await act(engine, path, o);
    if (!r.ok) {
      setError(actionError(r.error));
      return false;
    }
    setSheet(null);
    setDone(typeof said === 'function' ? said(r.body) : said);
    return true;
  };
  const SHEET_OF = /** @type {Record<string, any>} */ ({
    addNote: 'note',
    noShow: 'noShow',
    paymentLink: 'link',
    cancel: 'cancel',
    changeTravellers: 'travellers',
  });
  const refundBack = () =>
    change(
      `/api/bookings/${b.id}/refunds`,
      { method: 'POST', body: { reason: 'Sent again from the bookings desk' } },
      `Refund of ${formatNaira(b.sums.owedBackKobo)} started.`,
    );

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
            {b.banner.kind === 'cash' && (
              <>
                <button
                  type="button"
                  className="btn btn--ok btn--compact"
                  onClick={() =>
                    change(
                      `/api/cash-reports/${b.banner.cashReportId}/confirm`,
                      { method: 'POST', body: {} },
                      `${formatNaira(b.banner.amountKobo)} cash confirmed. It’s in the books.`,
                    )
                  }
                >
                  Confirm {formatNaira(b.banner.amountKobo)} received
                </button>
                <button
                  type="button"
                  className="btn btn--outline btn--compact"
                  onClick={() => setSheet('cashAmount')}
                >
                  Received a different amount
                </button>
                <button
                  type="button"
                  className="btn btn--danger-outline btn--compact"
                  onClick={() =>
                    change(
                      `/api/cash-reports/${b.banner.cashReportId}/not-received`,
                      { method: 'POST' },
                      'Marked not received. The guest still owes, and the owner has been alerted.',
                    )
                  }
                >
                  Not received
                </button>
              </>
            )}
            {b.banner.kind === 'owes' && b.actions.paymentLink.enabled && (
              <button
                type="button"
                className="btn btn--dark btn--compact"
                onClick={() => setSheet('link')}
              >
                Send payment link
              </button>
            )}
            {(b.banner.kind === 'refund_failed' || b.banner.kind === 'refund_due') && (
              <>
                {canRetryByCard(b.sums) && (
                  <button type="button" className="btn btn--dark btn--compact" onClick={refundBack}>
                    {b.banner.kind === 'refund_failed' ? 'Try the refund again' : 'Send the refund'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--outline btn--compact"
                  onClick={() => setSheet('transfer')}
                >
                  I refunded by bank transfer
                </button>
              </>
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
          {b.banner.kind === 'cash' && (
            <p className="small muted">
              Confirming adds a cash payment to the books and closes the balance. “Not received”
              keeps them owing and flags it to the owner.
            </p>
          )}
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
              className={`btn btn--compact ${x.danger ? 'btn--danger-outline' : 'btn--outline'}`}
              disabled={!x.enabled}
              onClick={() => setSheet(SHEET_OF[x.key])}
            >
              {x.label}
            </button>
            {!x.enabled && x.why && <span className="small muted">{x.why}</span>}
          </span>
        ))}
      </div>
      {b.actNote && <p className="small muted">{b.actNote}</p>}

      {sheet === 'link' && (
        <LinkSheet
          b={b}
          error={error}
          onClose={() => setSheet(null)}
          onSend={(body) =>
            change(`/api/bookings/${b.id}/payment-links`, { method: 'POST', body }, (r) =>
              linkSentText(r.link, new Date(), b.sums.timeZone),
            )
          }
          onCopy={async (body) => {
            setError(null);
            const r = await act(engine, `/api/bookings/${b.id}/payment-links`, {
              method: 'POST',
              body: { ...body, send: false },
            });
            if (!r.ok) {
              setError(actionError(r.error));
              return null;
            }
            return r.body.url;
          }}
        />
      )}
      {sheet === 'cancel' && b.cancel && (
        <CancelSheet
          b={b}
          error={error}
          onClose={() => setSheet(null)}
          onCancel={(body, refundKobo) =>
            change(`/api/bookings/${b.id}/cancel`, { method: 'POST', body }, (r) =>
              cancelledNote(refundKobo, r.refundStart),
            )
          }
        />
      )}
      {sheet === 'cashAmount' && b.banner?.kind === 'cash' && (
        <AmountSheet
          title="Received a different amount"
          heading={`Cash handed in for ${b.reference}`}
          help={`${b.banner.title}. Type what was really handed in; the rest stays owed.`}
          maxKobo={b.banner.amountKobo}
          tooMuch="That’s more than was reported. Confirm the reported amount instead."
          button="Confirm received"
          error={error}
          onClose={() => setSheet(null)}
          onSave={(kobo) =>
            change(
              `/api/cash-reports/${b.banner.cashReportId}/confirm`,
              { method: 'POST', body: { amountKobo: kobo } },
              `${formatNaira(kobo)} cash confirmed. The rest is still owed.`,
            )
          }
        />
      )}
      {sheet === 'transfer' && (
        <TransferSheet
          b={b}
          error={error}
          onClose={() => setSheet(null)}
          onSave={(body) =>
            change(
              `/api/bookings/${b.id}/refunds/bank-transfer`,
              { method: 'POST', body },
              `Refund of ${formatNaira(body.amountKobo)} recorded. The guest is told it was sent.`,
            )
          }
        />
      )}
      {sheet === 'travellers' && (
        <TravellersSheet
          b={b}
          error={error}
          onClose={() => setSheet(null)}
          onSave={(body) =>
            change(`/api/bookings/${b.id}/travellers/change`, { method: 'POST', body }, (r) =>
              changedNote(r),
            )
          }
        />
      )}
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

/** "Payment link for Yemi Ojo" (designs: Send payment link). @param {{ b: any, error: string | null, onClose: () => void, onSend: (body: any) => Promise<boolean>, onCopy: (body: any) => Promise<string | null> }} props */
function LinkSheet({ b, error, onClose, onSend, onCopy }) {
  const owed = b.sums.owedKobo;
  const [kind, setKind] = useState(/** @type {'balance' | 'other'} */ ('balance'));
  const [typed, setTyped] = useState(nairaField(owed));
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(/** @type {string | null} */ (null));
  const amount =
    kind === 'balance'
      ? { ok: true, kobo: owed }
      : amountIn(typed, owed, 'That’s more than they owe.');
  const body = () => ({ amountKobo: /** @type {any} */ (amount).kobo, expiresInDays: days });
  return (
    <Sheet title="Send a payment link" onClose={onClose}>
      <form
        className="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!amount.ok) return;
          setBusy(true);
          await onSend(body());
          setBusy(false);
        }}
      >
        <h2 className="h-lg">Payment link for {b.lead}</h2>
        <fieldset className="segmented">
          <legend className="strong">For</legend>
          <label className={kind === 'balance' ? 'is-on' : ''}>
            <input
              type="radio"
              name="for"
              checked={kind === 'balance'}
              onChange={() => setKind('balance')}
            />
            Balance
          </label>
          <label className={kind === 'other' ? 'is-on' : ''}>
            <input
              type="radio"
              name="for"
              checked={kind === 'other'}
              onChange={() => setKind('other')}
            />
            Other
          </label>
        </fieldset>
        <label className="field">
          Amount (₦)
          <input
            className="input input--money"
            inputMode="decimal"
            value={kind === 'balance' ? nairaField(owed) : typed}
            readOnly={kind === 'balance'}
            onChange={(e) => setTyped(e.target.value)}
          />
          <span className="small muted plain">Up to {formatNaira(owed)}, what they still owe</span>
        </label>
        {!amount.ok && <p className="field-error">{/** @type {any} */ (amount).error}</p>}
        <fieldset className="segmented">
          <legend className="strong">Expires</legend>
          {LINK_EXPIRY.map((x) => (
            <label key={x.days} className={days === x.days ? 'is-on' : ''}>
              <input
                type="radio"
                name="expires"
                checked={days === x.days}
                onChange={() => setDays(x.days)}
              />
              {x.label}
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--dark" disabled={busy || !amount.ok}>
          {busy ? 'Sending…' : 'Send to the guest'}
        </button>
        {url ? (
          <div className="copy-box">
            <input className="input" readOnly value={url} aria-label="The payment link" />
            <button
              type="button"
              className="btn btn--outline btn--compact"
              onClick={() => globalThis.navigator?.clipboard?.writeText(url)}
            >
              Copy
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="text-link"
            disabled={busy || !amount.ok}
            onClick={async () => setUrl(await onCopy(body()))}
          >
            Copy the link instead
          </button>
        )}
        <p className="small muted">
          Sent by WhatsApp and email, using your “Payment link” message. If their messages aren’t
          arriving, copy the link and send it another way.
        </p>
      </form>
    </Sheet>
  );
}

/** "Cancel ILT-7K4Q2M · Adaeze Okafor" (designs: the policy's refund, or another amount). @param {{ b: any, error: string | null, onClose: () => void, onCancel: (body: any, refundKobo: number) => Promise<boolean> }} props */
function CancelSheet({ b, error, onClose, onCancel }) {
  const c = b.cancel;
  const [which, setWhich] = useState(/** @type {'policy' | 'other'} */ ('policy'));
  const [typed, setTyped] = useState(nairaField(c.maxKobo));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const other = amountIn(typed, c.maxKobo, `At most ${formatNaira(c.maxKobo)}, what was paid.`);
  const refund = which === 'policy' ? c.policyKobo : other.ok ? other.kobo : 0;
  const ready = which === 'policy' || (other.ok && reason.trim().length >= 3);
  return (
    <Sheet title={c.title} alert onClose={onClose}>
      <form
        className="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onCancel(
            {
              initiatedBy: 'guest',
              reason: reason.trim() || 'Cancelled by the office',
              ...(which === 'other' ? { refundOverrideKobo: refund } : {}),
              startRefund: true,
            },
            refund,
          );
          setBusy(false);
        }}
      >
        <h2 className="h-lg">{c.title}</h2>
        <p className="muted">{c.sub}</p>
        <fieldset className="stack-sm plain-fieldset">
          <legend className="strong">Refund</legend>
          <label className="check-row">
            <input
              type="radio"
              name="refund"
              checked={which === 'policy'}
              onChange={() => setWhich('policy')}
            />
            Policy: {c.policyText}
          </label>
          {c.maxKobo > 0 && (
            <label className="check-row">
              <input
                type="radio"
                name="refund"
                checked={which === 'other'}
                onChange={() => setWhich('other')}
              />
              Another amount, up to {formatNaira(c.maxKobo)}
            </label>
          )}
        </fieldset>
        {which === 'other' && (
          <>
            <label className="field">
              Amount (₦)
              <input
                className="input input--money"
                inputMode="decimal"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </label>
            {!other.ok && <p className="field-error">{other.error}</p>}
          </>
        )}
        <label className="field">
          Reason {which === 'other' ? '(needed for another amount)' : '(optional)'}
          <input
            className="input"
            type="text"
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--danger" disabled={busy || !ready}>
          {busy ? 'Cancelling…' : cancelLabel(refund)}
        </button>
        <p className="small muted">
          The guest is told by WhatsApp and email. You can refund more than the policy; the reason
          goes on the timeline.
        </p>
      </form>
    </Sheet>
  );
}

/** One amount, up to a limit ("Received a different amount"). @param {{ title: string, heading: string, help: string, maxKobo: number, tooMuch: string, button: string, error: string | null, onClose: () => void, onSave: (kobo: number) => Promise<boolean> }} props */
function AmountSheet({ title, heading, help, maxKobo, tooMuch, button, error, onClose, onSave }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const amount = amountIn(typed, maxKobo, tooMuch);
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        className="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!amount.ok) return;
          setBusy(true);
          await onSave(amount.kobo);
          setBusy(false);
        }}
      >
        <h2 className="h-lg">{heading}</h2>
        <p className="muted">{help}</p>
        <label className="field">
          Amount (₦)
          <input
            className="input input--money"
            inputMode="decimal"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        {typed && !amount.ok && <p className="field-error">{amount.error}</p>}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--dark" disabled={busy || !amount.ok}>
          {busy ? 'Saving…' : button}
        </button>
      </form>
    </Sheet>
  );
}

/** "I refunded by bank transfer": amount, date sent, reference. @param {{ b: any, error: string | null, onClose: () => void, onSave: (body: any) => Promise<boolean> }} props */
function TransferSheet({ b, error, onClose, onSave }) {
  const max = b.sums.owedBackKobo;
  const today = localDate(new Date(), b.sums.timeZone);
  const [typed, setTyped] = useState(nairaField(max));
  const [sentOn, setSentOn] = useState(today);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const amount = amountIn(typed, max, `Only ${formatNaira(max)} is owed back.`);
  const ready = amount.ok && reference.trim().length >= 3 && sentOn && sentOn <= today;
  return (
    <Sheet title="I refunded by bank transfer" onClose={onClose}>
      <form
        className="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!amount.ok) return;
          setBusy(true);
          await onSave({ amountKobo: amount.kobo, sentOn, reference: reference.trim() });
          setBusy(false);
        }}
      >
        <h2 className="h-lg">Refund sent by bank transfer</h2>
        <p className="muted">
          {b.reference} · {b.lead} · {formatNaira(max)} owed back
        </p>
        <label className="field">
          Amount (₦)
          <input
            className="input input--money"
            inputMode="decimal"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        {!amount.ok && <p className="field-error">{amount.error}</p>}
        <label className="field">
          Date sent
          <input
            className="input"
            type="date"
            max={today}
            value={sentOn}
            onChange={(e) => setSentOn(e.target.value)}
          />
        </label>
        <label className="field">
          Transfer reference
          <input
            className="input"
            type="text"
            maxLength={60}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--dark" disabled={busy || !ready}>
          {busy ? 'Saving…' : 'Record and tell the guest'}
        </button>
        <p className="small muted">
          Adds the refund to the books and sends the guest the “Refund sent” message. The reference
          is required.
        </p>
      </form>
    </Sheet>
  );
}

/**
 * "Travellers · Yemi Ojo" (designs: Booking actions): − and + per kind of traveller, a name
 * and age for each one added; the server works out the new total, the extra or the refund,
 * and the seats, as you go (POST …/travellers/preview, nothing saved).
 * @param {{ b: any, error: string | null, onClose: () => void, onSave: (body: any) => Promise<boolean> }} props
 */
function TravellersSheet({ b, error, onClose, onSave }) {
  const engine = useEngine();
  const [removed, setRemoved] = useState(/** @type {string[]} */ ([]));
  const [added, setAdded] = useState(
    /** @type {Array<{ categoryKey: string, name: string, age: string }>} */ ([]),
  );
  const [plan, setPlan] = useState(/** @type {any} */ (null));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const body = changeBody(removed, added);
  const key = JSON.stringify(body);
  const settled = useSettled(key);

  // Ask the server what this change would do, once typing pauses.
  useEffect(() => {
    let live = true;
    const token = engine.getState().session?.token ?? null;
    request(`/api/bookings/${b.id}/travellers/preview`, {
      method: 'POST',
      body: JSON.parse(settled),
      token,
    }).then(
      (r) => {
        if (!live) return;
        setPlan(r.body.plan);
        setProblem(null);
      },
      (e) => live && setProblem(actionError(e)),
    );
    return () => {
      live = false;
    };
  }, [settled, b.id, engine]);

  const ready = plan && !problem && plan.changed && plan.seats.fits && settled === key;
  const kinds = plan?.categories ?? [];
  return (
    <Sheet title={`Travellers · ${b.lead}`} onClose={onClose}>
      <form
        className="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          setBusy(true);
          await onSave({ ...body, refundKobo: plan.refund?.policyKobo ?? 0, sendLink: true });
          setBusy(false);
        }}
      >
        <h2 className="h-lg">Travellers · {b.lead}</h2>
        <p className="muted">{b.sub}</p>
        {kinds.map((/** @type {any} */ c) => {
          const less = nextToRemove(b.travellers, removed, added, c.key);
          const plural = c.name.replace(/\s*\(.*\)\s*$/, '');
          return (
            <div key={c.key} className="row-between counter-row">
              <span>
                <strong>{c.name}</strong>
                <span className="block small muted">
                  {formatNaira(c.priceKobo)}
                  {c.booked ? '' : ' (today’s price)'}
                </span>
              </span>
              <span className="counter">
                <button
                  type="button"
                  className="square-btn"
                  aria-label={`Fewer: ${plural}`}
                  disabled={!less}
                  onClick={() => {
                    if (!less) return;
                    if ('added' in less) setAdded(added.filter((_, i) => i !== less.added));
                    else setRemoved([...removed, less.id]);
                  }}
                >
                  −
                </button>
                <strong aria-live="polite">{c.count}</strong>
                <button
                  type="button"
                  className="square-btn"
                  aria-label={`More: ${plural}`}
                  onClick={() => setAdded([...added, { categoryKey: c.key, name: '', age: '' }])}
                >
                  +
                </button>
              </span>
            </div>
          );
        })}
        {added.map((a, i) => {
          const c = kinds.find((/** @type {any} */ k) => k.key === a.categoryKey);
          const kind = (c?.name ?? a.categoryKey).replace(/\s*\(.*\)\s*$/, '');
          const set = (/** @type {any} */ v) =>
            setAdded(added.map((x, j) => (j === i ? { ...x, ...v } : x)));
          return (
            <div key={i} className="new-traveller">
              <label className="field grow">
                {kind}’s name
                <input
                  className="input"
                  type="text"
                  maxLength={200}
                  value={a.name}
                  onChange={(e) => set({ name: e.target.value })}
                />
              </label>
              {c && c.maxAge !== null && (
                <label className="field age-field">
                  Age
                  <input
                    className="input"
                    inputMode="numeric"
                    maxLength={3}
                    value={a.age}
                    onChange={(e) => set({ age: e.target.value })}
                  />
                </label>
              )}
            </div>
          );
        })}
        {plan && plan.changed && (
          <div className="change-sum">
            <div className="row-between">
              <span>New total</span>
              <strong>{formatNaira(plan.newTotalKobo)}</strong>
            </div>
            {plan.extraKobo > 0 && (
              <div className="row-between">
                <span>Extra to pay</span>
                <span>{formatNaira(plan.extraKobo)}</span>
              </div>
            )}
            {plan.refund && (
              <div className="row-between">
                <span>Refund (policy)</span>
                <span>{plan.refund.policyText}</span>
              </div>
            )}
            <div className={`small ${plan.seats.fits ? 'muted' : 'tone--urgent strong'}`}>
              Seats: {plan.seats.text}
            </div>
          </div>
        )}
        {problem && (
          <p role="alert" className="field-error">
            {problem}
          </p>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--dark" disabled={busy || !ready}>
          {busy ? 'Saving…' : plan ? saveChangeLabel(plan) : 'Save'}
        </button>
        <p className="small muted">
          Fewer travellers: the refund the policy allows, which you confirm by saving. Names can be
          fixed any time, free.
        </p>
      </form>
    </Sheet>
  );
}
