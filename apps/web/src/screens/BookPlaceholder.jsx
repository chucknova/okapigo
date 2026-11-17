// @ts-check
/**
 * /:operator/:tour/book: checkout's screens arrive in stage 12c. Until then this page says
 * so, and links back, so the tour page's Book buttons never lead to a dead end.
 */
import { Shell } from '../components/Shell.jsx';

/** @param {{ params: { operator: string, tour: string } }} props */
export function BookPlaceholder({ params }) {
  return (
    <Shell operatorName="">
      <div className="okg-card">
        <h1 className="okg-h2">Choose a date</h1>
        <p className="okg-muted" style={{ margin: 'var(--space-2) 0 var(--space-4)' }}>
          Online booking opens with the next stage (12c).
        </p>
        <a className="okg-btn okg-btn--secondary" href={`/${params.operator}/${params.tour}`}>
          Back to the tour
        </a>
      </div>
    </Shell>
  );
}
