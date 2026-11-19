// @ts-check
/**
 * The operator app's shell: who's signed in decides what shows.
 *
 *   not signed in on this phone   → Sign in (O1)
 *   signed in, first time here    → First run (install · saving · ready)
 *   otherwise                     → the connection strip, the screen, the tabs
 *                                   Today (O2) · a manifest (O3) · Scan (O4) · Sync (O5)
 *
 * The sign-in running out (30 days) while offline doesn't stop anything: the app works as
 * normal, and once there's signal a sheet asks to sign in again to send the changes.
 */
import { useEffect, useState } from 'react';
import { Route, Router, Switch } from 'wouter';
import { ConnectionStrip } from './components/ConnectionStrip.jsx';
import { TabBar } from './components/TabBar.jsx';
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
  const tz = s.pkg?.operator?.timeZone ?? 'Africa/Lagos';
  return (
    <Router base={base}>
      <div className="app">
        <ConnectionStrip timeZone={tz} />
        <div className="app-body">
          <Switch>
            <Route path="/" component={Today} />
            <Route path="/sync" component={Sync} />
            <Route path="/scan" component={Scan} />
            <Route path="/scan/:id" component={Scan} />
            <Route path="/departures/:id" component={Manifest} />
            <Route>{() => <Later title="Not found" what="This page" stage="" back />}</Route>
          </Switch>
        </div>
        <TabBar />
        <SignInAgain />
      </div>
    </Router>
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
