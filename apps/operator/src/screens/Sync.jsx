// @ts-check
/**
 * O5 · Sync and conflicts (designs: O5, and Sync edge cases).
 *
 *   a conflict        YOU DID / THE OFFICE HAD / SO NOW, then OK (· Use mine · Call the office)
 *   waiting           "Last sent: 06:40 · 3 changes waiting", each change, "good until…"
 *   sending           each change: sent · sending · next
 *   can't reach us    "Your phone has a connection, but it isn’t getting through"
 *   all synced        "Everything is sent" · Refresh now
 *
 * The words of a conflict come from the server (15b: it knows what it had); this screen
 * lays them out.
 */
import { useState } from 'react';
import { Icon } from '../components/Icon.jsx';
import { useEngine, useNow, useSync } from '../lib/engine.jsx';
import { describeChange } from '../lib/outbox.js';
import { goodUntil, stamp, stripFor } from '../lib/status.js';

export function Sync() {
  const s = useSync();
  const now = useNow(1000);
  const tz = s.pkg?.operator?.timeZone ?? 'Africa/Lagos';
  const conflict = s.conflicts[0];
  if (conflict)
    return (
      <Conflict
        conflict={conflict}
        phone={s.pkg?.operator?.phone ?? null}
        online={s.connection === 'online'}
      />
    );
  if (s.connection === 'unreachable' || s.connection === 'server')
    return <CantReach tz={tz} now={now} />;
  if (s.sending) return <Sending tz={tz} />;
  if (s.outbox.length > 0 || s.signedOut) return <Waiting tz={tz} now={now} />;
  return <AllSent tz={tz} now={now} />;
}

