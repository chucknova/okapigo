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
import { useEffect, useState } from 'react';
import { Route, Router, Switch } from 'wouter';
import { ConnectionStrip } from './components/ConnectionStrip.jsx';
import { TabBar, SideNav } from './components/TabBar.jsx';
import { NotAllowed } from './components/LiveFrame.jsx';
import { useLive } from './lib/live.js';
import { isOffice } from './lib/roles.js';
import { ManagerToday } from './screens/ManagerToday.jsx';
import { More } from './screens/More.jsx';
import { Schedule } from './screens/Schedule.jsx';
import { Departure } from './screens/Departure.jsx';
import { Bookings } from './screens/Bookings.jsx';
import { Inbox } from './screens/Inbox.jsx';
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
            <Route path="/settings">
              {officeOnly(() => (
                <Later title="Settings" what="Settings" stage="16e" />
              ))}
            </Route>
            <Route path="/more">
              {officeOnly(() => (
                <More />
              ))}
            </Route>
            <Route>{() => <Later title="Not found" what="This page" stage="" back />}</Route>
          </Switch>
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
