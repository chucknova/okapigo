// @ts-check
/**
 * O10 · Settings › Staff and roles (stage 16e-3; designs: "O10 Settings — WhatsApp and staff",
 * "Staff and form states", "phone").
 *
 *   the team        each person: how they sign in, their role, how they stand ("Active ·
 *                   synced 07:31", "Invited · hasn't signed in", "No access"); Edit, or Resend
 *   invite someone  name, email or phone, role → emailed, or the words to copy for a phone
 *   edit            name, how they sign in, role (making someone an owner asks first); remove
 *                   access, or give it back
 *   remove          "Remove Tolu's access?": signed out at once, what their phone had waiting,
 *                   the departures that will have no guide, then those departures, to reassign
 *
 * Managers and guides don't see this section at all (the menu hides it). The rules (the
 * checks, what's sent, the words for removing someone) are in lib/settings.js; the server
 * keeps at least one owner and refuses changing your own role or access.
 */
import { useState } from 'react';
import { Link } from 'wouter';
import { LiveFrame } from '../components/LiveFrame.jsx';
import { Sheet } from '../components/Sheet.jsx';
import { useLive } from '../lib/live.js';
import { useEngine } from '../lib/engine.jsx';
import { act, actionError } from '../lib/office.js';
import {
  LOOK_ONLY,
  OWNER_WARNING,
  becomesOwner,
  firstName,
  inviteLine,
  removeWords,
  roleChoices,
  roleLine,
  staffBody,
  staffErrors,
  staffForm,
  staffTone,
} from '../lib/settings.js';

/** @param {{ tz: string, canEdit: boolean }} props */
export function StaffSettings({ tz, canEdit }) {
  const live = useLive('/api/staff');
  const roles = useLive('/api/roles');
  return (
    <LiveFrame live={live} what="Your team" forWhom="the owner" tz={tz}>
      {({ staff, you }) => (
        <StaffPage
          staff={staff}
          you={you}
          roles={roleChoices(roles.entry.data?.roles ?? [])}
          canEdit={canEdit}
        />
      )}
    </LiveFrame>
  );
}

