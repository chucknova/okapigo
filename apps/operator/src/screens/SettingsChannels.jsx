// @ts-check
/**
 * O11 · Settings › Channels (stage 17c-2; designs: "O11 · Settings › Channels: list and one
 * channel" and "O11 · Connect, key shown once, empty, off, new key, OTA payment").
 *
 *   the cards       each OTA: connected or switched off, its commission, tours, last booking,
 *                   this month's sales, what it owes. Wide screen: the open one's page below;
 *                   phone: tap one to open it
 *   one channel     its tours (switched on and off one by one; reaches it within a minute),
 *                   its latest bookings, the money (and "Record a payment from Sojourna"), the
 *                   commission (new sales only), the connection (a new key, switch off: both
 *                   asked first)
 *   connect         a name and a commission → its key, shown once
 *
 * Owners change things; managers look (channels: view). The words are in lib/channels.js and
 * the server's answers (/api/channels).
 */
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { LiveFrame } from '../components/LiveFrame.jsx';
import { SaveBar, LeaveGuard } from '../components/SaveBar.jsx';
import { Sheet } from '../components/Sheet.jsx';
import { useLive } from '../lib/live.js';
import { useEngine } from '../lib/engine.jsx';
import { act, actionError } from '../lib/office.js';
import { localDate } from '@okapigo/shared/time';
import { LOOK_ONLY } from '../lib/settings.js';
import {
  EMPTY_WORDS,
  KEY_ONCE_WARNING,
  blankConnect,
  commissionError,
  commissionField,
  connectBody,
  connectErrors,
  keyOnceTitle,
  newKeyWords,
  offLine,
  owedAfterLine,
  parsePercent,
  paymentBody,
  paymentErrors,
  paymentForm,
  recordLabel,
  stateClass,
  switchOffWords,
  viaHelp,
} from '../lib/channels.js';

