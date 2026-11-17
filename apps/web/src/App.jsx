// @ts-check
/**
 * The guest web's routes. Screens arrive stage by stage (docs/designs/README.md):
 *   12b  /:operator, /:operator/:tour      catalogue and tour page
 *   12c+ checkout, after paying, trip hub, website, widget
 * Routing uses wouter (about 2 KB): the same idea as React Router, sized for the 300 KB budget.
 */
import { lazy, Suspense } from 'react';
import { Route, Switch } from 'wouter';
import { Shell } from './components/Shell.jsx';

// The gallery is for development, so it's split into its own file that only downloads when
// someone opens /_gallery. Guests never pay for it in the 300 KB budget.
const Gallery = lazy(() => import('./gallery/Gallery.jsx').then((m) => ({ default: m.Gallery })));

export function App() {
  return (
    <Switch>
      <Route path="/_gallery">
        <Suspense fallback={null}>
          <Gallery />
        </Suspense>
      </Route>
      <Route>
        <Shell operatorName="OkapiGo">
          <h1 style={{ fontSize: 'var(--text-xl)', lineHeight: 'var(--leading-xl)' }}>Guest web</h1>
          <p>
            Screens arrive from stage 12b. For now, see the{' '}
            <a className="okg-link" href="/_gallery">
              component gallery
            </a>
            .
          </p>
        </Shell>
      </Route>
    </Switch>
  );
}
