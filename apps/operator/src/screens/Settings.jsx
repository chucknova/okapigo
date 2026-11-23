// @ts-check
/**
 * O10 · Settings (designs: O10 Settings — Website; Embed on your site; phone; Staff and form
 * states. Stage 16e-1; Messages and WhatsApp in 16e-2 (their own files: SettingsMessages.jsx,
 * SettingsWhatsApp.jsx); Staff and roles in 16e-3 (SettingsStaff.jsx); Tours in 16e-4 (SettingsTours.jsx);
 * Channels in 17c-2 (SettingsChannels.jsx).
 *
 *   wide screen   the sections down the left, the open one on the right
 *   phone         More › Settings: the sections as a list (with how each stands); tap one
 *
 * Website: the style (previewed before it's applied) and the business details (checked as you
 * type; a save bar while something's unsaved; asked before leaving with unsaved changes).
 * Embed: what the widget shows, how, where it may appear, a live preview, the snippet to copy.
 */
import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { LiveFrame } from '../components/LiveFrame.jsx';
import { SaveBar, LeaveGuard } from '../components/SaveBar.jsx';
import { MessagesSettings } from './SettingsMessages.jsx';
import { WhatsAppSettings } from './SettingsWhatsApp.jsx';
import { StaffSettings } from './SettingsStaff.jsx';
import { ToursSettings } from './SettingsTours.jsx';
import { ChannelsSettings } from './SettingsChannels.jsx';
import { useLive } from '../lib/live.js';
import { useEngine, useSync } from '../lib/engine.jsx';
import { act, actionError } from '../lib/office.js';
import { LogoField, HeroField } from '../components/PictureFields.jsx';
import { usePicture } from '../lib/uploads.js';
import { picturesForm, pictureChanges, pictureErrors, picturesSite } from '../lib/pictures.js';
import { firstLetter } from '../lib/letter.js';
import { localTime } from '@okapigo/shared/time';
import {
  SECTIONS,
  visibleSections,
  LIMITS,
  STYLE_CHOICES,
  applyLabel,
  changedFields,
  countLine,
  detailsBody,
  detailsErrors,
  detailsForm,
  embedSnippet,
  embedWarning,
  fixLine,
  LOOK_ONLY,
  mayEdit,
  readableOn,
  stylePreview,
  styleStatus,
} from '../lib/settings.js';

