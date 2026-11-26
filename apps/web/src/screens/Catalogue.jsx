// @ts-check
/**
 * The operator's one-page website (MKT-08, stage 12g-2; designs: file 04, "Operator site ·
 * phone" and "· desktop"). /irin-lagos-tours
 *
 *   header        name, Book (desktop: Tours · About · Contact · Book a tour)
 *   hero          "City and food tours · Lagos" · the tagline · the intro · See tours and dates
 *   Our tours     the cards: facts, title, summary, from price, "Book · Wed 18 Nov"
 *   About · Why book with us · Questions · Get in touch · footer
 *
 * It replaces stage 12b's catalogue at the same address: links already shared still work.
 * Its look is the operator's style (12g-1: Lagoon, Classic or Earth, light or dark).
 *
 * MISSING CONTENT (designs: "the page still looks finished"):
 *   no tagline   → the business name is the hero title, "Tours in {city}" under it
 *   no about     → About hides ("Why book with us" moves up); no points → that hides too
 *   no FAQs      → Questions hides
 *   no WhatsApp  → Get in touch shows phone and email only; nothing at all → it hides
 *   no tours     → "New tours coming soon"; the hero and header stop offering to book
 *
 * Data: the page's embedded data on first load, else GET /public/:operator.
 * States: loading (skeleton) · not found · offline / failed (Try again).
 */
import { Link } from 'wouter';
import { formatNaira } from '@okapigo/shared/money';
import { formatLocalDay } from '@okapigo/shared/preview';
import { formatDurationShort } from '@okapigo/shared/tour-facts';
import { formatPhoneForDisplay } from '@okapigo/shared/contact';
import { takeEmbedded, useApi } from '../lib/data.js';
import { ApiError } from '../lib/api.js';
import { useLook } from '../lib/look.js';
import { whatsappUrl } from '../lib/map.js';
import { Shell, Mark } from '../components/Shell.jsx';
import { creditLine, siteCredits, srcSet } from '../lib/photos.js';
import { Bar } from '../components/Skeleton.jsx';
import { ErrorState } from '../components/ErrorState.jsx';
import { NotFound } from './NotFound.jsx';

/**
 * @typedef {{ slug: string, name: string, city: string | null, pricesInclude: string | null, timeZone: string, websiteStyle?: string, websiteMode?: string, logo?: import('../components/Shell.jsx').Logo | null }} PublicOperator
 * @typedef {{
 *   kind: string | null, tagline: string | null, intro: string | null, about: string | null,
 *   whyUs: Array<{ title: string, text: string }>,
 *   faqs: Array<{ question: string, answer: string }>,
 *   contact: { phone: string | null, whatsapp: string | null, email: string | null, address: string | null,
 *              socials: Array<{ network: string, url: string }> },
 *   hero?: import('../lib/photos.js').Photo | null,
 * }} PublicSite
 * @typedef {{
 *   slug: string, title: string, summary: string, durationMinutes: number,
 *   activityLabel: string | null, fromPriceKobo: number | null, scheduleSummary?: string | null,
 *   cancellationHeadline: string | null,
 *   nextDeparture: { localDate: string, localTime: string } | null,
 *   photo?: import('../lib/photos.js').Photo | null,
 * }} TourCard
 */

/** An empty site, for data from before stage 12g-2 (or a server that doesn't send one). */
const NO_SITE = /** @type {PublicSite} */ ({
  kind: null,
  tagline: null,
  intro: null,
  about: null,
  whyUs: [],
  faqs: [],
  contact: { phone: null, whatsapp: null, email: null, address: null, socials: [] },
});

const NETWORK_NAMES = /** @type {Record<string, string>} */ ({
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  tiktok: 'TikTok',
  youtube: 'YouTube',
});

/** "Ìrìn Lagos Tours" → "Ìrìn", as the designs say it ("About Ìrìn"). @param {string} name */
const shortName = (name) => name.split(/\s+/)[0] || name;

