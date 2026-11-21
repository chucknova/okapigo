// @ts-check
/**
 * Settings › Tours › one tour: Prices, and Schedule and seats (stage 16e-4b; designs: "Settings
 * — Tours"). Each reports its unsaved changes to the tour page's one save bar
 * (lib/save-parts.js); the rules are in lib/tours.js.
 *
 *   Prices     each category: its name, ages (empty "to": "and over", which counts as an adult),
 *              the price; add one, remove one. Whether prices include the tax. Before saving:
 *              "You changed Adult from ₦65,000 to ₦70,000. New bookings pay ₦70,000; the 26
 *              existing bookings keep their price." Saved all at once (PUT).
 *   Schedule   the days, the start times, seats per departure, until when, the dates it doesn't
 *              run; "Next 60 days are on sale". After saving, the booked departures the change
 *              couldn't remove, with links. A one-off departure, added straight away.
 */
import { useState } from 'react';
import { Link } from 'wouter';
import { useLive } from '../lib/live.js';
import { useEngine } from '../lib/engine.jsx';
import { act, actionError } from '../lib/office.js';
import { useSavePart } from '../lib/save-parts.js';
import { addDays, localDate, localTime } from '@okapigo/shared/time';
import { fixLine } from '../lib/settings.js';
import {
  WEEK,
  agesLine,
  blankPrice,
  countsAsAdult,
  dayChip,
  oneOffErrors,
  priceChangeWords,
  priceChanges,
  priceErrors,
  priceRows,
  pricesBody,
  runsPreview,
  scheduleBody,
  scheduleChanges,
  scheduleErrors,
  scheduleOf,
  syncLine,
} from '../lib/tours.js';

/** "Didn't save: no connection…" or the server's own words. @param {any} error */
const failed = (error) =>
  error.kind === 'offline' || error.kind === 'unreachable'
    ? 'Didn’t save: no connection. Your changes are still here.'
    : actionError(error);

/** @param {{ note: { ok: boolean, text: string } | null }} props */
function Note({ note }) {
  if (!note) return null;
  return (
    <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'done-note' : 'field-error'}>
      {note.text}
    </p>
  );
}

// --- Prices -----------------------------------------------------------------------------------

/**
 * @param {{ product: any, tz: string, part: import('../lib/save-parts.js').SavePart }} props
 */
