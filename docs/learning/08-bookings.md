# Session 8: Bookings, the lifecycle and travellers

**PRD coverage:** **BKG-23** (booking lifecycle: statuses with allowed transitions enforced in
one place and a timeline on every booking) and **BKG-25** (separate records for the lead booker
and each traveller: name, age, contact, dietary needs).

**Roadmap change:** the cancellation policy engine (**BKG-26**) moves to **session 9**:
refund tiers, forfeited deposits and versioned policies deserve the care pricing got. The
roadmap is now 21 sessions.

**Done when:** a booking can be created (holding seats), confirmed, moved through its lifecycle
and corrected, with every change on its timeline, through the API, with tests. ✅ 284 tests.

---

## 1. What we built

```
packages/shared/src/
├── booking-status.js        THE state machine: statuses, allowed moves, seat-consuming statuses
├── reference.js             "ILT-7K4Q2M": readable, unambiguous, browser-safe randomness
└── schemas/bookings.js      lead booker (consent!), travellers, list filters

packages/db/src/
├── booking-lifecycle.js     transitionBookingInTx(): the ONE place status changes
├── bookings.js              createBooking, confirmBooking, secureBookingInTx, setBookingStatus, updateTraveller
└── holds.js                 + createHoldInTx; releasing a hold cancels its waiting booking

apps/api/src/routes/bookings.js   6 endpoints
```

New tables: `bookings`, `travellers`, `booking_add_ons`, `booking_events` (append-only timeline).

### The endpoints

| Endpoint                                      | Permission     | Does                                                  |
| --------------------------------------------- | -------------- | ----------------------------------------------------- |
| `POST /api/bookings`                          | bookings: edit | price → hold seats → create booking (status `held`)   |
| `GET /api/bookings?status&departureId&q&page` | bookings: view | newest first; search by reference, name, email, phone |
| `GET /api/bookings/:id`                       | bookings: view | travellers, add-ons, hold expiry, **timeline**        |
| `POST /api/bookings/:id/confirm`              | bookings: edit | pay later: `held → confirmed`                         |
| `POST /api/bookings/:id/status`               | bookings: edit | `completed` or `no_show`                              |
| `PATCH /api/bookings/:id/travellers/:tid`     | bookings: edit | correct name, dietary needs, contact                  |

## 2. How it works

### The state machine

```
held ──► confirmed ──► part_paid ──► paid ──► completed
  │          │  ▲          │  ▲       │
  │          │  └ amended ◄┴──┴───────┤
  │          ├──► no_show ────────────┼──► refunded
  ▼          ▼                        ▼
cancelled ◄──┴────────────────────────┘ ──► refunded
```

`TRANSITIONS` in `booking-status.js` lists every allowed move; **anything not listed is
forbidden**. A test walks the graph from `held` to prove every status is reachable (no dead
definitions).

### One function changes status: `transitionBookingInTx`

1. **Check** `canTransition(from, to)`, otherwise `INVALID_TRANSITION` (409)
2. **Update with a guard**: `UPDATE bookings SET status = $to WHERE id = $id AND status = $from`.
   If someone changed it since we read it, no row matches → `CONCURRENT_CHANGE`. This is
   **optimistic concurrency**: assume no conflict, detect it if it happens. (Compare session 7's
   _pessimistic_ lock, which makes others wait.)
3. **Append an event**: type, from → to, actor (`user` + id, `guest`, or `system`), data

Everything runs in the caller's transaction, so the status, the seat movement and the event
commit together. **Tested by breaking it:** without the `status = $from` guard, two staff
clicking "completed" and "no-show" at once _both_ succeeded and one change silently overwrote
the other.

### Seats follow the booking

| Moment                  | Hold                   | Departure                            | Booking                      |
| ----------------------- | ---------------------- | ------------------------------------ | ---------------------------- |
| Create                  | `active`               | `seats_held += n`                    | `held`                       |
| Confirm / pay           | `converted`            | `seats_held −= n`, `seats_sold += n` | `confirmed` / `paid`         |
| Hold expires / released | `expired` / `released` | `seats_held −= n`                    | `cancelled` (system, reason) |

Converting and expiring are both conditional updates on the hold
(`… WHERE status = 'active'`), so **they race safely**. A test fires "confirm" and "expire" at
the same instant five times; every time exactly one wins and the seat counts match the winners.

Add-on stock now counts **active holds + bookings whose seats are sold** (a `held` booking is
counted through its hold, never twice).

### Lead booker vs travellers

- **Lead booker** (on the booking): the person paying and the contact. Email/phone normalised
  like staff contacts; **`acceptTerms` must be `true`**, and `termsAcceptedAt` and
  `marketingConsent` are stored (PRD privacy: consent capture).
- **Travellers** (one row each): name, age, the **price category they were charged as**, dietary
  needs, optional contact, check-in status. These feed manifests and check-in later.
  Age can't be edited afterwards, because a different age can mean a different price (that's an
  amendment, not a correction).

