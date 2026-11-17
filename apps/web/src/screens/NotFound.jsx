// @ts-check
import { Shell } from '../components/Shell.jsx';

/**
 * Shown when the operator or tour doesn't exist (or isn't on sale any more).
 * @param {{ operatorName?: string, operatorSlug?: string }} props
 */
export function NotFound({ operatorName, operatorSlug }) {
  return (
    <Shell operatorName={operatorName ?? 'OkapiGo'}>
      <div className="okg-card">
        <h1 className="okg-h2">
          {operatorSlug ? "This tour isn't available any more" : "We couldn't find that page"}
        </h1>
        <p className="okg-muted" style={{ margin: 'var(--space-2) 0 var(--space-4)' }}>
          {operatorSlug
            ? 'It may have been changed or retired. Their other tours are still running.'
            : 'The link may be old, or mistyped.'}
        </p>
        {operatorSlug && (
          <a className="okg-btn okg-btn--secondary" href={`/${operatorSlug}`}>
            See all tours
          </a>
        )}
      </div>
    </Shell>
  );
}