export function Prices({ product, tz, part }) {
  const engine = useEngine();
  const [saved, setSaved] = useState(() => priceRows(product));
  const [rows, setRows] = useState(saved);
  const [note, setNote] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));
  const errors = priceErrors(rows, product.status === 'published');
  const changed = priceChanges(rows, saved);
  const words = priceChangeWords(rows, saved, product.upcomingBookings ?? 0);
  /** @param {number} i @param {keyof import('../lib/tours.js').PriceRow} k */
  const set = (i, k) => (/** @type {any} */ e) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));

  const save = async () => {
    if (errors.count) return false;
    setNote(null);
    const r = await act(engine, `/api/products/${product.id}/price-categories`, {
      method: 'PUT',
      body: pricesBody(rows),
    });
    if (!r.ok) {
      setNote({ ok: false, text: failed(r.error) });
      return false;
    }
    const now = priceRows(r.body.product);
    setSaved(now);
    setRows(now);
    setNote({ ok: true, text: `Saved · ${localTime(new Date(), tz)}.` });
    return true;
  };
  useSavePart(part, changed, errors.count > 0, save, () => {
    setRows(saved);
    setNote(null);
  });

  return (
    <section className="panel panel--pad stack-sm" aria-label="Prices">
      <div className="row-between">
        <h3 className="h-md">Prices</h3>
        <button
          type="button"
          className="text-link"
          onClick={() => setRows([...rows, blankPrice()])}
        >
          Add a category
        </button>
      </div>
      <p className="small muted">{product.pricesNote}</p>
      {errors.count > 0 && (
        <p role="alert" className="field-error">
          {fixLine(errors.count)}
        </p>
      )}
      <ul className="plain-list price-rows" aria-label="Price categories">
        {rows.map((r, i) => {
          const e = errors.rows[i] ?? {};
          const label = r.name.trim() || `Price ${i + 1}`;
          return (
            <li key={r.id ?? `new-${i}`} className="price-row">
              <label className="field">
                Category
                <input
                  className="input"
                  type="text"
                  value={r.name}
                  onChange={set(i, 'name')}
                  aria-invalid={Boolean(e.name)}
                />
                {e.name && <span className="field-error plain">{e.name}</span>}
              </label>
              <fieldset className="plain-fieldset stack-xs">
                <legend className="strong small">Ages</legend>
                <span className="ages-row">
                  <input
                    className="input input--age"
                    inputMode="numeric"
                    aria-label={`${label}: youngest age`}
                    value={r.minAge}
                    onChange={set(i, 'minAge')}
                    aria-invalid={Boolean(e.minAge)}
                  />
                  <span aria-hidden="true">to</span>
                  <input
                    className="input input--age"
                    inputMode="numeric"
                    aria-label={`${label}: oldest age (empty: and over)`}
                    placeholder="+"
                    value={r.maxAge}
                    onChange={set(i, 'maxAge')}
                    aria-invalid={Boolean(e.maxAge)}
                  />
                </span>
                <span className="small muted">
                  {agesLine(r)}
                  {countsAsAdult(r) ? ' · counts as an adult' : ''}
                </span>
                {(e.minAge || e.maxAge) && (
                  <span className="field-error">{e.minAge ?? e.maxAge}</span>
                )}
              </fieldset>
              <label className="field">
                Price (₦)
                <input
                  className="input"
                  inputMode="decimal"
                  value={r.naira}
                  onChange={set(i, 'naira')}
                  aria-invalid={Boolean(e.naira)}
                />
                {r.naira.trim() === '0' && (
                  <span className="small muted plain">Free, needs a seat</span>
                )}
                {e.naira && <span className="field-error plain">{e.naira}</span>}
              </label>
              <button
                type="button"
                className="text-link price-remove"
                aria-label={`Remove ${label}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      {errors.all && <p className="field-error">{errors.all}</p>}
      {words && <p className="unavailable unavailable--warning">{words}</p>}
      <Note note={note} />
    </section>
  );
}

// --- Schedule and seats -----------------------------------------------------------------------

/**
 * @param {{ product: any, tz: string, canEdit: boolean, part: import('../lib/save-parts.js').SavePart }} props
 */
export function Schedule({ product, tz, canEdit, part }) {
  const live = useLive(`/api/products/${product.id}/schedules`);
  const schedules = live.entry.data?.schedules;
  // One section that stays put while its contents load.
  return (
    <section className="panel panel--pad stack-sm" aria-label="Schedule and seats">
      <h3 className="h-md">Schedule and seats</h3>
      {schedules ? (
        // No key from the rule's id: saving a new rule gives it one, and the form (with its
        // "Saved" note) should stay as it is.
        <ScheduleForm
          rule={scheduleOf(schedules, product)}
          product={product}
          tz={tz}
          canEdit={canEdit}
          part={part}
        />
      ) : (
        <p className="muted">{live.entry.error ? 'The schedule didn’t load.' : 'Loading…'}</p>
      )}
    </section>
  );
}

/**
 * @param {{ rule: ReturnType<typeof scheduleOf>, product: any, tz: string, canEdit: boolean, part: import('../lib/save-parts.js').SavePart }} props
 */
function ScheduleForm({ rule, product, tz, canEdit, part }) {
  const engine = useEngine();
  const [saved, setSaved] = useState(rule.form);
  const [form, setForm] = useState(rule.form);
  const [id, setId] = useState(rule.id);
  const [skipping, setSkipping] = useState('');
  const [note, setNote] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));
  const [attention, setAttention] = useState(/** @type {{ id: string, text: string }[]} */ ([]));
  const errors = scheduleErrors(form);
  const problems = Object.keys(errors).length;
  const changed = scheduleChanges(form, saved);
  const today = localDate(new Date(), tz);
  const runs = runsPreview(form);

  const save = async () => {
    if (problems) return false;
    setNote(null);
    setAttention([]);
    const isNew = !id;
    const r = await act(
      engine,
      isNew ? `/api/products/${product.id}/schedules` : `/api/schedules/${id}`,
      { method: isNew ? 'POST' : 'PATCH', body: scheduleBody(form, saved, isNew, today) },
    );
    if (!r.ok) {
      setNote({ ok: false, text: failed(r.error) });
      return false;
    }
    setId(r.body.schedule.id);
    setSaved(form);
    setAttention(r.body.sync.attention ?? []);
    setNote({ ok: true, text: `Saved · ${localTime(new Date(), tz)}. ${syncLine(r.body.sync)}` });
    return true;
  };
  useSavePart(part, changed, problems > 0, save, () => {
    setForm(saved);
    setNote(null);
  });

  /** @param {number} day */
  const toggle = (day) =>
    setForm({
      ...form,
      days: form.days.includes(day) ? form.days.filter((d) => d !== day) : [...form.days, day],
    });

  return (
    <>
      {problems > 0 && (
        <p role="alert" className="field-error">
          {fixLine(problems)}
        </p>
      )}
      {rule.others > 0 && (
        <p className="small muted">
          This tour has {rule.others + 1} schedules; this is the first. The others keep running.
        </p>
      )}
      <fieldset className="plain-fieldset stack-xs">
        <legend className="strong">Runs on</legend>
        <div className="day-picks">
          {WEEK.map(([d, name]) => (
            <label key={d} className={`day-pick${form.days.includes(d) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={form.days.includes(d)} onChange={() => toggle(d)} />
              {name}
            </label>
          ))}
        </div>
        <span className="small muted">{runs ? `Runs: ${runs}` : 'Not running yet'}</span>
        {errors.days && <span className="field-error">{errors.days}</span>}
      </fieldset>
      <div className="field-pair">
        <label className="field">
          Start time
          <input
            className="input"
            type="text"
            inputMode="numeric"
            placeholder="07:00"
            value={form.times}
            onChange={(e) => setForm({ ...form, times: e.target.value })}
            aria-invalid={Boolean(errors.times)}
          />
          <span className="small muted plain">More than one? Separate them with commas.</span>
          {errors.times && <span className="field-error plain">{errors.times}</span>}
        </label>
        <label className="field">
          Seats per departure
          <input
            className="input"
            inputMode="numeric"
            value={form.seats}
            onChange={(e) => setForm({ ...form, seats: e.target.value })}
            aria-invalid={Boolean(errors.seats)}
          />
          {errors.seats && <span className="field-error plain">{errors.seats}</span>}
        </label>
      </div>
      <label className="field">
        Until
        <input
          className="input"
          type="date"
          min={today}
          value={form.until}
          onChange={(e) => setForm({ ...form, until: e.target.value })}
        />
        <span className="small muted plain">
          {form.until ? `The last day it runs: ${dayChip(form.until)}` : 'Empty: it keeps running.'}
        </span>
      </label>
      <div className="stack-xs">
        <span className="strong">Not running on</span>
        <div className="chips" aria-label="Not running on">
          {form.skip.length === 0 && <span className="small muted">Every scheduled day runs.</span>}
          {form.skip.map((d) => (
            <span key={d} className="chip">
              {dayChip(d)}{' '}
              <button
                type="button"
                className="chip-x"
                aria-label={`Run on ${dayChip(d)} again`}
                onClick={() => setForm({ ...form, skip: form.skip.filter((x) => x !== d) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="row-wrap">
          <input
            className="input input--date"
            type="date"
            min={today}
            aria-label="A date it doesn’t run"
            value={skipping}
            onChange={(e) => setSkipping(e.target.value)}
          />
          <button
            type="button"
            className="btn btn--outline btn--compact"
            disabled={!skipping || form.skip.includes(skipping)}
            onClick={() => {
              setForm({ ...form, skip: [...form.skip, skipping].sort() });
              setSkipping('');
            }}
          >
            Add a date
          </button>
        </div>
      </div>
      <p className="small muted">The next 60 days are on sale; new dates open each day.</p>
      <Note note={note} />
      {attention.length > 0 && (
        <div
          className="unavailable unavailable--warning stack-xs"
          role="status"
          aria-label="Booked departures"
        >
          <strong>
            {attention.length === 1
              ? 'This booked departure stays'
              : 'These booked departures stay'}{' '}
            until you decide: cancel from its page (guests get their refunds), or let it run.
          </strong>
          <ul className="plain-list stack-xs">
            {attention.map((a) => (
              <li key={a.id}>
                <Link href={`/departures/${a.id}`} className="text-link">
                  {a.text} ›
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <OneOffs product={product} tz={tz} canEdit={canEdit} seats={saved.seats || form.seats} />
    </>
  );
}

/**
 * One-off departures: the coming ones, and "Add a one-off departure" (added straight away, not
 * through the save bar). @param {{ product: any, tz: string, canEdit: boolean, seats: string }} props
 */
function OneOffs({ product, tz, canEdit, seats }) {
  const engine = useEngine();
  const today = localDate(new Date(), tz);
  const live = useLive(
    `/api/departures?productId=${product.id}&from=${today}&to=${addDays(today, 92)}`,
  );
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ date: '', time: '', seats });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const errors = tried ? oneOffErrors(form, today) : {};
  const oneOffs = (live.entry.data?.departures ?? []).filter(
    (/** @type {any} */ d) => d.scheduleId === null && d.status === 'scheduled',
  );
  return (
    <div className="stack-xs" aria-label="One-off departures">
      <span className="strong">One-off departures</span>
      {oneOffs.length === 0 ? (
        <span className="small muted">None coming.</span>
      ) : (
        <ul className="plain-list stack-xs">
          {oneOffs.map((/** @type {any} */ d) => (
            <li key={d.id}>
              <Link href={`/departures/${d.id}`} className="text-link">
                {dayChip(d.localDate)}, {d.localTime} · {d.capacity} seats ›
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canEdit && !adding && (
        <button type="button" className="text-link" onClick={() => setAdding(true)}>
          Add a one-off departure
        </button>
      )}
      {adding && (
        <div className="stack-xs" role="group" aria-label="Add a one-off departure">
          <div className="row-wrap">
            <label className="field">
              Date
              <input
                className="input input--date"
                type="date"
                min={today}
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
            <label className="field">
              Time
              <input
                className="input input--short"
                placeholder="10:00"
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
              />
            </label>
            <label className="field">
              Seats
              <input
                className="input input--short"
                inputMode="numeric"
                value={form.seats}
                onChange={(e) => setForm({ ...form, seats: e.target.value })}
              />
            </label>
          </div>
          {Object.values(errors).map((m) => (
            <span key={m} className="field-error">
              {m}
            </span>
          ))}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <div className="row-wrap">
            <button
              type="button"
              className="btn btn--dark btn--compact"
              disabled={busy}
              onClick={async () => {
                setTried(true);
                if (Object.keys(oneOffErrors(form, today)).length) return;
                setBusy(true);
                setError(null);
                const r = await act(engine, `/api/products/${product.id}/departures`, {
                  method: 'POST',
                  body: { date: form.date, time: form.time, capacity: Number(form.seats) },
                });
                setBusy(false);
                if (!r.ok) return setError(actionError(r.error));
                setAdding(false);
                setTried(false);
                setForm({ date: '', time: '', seats });
              }}
            >
              {busy ? 'Adding…' : 'Add it'}
            </button>
            <button
              type="button"
              className="btn btn--outline btn--compact"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