/** @param {{ staff: any[], you: string, roles: any[], canEdit: boolean }} props */
function StaffPage({ staff, you, roles, canEdit }) {
  const engine = useEngine();
  const [editing, setEditing] = useState(/** @type {string | null} */ (null));
  const [invite, setInvite] = useState(/** @type {any} */ (null));
  const [removed, setRemoved] = useState(
    /** @type {{ name: string, unguided: { id: string, text: string }[] } | null} */ (null),
  );
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const row = staff.find((x) => x.id === editing) ?? null;

  /** @param {any} person */
  const resend = async (person) => {
    setError(null);
    const r = await act(engine, `/api/staff/${person.id}/invite`, { method: 'POST' });
    if (!r.ok) return setError(actionError(r.error));
    setInvite(r.body.invite);
  };

  return (
    <div className="stack-md">
      <header>
        <h2 className="h-xl">Staff and roles</h2>
        <p className="muted">
          Everyone who uses OkapiGo for your business. They sign in with their email or phone and a
          code: no passwords.
        </p>
      </header>
      {!canEdit && <p className="unavailable">{LOOK_ONLY}</p>}

      {removed && (
        <section className="panel panel--pad stack-xs" role="status" aria-label="Removed">
          <strong>{firstName(removed.name)}’s access is removed.</strong>
          {removed.unguided.length > 0 && (
            <>
              <span className="small">Now without a guide: assign someone.</span>
              <ul className="plain-list stack-xs">
                {removed.unguided.map((d) => (
                  <li key={d.id}>
                    <Link href={`/departures/${d.id}`} className="text-link">
                      {d.text} ›
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <ul className="plain-list staff-list" aria-label="Staff">
        {staff.map((p) => (
          <li key={p.id} className="staff-row">
            <span className="staff-who">
              <strong>
                {p.name}
                {p.id === you && <span className="muted"> (you)</span>}
              </strong>
              <span className="small muted">{p.contact}</span>
              <span className="staff-meta small">
                <strong className="staff-role">{p.role.name}</strong>
                <span className="staff-status">
                  <span
                    className={`state-dot state-dot--${staffTone(p.status)}`}
                    aria-hidden="true"
                  />
                  {p.statusText}
                </span>
              </span>
            </span>
            {canEdit && (
              <span className="staff-actions">
                {p.status === 'invited' && (
                  <button
                    type="button"
                    className="btn btn--outline btn--compact"
                    onClick={() => resend(p)}
                    aria-label={`Resend ${p.name}’s invitation`}
                  >
                    Resend
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--outline btn--compact"
                  onClick={() => {
                    setEditing(p.id);
                    setRemoved(null);
                  }}
                  aria-label={`Edit ${p.name}`}
                >
                  Edit
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}

      {canEdit && (
        <InviteForm
          roles={roles}
          invite={invite}
          onInvited={(i) => {
            setInvite(i);
            setRemoved(null);
          }}
        />
      )}

      <section className="panel panel--pad stack-xs" aria-label="What each role can do">
        <h3 className="h-md">What each role can do</h3>
        {roles
          .filter((r) => r.isPreset)
          .slice()
          .reverse()
          .map((r) => (
            <p key={r.id} className="small">
              <strong>{r.name}:</strong> {roleLine(r)}
            </p>
          ))}
        <p className="small muted">
          Removing someone signs them out at once. Anything still waiting on their phone (check-ins
          made without signal) doesn’t arrive after that, so ask them to open OkapiGo with signal
          first if you can.
        </p>
      </section>

      {row && (
        <EditSheet
          row={row}
          isYou={row.id === you}
          roles={roles}
          onClose={() => setEditing(null)}
          onRemoved={(unguided) => {
            setEditing(null);
            setRemoved({ name: row.name, unguided });
          }}
        />
      )}
    </div>
  );
}

/**
 * "Invite someone" (designs: email or phone, role, Invite; a name too, for the list and the
 * invitation's "Hi Dayo").
 * @param {{ roles: any[], invite: any, onInvited: (invite: any) => void }} props
 */
function InviteForm({ roles, invite, onInvited }) {
  const engine = useEngine();
  const guide = roles.find((r) => r.key === 'guide');
  const blank = { name: '', contact: '', roleId: guide?.id ?? '' };
  const [form, setForm] = useState(blank);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [copied, setCopied] = useState(false);
  // The role menu fills in once the roles arrive.
  const f = { ...form, roleId: form.roleId || (guide?.id ?? '') };
  const errors = tried ? staffErrors(f) : {};
  const role = roles.find((r) => r.id === f.roleId);
  return (
    <section className="panel panel--pad stack-sm" aria-label="Invite someone">
      <h3 className="h-md">Invite someone</h3>
      <form
        className="stack-sm"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setTried(true);
          if (Object.keys(staffErrors(f)).length) return;
          setBusy(true);
          setError(null);
          setCopied(false);
          const r = await act(engine, '/api/staff', {
            method: 'POST',
            body: { name: f.name.trim(), contact: f.contact.trim(), roleId: f.roleId },
          });
          setBusy(false);
          if (!r.ok) return setError(actionError(r.error));
          setForm(blank);
          setTried(false);
          onInvited(r.body.invite);
        }}
      >
        <div className="field-pair">
          <label className="field">
            Name
            <input
              className="input"
              type="text"
              value={f.name}
              onChange={(e) => setForm({ ...f, name: e.target.value })}
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name && <span className="field-error plain">{errors.name}</span>}
          </label>
          <label className="field">
            Email or phone
            <input
              className="input"
              type="text"
              inputMode="email"
              value={f.contact}
              onChange={(e) => setForm({ ...f, contact: e.target.value })}
              aria-invalid={Boolean(errors.contact)}
            />
            {errors.contact && <span className="field-error plain">{errors.contact}</span>}
          </label>
        </div>
        <label className="field">
          Role
          <select
            className="input"
            value={f.roleId}
            onChange={(e) => setForm({ ...f, roleId: e.target.value })}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {role && <span className="small muted plain">{roleLine(role)}</span>}
        </label>
        <button type="submit" className="btn btn--dark btn--compact" disabled={busy}>
          {busy ? 'Inviting…' : 'Invite'}
        </button>
      </form>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {invite && (
        <div className="stack-xs" role="status" aria-label="Invitation">
          <p className={invite.how === 'email' ? 'done-note' : 'small'}>{inviteLine(invite)}</p>
          {invite.how === 'copy' && (
            <>
              <pre className="approved-text invite-words">{invite.words}</pre>
              <button
                type="button"
                className="btn btn--outline btn--compact"
                onClick={async () => {
                  await globalThis.navigator?.clipboard?.writeText(invite.words);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy the words'}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Edit a staff member (designs: name, email or phone, role, its line; Remove access · Save),
 * and the question before removing them.
 * @param {{ row: any, isYou: boolean, roles: any[], onClose: () => void, onRemoved: (unguided: any[]) => void }} props
 */
function EditSheet({ row, isYou, roles, onClose, onRemoved }) {
  const engine = useEngine();
  const saved = staffForm(row);
  const [form, setForm] = useState(saved);
  const [step, setStep] = useState(/** @type {'edit' | 'owner' | 'remove'} */ ('edit'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const errors = staffErrors(form);
  const body = staffBody(form, saved);
  const role = roles.find((r) => r.id === form.roleId) ?? row.role;
  const first = firstName(row.name);
  const words = removeWords(row);

  /** @param {Record<string, unknown>} patch */
  const send = async (patch) => {
    setBusy(true);
    setError(null);
    const r = await act(engine, `/api/staff/${row.id}`, { method: 'PATCH', body: patch });
    setBusy(false);
    if (!r.ok) {
      setError(actionError(r.error));
      setStep('edit');
      return null;
    }
    return r.body;
  };

  const save = async () => {
    if (Object.keys(errors).length || Object.keys(body).length === 0) return;
    if (step === 'edit' && becomesOwner(roles, form, saved)) return setStep('owner');
    if (await send(body)) onClose();
  };

  return (
    <Sheet title={`Edit ${row.name}`} onClose={onClose}>
      <form
        className="dialog"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {step === 'remove' ? (
          <div className="stack-sm" role="group" aria-label={words.title}>
            <h2 className="h-lg">{words.title}</h2>
            <p>{words.signOut}</p>
            {words.waiting && <p className="unavailable unavailable--warning">{words.waiting}</p>}
            {words.departures && (
              <div className="stack-xs">
                <p className="strong">{words.departures}</p>
                <ul className="plain-list stack-xs">
                  {row.upcoming.map((/** @type {any} */ d) => (
                    <li key={d.id} className="small">
                      {d.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy}
              onClick={async () => {
                const done = await send({ isActive: false });
                if (done) onRemoved(done.unguided);
              }}
            >
              {busy ? 'Removing…' : words.yes}
            </button>
            <button type="button" className="btn btn--outline" onClick={() => setStep('edit')}>
              {words.no}
            </button>
          </div>
        ) : step === 'owner' ? (
          <div className="stack-sm" role="group" aria-label={`Make ${first} an owner?`}>
            <h2 className="h-lg">Make {first} an owner?</h2>
            <p>{OWNER_WARNING}</p>
            <button type="submit" className="btn btn--dark" disabled={busy}>
              {busy ? 'Saving…' : `Make ${first} an owner`}
            </button>
            <button type="button" className="btn btn--outline" onClick={() => setStep('edit')}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="stack-sm">
            <h2 className="h-lg">{row.name}</h2>
            <label className="field">
              Name
              <input
                className="input"
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name && <span className="field-error plain">{errors.name}</span>}
            </label>
            <label className="field">
              Email or phone
              <input
                className="input"
                type="text"
                value={form.contact}
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
                aria-invalid={Boolean(errors.contact)}
              />
              <span className="small muted plain">What they sign in with.</span>
              {errors.contact && <span className="field-error plain">{errors.contact}</span>}
            </label>
            <label className="field">
              Role
              <select
                className="input"
                value={form.roleId}
                disabled={isYou || !row.isActive}
                onChange={(e) => setForm({ ...form, roleId: e.target.value })}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <span className="small muted plain">
                {isYou ? 'You can’t change your own role.' : roleLine(role)}
              </span>
            </label>
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            <div className="row-wrap">
              <button
                type="submit"
                className="btn btn--dark btn--compact"
                disabled={busy || Object.keys(errors).length > 0 || Object.keys(body).length === 0}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
              {!isYou && row.isActive && (
                <button
                  type="button"
                  className="btn btn--danger-outline btn--compact"
                  onClick={() => setStep('remove')}
                >
                  Remove access
                </button>
              )}
              {!row.isActive && (
                <button
                  type="button"
                  className="btn btn--outline btn--compact"
                  disabled={busy}
                  onClick={async () => {
                    if (await send({ isActive: true })) onClose();
                  }}
                >
                  Give access back
                </button>
              )}
              <button type="button" className="btn btn--outline btn--compact" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </form>
    </Sheet>
  );
}