### Delete rules (lessons from session 7)

All booking links (to departure, product, hold) **cascade**, because multiple cascade paths make
anything else fragile. That's safe only because the app never deletes departures, holds or
products that have bookings, and the schedule sync now refuses to remove any departure with
bookings, **even cancelled ones** (tested).

## 3. Why we chose what we chose

| Choice                                                      | Why                                                                                           | Trade-off                                                             |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Booking created with its hold, status `held`**            | One record from first click; expiry cancels it cleanly with a reason.                         | Abandoned checkouts leave cancelled bookings (useful data, actually). |
| **Optimistic guard for status, pessimistic lock for seats** | Status conflicts are rare and should fail loudly; seat contention is common and should queue. | Two techniques to understand.                                         |
| **Balance due computed, not stored**                        | Can never disagree with total and paid.                                                       | Computed in every response (trivial).                                 |
| **Lead booker on the booking, no guest accounts**           | PRD: guests don't log in for the MVP.                                                         | Repeat-guest history needs a customer table later (v1).               |
| **Timeline events append-only**                             | An honest audit trail: who did what, when.                                                    | Grows forever (cheap).                                                |
| **References: letters prefix + 6 Crockford chars**          | Readable over the phone, ~1 billion combinations, collisions retried.                         | —                                                                     |

## 4. Concepts to study

- **Finite state machines** and transition tables.
- **Optimistic concurrency control** (compare-and-set) vs **pessimistic locking**.
- **Event logs / audit trails**, and the idea behind event sourcing.
- **Circular imports**, and breaking them by extracting a shared module (`booking-lifecycle.js`).
- **Modulo bias** in random generation (and why 256 ÷ 32 avoids it).
- **Flaky tests**: shared-state interference, contention, and why "it passed this time"
  is not an explanation.

## 5. Try it yourself

```bash
pnpm dev
```

Sign in as Tunde (manager). Get a Heritage Walk departure id from its availability, then:

```bash
T='Authorization: Bearer <token>'
curl -s -X POST localhost:4000/api/bookings -H "$T" -H 'content-type: application/json' -d '{
  "departureId": "<id>",
  "lead": { "name": "Bisi Adeyemi", "phone": "0803 555 0101", "acceptTerms": true },
  "travellers": [ { "name": "Bisi", "age": 41 }, { "name": "Dami", "age": 9, "dietaryNeeds": "no nuts" } ]
}' | python3 -m json.tool
```

Then:

1. `POST /api/bookings/<id>/confirm`, then `POST /api/bookings/<id>/status` with
   `{"status":"completed"}`, and read the `timeline` in `GET /api/bookings/<id>`.
2. Try `{"status":"completed"}` on a fresh `held` booking → 409 `INVALID_TRANSITION`.
3. Set `hold_minutes = 1` (psql), make a booking, wait a minute with `pnpm dev` running, and
   see it become `cancelled` with `reason: hold_expired`, done by the **system**.
4. Search: `GET /api/bookings?q=bisi`.

## 6. Gotchas

- **A digit in a reference prefix.** Test slugs like `test-3f9a…` produced the prefix `T3`, which
  the database's format CHECK refused. That only happened about half the time (hex sometimes
  starts with a letter). A real business called "lagos-360-tours" would have hit it too. Prefixes
  now use letters only.
- **`node:crypto` in shared code.** `packages/shared` will run in browsers too; references now
  use `crypto.getRandomValues`, which exists everywhere.
- **`prisma migrate dev` refused to run non-interactively** because it wanted to show a
  warning. I generated the SQL with `prisma migrate diff --from-config-datasource --to-schema …`
  instead. Same result, no prompt.
- **Three flaky-test causes, found by reading the evidence:**
  1. **Timeouts under contention**: four packages share one database, including deliberate
     40-way races. A seed takes 0.1–0.4 s alone (measured), so I raised integration-test
     timeouts to 20 s rather than hide a real slowdown.
  2. **A test reaching into other tests' data**: the sweeper test expired _every_ overdue hold,
     including holds another package's test was waiting on. Tests now scope the sweeper to their
     own operator.
  3. **My own stray process**: a workers app I started for a smoke test kept running (my stop
     command's pattern didn't match it) and swept test holds every minute. If tests act strangely,
     check `ps` for leftover `pnpm dev` processes.
- **Open issue:** after those fixes, about 1 run in 25 locally failed the first test of each API
  file once, without the error being captured. A stale-data theory didn't reproduce, so it's not
  "fixed". If CI shows it, the log will say why. Watch for it.

## 7. What's next: session 9

**Cancellation policies (BKG-26).** A versioned policy per product (e.g. full refund 48 h+
before, 50% from 24–48 h, nothing after; no-show rules; non-refundable deposits), a pure
**policy engine** that works out the refund (tested like the pricing pipeline), each booking
remembering the policy version it was sold under, and cancelling / no-showing bookings with seats
freed and the refund amount recorded, ready for Paystack in the session after.
