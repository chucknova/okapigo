// @ts-check
/**
 * Posters (designs P1–P2, stage 18b): pick a tour, a template, the headline and a size; the
 * preview is the real PNG the server draws, and Download saves that same picture.
 *
 *   1 · Tour        the tours on sale ("From ₦25,000 · 3 h · daily 09:00")
 *   2 · Template    New tour · Offer · Seats left · This weekend (greyed, with why, when it
 *                   can't be used: "No departures in the next 14 days")
 *   3 · Headline    the template's own words, editable (Seats left: which departure too)
 *   4 · Size        Square (1080 × 1080) · Story (1080 × 1920)
 *
 * The choices and words come from lib/posters.js; this file draws them.
 */
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { LiveFrame } from '../components/LiveFrame.jsx';
import { useLive } from '../lib/live.js';
import { useEngine, useSync } from '../lib/engine.jsx';
import {
  choose,
  downloadLabel,
  fetchPoster,
  fileFor,
  firstChoice,
  posterPath,
  savedWords,
} from '../lib/posters.js';
import {
  POSTER_SIZES,
  POSTER_TEMPLATES,
  POSTER_WORDS_MAX,
  templateState,
} from '@okapigo/shared/posters';

export function Posters() {
  const s = useSync();
  const live = useLive('/api/posters');
  const tz = s.me?.operator?.timeZone ?? 'Africa/Lagos';
  return (
    <main className="page stack-md">
      <header>
        <h1 className="h-xl">Posters</h1>
        <p className="muted">
          Pick a tour and a template. Your name, the price, the dates and a QR code to book go in by
          themselves.
        </p>
      </header>
      <LiveFrame live={live} what="Your posters" forWhom="the owner and managers" tz={tz}>
        {(data) =>
          data.tours.length === 0 ? (
            <section className="panel panel--pad stack-sm" aria-label="No tours yet">
              <h2 className="h-lg">Nothing to make a poster of yet</h2>
              <p className="muted">
                Posters are made from your tours: their name, price, dates and booking link. Add
                your first tour, then come back.
              </p>
              <Link href="/settings/tours/new" className="btn btn--dark btn--narrow">
                Add a tour
              </Link>
            </section>
          ) : (
            <PosterMaker data={data} businessSlug={s.me?.operator?.slug ?? ''} />
          )
        }
      </LiveFrame>
    </main>
  );
}

/**
 * @param {{ data: any, businessSlug: string }} props
 */
