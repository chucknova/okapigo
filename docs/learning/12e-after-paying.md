# Stage 12e: After paying (confirmation, balance, payment links) + journey 5

From your designs (file 01: "Confirming your payment…", "Booking confirmed", the deposit
version, "Payment declined"; and the payment link page with its states), plus **PRD journey 5
(deposit now, balance later) tested end to end**.

## 1. What we built

| Piece                                       | Where                                                              |
| ------------------------------------------- | ------------------------------------------------------------------ |
| Confirming → confirmed / declined           | `apps/web/src/screens/trip/Confirm.jsx` (`/trip/:token/confirm`)   |
| Pay the balance                             | `screens/trip/PayBalance.jsx` (`/trip/:token/pay`)                 |
| Payment link page (all its states) + "done" | `screens/pay/PaymentLink.jsx` (`/pay/:token`, `/pay/:token/done`)  |
| Ask the provider directly                   | `checkPayment()` in `packages/db/src/reconciliation.js`            |
| Check, calendar, link endpoints             | `public-checkout.js`, `payment-links.js` in `apps/api/src/routes/` |
| Polling, remembered trips, status panel     | `lib/polling.js`, `lib/trips.js`, `components/StatusPanel.jsx`     |
| The dark confirmation band                  | `band-*` colours in shared `tokens.js` (with contrast tests)       |
| Journey 5                                   | `apps/web/e2e/journey-5-deposit-then-balance.spec.js`              |

## 2. How it works

### Coming back from Paystack

```
Paystack (simulator in test mode) ──► /trip/<token>/confirm?reference=OKG-…
  every 2 s   GET /public/bookings/:token        (did the webhook settle it yet?)
  from 8 s    POST …/payments/:reference/check   (ask Paystack ourselves)
  after 30 s  "Your payment is being confirmed" — you can close the page
      ├─ paid in full          → Booking confirmed · Paid in full
      ├─ deposit paid          → Booking confirmed · ₦X due by <date> · Pay balance now
      └─ failed / abandoned    → Payment declined · Try again (back to step 4)
```

**Why ask Paystack at all?** A declined card sends **no** webhook. Without the check, the page
would wait forever. And if our worker is down, the webhook sits unprocessed; the check covers that
too.

**One path for money.** The check doesn't mark anything paid itself. It records what Paystack said
as a webhook event and runs the **same** `processWebhookEvent` the worker runs. If the real webhook
arrives later, it's a duplicate and changes nothing.

### Payment links are now a page in the app

The old link page was plain HTML from the API. Now `/pay/:token` is a screen built from your
design, fed by `GET /public/payment-links/:token`:

| State         | When                                                           |
| ------------- | -------------------------------------------------------------- |
| `open`        | can be paid                                                    |
| `paid`        | already paid (shows when)                                      |
| `expired`     | past its date                                                  |
| `cancelled`   | staff cancelled it                                             |
| `out_of_date` | the booking now owes less than the link asks, or can't be paid |

The link endpoint returns **no personal data** (no names, emails or phones): anyone holding the
link sees the tour, date, amount and reference, nothing more.

### Private pages

`/trip/…` and `/pay/…` contain a secret in the address. The server sends them with `noindex`,
`Referrer-Policy: no-referrer` (so the address isn't leaked to other sites) and
`Cache-Control: private, no-store`, and embeds **no data** in the HTML: the page asks for it after
loading.

### Small things

- **Add to calendar** downloads a `.ics` file (`GET …/calendar.ics`), built by hand with the
  calendar format's rules: CRLF line ends, and `,` `;` `\` escaped.
- **Share on WhatsApp** shares the **tour** link, never the private trip link.
- **"View your trip"** on a paid link shows only if this browser booked that trip
  (`localStorage` `okg-trips`), because the link alone doesn't prove who you are.

## 3. Found along the way

- **A real bug:** `checkPayment` skipped processing when the event was a duplicate. If the webhook
  had been **recorded** but the worker was down, the check saw "duplicate" and did nothing, so the
  page hung. Now it always runs the processing step, which is safe because processing is
  idempotent (the concurrency test from 11c still covers two at once).
- **Lint caught impurity:** `Date.now()` during render (to decide "expired") is flagged by
  `react-hooks/purity`, since renders must give the same result for the same input. It's now a
  timer that flips a flag.
- **One unexplained failure:** an API test ("returns the guest…") failed once in a combined run
  and never again in three full runs plus two more today. I'm noting it rather than hiding it; if
  it comes back, the first suspect is shared test data between files.
- One e2e run took 15 minutes; the rerun took 5 seconds. The computer had gone to sleep.

### A note for running it yourself

The simulator returns to `WEB_PUBLIC_URL`. It isn't set in your `.env`, so it falls back to the
API's address (`:4000`), which serves the **built** app: after changing screens, you'd need
`pnpm --filter @okapigo/web build` and an API restart to see them there. To use the live dev
server instead, add to `.env`:

```
WEB_PUBLIC_URL=http://localhost:5173
```

## 4. Why we chose what we chose

| Choice                                  | Alternative               | Why                                                           |
| --------------------------------------- | ------------------------- | ------------------------------------------------------------- |
| Poll, then also ask Paystack from 8 s   | wait only for the webhook | declined cards send none; a down worker shouldn't hang guests |
| The check goes through the webhook path | mark paid directly        | one place decides what money means                            |
| Link page in the app, JSON endpoint     | keep server-made HTML     | one look, one set of components, testable states              |
| No personal data on the link endpoint   | show the guest's name     | links get forwarded; the amount is all a payer needs          |
| Share the tour link, not the trip link  | share the trip link       | the trip link lets anyone change the booking                  |

## 5. Concepts to study

- **Polling with back-off** and when to give up waiting (vs WebSockets)
- **Idempotent processing**: why running the same event twice must be safe
- **Capability URLs** (a secret in the link) and `Referrer-Policy`
- **iCalendar (RFC 5545)** basics
- **Pure renders** in React and why time can't be read during render

## 6. Try it yourself

```bash
pnpm --filter @okapigo/web e2e
```

By hand: book Badagry on a Saturday more than a week away, pay the 30% deposit, then on the
confirmation press "Pay balance now". Or decline on the simulator to see "Payment declined".

## 7. Differences from the designs

- The trip page itself (the hub with everything about the booking) is a placeholder until 12f;
  "View your trip" leads there.
- "Your payment is being confirmed" (the slow version) appears after 30 s; the design didn’t give a time.

## 8. What's next

**Stage 12f: the trip hub** (`/trip/<token>`): everything about a booking in one place, with
change, cancel and ask the operator.
