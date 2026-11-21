// @ts-check
/**
 * O10 · Settings › Messages (stage 16e-2): the words guests get, by WhatsApp and email.
 *
 *   the list      each message, when it goes, "Default" or "Edited"; then the one message that
 *                 has only WhatsApp's approved wording ("Can we help you finish booking?")
 *   one message   WhatsApp · Email; details to insert where the cursor is; what it must keep;
 *                 the preview with one of your own bookings; the approved version a guest gets
 *                 after 24 hours; send a test to my WhatsApp; back to OkapiGo's wording; save
 *
 * The rules (what's wrong, what must stay, the 24-hour rule in words) are in lib/settings.js;
 * the server checks the same ones before it saves.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { LiveFrame } from '../components/LiveFrame.jsx';
import { SaveBar, LeaveGuard } from '../components/SaveBar.jsx';
import { useLive } from '../lib/live.js';
import { useEngine } from '../lib/engine.jsx';
import { act, actionError } from '../lib/office.js';
import { request } from '../lib/api.js';
import { localTime } from '@okapigo/shared/time';
import {
  LOOK_ONLY,
  approvedText,
  detailLabel,
  exampleLine,
  insertDetail,
  messageChanges,
  messageForm,
  messageProblems,
  messageRows,
  mustKeep,
  testSentLine,
  whatsappRule,
} from '../lib/settings.js';

/** @param {{ tz: string, canEdit: boolean, kind: string | null }} props */
export function MessagesSettings({ tz, canEdit, kind }) {
  const live = useLive('/api/message-templates');
  return (
    <LiveFrame live={live} what="Your messages" forWhom="the owner" tz={tz}>
      {(data) => {
        const t = kind ? data.templates.find((/** @type {any} */ x) => x.kind === kind) : null;
        return t ? (
          <MessageEditor key={t.kind} t={t} tz={tz} canEdit={canEdit} />
        ) : (
          <MessageList data={data} />
        );
      }}
    </LiveFrame>
  );
}

