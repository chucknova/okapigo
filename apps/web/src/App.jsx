// @ts-check
/**
 * The guest web's routes (docs/designs/README.md has the stage plan).
 *
 *   /_gallery                       component gallery (development)
 *   /:operator                      A · catalogue                 stage 12b
 *   /:operator/:tour                B · tour page                 stage 12b
 *   /:operator/:tour/book           checkout                      stage 12c (placeholder now)
 *
 * The same paths are served by the API with link previews and the page's data embedded
 * (apps/api/src/routes/share-pages.js). wouter (about 2 KB) does the matching.
 */
import { lazy, Suspense } from 'react';
import { Route, Switch } from 'wouter';
import { Catalogue } from './screens/Catalogue.jsx';
import { TourPage } from './screens/TourPage.jsx';
import { BookPlaceholder } from './screens/BookPlaceholder.jsx';
import { NotFound } from './screens/NotFound.jsx';

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
      <Route path="/:operator/:tour/book" component={BookPlaceholder} />
      <Route path="/:operator/:tour" component={TourPage} />
      <Route path="/:operator" component={Catalogue} />
      <Route>
        <NotFound />
      </Route>
    </Switch>
  );
}
