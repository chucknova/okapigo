// @ts-check
/**
 * The guide's tabs (designs: tokens v1, "Phone tabs · guide"): Today · Scan · Sync, with
 * the number of changes waiting on Sync. (The manager's five tabs come with their screens,
 * session 16.)
 */
import { Link, useLocation } from 'wouter';
import { Icon } from './Icon.jsx';
import { useSync } from '../lib/engine.jsx';

const TABS = /** @type {const} */ ([
  { href: '/', label: 'Today', icon: 'today' },
  { href: '/scan', label: 'Scan', icon: 'scan' },
  { href: '/sync', label: 'Sync', icon: 'sync' },
]);

export function TabBar() {
  const [location] = useLocation();
  const { outbox } = useSync();
  return (
    <nav aria-label="Main" className="tabs">
      {TABS.map((t) => {
        const current = t.href === '/' ? location === '/' : location.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className="tab"
            aria-current={current ? 'page' : undefined}
          >
            <Icon name={t.icon} size={22} width={2} />
            {t.label}
            {t.href === '/sync' && outbox.length > 0 && (
              <span className="tab-badge" aria-label={`${outbox.length} waiting`}>
                {outbox.length}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
