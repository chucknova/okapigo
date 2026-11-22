// @ts-check
/**
 * Sojourna (session 17d): a pretend travel website that sells an OkapiGo business's tours
 * through OCTO, as a real OTA would (designs: "Sojourna — Mock OTA").
 *
 *   /                     M1 · the business's experiences
 *   /experiences/:id      M2 · one: a date, a time, who's coming
 *   /checkout/:uuid       M3 · the lead guest, and paying (a test: nothing is charged)
 *   /booked/:ref          M4 · you're booked: the ticket, where to meet
 *   /bookings             M5 · the back office (17d-2)
 */
import { Route, Switch } from 'wouter';
import { Header } from './components/Header.jsx';
import { Experiences } from './screens/Experiences.jsx';
import { Experience } from './screens/Experience.jsx';
import { Checkout } from './screens/Checkout.jsx';
import { Booked } from './screens/Booked.jsx';
import { StatePanel } from './components/StatePanel.jsx';

export function App() {
  return (
    <Switch>
      <Route path="/checkout/:uuid">{(p) => <Checkout uuid={p.uuid} />}</Route>
      <Route>
        <Header />
        <Switch>
          <Route path="/">{() => <Experiences />}</Route>
          <Route path="/experiences/:id">{(p) => <Experience id={p.id} />}</Route>
          <Route path="/booked/:ref">{(p) => <Booked reference={p.ref} />}</Route>
          <Route path="/bookings">
            {() => (
              <main className="page">
                <StatePanel
                  tone="info"
                  tag="COMING NEXT"
                  title="My bookings"
                  body="The back office, with your bookings and cancelling, arrives in the next part (17d-2)."
                />
              </main>
            )}
          </Route>
          <Route>
            {() => (
              <main className="page">
                <StatePanel tone="info" tag="NOT FOUND" title="That page isn’t here" body="" />
              </main>
            )}
          </Route>
        </Switch>
      </Route>
    </Switch>
  );
}
