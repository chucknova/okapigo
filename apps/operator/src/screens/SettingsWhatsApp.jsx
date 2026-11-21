// @ts-check
/**
 * O10 · Settings › WhatsApp (stage 16e-2): the business's WhatsApp number.
 *
 *   how it stands   "Connected · last message 10:51" · "Waiting for Meta to call the webhook" ·
 *                   "Not connected · using the simulator", and why not
 *   the number      the business number and its name, as guests see them
 *   connect         Meta's Phone number ID; the webhook address to paste in Meta, with Copy
 *   check           send a test to my WhatsApp; disconnect (asked first)
 *
 * The access token and the webhook's verify token are OkapiGo's, kept in the server's settings:
 * never shown here or asked for (decided with the project: keys stay in .env).
 */
import { useState } from 'react';
import { Link } from 'wouter';
import { LiveFrame } from '../components/LiveFrame.jsx';
import { useLive } from '../lib/live.js';
import { useEngine } from '../lib/engine.jsx';
import { act, actionError } from '../lib/office.js';
import { LOOK_ONLY, phoneIdError, testSentLine, whatsappTone } from '../lib/settings.js';

/** @param {{ tz: string, canEdit: boolean }} props */
export function WhatsAppSettings({ tz, canEdit }) {
  const live = useLive('/api/whatsapp');
  return (
    <LiveFrame live={live} what="WhatsApp" forWhom="the owner and managers" tz={tz}>
      {({ whatsapp }) => (
        <WhatsAppPage key={whatsapp.phoneNumberId ?? ''} w={whatsapp} canEdit={canEdit} />
      )}
    </LiveFrame>
  );
}

/** @param {{ w: any, canEdit: boolean }} props */
function WhatsAppPage({ w, canEdit }) {
  const engine = useEngine();
  const [typed, setTyped] = useState(w.phoneNumberId ?? '');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));
  const [test, setTest] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));
  const [testing, setTesting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  const error = touched ? phoneIdError(typed) : null;
  const same = typed.trim() === (w.phoneNumberId ?? '');

  /** @param {string | null} phoneNumberId */
  const save = async (phoneNumberId) => {
    setBusy(true);
    setNote(null);
    const r = await act(engine, '/api/whatsapp', { method: 'PATCH', body: { phoneNumberId } });
    setBusy(false);
    setAsking(false);
    if (!r.ok) return setNote({ ok: false, text: actionError(r.error) });
    setNote({ ok: true, text: phoneNumberId ? 'Number saved.' : 'Disconnected.' });
  };

  const sendTest = async () => {
    setTesting(true);
    setTest(null);
    const r = await act(engine, '/api/whatsapp/test', { method: 'POST' });
    setTesting(false);
    setTest(
      r.ok
        ? { ok: true, text: testSentLine(r.body.test.to) }
        : { ok: false, text: actionError(r.error) },
    );
  };

  return (
    <div className="stack-md">
      <header>
        <h2 className="h-xl">WhatsApp</h2>
        <p className="muted">
          Guests chat with your business number. OkapiGo answers, takes bookings and payments, and
          hands the chat to you when they ask for a person.
        </p>
      </header>

      <section className="panel panel--pad stack-sm" aria-label="How it stands">
        <p className="wa-state">
          <span className={`state-dot state-dot--${whatsappTone(w.state)}`} aria-hidden="true" />
          <strong>{w.stateText}</strong>
        </p>
        {w.why && <p className="small muted">{w.why}</p>}
        <dl className="wa-facts">
          <dt>Business number</dt>
          <dd>
            {w.businessNumber ?? (
              <>
                Not added yet ·{' '}
                <Link href="/settings/website" className="text-link text-link--inline">
                  add it under Website
                </Link>
              </>
            )}
          </dd>
          <dt>Name guests see</dt>
          <dd>{w.displayName}</dd>
        </dl>
      </section>

      {!canEdit && <p className="unavailable">{LOOK_ONLY}</p>}

      <section className="panel panel--pad stack-sm" aria-label="Connect your number">
        <h3 className="h-md">Connect your number</h3>
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!phoneIdError(typed)) save(typed.trim());
          }}
        >
          <fieldset className="plain-fieldset stack-sm" disabled={!canEdit}>
            <label className="field">
              Phone number ID
              <input
                className="input"
                type="text"
                inputMode="numeric"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  setTouched(true);
                }}
                aria-invalid={Boolean(error)}
              />
              <span className="small muted plain">
                From Meta: your app › WhatsApp › API Setup. It’s a long number, not your phone
                number.
              </span>
              {error && <span className="field-error plain">{error}</span>}
            </label>
            <div className="row-wrap">
              <button
                type="submit"
                className="btn btn--dark btn--compact"
                disabled={busy || same || Boolean(error)}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
              {w.phoneNumberId && !asking && (
                <button
                  type="button"
                  className="btn btn--danger-outline btn--compact"
                  onClick={() => setAsking(true)}
                >
                  Disconnect
                </button>
              )}
            </div>
          </fieldset>
        </form>
        {asking && (
          <div className="stack-xs" role="group" aria-label="Disconnect WhatsApp?">
            <p className="small">
              Guests’ WhatsApp messages stop reaching OkapiGo until you connect again. Chats so far
              stay in the inbox.
            </p>
            <div className="row-wrap">
              <button
                type="button"
                className="btn btn--danger btn--compact"
                disabled={busy}
                onClick={() => save(null)}
              >
                Disconnect
              </button>
              <button
                type="button"
                className="btn btn--outline btn--compact"
                onClick={() => setAsking(false)}
              >
                Keep it connected
              </button>
            </div>
          </div>
        )}
        {note && (
          <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'done-note' : 'field-error'}>
            {note.text}
          </p>
        )}
      </section>

      <section className="panel panel--pad stack-sm" aria-label="Webhook">
        <div className="row-between">
          <h3 className="h-md">Webhook address</h3>
          <button
            type="button"
            className="btn btn--outline btn--compact"
            onClick={async () => {
              await globalThis.navigator?.clipboard?.writeText(w.webhookUrl);
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="snippet">
          <code>{w.webhookUrl}</code>
        </pre>
        <p className="small muted">
          In Meta: WhatsApp › Configuration › Webhook. Paste this as the Callback URL and subscribe
          to “messages”. The verify token comes from OkapiGo; it isn’t shown here.
        </p>
      </section>

      {canEdit && (
        <section className="panel panel--pad stack-sm" aria-label="Test">
          <h3 className="h-md">Check it works</h3>
          <p className="small muted">
            Sends a short message from your business number to the phone on your account.
          </p>
          <button
            type="button"
            className="btn btn--outline btn--compact"
            disabled={testing}
            onClick={sendTest}
          >
            {testing ? 'Sending…' : 'Send a test to my WhatsApp'}
          </button>
          {test && (
            <p
              role={test.ok ? 'status' : 'alert'}
              className={test.ok ? 'done-note' : 'field-error'}
            >
              {test.text}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
