// @ts-check
/**
 * office.js — the office's screens, in a file of their own (stage 19c-2).
 *
 * The app's script was over 500 kB (Vite warned at every build since 16e-4c). A GUIDE uses
 * sign-in, Today, a departure's manifest, Scan and Sync; the office's screens (schedule,
 * bookings desk, inbox, dashboard, posters, settings) are most of the rest. App.jsx loads
 * this file only when one of them is opened (React.lazy), so a guide's phone starts less
 * code. An office user's home screen is in here, so for them it's one more file at the start.
 *
 * Offline still works: the build lists every file it makes in precache.json, this one
 * included, and the service worker saves them all when the app is installed.
 */
export { ManagerToday } from './ManagerToday.jsx';
export { Schedule } from './Schedule.jsx';
export { Departure } from './Departure.jsx';
export { Bookings } from './Bookings.jsx';
export { Inbox } from './Inbox.jsx';
export { Dashboard } from './Dashboard.jsx';
export { Posters } from './Posters.jsx';
export { Settings } from './Settings.jsx';
export { More } from './More.jsx';
