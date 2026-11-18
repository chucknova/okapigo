// @ts-check
/**
 * A · Catalogue: every published tour of one operator (docs/designs, file 01).
 * /irin-lagos-tours
 *
 * Data: the page's embedded data on first load, else GET /public/:operator.
 * States: loading (skeleton cards) · no tours · not found · offline / failed (Try again).
 */
import { Link } from 'wouter';
import { formatNaira } from '@okapigo/shared/money';
import { formatLocalDay } from '@okapigo/shared/preview';
import { formatDurationShort } from '@okapigo/shared/tour-facts';
import { takeEmbedded, useApi } from '../lib/data.js';
import { ApiError } from '../lib/api.js';
import { Shell } from '../components/Shell.jsx';
import { Icon } from '../components/Icon.jsx';
import { Bar } from '../components/Skeleton.jsx';
import { ErrorState } from '../components/ErrorState.jsx';
import { NotFound } from './NotFound.jsx';
import { useLook } from '../lib/look.js';

/**
 * @typedef {{ slug: string, name: string, city: string | null, pricesInclude: string | null, timeZone: string }} PublicOperator
 * @typedef {{
 *   slug: string, title: string, summary: string, durationMinutes: number,
 *   activityLabel: string | null, fromPriceKobo: number | null,
 *   cancellationHeadline: string | null,
 *   nextDeparture: { localDate: string, localTime: string } | null,
 * }} TourCard
 */

/** @param {{ params: { operator: string } }} props */
export function Catalogue({ params }) {
  const slug = params.operator;
  const initial = takeEmbedded((d) => d.kind === 'catalogue' && d.operatorSlug === slug);
  const { data, error, loading, retry } = useApi(
    `/public/${encodeURIComponent(slug)}`,
    initial?.view ?? null,
  );
  /** @type {{ operator: PublicOperator, tours: TourCard[] } | null} */
  const view = data;
  useLook(view?.operator);

  if (error instanceof ApiError && error.status === 404) return <NotFound />;
  if (!view) {
    return (
      <Shell operatorName={error ? 'OkapiGo' : ''}>
        {error ? <ErrorState error={error} onRetry={retry} /> : <CatalogueSkeleton />}
      </Shell>
    );
  }

  const { operator, tours } = view;
  return (
    <Shell operatorName={operator.name}>
      <div>
        <h1 className="okg-title">{operator.city ? `Tours in ${operator.city}` : 'Our tours'}</h1>
        <p className="okg-muted okg-small">{subline(operator, tours)}</p>
      </div>
      {tours.length === 0 ? (
        <div className="okg-card">
          <h2 className="okg-h2">No tours available right now</h2>
          <p className="okg-muted">
            New dates are coming soon. Message {operator.name} to ask about private tours.
          </p>
        </div>
      ) : (
        tours.map((t) => <Card key={t.slug} operatorSlug={operator.slug} tour={t} />)
      )}
      {loading && <p className="okg-visually-hidden">Updating…</p>}
      <p className="okg-muted okg-xs">Bookings by OkapiGo</p>
    </Shell>
  );
}

/**
 * "5 tours · prices include VAT · free cancellation up to 48 hours before". The last part
 * only when EVERY tour has the same free-cancellation rule (otherwise it would mislead).
 * @param {PublicOperator} operator
 * @param {TourCard[]} tours
 */
function subline(operator, tours) {
  const parts = [`${tours.length} ${tours.length === 1 ? 'tour' : 'tours'}`];
  if (operator.pricesInclude) parts.push(`prices include ${operator.pricesInclude}`);
  const headlines = new Set(tours.map((t) => t.cancellationHeadline));
  const [only] = headlines;
  if (headlines.size === 1 && only) parts.push(only.charAt(0).toLowerCase() + only.slice(1));
  return parts.join(' · ');
}

/** @param {{ operatorSlug: string, tour: TourCard }} props */
function Card({ operatorSlug, tour }) {
  return (
    <Link className="okg-card okg-tour-card" href={`/${operatorSlug}/${tour.slug}`}>
      <span className="okg-tour-card__meta">
        <Icon name="clock" size={16} />
        {formatDurationShort(tour.durationMinutes)}
        {tour.activityLabel && (
          <>
            <span aria-hidden="true">·</span>
            {tour.activityLabel}
          </>
        )}
      </span>
      <span className="okg-tour-card__title">{tour.title}</span>
      <span className="okg-muted okg-small">{tour.summary}</span>
      <span className="okg-tour-card__foot">
        {tour.fromPriceKobo !== null && (
          <span>
            <span className="okg-label">from</span>
            <span className="okg-price okg-money">{formatNaira(tour.fromPriceKobo)}</span>
          </span>
        )}
        <span className="okg-tour-card__next">
          <span className="okg-label">Next</span>
          <span className="okg-strong-sm">
            {tour.nextDeparture ? formatLocalDay(tour.nextDeparture.localDate) : 'No dates yet'}
          </span>
        </span>
      </span>
    </Link>
  );
}

function CatalogueSkeleton() {
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
          <Bar width="70%" />
          <Bar width={64} height={24} pill />
        </div>
      ))}
    </div>
  );
}
