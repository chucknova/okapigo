// @ts-check
/**
 * A screen that arrives in a later stage (Scan: 15c-3; the manifest: 15c-2), so a tab
 * never leads nowhere.
 */
import { Link } from 'wouter';
import { Icon } from '../components/Icon.jsx';

/** @param {{ title: string, what: string, stage: string, back?: boolean }} props */
export function Later({ title, what, stage, back = false }) {
  return (
    <main className="page">
      {back && (
        <Link href="/" className="icon-btn icon-btn--edge" aria-label="Back to Today">
          <Icon name="back" size={24} />
        </Link>
      )}
      <h1 className="h-xl">{title}</h1>
      <p className="muted">
        {what} {stage ? `comes in the next stages of the app (${stage}).` : 'isn’t here.'}
      </p>
    </main>
  );
}
