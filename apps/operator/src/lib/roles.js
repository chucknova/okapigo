// @ts-check
/**
 * roles.js — which screens this person sees (one app for everyone, decided in brief 07:
 * "what you see depends on your role; the guide just sees less").
 *
 *   the office (manager, owner: can edit bookings)   Today · Schedule · Bookings · Inbox · More
 *   a guide                                          Today · Scan · Sync
 *
 * From /api/me's permissions (saved, so it holds offline), or, before the first sync after
 * signing in, from the role in the sign-in answer.
 */
import { hasAccess } from '@okapigo/shared/permissions';

/** @param {any} me  /api/me's answer @param {any} session */
export function isOffice(me, session) {
  if (me?.permissions?.bookings) return hasAccess(me.permissions.bookings, 'edit');
  return ['owner', 'manager'].includes(session?.user?.role?.key);
}

/** "Kunle (manager)" @param {any} me @param {any} session */
export function whoLine(me, session) {
  const user = me?.user ?? session?.user;
  if (!user) return '';
  const role = user.role?.name ?? user.role?.key;
  return role ? `${user.name} (${String(role).toLowerCase()})` : user.name;
}

/** The owner's first name, to ask for access: "Ask Bisola if you need access." @param {any} me */
export const ownerName = (me) => me?.owner?.name?.split(/\s+/)[0] ?? 'the owner';

/** The office's tabs on a phone, and its menu on a wide screen. */
export const OFFICE_TABS = /** @type {const} */ ([
  { href: '/', label: 'Today', icon: 'today', badge: null },
  { href: '/schedule', label: 'Schedule', icon: 'calendar', badge: 'schedule' },
  { href: '/bookings', label: 'Bookings', icon: 'list', badge: null },
  { href: '/inbox', label: 'Inbox', icon: 'inbox', badge: 'inbox' },
  { href: '/more', label: 'More', icon: 'more', badge: null },
]);

/** A guide's tabs. */
export const GUIDE_TABS = /** @type {const} */ ([
  { href: '/', label: 'Today', icon: 'today', badge: null },
  { href: '/scan', label: 'Scan', icon: 'scan', badge: null },
  { href: '/sync', label: 'Sync', icon: 'sync', badge: 'outbox' },
]);
