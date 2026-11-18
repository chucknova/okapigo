# Stage 12f-2: Cancel yourself, or ask Ìrìn

From your designs (file 05: "Cancel yourself (journey 4)" and "Ask the operator"), and the
2026-11-17 decision: guests can **both** cancel themselves and ask the operator.

## 1. What we built

| Piece                                                          | Where                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1 · Change or cancel (the two choices)                         | `apps/web/src/screens/trip/TripChange.jsx` (`/trip/:token/change`) |
| 2 · Confirm, refund first · 3 · Cancelled                      | same file (`/trip/:token/cancel`)                                  |
| Ask Ìrìn: form, then Sent                                      | same file (`/trip/:token/ask`)                                     |
| "Your request was sent on Tue 1 Dec" banner, the Change button | `TripHub.jsx`                                                      |
| "Why ₦31,250?" in words                                        | `refundReason()` in shared `trip-hub.js`                           |
| The guest's cancellation and its rules                         | `guestCancelBooking()` in `packages/db/src/cancellations.js`       |
| Requests: ask, list, answer                                    | `packages/db/src/guest-requests.js`, table `guest_requests`        |
| Public endpoints                                               | `POST /public/bookings/:token/cancel`, `…/requests`                |
| Staff endpoints                                                | `apps/api/src/routes/guest-requests.js`                            |
| Journey 4 end to end                                           | `apps/web/e2e/journey-4-cancel-yourself.spec.js`                   |

## 2. How it works

### Cancelling yourself

```
Change or cancel ──► [Instant: Cancel now]          [Reply in a few hours: Ask Ìrìn]
                         │
                         ▼
   You paid ₦62,500 · Refund (50%) ₦31,250 · You'll get back ₦31,250
   "All 3 travellers are cancelled. This can't be undone."
                         │ Cancel and get ₦31,250 back
                         ▼
   POST /public/bookings/:token/cancel  { expectRefundKobo: 3125000 }
     ├─ locks the booking (two taps or two tabs can't both cancel)
     ├─ on the trip day (Lagos time)?        → 409 TOO_LATE_TO_CANCEL ("contact Ìrìn")
     ├─ refund now ≠ the refund SHOWN?       → 409 REFUND_CHANGED, nothing cancelled
     ├─ cancel, with the same policy engine staff use (seats back on sale, refund owed)
     └─ then ask Paystack for the refund     → "Your ₦31,250 refund is on its way"
```

**Why send the amount back?** The page works out the refund from the policy and the clock.
If the guest reads the screen at 08:59 and taps at 09:01, the 48-hour line may have passed.
The server compares, and if they differ it cancels **nothing** and the page shows the new
amount. The guest never gets less than they agreed to on screen.

**The refund starts by itself.** Staff cancellations leave the refund for a separate staff step
(10e). A guest cancelling under the policy is told "on its way", so it's sent at once. If Paystack
refuses or is down, the refund stays **owed** on the booking (staff see it and can send it
again), and the page says "₦31,250 is owed back to you. Ìrìn will send it."

### Asking Ìrìn

```
Ask Ìrìn: ( ) Change the date  ( ) Cancel  ( ) Something else  + a message
   POST /public/bookings/:token/requests → guest_requests (open) + a timeline entry
   trip hub: "Your request was sent on Tue 1 Dec · “Can we move to Sun 6 Dec?”"

Staff: GET /api/guest-requests → who, how to reach them, which trip, what they asked
       (they reply on WhatsApp or by email, then)
       POST /api/guest-requests/:id/answer { note } → answered, gone from the trip hub
```

**Asking changes nothing.** Staff use what they already have (cancel with a chosen refund,
payment links…). Guards: at most 3 open requests per booking, 1–1000 characters, only for
bookings that are still on, and a guide (bookings: view) can read the list but not answer it.

## 3. Found along the way

- **"17 days" vs "In 18 days":** the refund explanation rounded the days down, and the heading
  counts calendar days. It now rounds to the nearest. A test of mine had its hours wrong
  (03:00 on the 4th to 09:00 on the 5th is 30 hours, not 29): the code was right.
- **The e2e failed on old screens:** `npx playwright test` doesn't build; `pnpm … e2e` does.
- **A race in a 12e test:** "this phone remembers the trip" was checked straight after the
  heading appeared. The page saves it in an effect just after drawing, so under load the test
  could look too early. It now waits. This is probably 12e's "unexplained" one-off.
- **Busy machine:** with Figma using about three of the eight cores, the full suite hit time
  limits in old, unrelated tests (seeding a demo business inside a test is slow under load).
  Each of those files passes alone. One full run passed completely; others had 1–3 timeouts.
  Running fewer packages at once didn't help while the load stayed that high.

## 4. Why we chose what we chose

| Choice                                 | Alternative               | Why                                                       |
| -------------------------------------- | ------------------------- | --------------------------------------------------------- |
| Send the refund shown, server compares | trust the server's figure | the guest never confirms an amount they didn't see        |
| No cancelling on the trip day          | allow it until the start  | the design: on the day, contact the operator              |
| Start the provider refund at once      | leave it to staff         | "on its way" must be true; failures stay owed, visible    |
| A requests table                       | an email to the operator  | staff see and close requests in one place; WhatsApp in 14 |
| At most 3 open requests                | unlimited                 | enough for "one more thing", not a spam channel           |

## 5. Concepts to study

- **Optimistic concurrency** (send what you saw; the server refuses if it changed)
- **Row locks** (`SELECT … FOR UPDATE`) for one-at-a-time actions
- **Idempotent buttons**: one request however many taps
- **Least privilege**: view vs edit on the same module

## 6. Try it yourself

```bash
pnpm --filter @okapigo/web e2e
```

By hand: open a trip page a few days ahead → Change or cancel → Ask Ìrìn, send something. The
trip page shows "Your request was sent…". Then cancel yourself and watch the banner become
"Cancelled · … on its way", then "Refunded …" a moment later (the simulator completes refunds
by itself). **With Paystack test mode** the refund goes to Paystack's test system instead.

## 7. Differences from the designs

- **"We've sent the details to 0803… and your email"** isn't said: messages arrive in session 14.
  The Cancelled page says when the refund appears instead.
- **"Your trip is 30 hours away"** rounds down: 29.5 hours says 29.
- **The staff side has no screen yet**, only its API (the operator app is designed later).

## 8. What's next

**Stage 12g: the operator website** (file 04): the one-page site in Lagoon, Classic and Earth,
light and dark, with the business details it needs (tagline, about, email, socials).
