// @ts-check
/**
 * O10 · Settings › Tours (stage 16e-4a; designs: "Settings — Tours").
 *
 *   the list     each tour, when it runs ("Daily 09:00 · 15 seats"), ON SALE / DRAFT; New tour
 *   a new tour   name, summary, duration, seats, how it travels, where guests meet (and the map
 *                pin, pasted) → a draft, opened to finish
 *   one tour     its status (on sale, or not, and why), and Basics: name, short name, summary,
 *                description, duration, how it travels, the meeting point and its pin, arrive
 *                by, and the text lists (stops, included, not included, what to bring, FAQs);
 *                Prices and Schedule and seats (16e-4b, SettingsTourSections.jsx); one save
 *                bar for all of them. Extras, Pickup points, Cancellation and deposit (16e-4c).
 *
 * Owners edit; a manager can look (products: view). The rules are in lib/tours.js.
 */
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { LiveFrame } from '../components/LiveFrame.jsx';
import { SaveBar, LeaveGuard } from '../components/SaveBar.jsx';
import { useLive } from '../lib/live.js';
import { useSaveParts, useSavePart } from '../lib/save-parts.js';
import { Prices, Schedule, Extras, Pickups, Terms } from './SettingsTourSections.jsx';
import { useEngine } from '../lib/engine.jsx';
import { act, actionError } from '../lib/office.js';
import { localTime } from '@okapigo/shared/time';
import { LOOK_ONLY, fixLine, countLine } from '../lib/settings.js';
import {
  TRANSPORT_CHOICES,
  basicsBody,
  basicsChanges,
  basicsErrors,
  basicsForm,
  blankTour,
  newTourBody,
  newTourErrors,
  pinLine,
  saleWords,
  statusLine,
  tourRows,
} from '../lib/tours.js';

/** @param {{ tz: string, canEdit: boolean, item: string | null }} props */
export function ToursSettings({ tz, canEdit, item }) {
  if (item === 'new') return <NewTour canEdit={canEdit} />;
  if (item) return <OneTour id={item} tz={tz} canEdit={canEdit} />;
  return <TourList tz={tz} canEdit={canEdit} />;
}

