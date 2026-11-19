// @ts-check
/**
 * The connection strip: always on top (designs: tokens v1). Online, sending, offline, a
 * conflict, or trouble, never by colour alone (each has its icon and words). Tapping it opens
 * Sync (O5).
 */
import { Link } from 'wouter';
import { Icon } from './Icon.jsx';
import { stripFor } from '../lib/status.js';
import { useNow, useSync } from '../lib/engine.jsx';

/** @param {{ timeZone: string, asLink?: boolean }} props */
export function ConnectionStrip({ timeZone, asLink = true }) {
  const s = useSync();
  const now = useNow(1000);
  const strip = stripFor(s, now, timeZone);
  const inner = (
    <>
      {strip.icon === 'dot' ? (
        <span className="strip-dot" aria-hidden="true" />
      ) : (
        <Icon name={strip.icon} size={16} />
      )}
      <span>{strip.text}</span>
    </>
  );
  const cls = `strip strip--${strip.tone}`;
  return asLink ? (
    <Link href="/sync" className={cls} aria-live="polite">
      {inner}
    </Link>
  ) : (
    <div className={cls} role="status">
      {inner}
    </div>
  );
}
