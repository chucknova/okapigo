// @ts-check
/**
 * M3 · Checkout (designs: "Sojourna — Checkout"): the seats are held (a countdown in the
 * header); the lead guest's name, email and phone; "Pay (test)": nothing is charged, Sojourna
 * confirms the booking with the supplier and shows the ticket.
 *
 *   the hold runs out    "Your seats were released" (TIME'S UP), and Choose again
 *   the supplier fails   "We couldn't confirm your booking": nothing charged; still held
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useLoad } from '../lib/use-load.js';
import { api } from '../lib/api.js';
import {
  clock,
  dateLabel,
  naira,
  orderLines,
  possessive,
  refundDeadlines,
  startPlace,
  timeOf,
} from '../lib/words.js';
import { holdRanOut, notConfirmed } from '../lib/states.js';
import { StatePanel } from '../components/StatePanel.jsx';
import { Header } from '../components/Header.jsx';

/** @param {{ uuid: string }} props */
export function Checkout({ uuid }) {
  const [, navigate] = useLocation();
  const hold = useLoad(`/api/holds/${uuid}`);
  const supplier = useLoad('/api/supplier');
  const name = supplier.data?.supplier?.name ?? 'The operator';
  const [now, setNow] = useState(() => Date.now());
  const [form, setForm] = useState({ fullName: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(/** @type {any} */ (null));
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const b = hold.data?.booking;
  const p = hold.data?.experience;
  const expiresAt = b?.utcExpiresAt ? Date.parse(b.utcExpiresAt) : null;
  const secondsLeft = expiresAt ? (expiresAt - now) / 1000 : null;
  const ranOut =
    problem?.problem === 'expired' ||
    (b && b.status !== 'ON_HOLD' && b.status !== 'CONFIRMED') ||
    (secondsLeft !== null && secondsLeft <= 0);

  const pay = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await api(`/api/holds/${uuid}/confirm`, { method: 'POST', body: form });
      navigate(`/booked/${r.ref}`);
    } catch (err) {
      setBusy(false);
      setProblem(err);
    }
  };

  return (
    <>
      <Header>
        {secondsLeft !== null && !ranOut && (
          <span role="timer" aria-label="Seats held" className="timer">
            Seats held for {clock(secondsLeft)}
          </span>
        )}
      </Header>
      {hold.error ? (
        <main className="page">
          <StatePanel
            tone="bad"
            tag="NOT FOUND"
            title="We can’t find these seats"
            body={hold.error.message}
          >
            <Link href="/" className="btn btn--line">
              Back to experiences
            </Link>
          </StatePanel>
        </main>
      ) : !b || !p ? (
        <main className="page" aria-busy="true" />
      ) : ranOut ? (
        <main className="page">
          <StatePanel {...holdRanOut()}>
            <Link href={`/experiences/${b.productId}`} className="btn btn--blue">
              Choose again
            </Link>
          </StatePanel>
        </main>
      ) : (
        <main className="page page--checkout">
          <section className="panel stack-md">
            <h1 className="h1 h1--small">Who’s the lead guest?</h1>
            <p className="muted">
              We share these details with {name} so they can reach you on the day.
            </p>
            {problem?.problem === 'not_confirmed' && (
              <StatePanel
                {...notConfirmed(
                  name,
                  expiresAt ? new Date(expiresAt).toTimeString().slice(0, 5) : null,
                )}
              />
            )}
            <form
              className="stack-md"
              onSubmit={(e) => {
                e.preventDefault();
                pay();
              }}
            >
              <label className="field">
                Full name
                <input
                  className="input"
                  type="text"
                  autoComplete="name"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                Email
                <input
                  className="input"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                Mobile (WhatsApp if you have it)
                <input
                  className="input"
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </label>
              <div className="pay-note">
                <strong>Payment</strong>
                <span>This is a test site: no card needed and nothing is charged.</span>
              </div>
              {problem?.problem === 'refused' && (
                <p role="alert" className="note note--bad">
                  {problem.message}
                </p>
              )}
              <button type="submit" className="btn btn--blue btn--big" disabled={busy}>
                {busy
                  ? 'Confirming…'
                  : problem?.problem === 'not_confirmed'
                    ? 'Try again'
                    : `Pay ${naira(b.pricing?.retail ?? 0)} (test)`}
              </button>
              <p className="small muted">
                By paying you agree to Sojourna’s terms and {possessive(name)} cancellation policy.
              </p>
            </form>
          </section>
          <OrderSummary b={b} p={p} name={name} />
        </main>
      )}
    </>
  );
}

/** What's being booked: the tour, the day, who, the total, the refund deadlines. @param {{ b: any, p: any, name: string }} props */
function OrderSummary({ b, p, name }) {
  const lines = orderLines(p.options?.[0]?.units ?? [], b.unitItems);
  const place = startPlace(b, p);
  const start = b.availability.localDateTimeStart;
  return (
    <aside className="panel stack-sm" aria-label="Your booking">
      <div className="summary-title">{p.title}</div>
      <div className="small muted">by {name}</div>
      <div>
        {dateLabel(start)} · {timeOf(start)}
      </div>
      {place && <div>{place}</div>}
      <div className="lines">
        {lines.map((l) => (
          <div key={l.id} className="row-between">
            <span>{l.text}</span>
            <span>{l.price}</span>
          </div>
        ))}
      </div>
      <div className="summary-total">
        <strong>Total</strong>
        <strong className="big">{naira(b.pricing?.retail ?? 0)}</strong>
      </div>
      <div className="small muted">{refundDeadlines(p.options?.[0]?.refundRules, start)}</div>
    </aside>
  );
}
