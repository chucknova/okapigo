// @ts-check
/**
 * More (the office's fifth tab on a phone): the rest, in a list. Settings arrive in 16e.
 */
import { Link } from 'wouter';
import { Icon } from '../components/Icon.jsx';
import { useSync } from '../lib/engine.jsx';

export function More() {
  const s = useSync();
  const items = [
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
