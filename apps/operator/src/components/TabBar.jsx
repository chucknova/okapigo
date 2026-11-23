// @ts-check
/**
 * The tabs on a phone, and the menu down the side on a wide screen (designs: tokens v1,
 * "Phone tabs · guide", "Phone tabs · manager and owner", "Desktop · sidebar"). Which tabs
 * depends on the person's role (lib/roles.js). Badges: the guide's changes waiting; the
 * office's departures needing a guide and inbox items.
 */
import { Link, useLocation } from 'wouter';
import { Icon } from './Icon.jsx';
import { useSync } from '../lib/engine.jsx';
import { GUIDE_TABS, OFFICE_TABS, isOffice, whoLine } from '../lib/roles.js';
import { canMakePosters } from '../lib/posters.js';

/** @param {{ badges?: Record<string, number> }} props */
function useTabs({ badges = {} }) {
  const s = useSync();
  const office = isOffice(s.me, s.session);
  const tabs = office ? OFFICE_TABS : GUIDE_TABS;
  const counts = { ...badges, outbox: s.outbox.length };
  return { tabs, counts, office, s };
}

/** @param {string} location @param {string} href */
const isCurrent = (location, href) => (href === '/' ? location === '/' : location.startsWith(href));

/** The phone's tab bar. @param {{ badges?: Record<string, number> }} props */
export function TabBar(props) {
  const [location] = useLocation();
  const { tabs, counts } = useTabs(props);
  return (
    <nav aria-label="Main" className={`tabs tabs--${tabs.length}`}>
      {tabs.map((t) => {
        const n = t.badge ? (counts[t.badge] ?? 0) : 0;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="tab"
            aria-current={isCurrent(location, t.href) ? 'page' : undefined}
          >
            <Icon name={t.icon} size={22} width={2} />
            {t.label}
            {n > 0 && (
              <span className="tab-badge" aria-label={`${n} waiting`}>
                {n}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** The menu down the side on a wide screen. @param {{ badges?: Record<string, number> }} props */
export function SideNav(props) {
  const [location] = useLocation();
  const { tabs, counts, office, s } = useTabs(props);
  // On a wide screen the office's "More" is Posters (18b) and Settings (the rest is on Today
  // and Sync).
  const items = office
    ? [
        ...tabs.filter((t) => t.href !== '/more'),
        ...(canMakePosters(s.me, s.session)
          ? [{ href: '/posters', label: 'Posters', icon: 'more', badge: null }]
          : []),
        { href: '/settings', label: 'Settings', icon: 'more', badge: null },
      ]
    : tabs;
  return (
    <nav aria-label="Main" className="sidenav">
      <div className="sidenav-brand">OkapiGo</div>
      <div className="sidenav-who">
        {[s.me?.operator?.name ?? s.pkg?.operator?.name, whoLine(s.me, s.session)]
          .filter(Boolean)
          .join(' · ')}
      </div>
      {items.map((t) => {
        const n = t.badge ? (counts[t.badge] ?? 0) : 0;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="sidenav-item"
            aria-current={isCurrent(location, t.href) ? 'page' : undefined}
          >
            <span>{t.label}</span>
            {n > 0 && <span className="sidenav-badge">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