function PosterMaker({ data, businessSlug }) {
  const engine = useEngine();
  const [c, setC] = useState(() => firstChoice(data));
  const set = (/** @type {Partial<import('../lib/posters.js').PosterChoice>} */ change) =>
    setC((prev) => choose(prev, change, data));
  const tour = data.tours.find((/** @type {any} */ t) => t.id === c.tourId) ?? data.tours[0];
  const path = posterPath(c);
  const file = fileFor(c, tour.slug, businessSlug);

  // The preview: the real PNG, fetched with the sign-in, a moment after the last change.
  const [shown, setShown] = useState(
    /** @type {{ path: string, url: string } | { path: string, problem: string } | null} */ (null),
  );
  const [saved, setSaved] = useState(/** @type {string | null} */ (null));
  useEffect(() => {
    const ctrl = new AbortController();
    /** @type {string | null} */
    let made = null;
    const timer = setTimeout(async () => {
      try {
        const r = await fetchPoster(path, {
          token: engine.getState().session?.token ?? null,
          signal: ctrl.signal,
        });
        if (r.ok) {
          made = URL.createObjectURL(r.blob);
          setShown({ path, url: made });
        } else setShown({ path, problem: r.problem });
      } catch {
        // Replaced by a newer choice before it arrived.
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [path, engine]);
  const ready = shown && shown.path === path && 'url' in shown ? shown.url : null;
  const problem = shown && shown.path === path && 'problem' in shown ? shown.problem : null;

  return (
    <div className="poster-grid">
      <form className="stack-md" onSubmit={(e) => e.preventDefault()}>
        <fieldset className="plain-fieldset stack-xs">
          <legend className="strong">1 · Tour</legend>
          {c.template === 'weekend' && (
            <p className="small muted">This weekend shows every tour with seats.</p>
          )}
          {data.tours.map((/** @type {any} */ t) => (
            <label
              key={t.id}
              className={`choice poster-choice${t.id === c.tourId ? ' is-picked' : ''}`}
            >
              <input
                type="radio"
                name="tour"
                checked={t.id === c.tourId}
                disabled={c.template === 'weekend'}
                onChange={() => set({ tourId: t.id })}
              />
              <span>
                <span className="block strong">{t.title}</span>
                <span className="small muted">{t.meta}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="plain-fieldset stack-xs">
          <legend className="strong">2 · Template</legend>
          <div className="poster-templates">
            {POSTER_TEMPLATES.map((m) => {
              const st = templateState(m.key, tour, data.weekend.count);
              return (
                <label
                  key={m.key}
                  className={`choice poster-choice${m.key === c.template ? ' is-picked' : ''}${st.available ? '' : ' is-off'}`}
                >
                  <input
                    type="radio"
                    name="template"
                    checked={m.key === c.template}
                    disabled={!st.available}
                    onChange={() => set({ template: m.key })}
                  />
                  <span>
                    <span className="block strong">{m.name}</span>
                    <span className="small muted">{st.why ?? m.what}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {c.template === 'seats_left' && (
          <label className="field">
            Departure
            <select
              className="input"
              value={c.departureId ?? ''}
              onChange={(e) => set({ departureId: e.target.value })}
            >
              {tour.departures.map((/** @type {any} */ d) => (
                <option key={d.id} value={d.id}>
                  {d.when} · {d.seatsLeft} {d.seatsLeft === 1 ? 'seat' : 'seats'} left
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          3 · Headline
          <input
            className="input"
            value={c.words}
            maxLength={POSTER_WORDS_MAX}
            placeholder={c.template === 'seats_left' ? 'When it is: THIS SATURDAY' : ''}
            onChange={(e) => set({ words: e.target.value })}
          />
          <span className="small muted plain">
            Up to {POSTER_WORDS_MAX} characters. The tour’s name, price and dates are filled in.
            {c.template === 'offer' && ' The price stays the real one.'}
          </span>
        </label>

        <fieldset className="segmented">
          <legend className="strong">4 · Size</legend>
          {
            /** @type {const} */ (['square', 'story']).map((size) => (
              <label key={size} className={size === c.size ? 'is-on' : ''}>
                <input
                  type="radio"
                  name="size"
                  checked={size === c.size}
                  onChange={() => set({ size })}
                />
                {POSTER_SIZES[size].label}
              </label>
            ))
          }
        </fieldset>
      </form>

      <aside className="stack-sm poster-side" aria-label="Preview">
        <div
          className={`poster-preview poster-preview--${c.size}`}
          aria-busy={!ready && !problem ? 'true' : undefined}
        >
          {ready ? (
            <img src={ready} alt={`Poster preview: ${tour.title}`} />
          ) : (
            <span className="small muted">{problem ? '' : 'Drawing your poster…'}</span>
          )}
        </div>
        {problem && (
          <p role="alert" className="field-error">
            {problem}
          </p>
        )}
        {ready ? (
          <a className="btn btn--main" href={ready} download={file} onClick={() => setSaved(file)}>
            {downloadLabel(c.size)}
          </a>
        ) : (
          <button type="button" className="btn btn--main" disabled aria-busy={!problem}>
            {problem ? downloadLabel(c.size) : 'Preparing your PNG…'}
          </button>
        )}
        {saved && (
          <p role="status" className="done-note">
            <strong>Saved:</strong> {savedWords(saved, c.size)}
          </p>
        )}
        <p className="small muted">
          The QR code opens {c.template === 'weekend' ? 'your website' : 'this tour’s booking page'}
          . No photo yet: photos come with uploads.
        </p>
      </aside>
    </div>
  );
}
