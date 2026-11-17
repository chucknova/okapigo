// @ts-check
import { describeError } from '../lib/api.js';
import { Button } from './Button.jsx';

/**
 * "You're offline · Check your connection and try again. Nothing you entered is lost."
 * Used by any screen whose request failed. `onRetry` repeats the request; the screen keeps
 * what the guest typed, so nothing is lost.
 * @param {{ error: unknown, onRetry: () => void }} props
 */
export function ErrorState({ error, onRetry }) {
  const { title, body } = describeError(error);
  return (
    <div className="okg-card" role="alert">
      <h2 style={{ fontSize: 'var(--text-lg)', lineHeight: 'var(--leading-lg)' }}>{title}</h2>
      {body && (
        <p style={{ color: 'var(--color-text-muted)', margin: 'var(--space-2) 0 var(--space-4)' }}>
          {body}
        </p>
      )}
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