/** @param {{ tz: string, canEdit: boolean }} props */
function TourList({ tz, canEdit }) {
  const live = useLive('/api/products');
  return (
    <LiveFrame live={live} what="Your tours" tz={tz}>
      {({ products }) => (
        <div className="stack-md">
          <header className="row-between">
            <h2 className="h-xl">Tours</h2>
            {canEdit && (
              <Link href="/settings/tours/new" className="btn btn--dark btn--compact">
                New tour
              </Link>
            )}
          </header>
          {!canEdit && <p className="unavailable">{LOOK_ONLY}</p>}
          {products.length === 0 ? (
            <p className="muted">No tours yet. Add your first with New tour.</p>
          ) : (
            <ul className="plain-list staff-list" aria-label="Tours">
              {tourRows(products).map((t) => (
                <li key={t.id}>
                  <Link href={`/settings/tours/${t.id}`} className="tour-row">
                    <span className="grow stack-xs">
                      <strong>{t.title}</strong>
                      <span className="small muted">{t.runs}</span>
                    </span>
                    <span className={`chip chip--${t.tone}`}>{t.tag}</span>
                    <span aria-hidden="true">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </LiveFrame>
  );
}

/** "New tour": the least it takes to make a draft. @param {{ canEdit: boolean }} props */
function NewTour({ canEdit }) {
  const engine = useEngine();
  const [, navigate] = useLocation();
  const [form, setForm] = useState(blankTour);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const errors = tried ? newTourErrors(form) : {};
  const set = (/** @type {keyof typeof form} */ k) => (/** @type {any} */ e) =>
    setForm({ ...form, [k]: e.target.value });
  /** @param {keyof typeof form} k @param {string} label @param {any} [extra] */
  const field = (k, label, extra = {}) => (
    <label className="field">
      {label}
      <input
        className="input"
        type="text"
        inputMode={extra.inputMode}
        value={form[k]}
        onChange={set(k)}
        aria-invalid={Boolean(errors[k])}
      />
      {extra.help && <span className="small muted plain">{extra.help}</span>}
      {errors[k] && <span className="field-error plain">{errors[k]}</span>}
    </label>
  );
  if (!canEdit) return <p className="unavailable">{LOOK_ONLY}</p>;
  return (
    <div className="stack-md">
      <Link href="/settings/tours" className="back-link">
        ‹ Tours
      </Link>
      <header>
        <h2 className="h-xl">New tour</h2>
        <p className="muted">
          The basics first. It starts as a draft: nobody can book it until you put it on sale.
        </p>
      </header>
      <form
        className="panel panel--pad stack-sm"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setTried(true);
          if (Object.keys(newTourErrors(form)).length) return;
          setBusy(true);
          setError(null);
          const r = await act(engine, '/api/products', { method: 'POST', body: newTourBody(form) });
          setBusy(false);
          if (!r.ok) return setError(actionError(r.error));
          navigate(`/settings/tours/${r.body.product.id}`);
        }}
      >
        {field('title', 'Name', { help: 'Like “Epe Fish Market Morning”' })}
        {field('summary', 'Summary', { help: 'One line for the tour’s card' })}
        <div className="field-pair">
          <fieldset className="plain-fieldset stack-xs">
            <legend className="strong">Duration</legend>
            <div className="row-wrap">
              <label className="field field--inline">
                <input
                  className="input input--short"
                  inputMode="numeric"
                  value={form.hours}
                  onChange={set('hours')}
                  aria-invalid={Boolean(errors.hours)}
                />
                hours
              </label>
              <label className="field field--inline">
                <input
                  className="input input--short"
                  inputMode="numeric"
                  value={form.minutes}
                  onChange={set('minutes')}
                />
                minutes
              </label>
            </div>
            {errors.hours && <span className="field-error plain">{errors.hours}</span>}
          </fieldset>
          {field('seats', 'Seats per departure', { inputMode: 'numeric' })}
        </div>
        <TransportChoice
          value={form.transport}
          onChange={(v) => setForm({ ...form, transport: v })}
        />
        {field('meetingName', 'Meeting point', { help: 'Where guests meet: “Epe jetty”' })}
        {field('meetingAddress', 'Address')}
        {field('pin', 'Map pin', {
          help: pinLine(form.pin) ?? 'Paste a Google Maps link, or the coordinates.',
        })}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--dark btn--compact" disabled={busy}>
          {busy ? 'Making it…' : 'Make the draft'}
        </button>
      </form>
    </div>
  );
}

/** @param {{ value: string, onChange: (v: string) => void }} props */
function TransportChoice({ value, onChange }) {
  return (
    <fieldset className="plain-fieldset stack-xs">
      <legend className="strong">How it travels</legend>
      <div className="segmented">
        {TRANSPORT_CHOICES.map((c) => (
          <label key={c.key} className={value === c.key ? 'is-on' : ''}>
            <input
              type="radio"
              name="transport"
              checked={value === c.key}
              onChange={() => onChange(c.key)}
            />
            {c.label}
          </label>
        ))}
      </div>
      <span className="small muted">{TRANSPORT_CHOICES.find((c) => c.key === value)?.hint}</span>
    </fieldset>
  );
}

/** @param {{ id: string, tz: string, canEdit: boolean }} props */
function OneTour({ id, tz, canEdit }) {
  const live = useLive(`/api/products/${id}`);
  return (
    <LiveFrame live={live} what="This tour" tz={tz}>
      {({ product }) => <TourPage product={product} tz={tz} canEdit={canEdit} />}
    </LiveFrame>
  );
}

/**
 * One tour: its sections, and one save bar for all of them (lib/save-parts.js).
 * @param {{ product: any, tz: string, canEdit: boolean }} props
 */
function TourPage({ product, tz, canEdit }) {
  const parts = useSaveParts();
  return (
    <div className="stack-md">
      <Link href="/settings/tours" className="back-link">
        ‹ Tours
      </Link>
      <header className="stack-xs">
        <h2 className="h-xl">{product.title}</h2>
        <OnSale product={product} canEdit={canEdit} />
      </header>
      {!canEdit && <p className="unavailable">{LOOK_ONLY}</p>}
      <fieldset className="plain-fieldset stack-md" disabled={!canEdit}>
        <Basics
          key={`basics-${product.id}`}
          product={product}
          tz={tz}
          part={parts.part('basics')}
        />
        <Prices
          key={`prices-${product.id}`}
          product={product}
          tz={tz}
          part={parts.part('prices')}
        />
        <Schedule
          key={`schedule-${product.id}`}
          product={product}
          tz={tz}
          canEdit={canEdit}
          part={parts.part('schedule')}
        />
        <Extras
          key={`extras-${product.id}`}
          product={product}
          tz={tz}
          part={parts.part('extras')}
        />
        <Pickups
          key={`pickups-${product.id}`}
          product={product}
          tz={tz}
          part={parts.part('pickups')}
        />
        <Terms key={`terms-${product.id}`} product={product} tz={tz} part={parts.part('terms')} />
      </fieldset>
      <SaveBar
        changed={parts.changed}
        saving={parts.saving}
        blocked={parts.blocked}
        onSave={parts.saveAll}
        onDiscard={parts.discardAll}
      />
      <LeaveGuard
        changed={parts.changed}
        what={`Your change to ${parts.changed.join(', ').toLowerCase()} on ${product.title}`}
        onSave={parts.saveAll}
      />
    </div>
  );
}

/** On sale or not, and the button to change it. @param {{ product: any, canEdit: boolean }} props */
function OnSale({ product, canEdit }) {
  const engine = useEngine();
  const words = saleWords(product);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  /** @param {string} status */
  const change = async (status) => {
    setBusy(true);
    setError(null);
    const r = await act(engine, `/api/products/${product.id}`, {
      method: 'PATCH',
      body: { status },
    });
    setBusy(false);
    setAsking(false);
    if (!r.ok) setError(actionError(r.error));
  };
  return (
    <div className="stack-xs" aria-label="On sale">
      <p className="row-wrap">
        <span
          className={`state-dot state-dot--${product.status === 'published' ? 'success' : 'warning'}`}
          aria-hidden="true"
        />
        <strong>{statusLine(product.status)}</strong>
        {canEdit && !asking && product.status !== 'archived' && (
          <button
            type="button"
            className="btn btn--outline btn--compact"
            disabled={busy || !words.ready}
            onClick={() => (words.ask ? setAsking(true) : change('published'))}
          >
            {words.action}
          </button>
        )}
      </p>
      {words.why && canEdit && <p className="small muted">{words.why}</p>}
      {asking && (
        <div className="stack-xs" role="group" aria-label="Take it off sale?">
          <p className="small">{words.ask}</p>
          <div className="row-wrap">
            <button
              type="button"
              className="btn btn--danger-outline btn--compact"
              disabled={busy}
              onClick={() => change('draft')}
            >
              Take off sale
            </button>
            <button
              type="button"
              className="btn btn--outline btn--compact"
              onClick={() => setAsking(false)}
            >
              Keep it on sale
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Basics (designs: name, short name, summary, duration, meeting point; the text lists).
 * @param {{ product: any, tz: string, part: import('../lib/save-parts.js').SavePart }} props
 */
function Basics({ product, tz, part }) {
  const engine = useEngine();
  const [saved, setSaved] = useState(() => basicsForm(product));
  const [form, setForm] = useState(saved);
  const [note, setNote] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));
  const errors = basicsErrors(form);
  const problems = Object.keys(errors).length;
  const changed = basicsChanges(form, saved);
  const set = (/** @type {keyof typeof form} */ k) => (/** @type {any} */ e) =>
    setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    if (problems) return false;
    setNote(null);
    const r = await act(engine, `/api/products/${product.id}`, {
      method: 'PATCH',
      body: basicsBody(form, saved),
    });
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
    const now = basicsForm(r.body.product);
    setSaved(now);
    setForm(now);
    setNote({ ok: true, text: `Saved · ${localTime(new Date(), tz)}.` });
    return true;
  };
  useSavePart(part, changed, problems > 0, save, () => {
    setForm(saved);
    setNote(null);
  });

  /** @param {keyof typeof form} k @param {string} label @param {any} [extra] */
  const field = (k, label, extra = {}) => (
    <label className="field">
      {label}
      {extra.rows ? (
        <textarea
          className="textarea"
          rows={extra.rows}
          value={form[k]}
          onChange={set(k)}
          aria-invalid={Boolean(errors[k])}
        />
      ) : (
        <input
          className={`input${extra.short ? ' input--short' : ''}`}
          type="text"
          inputMode={extra.inputMode}
          value={form[k]}
          onChange={set(k)}
          aria-invalid={Boolean(errors[k])}
        />
      )}
      {extra.help && <span className="small muted plain">{extra.help}</span>}
      {errors[k] && <span className="field-error plain">{errors[k]}</span>}
    </label>
  );

  return (
    <section className="panel panel--pad stack-sm" aria-label="Basics">
      <h3 className="h-md">Basics</h3>
      {problems > 0 && (
        <p role="alert" className="field-error">
          {fixLine(problems)}
        </p>
      )}
      {field('title', 'Name')}
      {field('shortTitle', 'Short name (WhatsApp lists)', {
        help: `${countLine(form.shortTitle, 24)}${form.shortTitle.trim() ? '' : ' · empty: the name is used'}`,
      })}
      {field('summary', 'Summary', { help: 'One line, on the tour’s card' })}
      <fieldset className="plain-fieldset stack-xs">
        <legend className="strong">Duration</legend>
        <div className="row-wrap">
          <label className="field field--inline">
            <input
              className="input input--short"
              inputMode="numeric"
              value={form.hours}
              onChange={set('hours')}
              aria-invalid={Boolean(errors.hours)}
            />
            hours
          </label>
          <label className="field field--inline">
            <input
              className="input input--short"
              inputMode="numeric"
              value={form.minutes}
              onChange={set('minutes')}
            />
            minutes
          </label>
        </div>
        {errors.hours && <span className="field-error plain">{errors.hours}</span>}
      </fieldset>
      <TransportChoice
        value={form.transport}
        onChange={(v) => setForm({ ...form, transport: v })}
      />
      {field('activityLabel', 'Activity (on the tour’s card)', {
        help: 'Like “Walking” or “Boat”',
      })}

      <h4 className="h-sm">Meeting point</h4>
      {field('meetingName', 'Where guests meet')}
      {field('meetingAddress', 'Address')}
      {field('meetingNote', 'How to find the guide', {
        help: 'Like “Look for the green Ìrìn cap, by the fountain”',
      })}
      {field('pin', 'Map pin', {
        help: pinLine(form.pin) ?? 'Paste a Google Maps link, or the coordinates.',
      })}
      {field('arrive', 'Arrive this many minutes early', {
        inputMode: 'numeric',
        short: true,
        help: form.arrive.trim() ? 'The trip page says “Arrive by …”' : 'Empty: not said',
      })}

      <h4 className="h-sm">About the tour</h4>
      {field('description', 'Description', { rows: 6 })}
      {field('stops', 'Stops', {
        rows: 4,
        help: 'One per line. Add what happens there after a dash: “Freedom Park — the old prison”',
      })}
      <div className="field-pair">
        {field('inclusions', 'Included', { rows: 4, help: 'One per line' })}
        {field('exclusions', 'Not included', { rows: 4, help: 'One per line' })}
      </div>
      {field('whatToBring', 'What to bring', { rows: 3, help: 'One per line' })}
      {field('faqs', 'FAQs', {
        rows: 6,
        help: 'The question on one line, its answer under it, a blank line between FAQs',
      })}

      {note && (
        <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'done-note' : 'field-error'}>
          {note.text}
          {!note.ok && (
            <>
              {' '}
              <button type="button" className="text-link" onClick={save}>
                Try again
              </button>
            </>
          )}
        </p>
      )}
    </section>
  );
}
