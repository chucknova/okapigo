// @ts-check
/**
 * The operator app's shell: who's signed in decides what shows.
 *
 *   not signed in on this phone   → Sign in (O1)
 *   signed in, first time here    → First run (install · saving · ready)
 *   otherwise                     → the connection strip, the screen, the tabs (Shell, below)
 *
 * The sign-in running out (30 days) while offline doesn't stop anything: the app works as
 * normal, and once there's signal a sheet asks to sign in again to send the changes.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { Route, Router, Switch } from 'wouter';
import { ConnectionStrip } from './components/ConnectionStrip.jsx';
import { TabBar, SideNav } from './components/TabBar.jsx';
import { NotAllowed } from './components/LiveFrame.jsx';
import { useLive } from './lib/live.js';
import { isOffice } from './lib/roles.js';
import { Sheet } from './components/Sheet.jsx';
import { useEngine, useSync } from './lib/engine.jsx';
import { REFRESH_EVERY_MS } from './lib/sync.js';
import { SignIn } from './screens/SignIn.jsx';
import { FirstRun } from './screens/FirstRun.jsx';
import { Today } from './screens/Today.jsx';
import { Sync } from './screens/Sync.jsx';
import { Later } from './screens/Later.jsx';
import { Manifest } from './screens/Manifest.jsx';
import { Scan } from './screens/Scan.jsx';

/**
 * The office's screens load from their own file, the first time one is opened (19c-2;
 * screens/office.js). One import for all of them: the browser fetches the file once.
 */
const office = () => import('./screens/office.js');
/** @param {keyof Awaited<ReturnType<typeof office>>} name */
const officeScreen = (name) =>
  lazy(() => office().then((m) => ({ default: /** @type {any} */ (m[name]) })));
const ManagerToday = officeScreen('ManagerToday');
const Schedule = officeScreen('Schedule');
const Departure = officeScreen('Departure');
const Bookings = officeScreen('Bookings');
const Inbox = officeScreen('Inbox');
const Dashboard = officeScreen('Dashboard');
const Posters = officeScreen('Posters');
const Settings = officeScreen('Settings');
const More = officeScreen('More');

/** @param {{ base?: string }} props */
export function App({ base = '/app' }) {
  const engine = useEngine();
  const s = useSync();

  // Keep in step: when signal comes back, when the app comes to the front, every few minutes.
  useEffect(() => {
    const changed = () => engine.connectionChanged();
    const visible = () => {
      if (document.visibilityState === 'visible') void engine.sync();
    };
    addEventListener('online', changed);
    addEventListener('offline', changed);
    document.addEventListener('visibilitychange', visible);
    const every = setInterval(() => void engine.sync(), REFRESH_EVERY_MS);
    return () => {
      removeEventListener('online', changed);
      removeEventListener('offline', changed);
      document.removeEventListener('visibilitychange', visible);
      clearInterval(every);
    };
  }, [engine]);

  if (!s.ready) return null;
  if (!s.session) return <SignIn />;
  if (!s.firstRunDone) return <FirstRun />;
  return (
    <Router base={base}>
      <Shell />
    </Router>
  );
}

/**
 * The signed-in app: the connection strip, the screen, and the tabs (a phone) or the menu
 * down the side (a wide screen). Which screens depends on the person's role (16a):
 *   the office   Today (theirs) · Schedule · Bookings · Inbox · More   (+ Scan and Sync)
 *   a guide      Today (theirs) · Scan · Sync
 * A guide opening an office link gets "This page is for managers".
 */
function Shell() {
  const s = useSync();
  const office = isOffice(s.me, s.session);
  const tz = s.me?.operator?.timeZone ?? s.pkg?.operator?.timeZone ?? 'Africa/Lagos';
  // The menu's badges come from the manager's Today (the same fetch the screen uses).
  const live = useLive(office ? '/api/today' : null);
  const badges = live.entry.data?.today?.badges ?? {};
  /** An office screen: the office sees it; anyone else, "This page is for managers". */
  const officeOnly = (/** @type {() => import('react').ReactNode} */ screen) => () =>
    office ? screen() : <NotAllowed forWhom="managers" />;
  return (
    <div className="app">
      <SideNav badges={badges} />
      <div className="app-main">
        <ConnectionStrip timeZone={tz} />
        <div className="app-body">
          {/* While an office screen's file arrives (once; then it's in memory). */}
          <Suspense
            fallback={
              <p className="muted" role="status">
                Loading…
              </p>
            }
          >
            <Switch>
              <Route path="/">{() => (office ? <ManagerToday /> : <Today />)}</Route>
              <Route path="/sync" component={Sync} />
              <Route path="/scan" component={Scan} />
              <Route path="/scan/:id" component={Scan} />
              <Route path="/departures/:id">{() => (office ? <Departure /> : <Manifest />)}</Route>
              <Route path="/schedule">
                {officeOnly(() => (
                  <Schedule />
                ))}
              </Route>
              {/* One route for the list and an open booking: the search and filter are kept
                while you open bookings one after another. */}
              <Route path="/bookings/:id?">
                {officeOnly(() => (
                  <Bookings />
                ))}
              </Route>
              <Route path="/inbox/alerts">
                {officeOnly(() => (
                  <Inbox tab="alerts" />
                ))}
              </Route>
              <Route path="/inbox/requests/:rid?">
                {officeOnly(() => (
                  <Inbox tab="requests" />
                ))}
              </Route>
              <Route path="/inbox/:id?">
                {officeOnly(() => (
                  <Inbox tab="chats" />
                ))}
              </Route>
              <Route path="/dashboard">
                {officeOnly(() => (
                  <Dashboard />
                ))}
              </Route>
              <Route path="/posters">
                {officeOnly(() => (
                  <Posters />
                ))}
              </Route>
              <Route path="/settings/:section?/:item?">
                {officeOnly(() => (
                  <Settings />
                ))}
              </Route>
              <Route path="/more">
                {officeOnly(() => (
                  <More />
                ))}
              </Route>
              <Route>{() => <Later title="Not found" what="This page" stage="" back />}</Route>
            </Switch>
          </Suspense>
        </div>
      </div>
      <TabBar badges={badges} />
      <SignInAgain />
    </div>
  );
}

/** "Sign in again to send your 6 changes" (Sync edge cases), once there's signal. */
function SignInAgain() {
  const s = useSync();
  const [later, setLater] = useState(false);
  if (!s.signedOut || later || s.connection === 'offline') return null;
  return (
    <Sheet title="Sign in again" onClose={() => setLater(true)}>
      <SignIn
        contact={s.session?.contact ?? ''}
        again={{
          waiting: s.outbox.length,
          name: s.session?.user?.name ?? 'you',
          onLater: () => setLater(true),
        }}
      />
    </Sheet>
  );
}