/** @param {{ conflict: any, phone: string | null, online: boolean }} props */
function Conflict({ conflict, phone, online }) {
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const e = conflict.explanation ?? {
    title: 'A change wasn’t applied',
    youDid: conflict.message,
    theyLabel: 'The office had',
    theyHad: '',
    soNow: 'Nothing changed.',
    canUseMine: false,
  };
  /** @param {() => Promise<void>} fn */
  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError('That needs signal. It’s kept here until then.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="page">
      <h1 className="h-xl">{e.title}</h1>
      <section className="card stack-sm conflict">
        <div>
          <div className="eyebrow">You did</div>
          {e.youDid}
        </div>
        {e.theyHad && (
          <div className="conflict-part">
            <div className="eyebrow">{e.theyLabel}</div>
            {e.theyHad}
          </div>
        )}
        <div className="conflict-part">
          <div className="eyebrow">So now</div>
          <SoNow text={e.soNow} />
        </div>
      </section>
      <button
        type="button"
        className="btn btn--dark"
        disabled={busy || !online}
        onClick={() => act(() => engine.dismiss(conflict.id))}
      >
        OK
      </button>
      {e.canUseMine && (
        <button
          type="button"
          className="btn btn--outline"
          disabled={busy || !online}
          onClick={() => act(() => engine.useMine(conflict))}
        >
          Use mine
        </button>
      )}
      {phone && (
        <a className="btn btn--outline" href={`tel:${phone}`}>
          Call the office
        </a>
      )}
      {!online && (
        <p className="small muted">OK needs signal; the conflict stays here until then.</p>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </main>
  );
}

/** "Nothing changed." in bold, the rest plain (as designed). @param {{ text: string }} props */
function SoNow({ text }) {
  const m = /^(Nothing changed[.:]?|Theirs stands[.:]?)(.*)$/.exec(text);
  return m ? (
    <>
      <strong>{m[1]}</strong>
      {m[2]}
    </>
  ) : (
    <>{text}</>
  );
}

/** @param {{ tz: string, now: Date }} props */
function Waiting({ tz, now }) {
  const s = useSync();
  const engine = useEngine();
  const n = s.outbox.length;
  return (
    <main className="page">
      <h1 className="h-xl">Sync</h1>
      <p className="sm muted">
        {s.lastSentAt ? `Last sent: ${stamp(s.lastSentAt, now, tz)} · ` : ''}
        {n} {n === 1 ? 'change' : 'changes'} waiting.{' '}
        {s.signedOut
          ? 'Sign in when you’re back online to send them.'
          : 'They send by themselves when there’s signal.'}
      </p>
      <ChangeList items={s.outbox.map((c) => ({ c, state: 'waiting' }))} tz={tz} />
      {s.savedAt && (
        <p className="small muted">
          Saved copy is good until {goodUntil(s.savedAt, tz)} (72 hours).
        </p>
      )}
      {s.connection === 'online' && !s.signedOut && (
        <button type="button" className="btn btn--outline" onClick={() => engine.sync()}>
          Send now
        </button>
      )}
    </main>
  );
}

/** @param {{ tz: string }} props */
function Sending({ tz }) {
  const s = useSync();
  const recent = s.sent.slice(-(s.sending?.done ?? 0));
  const items = [
    ...recent.map((c) => ({ c, state: 'sent' })),
    ...s.outbox.map((c, i) => ({ c, state: i === 0 ? 'sending' : 'next' })),
  ];
  return (
    <main className="page">
      <h1 className="h-xl">Sync</h1>
      <ChangeList items={items} tz={tz} />
      <p className="small muted">
        Oldest first. If the signal drops again, it carries on later. Nothing is sent twice.
      </p>
    </main>
  );
}

/** @param {{ tz: string, now: Date }} props */
function CantReach({ tz, now }) {
  const s = useSync();
  const engine = useEngine();
  const server = s.connection === 'server';
  return (
    <main className="page">
      <h1 className="h-xl">
        {server
          ? 'OkapiGo is having trouble'
          : 'Your phone has a connection, but it isn’t getting through'}
      </h1>
      <p className="muted">
        {server
          ? 'It’s on our side, not yours. Your changes are safe here and send as soon as it’s fixed.'
          : 'Hotel or café Wi-Fi often needs you to open a login page first. Or the signal may be too weak.'}
      </p>
      <button type="button" className="btn btn--dark" onClick={() => engine.sync()}>
        Try now
      </button>
      {!server && (
        // Any plain http:// page makes a Wi-Fi login page appear; this one exists for that.
        <a className="btn btn--outline" href="http://neverssl.com" target="_blank" rel="noreferrer">
          Open the Wi-Fi login page
        </a>
      )}
      <div className="card sm">
        {s.lastTriedAt ? `Last tried ${stamp(s.lastTriedAt, now, tz)} · ` : ''}
        {s.outbox.length} {s.outbox.length === 1 ? 'change' : 'changes'} waiting. Everything keeps
        working offline meanwhile.
      </div>
      <p className="tiny muted">{stripFor(s, now, tz).text}</p>
    </main>
  );
}

/** @param {{ tz: string, now: Date }} props */
function AllSent({ tz, now }) {
  const s = useSync();
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  return (
    <main className="page center-stack">
      <span className="badge-circle badge-circle--success">
        <Icon name="check" size={32} width={3} />
      </span>
      <h1 className="h-xl">Everything is sent</h1>
      <p className="muted">
        {s.savedAt ? `Last sync ${stamp(s.savedAt, now, tz)}. ` : ''}
        {s.connection === 'offline'
          ? 'You’re offline; today and tomorrow are saved on this phone.'
          : 'Today and tomorrow are saved on this phone.'}
      </p>
      <button
        type="button"
        className="btn btn--outline btn--narrow"
        disabled={busy || s.connection === 'offline'}
        onClick={async () => {
          setBusy(true);
          await engine.sync();
          setBusy(false);
        }}
      >
        {busy ? 'Refreshing…' : 'Refresh now'}
      </button>
    </main>
  );
}

/** @param {{ items: Array<{ c: any, state: 'waiting' | 'sent' | 'sending' | 'next' }>, tz: string }} props */
function ChangeList({ items, tz }) {
  const s = useSync();
  if (items.length === 0) return null;
  return (
    <ol className="list">
      {items.map(({ c, state }) => {
        const d = describeChange(c, s.pkg, tz);
        return (
          <li key={c.id} className="list-row">
            {state === 'sent' ? (
              <Icon name="check" size={22} width={3} className="success" />
            ) : state === 'sending' ? (
              <Icon name="spinner" size={22} className="spin primary-ink" />
            ) : (
              <Icon name="clock" size={22} className="muted" />
            )}
            <span className="grow">
              <span className="block strong-ish">{d.who}</span>
              <span className="small muted">
                {d.what}
                {state === 'waiting' ? '' : ` · ${state}`}
              </span>
            </span>
            {state === 'waiting' && <span className="small muted tabular">{d.time}</span>}
          </li>
        );
      })}
    </ol>
  );
}