/** @param {{ params: { operator: string } }} props */
export function Catalogue({ params }) {
  const slug = params.operator;
  const initial = takeEmbedded((d) => d.kind === 'catalogue' && d.operatorSlug === slug);
  const { data, error, loading, retry } = useApi(
    `/public/${encodeURIComponent(slug)}`,
    initial?.view ?? null,
  );
  /** @type {{ operator: PublicOperator, site?: PublicSite, tours: TourCard[] } | null} */
  const view = data;
  useLook(view?.operator);

  if (error instanceof ApiError && error.status === 404) return <NotFound />;
  if (!view) {
    return (
      <Shell operatorName={error ? 'OkapiGo' : ''}>
        {error ? <ErrorState error={error} onRetry={retry} /> : <SiteSkeleton />}
      </Shell>
    );
  }

  const { operator, tours } = view;
  const site = view.site ?? NO_SITE;
  const c = site.contact;
  const hasTours = tours.length > 0;
  const hasContact = Boolean(c.whatsapp || c.phone || c.email || c.address || c.socials.length);
  const op = shortName(operator.name);
  const credits = siteCredits(site.hero, tours);
  const eyebrow = site.tagline
    ? [site.kind, operator.city].filter(Boolean).join(' · ')
    : operator.city
      ? `Tours in ${operator.city}`
      : null;

  return (
    <div className="okg-site">
      <header className="okg-site__header">
        <div className="okg-site__bar">
          <Mark name={operator.name} logo={operator.logo} />
          <span className="okg-header__name okg-site__name">{operator.name}</span>
          <nav className="okg-site__nav" aria-label="On this page">
            {hasTours && <a href="#tours">Tours</a>}
            {site.about && <a href="#about">About</a>}
            {hasContact && <a href="#contact">Contact</a>}
          </nav>
          {hasTours && (
            <a className="okg-btn okg-btn--primary okg-site__book" href="#tours">
              <span className="okg-phone-only">Book</span>
              <span className="okg-desktop-only">Book a tour</span>
            </a>
          )}
        </div>
      </header>

      <main>
        <section className={`okg-site-hero${site.hero ? ' okg-site-hero--photo' : ''}`}>
          <span className="okg-site-hero__ring" aria-hidden="true" />
          <span className="okg-site-hero__dot" aria-hidden="true" />
          <div className="okg-site__inner okg-site-hero__inner">
            {eyebrow && <p className="okg-site-hero__eyebrow">{eyebrow}</p>}
            <h1 className="okg-site-hero__title">{site.tagline ?? operator.name}</h1>
            {site.intro && <p className="okg-site-hero__intro">{site.intro}</p>}
            {hasTours && (
              <a className="okg-btn okg-btn--primary okg-site-hero__cta" href="#tours">
                See tours and dates
              </a>
            )}
            {/* The hero photo (19b-2b; designs: U4): under the words on a phone, beside them on
                a desk; its credit under it. None: the style's pattern, as before. */}
            {site.hero && (
              <figure className="okg-site-hero__photo">
                <img
                  src={site.hero.url}
                  srcSet={srcSet(site.hero)}
                  sizes="(min-width: 960px) 560px, 100vw"
                  alt={site.hero.alt}
                />
                {creditLine(site.hero) && <figcaption>{creditLine(site.hero)}</figcaption>}
              </figure>
            )}
          </div>
        </section>

        <section
          className="okg-site__inner okg-site__tours"
          id="tours"
          aria-labelledby="okg-tours-title"
        >
          <h2 className="okg-site__h2" id="okg-tours-title">
            Our tours
          </h2>
          {hasTours ? (
            <>
              <div className="okg-site__grid">
                {tours.map((t) => (
                  <Card key={t.slug} operatorSlug={operator.slug} tour={t} />
                ))}
              </div>
              {operator.pricesInclude && (
                <p className="okg-muted okg-small">Prices include {operator.pricesInclude}.</p>
              )}
            </>
          ) : (
            <div className="okg-card okg-site__soon">
              <p className="okg-site__soon-title">New tours coming soon</p>
              {c.whatsapp && (
                <p className="okg-muted">
                  <a className="okg-link" href={whatsappUrl(c.whatsapp)}>
                    Message us on WhatsApp
                  </a>{' '}
                  to hear first.
                </p>
              )}
            </div>
          )}
        </section>

        {(site.about || site.whyUs.length > 0) && (
          <section className="okg-site__band">
            <div className="okg-site__inner okg-site__about-why">
              {site.about && (
                <div id="about">
                  <h2 className="okg-site__h2">About {op}</h2>
                  <p className="okg-muted okg-site__about">{site.about}</p>
                </div>
              )}
              {site.whyUs.length > 0 && (
                <div className="okg-site__why">
                  <h2 className="okg-site__h2">Why book with us</h2>
                  <ol className="okg-site__points">
                    {site.whyUs.map((p, i) => (
                      <li key={p.title} className="okg-card okg-site__point">
                        <span className="okg-site__num" aria-hidden="true">
                          {i + 1}
                        </span>
                        <span>
                          <span className="okg-strong okg-site__point-title">{p.title}</span>
                          <span className="okg-muted okg-small">{p.text}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </section>
        )}

        {site.faqs.length > 0 && (
          <section className="okg-site__inner okg-site__faqs" aria-labelledby="okg-faqs-title">
            <h2 className="okg-site__h2" id="okg-faqs-title">
              Questions
            </h2>
            {site.faqs.map((f) => (
              <details key={f.question} className="okg-site__faq">
                <summary>{f.question}</summary>
                <p className="okg-muted">{f.answer}</p>
              </details>
            ))}
          </section>
        )}

        {hasContact && (
          <section className="okg-site__band okg-site__contact-band" id="contact">
            <div className="okg-site__inner okg-site__contact">
              <div className="okg-site__contact-text">
                <h2 className="okg-site__h2">Get in touch</h2>
                <ul className="okg-plain-list">
                  {c.phone && (
                    <li>
                      <a className="okg-site__plain-link" href={`tel:${c.phone}`}>
                        {formatPhoneForDisplay(c.phone)}
                      </a>
                    </li>
                  )}
                  {c.email && (
                    <li>
                      <a className="okg-site__plain-link" href={`mailto:${c.email}`}>
                        {c.email}
                      </a>
                    </li>
                  )}
                  {c.address && <li className="okg-muted">{c.address}</li>}
                  {c.socials.length > 0 && (
                    <li className="okg-site__socials">
                      {c.socials.map((s, i) => (
                        <span key={s.network}>
                          {i > 0 && ' · '}
                          <a
                            className="okg-link"
                            href={s.url}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            {NETWORK_NAMES[s.network] ?? s.network}
                          </a>
                        </span>
                      ))}
                    </li>
                  )}
                </ul>
              </div>
              {c.whatsapp && (
                <a
                  className="okg-btn okg-btn--primary okg-site__whatsapp"
                  href={whatsappUrl(c.whatsapp)}
                >
                  Chat on WhatsApp
                </a>
              )}
            </div>
          </section>
        )}
      </main>

      <footer className="okg-site__inner okg-site__footer">
        <span>© {operator.name} · Bookings by OkapiGo</span>
        {/* The cards stay clean; everyone whose photo is on this page is named here (19b-2b). */}
        {credits && <span className="okg-site__credits">{credits}</span>}
      </footer>
      {loading && <p className="okg-visually-hidden">Updating…</p>}
    </div>
  );
}

/**
 * "3 h · walking · daily 09:00": one line, so the words after the first run in lower case,
 * except day names ("Thu–Sat 18:30", "Saturdays 07:00" keep their capitals).
 * @param {TourCard} t
 */
function facts(t) {
  const schedule = t.scheduleSummary?.replace(/^(Daily|Weekends|Weekdays)\b/, (w) =>
    w.toLowerCase(),
  );
  return [
    formatDurationShort(t.durationMinutes),
    t.activityLabel ? t.activityLabel.toLowerCase() : null,
    schedule ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** @param {{ operatorSlug: string, tour: TourCard }} props */
function Card({ operatorSlug, tour }) {
  const next = tour.nextDeparture ? formatLocalDay(tour.nextDeparture.localDate) : null;
  return (
    <Link
      className={`okg-card okg-tour-card okg-site-card${tour.photo ? ' okg-site-card--photo' : ''}`}
      href={`/${operatorSlug}/${tour.slug}`}
    >
      {/* The cover (19b-2b): the 640 px copy, loaded as it scrolls into view. */}
      {tour.photo && (
        <img
          className="okg-site-card__photo"
          src={tour.photo.small ?? tour.photo.url}
          alt={tour.photo.alt}
          loading="lazy"
        />
      )}
      <span className="okg-tour-card__meta">{facts(tour)}</span>
      <h3 className="okg-tour-card__title">{tour.title}</h3>
      <span className="okg-muted okg-small">{tour.summary}</span>
      <span className="okg-tour-card__foot">
        {tour.fromPriceKobo !== null && (
          <span>
            <span className="okg-label">from</span>
            <span className="okg-price okg-money">{formatNaira(tour.fromPriceKobo)}</span>
          </span>
        )}
        <span className="okg-site-card__book">{next ? `Book · ${next}` : 'See dates'}</span>
      </span>
    </Link>
  );
}

function SiteSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading tours"
      style={{ display: 'grid', gap: 'var(--space-3)' }}
    >
      <Bar width="60%" height={28} />
      <Bar width="85%" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="okg-card" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <Bar width={88} />
          <Bar width="80%" height={14} />
          <Bar width="95%" />
          <Bar width={64} height={24} pill />
        </div>
      ))}
    </div>
  );
}
