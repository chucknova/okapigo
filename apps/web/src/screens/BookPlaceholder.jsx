// @ts-check
/**
 * /:operator/:tour/book/details: checkout steps 3–4 arrive in stage 12d. Until then this
 * page says so, and links back, so Continue never leads to a dead end.
 */
import { Shell } from '../components/Shell.jsx';

/** @param {{ params: { operator: string, tour: string } }} props */
export function BookPlaceholder({ params }) {
  return (
    <Shell operatorName="">
      <div className="okg-card">
        <h1 className="okg-h2">Your details</h1>
        <p className="okg-muted" style={{ margin: 'var(--space-2) 0 var(--space-4)' }}>
          Details and payment open with the next stage (12d). Your choices are saved.
        </p>
        <a
          className="okg-btn okg-btn--secondary"
          href={`/${params.operator}/${params.tour}/book/who`}
        >
          Back to who’s coming
        </a>
      </div>
    </Shell>
  );
}