/** @param {{ tz: string, canEdit: boolean, item: string | null }} props */
export function ChannelsSettings({ tz, canEdit, item }) {
  const live = useLive('/api/channels');
  const [connecting, setConnecting] = useState(false);
  const [madeKey, setMadeKey] = useState(
    /** @type {{ name: string, apiKey: string, octoEndpoint: string } | null} */ (null),
  );
  return (
    <LiveFrame live={live} what="Your channels" forWhom="the owner and managers" tz={tz}>
      {({ channels }) => {
        const open = channels.find((/** @type {any} */ c) => c.id === item) ?? channels[0] ?? null;
        return (
          <div className="stack-md">
            {/* On a phone, inside one channel, "‹ Channels" is the way back: no page header. */}
            <div className={item ? 'wide-only' : ''}>
              <header className="row-between channels-head">
                <div>
                  <p className="eyebrow">Settings › Channels</p>
                  <h2 className="h-xl">Sell on travel websites</h2>
                  <p className="muted">
                    OTAs sell from the same seats and prices as your website, through OCTO.
                  </p>
                </div>
                {canEdit && channels.length > 0 && (
                  <button
                    type="button"
                    className="btn btn--dark btn--compact"
                    onClick={() => setConnecting(true)}
                  >
                    Connect a channel
                  </button>
                )}
              </header>
            </div>
            {!canEdit && <p className="unavailable">{LOOK_ONLY}</p>}

            {channels.length === 0 ? (
              <section className="panel panel--pad channels-empty" aria-label="No channels yet">
                <h3 className="h-lg">Sell on OTAs</h3>
                <p className="muted">{EMPTY_WORDS}</p>
                {canEdit && (
                  <button
                    type="button"
                    className="btn btn--dark btn--narrow"
                    onClick={() => setConnecting(true)}
                  >
                    Connect a channel
                  </button>
                )}
              </section>
            ) : (
              <div className={item ? 'wide-only' : ''}>
                <ul className="plain-list channel-cards" aria-label="Channels">
                  {channels.map((/** @type {any} */ c) => (
                    <li key={c.id}>
                      <Link
                        href={`/settings/channels/${c.id}`}
                        className={`channel-card${c.id === open?.id ? ' is-open' : ''}${c.isActive ? '' : ' is-off'}`}
                        aria-current={c.id === open?.id ? 'true' : undefined}
                      >
                        <span className="channel-card-name">{c.name}</span>
                        <span className={`chip ${c.isActive ? 'chip--success' : 'chip--muted'}`}>
                          {c.status}
                        </span>
                        <span className="muted">{c.summary}</span>
                        <span />
                        <span className={c.month.strong ? '' : 'muted'}>
                          {c.month.lead} {c.month.strong && <strong>{c.month.strong}</strong>}
                        </span>
                        <strong className={c.owedKobo > 0 ? 'tone--warning' : ''}>
                          {c.owedLine}
                        </strong>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {open && (
              <div className={item ? '' : 'wide-only'}>
                {item && (
                  <Link href="/settings/channels" className="back-link narrow-only">
                    ‹ Channels
                  </Link>
                )}
                <ChannelPage
                  key={open.id}
                  id={open.id}
                  tz={tz}
                  canEdit={canEdit}
                  onKey={setMadeKey}
                />
              </div>
            )}

            {connecting && (
              <ConnectSheet
                taken={channels.map((/** @type {any} */ c) => c.name)}
                onClose={() => setConnecting(false)}
                onMade={(made) => {
                  setConnecting(false);
                  setMadeKey(made);
                }}
              />
            )}
            {madeKey && <KeyOnce made={madeKey} onClose={() => setMadeKey(null)} />}
          </div>
        );
      }}
    </LiveFrame>
  );
}

/**
 * @param {{ id: string, tz: string, canEdit: boolean, onKey: (made: { name: string, apiKey: string, octoEndpoint: string }) => void }} props
 */
function ChannelPage({ id, tz, canEdit, onKey }) {
  const live = useLive(`/api/channels/${id}`);
  return (
    <LiveFrame live={live} what="This channel" forWhom="the owner and managers" tz={tz}>
      {({ channel }) => (
        <OneChannel
          key={channel.commissionBasisPoints}
          c={channel}
          tz={tz}
          canEdit={canEdit}
          onKey={onKey}
        />
      )}
    </LiveFrame>
  );
}

/**
 * @param {{ c: any, tz: string, canEdit: boolean, onKey: (made: { name: string, apiKey: string, octoEndpoint: string }) => void }} props
 */
function OneChannel({ c, tz, canEdit, onKey }) {
  const engine = useEngine();
  const [commission, setCommission] = useState(commissionField(c.commissionBasisPoints));
  const [saving, setSaving] = useState(false);
  const [busyTour, setBusyTour] = useState(/** @type {string | null} */ (null));
  const [asking, setAsking] = useState(/** @type {'key' | 'off' | 'pay' | null} */ (null));
  const [note, setNote] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));
  const typedError = commissionError(commission);
  const changed = parsePercent(commission) === c.commissionBasisPoints / 100 ? [] : ['Commission'];

  /** @param {string} path @param {'POST' | 'PUT' | 'PATCH'} method @param {any} [body] */
  const send = async (path, method, body) => {
    setNote(null);
    const r = await act(engine, path, { method, body });
    if (!r.ok) setNote({ ok: false, text: actionError(r.error) });
    return r;
  };

  const saveCommission = async () => {
    if (typedError) return false;
    setSaving(true);
    const r = await send(`/api/channels/${c.id}`, 'PATCH', {
      commissionPercent: parsePercent(commission),
    });
    setSaving(false);
    return r.ok;
  };

  /** @param {any} t */
  const switchTour = async (t) => {
    setBusyTour(t.id);
    await send(`/api/channels/${c.id}/tours/${t.id}`, 'PUT', { on: !t.on });
    setBusyTour(null);
  };

  return (
    <div className="stack-md">
      <div className="row-wrap">
        <h2 className="h-xl">{c.name}</h2>
        {!c.isActive && <span className="chip chip--muted">Switched off</span>}
      </div>

      {!c.isActive && (
        <section className="panel panel--pad stack-sm" aria-label="Switched off">
          <p>{offLine(c.name)}</p>
          <p className="channel-kept">{c.keptLine}</p>
          {canEdit && (
            <button
              type="button"
              className="btn btn--dark btn--narrow"
              onClick={() => send(`/api/channels/${c.id}`, 'PATCH', { isActive: true })}
            >
              Switch back on
            </button>
          )}
        </section>
      )}

      {note && (
        <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'done-note' : 'field-error'}>
          {note.text}
        </p>
      )}

      <div className="channel-grid">
        <div className="stack-md">
          <section className="panel panel--pad" aria-label={`Tours on ${c.name}`}>
            <div className="row-between">
              <h3 className="h-md">Tours on {c.name}</h3>
              <span className="small muted">Changes reach {c.name} within a minute</span>
            </div>
            <ul className="plain-list">
              {c.tours.map((/** @type {any} */ t) => (
                <li key={t.id}>
                  <label className={`channel-tour${t.canSwitch ? '' : ' is-draft'}`}>
                    <span className="grow">
                      <strong>{t.title}</strong>
                      <span className="block small muted">{t.note}</span>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      className="switch"
                      checked={t.on}
                      disabled={!canEdit || !t.canSwitch || busyTour !== null}
                      onChange={() => switchTour(t)}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel panel--pad" aria-label={`Latest bookings via ${c.name}`}>
            <div className="row-between">
              <h3 className="h-md">Latest bookings via {c.name}</h3>
              <Link href={`/bookings?channel=${c.id}`} className="text-link">
                All in Bookings ›
              </Link>
            </div>
            {c.bookings.length === 0 ? (
              <p className="muted">No bookings from {c.name} yet.</p>
            ) : (
              <ul className="plain-list">
                {c.bookings.map((/** @type {any} */ b) => (
                  <li key={b.id} className="channel-booking">
                    <Link href={`/bookings/${b.id}`} className="strong">
                      {b.reference}
                    </Link>
                    <span className="channel-booking-who">
                      {b.who}
                      <span className="block small muted">{b.tour}</span>
                    </span>
                    <span className="right">{b.price}</span>
                    <span className={`right small strong ${stateClass(b.tone)}`}>{b.state}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="stack-md">
          <section className="panel panel--pad stack-sm" aria-label="Money">
            <h3 className="h-md">Money</h3>
            <table className="money-table">
              <tbody>
                <tr>
                  <td>{c.money.salesLabel}</td>
                  <td className="right">{c.money.sales}</td>
                </tr>
                <tr>
                  <td className="muted">{c.money.shareLabel}</td>
                  <td className="right muted">{c.money.share}</td>
                </tr>
                <tr className="money-total">
                  <td>{c.money.owedLabel}</td>
                  <td className={`right${c.owedKobo > 0 ? ' tone--warning' : ''}`}>
                    {c.money.owed}
                  </td>
                </tr>
              </tbody>
            </table>
            {c.money.lastPayment && <p className="small muted">{c.money.lastPayment}</p>}
            {canEdit && (
              <button
                type="button"
                className="btn btn--main"
                disabled={c.owedKobo <= 0}
                onClick={() => setAsking('pay')}
              >
                Record a payment from {c.name}
              </button>
            )}
          </section>

          <section className="panel panel--pad stack-sm" aria-label="Commission">
            <label className="field">
              Commission
              <span className="row-wrap">
                <input
                  className="input input--short strong"
                  type="text"
                  inputMode="decimal"
                  value={commission}
                  disabled={!canEdit}
                  onChange={(e) => setCommission(e.target.value)}
                  aria-invalid={Boolean(typedError)}
                />
                <span className="plain">% of the price</span>
              </span>
              {typedError && <span className="field-error plain">{typedError}</span>}
            </label>
            <p className="small muted">New sales use the new %. Past bookings keep theirs.</p>
          </section>

          <section className="panel panel--pad stack-sm" aria-label="Connection">
            <h3 className="h-md">Connection</h3>
            <div className="small">
              <span className="muted">OCTO address</span>
              <code className="block">{c.connection.octoEndpoint}</code>
            </div>
            <div className="small">
              <span className="muted">API key</span>
              <span className="block">{c.connection.keyLine}</span>
            </div>
            {canEdit && c.isActive && (
              <div className="row-wrap">
                <button
                  type="button"
                  className="btn btn--outline btn--compact"
                  onClick={() => setAsking('key')}
                >
                  New key
                </button>
                <button
                  type="button"
                  className="btn btn--danger-outline btn--compact"
                  onClick={() => setAsking('off')}
                >
                  Switch off
                </button>
              </div>
            )}
          </section>
        </div>
      </div>

      <SaveBar
        changed={changed}
        saving={saving}
        blocked={Boolean(typedError)}
        onSave={saveCommission}
        onDiscard={() => setCommission(commissionField(c.commissionBasisPoints))}
      />
      <LeaveGuard changed={changed} what="Your change to the commission" onSave={saveCommission} />

      {asking === 'key' && (
        <Ask
          words={newKeyWords(c.name, c.connection.keyHint)}
          yes="Make a new key"
          no="Keep the old one"
          onNo={() => setAsking(null)}
          onYes={async () => {
            const r = await send(`/api/channels/${c.id}/key`, 'POST');
            setAsking(null);
            if (r.ok)
              onKey({ name: c.name, apiKey: r.body.apiKey, octoEndpoint: r.body.octoEndpoint });
          }}
        />
      )}
      {asking === 'off' && (
        <Ask
          words={{ ...switchOffWords(c.name), kept: null }}
          yes={`Switch off ${c.name}`}
          no="Keep it on"
          onNo={() => setAsking(null)}
          onYes={async () => {
            await send(`/api/channels/${c.id}`, 'PATCH', { isActive: false });
            setAsking(null);
          }}
        />
      )}
      {asking === 'pay' && <PaymentSheet c={c} tz={tz} onClose={() => setAsking(null)} />}
    </div>
  );
}

/**
 * A question asked first (a new key, switching off): red, with the way out beside it.
 * @param {{ words: { title: string, body: string, kept: string | null }, yes: string, no: string, onYes: () => Promise<void>, onNo: () => void }} props
 */
function Ask({ words, yes, no, onYes, onNo }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={words.title} onClose={onNo} alert center>
      <div className="dialog stack-sm">
        <h2 className="h-lg">{words.title}</h2>
        <p>{words.body}</p>
        {words.kept && <p>{words.kept}</p>}
        <div className="row-wrap">
          <button
            type="button"
            className="btn btn--danger btn--compact"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onYes();
            }}
          >
            {busy ? 'One moment…' : yes}
          </button>
          <button type="button" className="btn btn--outline btn--compact" onClick={onNo}>
            {no}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * "Connect a channel": a name and the commission it keeps.
 * @param {{ taken: string[], onClose: () => void, onMade: (made: { name: string, apiKey: string, octoEndpoint: string }) => void }} props
 */
function ConnectSheet({ taken, onClose, onMade }) {
  const engine = useEngine();
  const [, navigate] = useLocation();
  const [form, setForm] = useState(blankConnect);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const errors = tried ? connectErrors(form, taken) : {};

  const connect = async () => {
    setTried(true);
    if (Object.keys(connectErrors(form, taken)).length) return;
    setBusy(true);
    setError(null);
    const r = await act(engine, '/api/channels', { method: 'POST', body: connectBody(form) });
    setBusy(false);
    if (!r.ok) return setError(actionError(r.error));
    navigate(`/settings/channels/${r.body.channel.id}`);
    onMade({ name: r.body.channel.name, apiKey: r.body.apiKey, octoEndpoint: r.body.octoEndpoint });
  };

  return (
    <Sheet title="Connect a channel" onClose={onClose}>
      <form
        className="dialog stack-sm"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          connect();
        }}
      >
        <h2 className="h-lg">Connect a channel</h2>
        <label className="field">
          Name
          <input
            className="input"
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            aria-invalid={Boolean(errors.name)}
          />
          <span className="small muted plain">{viaHelp(form.name)}</span>
          {errors.name && <span className="field-error plain">{errors.name}</span>}
        </label>
        <label className="field">
          Commission it keeps
          <span className="row-wrap">
            <input
              className="input input--short strong"
              type="text"
              inputMode="decimal"
              value={form.commission}
              onChange={(e) => setForm({ ...form, commission: e.target.value })}
              aria-invalid={Boolean(errors.commission)}
            />
            <span className="plain">%</span>
          </span>
          {errors.commission && <span className="field-error plain">{errors.commission}</span>}
        </label>
        <p className="small muted">
          All published tours start switched on. You can change that after.
        </p>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--main" disabled={busy}>
          {busy ? 'Connecting…' : 'Connect and make a key'}
        </button>
        <button type="button" className="btn btn--outline" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Sheet>
  );
}

/**
 * The key, shown once: the OCTO address and the key, each with Copy.
 * @param {{ made: { name: string, apiKey: string, octoEndpoint: string }, onClose: () => void }} props
 */
function KeyOnce({ made, onClose }) {
  const [copied, setCopied] = useState(/** @type {string | null} */ (null));
  /** @param {string} what @param {string} text */
  const copy = async (what, text) => {
    await globalThis.navigator?.clipboard?.writeText(text);
    setCopied(what);
  };
  return (
    <Sheet title={keyOnceTitle(made.name)} onClose={onClose}>
      <div className="dialog stack-sm">
        <h2 className="h-lg">{keyOnceTitle(made.name)}</h2>
        {[
          ['OCTO address', made.octoEndpoint],
          ['API key', made.apiKey],
        ].map(([label, value]) => (
          <div key={label} className="stack-xs">
            <span className="small muted strong">{label}</span>
            <div className="key-row">
              <code className="key-value">{value}</code>
              <button
                type="button"
                className="btn btn--outline btn--compact"
                onClick={() => copy(label, value)}
              >
                {copied === label ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        ))}
        <p role="status" className="unavailable unavailable--warning strong">
          {KEY_ONCE_WARNING}
        </p>
        <button type="button" className="btn btn--dark" onClick={onClose}>
          I’ve stored it
        </button>
      </div>
    </Sheet>
  );
}

/**
 * "Payment received from Sojourna": how much, which day, the bank's reference.
 * @param {{ c: any, tz: string, onClose: () => void }} props
 */
function PaymentSheet({ c, tz, onClose }) {
  const engine = useEngine();
  const today = localDate(new Date(), tz);
  const [form, setForm] = useState(() => paymentForm(c.owedKobo, today));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const check = () => paymentErrors(form, { owedKobo: c.owedKobo, today, name: c.name });
  const errors = tried ? check() : {};
  /** @param {'amount' | 'receivedOn' | 'reference'} k */
  const set = (k) => (/** @type {any} */ e) => setForm({ ...form, [k]: e.target.value });

  const record = async () => {
    setTried(true);
    if (Object.keys(check()).length) return;
    setBusy(true);
    setError(null);
    const r = await act(engine, `/api/channels/${c.id}/payments`, {
      method: 'POST',
      body: paymentBody(form),
    });
    setBusy(false);
    if (!r.ok) return setError(actionError(r.error));
    onClose();
  };

  return (
    <Sheet title={`Payment received from ${c.name}`} onClose={onClose}>
      <form
        className="dialog stack-sm"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          record();
        }}
      >
        <h2 className="h-lg">Payment received from {c.name}</h2>
        <div className="two-fields">
          <label className="field">
            Amount (₦)
            <input
              className="input strong"
              type="text"
              inputMode="decimal"
              value={form.amount}
              onChange={set('amount')}
              aria-invalid={Boolean(errors.amount)}
            />
            {errors.amount && <span className="field-error plain">{errors.amount}</span>}
          </label>
          <label className="field">
            Date received
            <input
              className="input"
              type="date"
              max={today}
              value={form.receivedOn}
              onChange={set('receivedOn')}
              aria-invalid={Boolean(errors.receivedOn)}
            />
            {errors.receivedOn && <span className="field-error plain">{errors.receivedOn}</span>}
          </label>
        </div>
        <label className="field">
          Bank reference
          <input
            className="input"
            type="text"
            value={form.reference}
            onChange={set('reference')}
            aria-invalid={Boolean(errors.reference)}
          />
          {errors.reference && <span className="field-error plain">{errors.reference}</span>}
        </label>
        <p className="small muted">{owedAfterLine(c.owedKobo, form.amount)}</p>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--main" disabled={busy}>
          {busy ? 'Recording…' : recordLabel(form.amount)}
        </button>
        <button type="button" className="btn btn--outline" onClick={onClose}>
          Cancel
        </button>
      </form>
    </Sheet>
  );
}
