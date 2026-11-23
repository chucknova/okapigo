// @ts-check
/**
 * More (the office's fifth tab on a phone): the rest, in a list (Settings since 16e, Posters
 * since 18b, the Dashboard since 18c).
 */
import { Link } from 'wouter';
import { Icon } from '../components/Icon.jsx';
import { useSync } from '../lib/engine.jsx';
import { canMakePosters } from '../lib/posters.js';
import { canSeeDashboard } from '../lib/dashboard.js';

export function More() {
  const s = useSync();
  const items = [
    // The dashboard (18c): for the owner and managers (reports).
    ...(canSeeDashboard(s.me, s.session)
      ? [{ href: '/dashboard', label: 'Dashboard', note: 'Today, and the last 30 days' }]
      : []),
    // Posters (18b): for the owner and managers (marketing).
    ...(canMakePosters(s.me, s.session)
      ? [{ href: '/posters', label: 'Posters', note: 'Square or story, ready to post' }]
      : []),
    { href: '/settings', label: 'Settings', note: 'Website, messages, WhatsApp, staff, tours' },
    {
      href: '/sync',
      label: 'Sync',
      note: s.outbox.length ? `${s.outbox.length} changes waiting` : 'Everything sent',
    },
    { href: '/scan', label: 'Scan a ticket', note: 'If you’re guiding today' },
  ];
  return (
    <main className="page">
      <h1 className="h-xl">More</h1>
      <ul className="list">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="list-row list-link">
              <span className="grow">
                <span className="block strong">{i.label}</span>
                <span className="small muted">{i.note}</span>
              </span>
              <Icon name="back" size={18} className="chevron" />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