export function Settings() {
  const { section, item } = useParams();
  const s = useSync();
  const tz = s.me?.operator?.timeZone ?? 'Africa/Lagos';
  const open = SECTIONS.find((x) => x.key === section) ?? null;
  // The menu lists only what this person may open (a link typed in still says why not).
  const menu = visibleSections(s.me);
  return (
    <main className={`page settings${open ? ' desk--open' : ''}`}>
      <nav className="settings-nav" aria-label="Settings">
        <h1 className="h-xl">Settings</h1>
        <p className="small muted narrow-only">
          {s.me?.operator?.name} · {s.me?.user?.name}
        </p>
        <ul className="plain-list">
          {menu.map((x) => (
            <li key={x.key}>
              <Link
                href={`/settings/${x.key}`}
                className={`settings-link${(open ?? menu[0])?.key === x.key ? ' is-open' : ''}`}
                aria-current={open?.key === x.key ? 'page' : undefined}
              >
                <span className="grow">{x.label}</span>
                {!x.built && <span className="small muted">Coming next</span>}
                <span className="narrow-only" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section className="settings-page" aria-label={(open ?? SECTIONS[0]).label}>
        {/* Inside one message, its own "‹ Messages" is the way back. */}
        {open && !item && (
          <Link href="/settings" className="back-link narrow-only">
            ‹ Settings
          </Link>
        )}
        {(open?.key ?? 'website') === 'website' && (
          <WebsiteSettings tz={tz} canEdit={mayEdit(s.me, 'marketing')} />
        )}
        {open?.key === 'embed' && <EmbedSettings tz={tz} canEdit={mayEdit(s.me, 'marketing')} />}
        {open?.key === 'messages' && (
          <MessagesSettings tz={tz} canEdit={mayEdit(s.me, 'settings')} kind={item ?? null} />
        )}
        {open?.key === 'staff' && <StaffSettings tz={tz} canEdit={mayEdit(s.me, 'settings')} />}
        {open?.key === 'tours' && (
          <ToursSettings tz={tz} canEdit={mayEdit(s.me, 'products')} item={item ?? null} />
        )}
        {open?.key === 'channels' && (
          <ChannelsSettings tz={tz} canEdit={mayEdit(s.me, 'channels')} item={item ?? null} />
        )}
        {open?.key === 'whatsapp' && (
          <WhatsAppSettings tz={tz} canEdit={mayEdit(s.me, 'channels')} />
        )}
        {open && !open.built && (
          <p className="muted">{open.label} arrive in the next part of this stage.</p>
        )}
      </section>
    </main>
  );
}

// --- Website ---------------------------------------------------------------------------------

/** @param {{ tz: string, canEdit: boolean }} props */
function WebsiteSettings({ tz, canEdit }) {
  const live = useLive('/api/website');
  return (
    <LiveFrame live={live} what="Your website" tz={tz}>
      {({ website }) => (
        <div className="stack-md">
          <header>
            <h2 className="h-xl">Website</h2>
            <p className="muted">
              {website.siteUrl.replace(/^https?:\/\//, '')} · one page made from your tours.
              Changing the style never changes your content or links.
            </p>
            <a href={website.siteUrl} target="_blank" rel="noreferrer" className="text-link">
              Open the live site ↗
            </a>
          </header>
          {!canEdit && <p className="unavailable">{LOOK_ONLY}</p>}
          <fieldset className="plain-fieldset stack-md" disabled={!canEdit}>
            <StylePicker website={website} />
            <BusinessDetails key={JSON.stringify(website.site)} website={website} tz={tz} />
          </fieldset>
        </div>
      )}
    </LiveFrame>
  );
}

/** The three styles, light or dark, previewed before it's applied. @param {{ website: any }} props */
function StylePicker({ website }) {
  const engine = useEngine();
  const liveLook = { style: website.style, mode: website.mode };
  const [shown, setShown] = useState(liveLook);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const dark = shown.mode === 'dark';
  const same = shown.style === liveLook.style && shown.mode === liveLook.mode;
  return (
    <section className="panel panel--pad stack-sm" aria-label="Style">
      <div className="row-between">
        <h3 className="h-md">Style</h3>
        <fieldset className="segmented">
          <legend className="visually-hidden">Light or dark</legend>
          {[
            ['light', 'Light'],
            ['dark', 'Dark'],
            ['auto', 'Follow the phone'],
          ].map(([key, label]) => (
            <label key={key} className={shown.mode === key ? 'is-on' : ''}>
              <input
                type="radio"
                name="mode"
                checked={shown.mode === key}
                onChange={() => setShown({ ...shown, mode: key })}
              />
              {label}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="style-cards" role="radiogroup" aria-label="Style">
        {STYLE_CHOICES.map((c) => {
          const p = stylePreview(c.key, dark);
          const on = shown.style === c.key;
          return (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={on}
              className={`style-card${on ? ' is-on' : ''}`}
              onClick={() => setShown({ ...shown, style: c.key })}
            >
              {/* The colours are the style's own tokens: a preview of another look. */}
              <span className="style-mini" style={{ background: p.bg, color: p.text }}>
                <span
                  className="style-mini-hero"
                  style={{ background: p.heroBg, color: p.heroText, fontFamily: p.font }}
                >
                  <span style={{ color: p.accent }}>{website.site?.tagline || 'Your tagline'}</span>
                </span>
                <span
                  className="style-mini-btn"
                  style={{ background: p.button, color: p.onButton }}
                >
                  Book
                </span>
              </span>
              <span className="row-between">
                <strong>{c.name}</strong>
                {c.key === liveLook.style && <span className="small strong">LIVE NOW</span>}
              </span>
              <span className="small muted">{c.desc}</span>
            </button>
          );
        })}
      </div>
      <p className="small muted">{styleStatus(shown, liveLook)}</p>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn--dark btn--compact"
        disabled={same || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await act(engine, '/api/website', { method: 'PATCH', body: shown });
          setBusy(false);
          if (!r.ok) setError(actionError(r.error));
        }}
      >
        {busy ? 'Applying…' : applyLabel(shown, liveLook)}
      </button>
    </section>
  );
}

/** The business details form (designs: "Business details"; "Errors in a form"). @param {{ website: any, tz: string }} props */
function BusinessDetails({ website, tz }) {
  const engine = useEngine();
  const sync = useSync();
  const [saved, setSaved] = useState(() => detailsForm(website));
  const [form, setForm] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));
  // The logo and hero photo (19b-2a; designs: U1): each uploads when picked, saved with the rest.
  const [savedPics, setSavedPics] = useState(() => picturesForm(website));
  const logo = usePicture(savedPics.logo, 'logo');
  const hero = usePicture(savedPics.hero, 'photo');
  const [heroText, setHeroText] = useState({
    alt: savedPics.heroAlt,
    credit: savedPics.heroCredit,
  });
  const pics = {
    logo: logo.picture,
    hero: hero.picture,
    heroAlt: heroText.alt,
    heroCredit: heroText.credit,
  };
  const picErrors = pictureErrors(pics);
  const uploading = Boolean(logo.upload || hero.upload);
  const errors = detailsErrors(form);
  const problems = Object.keys(errors).length + Object.keys(picErrors).length;
  const changed = [...changedFields(form, saved), ...pictureChanges(pics, savedPics)];
  const set = (/** @type {keyof typeof form} */ k) => (/** @type {any} */ e) =>
    setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    if (problems || uploading) return false;
    setSaving(true);
    setNote(null);
    const body = detailsBody(form, saved);
    const site = { ...body.site, ...picturesSite(pics, savedPics) };
    const r = await act(engine, '/api/website', {
      method: 'PATCH',
      body: Object.keys(site).length ? { ...body, site } : body,
    });
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
    setSavedPics(pics);
    setNote({ ok: true, text: `Saved · ${localTime(new Date(), tz)}.` });
    return true;
  };
  const discard = () => {
    setForm(saved);
    logo.reset(savedPics.logo);
    hero.reset(savedPics.hero);
    setHeroText({ alt: savedPics.heroAlt, credit: savedPics.heroCredit });
    setNote(null);
  };

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
          className="input"
          type={extra.type ?? 'text'}
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
    <section className="panel panel--pad stack-sm" aria-label="Business details">
      <h3 className="h-md">Business details</h3>
      <p className="small muted">
        Empty fields hide their section on the site, so it always looks finished.
      </p>
      {problems > 0 && (
        <p role="alert" className="field-error">
          {fixLine(problems)}
        </p>
      )}
      {field('tagline', 'Tagline', {
        help: countLine(form.tagline, LIMITS.tagline, 'the hero title'),
      })}
      {field('whatsapp', 'WhatsApp number', {
        inputMode: 'tel',
        help: 'For the “Chat on WhatsApp” buttons',
      })}
      {field('about', 'About', { rows: 4 })}
      <div className="field-pair">
        {field('phone', 'Phone', { inputMode: 'tel' })}
        {field('email', 'Email', { type: 'email' })}
      </div>
      {field('address', 'Address')}
      {field('instagram', 'Instagram', { help: 'Your handle, like @irinlagostours' })}
      <LogoField logo={logo} letter={firstLetter(sync.me?.operator?.name ?? '')} />
      <HeroField
        hero={hero}
        alt={heroText.alt}
        credit={heroText.credit}
        onAlt={(alt) => setHeroText({ ...heroText, alt })}
        onCredit={(credit) => setHeroText({ ...heroText, credit })}
        errors={picErrors}
      />
      {uploading && <p className="small muted">Save when the upload ends.</p>}
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
      <SaveBar
        changed={changed}
        saving={saving}
        blocked={problems > 0 || uploading}
        onSave={save}
        onDiscard={discard}
      />
      <LeaveGuard
        changed={changed}
        what={`Your change to ${changed.join(', ').toLowerCase()}`}
        onSave={save}
      />
    </section>
  );
}

// --- Embed -----------------------------------------------------------------------------------

/** @param {{ tz: string, canEdit: boolean }} props */
function EmbedSettings({ tz, canEdit }) {
  const live = useLive('/api/website');
  const tours = useLive('/api/products');
  return (
    <LiveFrame live={live} what="Embed settings" tz={tz}>
      {({ website }) => (
        <EmbedForm
          canEdit={canEdit}
          website={website}
          tours={(tours.entry.data?.products ?? []).filter(
            (/** @type {any} */ p) => p.status === 'published',
          )}
        />
      )}
    </LiveFrame>
  );
}

/** @param {{ website: any, tours: any[], canEdit: boolean }} props */
function EmbedForm({ website, tours, canEdit }) {
  const engine = useEngine();
  const [tour, setTour] = useState(/** @type {string | null} */ (null));
  const [widget, setWidget] = useState(/** @type {'inline' | 'button'} */ ('inline'));
  const [label, setLabel] = useState('Book now');
  const [colour, setColour] = useState('#9BD10F');
  const [adding, setAdding] = useState('');
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [copied, setCopied] = useState(false);
  const snippet = embedSnippet({
    slug: website.slug,
    tour,
    widget,
    label,
    colour,
    scriptUrl: website.embedScriptUrl,
  });
  /** @param {string[]} embedDomains */
  const saveDomains = async (embedDomains) => {
    setError(null);
    const r = await act(engine, '/api/website', { method: 'PATCH', body: { embedDomains } });
    if (!r.ok) {
      setError(actionError(r.error));
      return false;
    }
    return true;
  };
  const warning = embedWarning(website.embedDomains);
  return (
    <div className="stack-md">
      <header>
        <h2 className="h-xl">Put booking on your own website</h2>
        <p className="muted">
          Copy a snippet into your site. Checkout runs inside it, served by OkapiGo, so card details
          never touch your site.
        </p>
      </header>

      <section className="panel panel--pad stack-sm" aria-label="What to show">
        <h3 className="h-md">1 · What to show</h3>
        <label className="field">
          Tour
          <select
            className="input"
            value={tour ?? ''}
            onChange={(e) => setTour(e.target.value || null)}
          >
            <option value="">All tours</option>
            {tours.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="panel panel--pad stack-sm" aria-label="How">
        <h3 className="h-md">2 · How</h3>
        <fieldset className="plain-fieldset stack-xs">
          <legend className="strong">Widget type</legend>
          <label className="check-row">
            <input
              type="radio"
              name="widget"
              checked={widget === 'inline'}
              onChange={() => setWidget('inline')}
            />
            <span>
              Inline calendar <span className="small muted">· dates right on the page</span>
            </span>
          </label>
          <label className="check-row">
            <input
              type="radio"
              name="widget"
              checked={widget === 'button'}
              onChange={() => setWidget('button')}
            />
            <span>
              Pop-up button <span className="small muted">· “Book now” opens checkout</span>
            </span>
          </label>
        </fieldset>
        {widget === 'button' && (
          <div className="field-pair">
            <label className="field">
              Button text
              <input
                className="input"
                type="text"
                maxLength={40}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label className="field">
              Button colour
              <input
                className="input input--colour"
                type="color"
                value={colour}
                onChange={(e) => setColour(e.target.value)}
              />
              <span className="small muted plain">The text colour is picked to stay readable.</span>
            </label>
          </div>
        )}
      </section>

      <section className="panel panel--pad stack-sm" aria-label="Approved websites">
        <h3 className="h-md">3 · Approved websites</h3>
        {!canEdit && <p className="small muted">{LOOK_ONLY}</p>}
        <p className="small muted">
          Only these sites can show the widget. Anywhere else, it shows nothing.
        </p>
        {warning && (
          <p role="alert" className="unavailable unavailable--warning">
            {warning}
          </p>
        )}
        <ul className="plain-list">
          {/* (A fieldset can't hold an <li>: each button is switched off itself.) */}
          {website.embedDomains.map((/** @type {string} */ d) => (
            <li key={d} className="row-between">
              <span>{d}</span>
              <button
                type="button"
                className="text-link"
                disabled={!canEdit}
                onClick={() =>
                  saveDomains(website.embedDomains.filter((/** @type {string} */ x) => x !== d))
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form
          className="composer"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await saveDomains([...website.embedDomains, adding.trim()])) setAdding('');
          }}
        >
          <label className="field grow">
            Website to add
            <input
              className="input"
              type="text"
              placeholder="irinlagostours.com"
              value={adding}
              disabled={!canEdit}
              onChange={(e) => setAdding(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn--outline btn--compact" disabled={!adding.trim()}>
            Add
          </button>
        </form>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </section>

      <section className="panel panel--pad stack-sm" aria-label="Live preview">
        <h3 className="h-md">Live preview · exactly what guests see</h3>
        {widget === 'inline' ? (
          <iframe
            title="The booking widget"
            className="embed-preview"
            src={`/embed/${website.slug}${tour ? `/${tour}` : ''}`}
          />
        ) : (
          <div className="embed-button-preview">
            <span className="btn" style={{ background: colour, color: readableOn(colour) }}>
              {label.trim() || 'Book now'}
            </span>
            <span className="small muted">Opens checkout in a pop-up, on top of your page.</span>
          </div>
        )}
      </section>

      <section className="panel panel--pad stack-sm" aria-label="Your snippet">
        <div className="row-between">
          <h3 className="h-md">4 · Your snippet</h3>
          <button
            type="button"
            className="btn btn--outline btn--compact"
            onClick={async () => {
              await globalThis.navigator?.clipboard?.writeText(snippet);
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="small muted">Paste this into your website where you want it to appear.</p>
        <pre className="snippet">
          <code>{snippet}</code>
        </pre>
        <p className="small muted">
          Tracking: links with ?utm_source=… are recorded on the booking, so you can see which page
          or post sold it.
        </p>
      </section>
    </div>
  );
}
