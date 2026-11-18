// @ts-check
/**
 * The guest web's routes (docs/designs/README.md has the stage plan).
 *
 *   /_gallery                       component gallery (development)
 *   /:operator                      A · catalogue                 stage 12b
 *   /:operator/:tour                B · tour page                 stage 12b
 *   /:operator/:tour/book           checkout 1 · choose a date    stage 12c
 *   /:operator/:tour/book/who       checkout 2 · who's coming     stage 12c
 *   /:operator/:tour/book/details   checkout 3 · your details     stage 12d
 *   /:operator/:tour/book/review    checkout 4 · review and pay   stage 12d
 *   /trip/:token/confirm            C/D · confirming → confirmed  stage 12e
 *   /trip/:token/pay                F · pay your balance           stage 12e
 *   /trip/:token                    the trip hub                   stage 12f (placeholder now)
 *   /pay/:token(/done)              E · a payment link             stage 12e
 *
 * The same paths are served by the API with link previews and the page's data embedded
 * (apps/api/src/routes/share-pages.js). wouter (about 2 KB) does the matching.
 */
import { lazy, Suspense } from 'react';
import { Route, Switch } from 'wouter';
import { Catalogue } from './screens/Catalogue.jsx';
import { TourPage } from './screens/TourPage.jsx';
import { ChooseDate } from './screens/checkout/ChooseDate.jsx';
import { WhoComing } from './screens/checkout/WhoComing.jsx';
import { Details } from './screens/checkout/Details.jsx';
import { Review } from './screens/checkout/Review.jsx';
import { NotFound } from './screens/NotFound.jsx';
import { Confirm } from './screens/trip/Confirm.jsx';
import { PayBalance } from './screens/trip/PayBalance.jsx';
import { TripHub } from './screens/trip/TripHub.jsx';
import { PaymentLink, PaymentLinkDone } from './screens/pay/PaymentLink.jsx';

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
      {/* Private pages first: "trip" and "pay" are reserved words, never operators. */}
      <Route path="/trip/:token/confirm" component={Confirm} />
      <Route path="/trip/:token/pay" component={PayBalance} />
      <Route path="/trip/:token" component={TripHub} />
      <Route path="/pay/:token/done" component={PaymentLinkDone} />
      <Route path="/pay/:token" component={PaymentLink} />
      <Route path="/:operator/:tour/book/review" component={Review} />
      <Route path="/:operator/:tour/book/details" component={Details} />
      <Route path="/:operator/:tour/book/who" component={WhoComing} />
      <Route path="/:operator/:tour/book" component={ChooseDate} />
      <Route path="/:operator/:tour" component={TourPage} />
      <Route path="/:operator" component={Catalogue} />
      <Route>
        <NotFound />
      </Route>
    </Switch>
  );
}