/** @param {{ data: any }} props */
function MessageList({ data }) {
  return (
    <div className="stack-md">
      <header>
        <h2 className="h-xl">Messages</h2>
        <p className="muted">
          What guests get from you, by WhatsApp and email. Change the words; the details (name,
          date, links) fill in for each booking.
        </p>
      </header>
      <ul className="plain-list message-list" aria-label="Messages">
        {messageRows(data).map((/** @type {any} */ m) => (
          <li key={m.kind}>
            <Link href={`/settings/messages/${m.kind}`} className="settings-link message-link">
              <span className="grow stack-xs">
                <span>{m.name}</span>
                <span className="small muted plain">Goes {m.when}</span>
              </span>
              <span className={`chip${m.tag === 'Edited' ? ' chip--edited' : ''}`}>{m.tag}</span>
              <span aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>
      <section className="panel panel--pad stack-sm" aria-label="Approved by WhatsApp only">
        <h3 className="h-md">WhatsApp’s approved wording only</h3>
        <p className="small muted">
          These go to a guest who last wrote more than 24 hours ago, so only Meta’s approved words
          can be used. They can’t be edited.
        </p>
        {data.approvedOnly.map((/** @type {any} */ a) => (
          <div key={a.key} className="stack-xs">
            <strong>{a.name}</strong>
            <span className="small muted">Goes {a.when}</span>
            <p className="approved-text">{approvedText(a.text)}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

/**
 * The preview, as a guest would get it, with one of the business's own bookings; asked for a
 * moment after the typing stops.
 * @param {string} kind @param {{ subject: string, body: string }} form
 */
function usePreview(kind, form) {
  const engine = useEngine();
  const [preview, setPreview] = useState(
    /** @type {{ preview: { subject: string, body: string }, example: string | null } | null} */ (
      null
    ),
  );
  const { subject, body } = form;
  useEffect(() => {
    let gone = false;
    const timer = setTimeout(async () => {
      try {
        const res = await request(`/api/message-templates/${kind}/preview`, {
          method: 'POST',
          body: { subject, body },
          token: engine.getState().session?.token ?? null,
        });
        if (!gone) setPreview(res.body);
      } catch {
        // No connection: the last preview stays.
      }
    }, 300);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [engine, kind, subject, body]);
  return preview;
}

/** One message (designs: the editor). @param {{ t: any, tz: string, canEdit: boolean }} props */
function MessageEditor({ t, tz, canEdit }) {
  const engine = useEngine();
  const [saved, setSaved] = useState(() => messageForm(t));
  const [form, setForm] = useState(saved);
  const [edited, setEdited] = useState(Boolean(t.custom));
  const [tab, setTab] = useState(/** @type {'whatsapp' | 'email'} */ ('whatsapp'));
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));
  const [test, setTest] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const bodyRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  const subjectRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  // Where a detail goes: the last field the cursor was in.
  const [into, setInto] = useState(/** @type {'subject' | 'body'} */ ('body'));
  const problems = messageProblems(t.kind, form);
  const changed = messageChanges(form, saved);
  const keep = mustKeep(t, form.body);
  const preview = usePreview(t.kind, form);

  /** @param {string} name */
  const insert = (name) => {
    const el = into === 'subject' && tab === 'email' ? subjectRef.current : bodyRef.current;
    const field = el === subjectRef.current ? 'subject' : 'body';
    const at = el
      ? { start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length }
      : { start: form[field].length, end: form[field].length };
    const next = insertDetail(form[field], at, name);
    setForm({ ...form, [field]: next.text });
    // Back into the field, just after the detail.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  };

  const save = async () => {
    if (problems.length) return false;
    setSaving(true);
    setNote(null);
    const r = await act(engine, `/api/message-templates/${t.kind}`, { method: 'PUT', body: form });
    setSaving(false);
    if (!r.ok) {
      setNote({
        ok: false,
        text:
          r.error.kind === 'offline' || r.error.kind === 'unreachable'
            ? 'Didn’t save: no connection. Your changes are still here.'
            : actionError(r.error),
      });
      return false;
    }
    setSaved(form);
    setEdited(true);
    setNote({ ok: true, text: `Saved · ${localTime(new Date(), tz)}.` });
    return true;
  };

  const reset = async () => {
    setNote(null);
    const r = await act(engine, `/api/message-templates/${t.kind}`, { method: 'DELETE' });
    setResetting(false);
    if (!r.ok) return setNote({ ok: false, text: actionError(r.error) });
    const back = { subject: t.default.subject, body: t.default.body };
    setSaved(back);
    setForm(back);
    setEdited(false);
    setNote({ ok: true, text: 'Back to OkapiGo’s wording.' });
  };

  const sendTest = async () => {
    setTesting(true);
    setTest(null);
    const r = await act(engine, `/api/message-templates/${t.kind}/test`, {
      method: 'POST',
      body: form,
    });
    setTesting(false);
    setTest(
      r.ok
        ? { ok: true, text: testSentLine(r.body.test.to) }
        : { ok: false, text: actionError(r.error) },
    );
  };

  return (
    <div className="stack-md">
      <Link href="/settings/messages" className="back-link">
        ‹ Messages
      </Link>
      <header>
        <h2 className="h-xl">{t.name}</h2>
        <p className="muted">
          Goes {t.when}. <span className="chip">{edited ? 'Edited' : 'Default'}</span>
        </p>
      </header>
      {!canEdit && <p className="unavailable">{LOOK_ONLY}</p>}

      <fieldset className="segmented">
        <legend className="visually-hidden">WhatsApp or email</legend>
        {[
          ['whatsapp', 'WhatsApp'],
          ['email', 'Email'],
        ].map(([key, label]) => (
          <label key={key} className={tab === key ? 'is-on' : ''}>
            <input
              type="radio"
              name="channel"
              checked={tab === key}
              onChange={() => setTab(/** @type {'whatsapp' | 'email'} */ (key))}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <section className="panel panel--pad stack-sm" aria-label="The words">
        <fieldset className="plain-fieldset stack-sm" disabled={!canEdit}>
          {tab === 'email' && (
            <label className="field">
              Subject
              <input
                ref={subjectRef}
                className="input"
                type="text"
                value={form.subject}
                onFocus={() => setInto('subject')}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </label>
          )}
          <div className="stack-xs">
            <span className="strong">Insert a detail</span>
            <div className="chips" role="group" aria-label="Insert a detail">
              {t.placeholders.map((/** @type {any} */ p) => (
                <button
                  key={p.name}
                  type="button"
                  className="chip chip--detail"
                  title={p.description}
                  onClick={() => insert(p.name)}
                >
                  + {detailLabel(p.name)}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            Message
            <textarea
              ref={bodyRef}
              className="textarea"
              rows={9}
              value={form.body}
              onFocus={() => setInto('body')}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              aria-invalid={problems.length > 0}
            />
            <span className="small muted plain">
              {tab === 'whatsapp'
                ? 'The same words go in the email.'
                : 'The same words as the WhatsApp message, inside your email’s layout.'}
            </span>
          </label>
        </fieldset>
        <p className="small" aria-label="Must keep">
          <span className="strong">Must keep: </span>
          {keep.map((/** @type {any} */ k) => (
            <span key={k.name} className={`chip ${k.kept ? 'chip--paid' : 'chip--owes'}`}>
              {k.label} {k.kept ? '✓' : '✗'}
            </span>
          ))}
        </p>
        {problems.length > 0 && (
          <ul role="alert" className="field-error plain-list">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel panel--pad stack-sm" aria-label="Preview">
        <h3 className="h-md">Preview</h3>
        <p className="small muted">{preview ? exampleLine(preview.example) : 'Loading…'}</p>
        {preview &&
          (tab === 'whatsapp' ? (
            <div className="chat-log">
              <div className="bubble bubble--out">
                <span className="bubble-text">{preview.preview.body}</span>
              </div>
            </div>
          ) : (
            <div className="email-preview">
              <strong>{preview.preview.subject}</strong>
              <p className="bubble-text">{preview.preview.body}</p>
            </div>
          ))}
        {canEdit && (
          <div className="stack-xs">
            <button
              type="button"
              className="btn btn--outline btn--compact"
              disabled={testing || problems.length > 0}
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
          </div>
        )}
      </section>

      {t.approved && (
        <section className="panel panel--pad stack-sm" aria-label="After 24 hours">
          <h3 className="h-md">If they haven’t written in 24 hours</h3>
          <p className="small muted">{whatsappRule(t)}</p>
          <p className="approved-text">{approvedText(t.approved)}</p>
        </section>
      )}

      {canEdit && edited && (
        <div className="stack-xs">
          {resetting ? (
            <div className="row-wrap" role="group" aria-label="Back to OkapiGo’s wording?">
              <span className="small">Your wording will be replaced by OkapiGo’s.</span>
              <button
                type="button"
                className="btn btn--danger-outline btn--compact"
                onClick={reset}
              >
                Use OkapiGo’s wording
              </button>
              <button
                type="button"
                className="btn btn--outline btn--compact"
                onClick={() => setResetting(false)}
              >
                Keep mine
              </button>
            </div>
          ) : (
            <button type="button" className="text-link" onClick={() => setResetting(true)}>
              Back to OkapiGo’s wording
            </button>
          )}
        </div>
      )}

      {note && (
        <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'done-note' : 'field-error'}>
          {note.text}
        </p>
      )}
      <SaveBar
        changed={changed}
        saving={saving}
        blocked={problems.length > 0}
        onSave={save}
        onDiscard={() => {
          setForm(saved);
          setNote(null);
        }}
      />
      <LeaveGuard changed={changed} what={`Your change to “${t.name}”`} onSave={save} />
    </div>
  );
}
