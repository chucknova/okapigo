# Stage 19a-1: the demo business's history

| Part      | What                                                                        |
| --------- | --------------------------------------------------------------------------- |
| **19a-1** | **The demo's past and near future: bookings, money, check-ins, loose ends** |
| 19a-2     | The nightly reset and "Try it" visitor copies                               |
| 19b       | Uploads (photos, logo)                                                      |
| 19c–19e   | Accessibility and polish; README and demo script; deploy                    |

PRD, "Seed data": _"60 days of schedules, about 150 past bookings and 20 upcoming bookings, a few
of them from the mock OTA."_ Until now a fresh `pnpm db:reset` had no bookings at all: an empty
dashboard, an empty desk, a schedule with no guests.

## 1. What a reset now gives you

`pnpm db:seed` (and `db:reset`) runs `seedDemoOperator()` then **`seedDemoHistory()`**
(`packages/db/src/seed/history.js`):

| Part of the story           | What's there                                                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **60 days of departures**   | from the schedules, each with its guide and vehicle (Badagry: Kemi, Van 1; Lekki: Chinedu, Van 2; Tarkwa Bay: Femi, the boat; the walk: Halima; food: Chinedu), never two at once |
| **About 155 past bookings** | website, widget, WhatsApp, the desk and Sojourna; friends, families and small groups; guests checked in (a few late); the trip marked completed                                   |
| **A growing business**      | later weeks busier, weekends busiest (the dashboard: about +20% on the 30 days before)                                                                                            |
| **Cancellations**           | about 1 in 19 cancels: refunded by the policy (full, half or nothing, by how late)                                                                                                |
| **Two no-shows**            | travellers marked no-show                                                                                                                                                         |
| **The weather**             | one Tarkwa Bay trip about three weeks ago called off: its 3 bookings refunded in full                                                                                             |
| **Sojourna**                | its sales, and twice it paid what it owed for trips over a week old                                                                                                               |
| **About 20 upcoming**       | over the next three weeks; Badagry deposits still owing their balance                                                                                                             |
| **Guides for the week**     | assigned over the past few days, as a manager plans                                                                                                                               |

**The loose ends** (decided: "a few"), all on Today's "Needs you" and in the inbox:

1. A departure tomorrow, with guests, and **no guide**.
2. A **refund that failed** ("The bank declined it: the card has been closed").
3. **Cash** a guide took yesterday and hasn't handed in.
4. A Badagry **balance overdue** (when the next Badagry trip is within 7 days).
5. A guest asking to **change the date**, and a **question the AI companion passed on**.

**Not in the tests' businesses:** the tests (and the e2e journeys) still seed a quiet business
with `seedDemoOperator()` alone, so their numbers stay predictable and fast.

## 2. Why it writes rows directly, and how it stays honest

The booking engine won't hold seats on a trip that already happened, and stamps everything
"now". A history needs the past. So `history.js` writes what the real paths leave behind, with
the times a real history would have:

```
hold (converted) → booking + travellers → timeline: created, held → paid (→ completed)
→ the payment (simulator, as the demo runs) → the books: money received, Paystack's fee
   (Sojourna: its sale, less 20%) → seats sold → checked in
```

It reuses the real building blocks: the basket pricer (`priceBasket`), the posting rules
(`POSTINGS` + `postTransaction`), the refund rule (`computeRefund`), the reference makers. Then
**the test holds it to the live system's rules**:

- **The books balance:** the nightly check (`verifyLedger`) finds nothing wrong.
- **Fees and refunds match the books:** every Paystack fee is posted, and every refund sent
  takes money out of the Paystack account.
- **Seats add up:** every departure's seats sold equal its coming guests, and never exceed its
  capacity.
- **The timeline reads true:** each step starts where the one before ended, from "created", and
  nothing is booked after its trip or in the future.
- **Money:** paid equals the payments; a part-paid booking has only its deposit.
- **Statuses** are only ones the app knows.
- **Sojourna** never paid more than it owed.

**The same story every time:** a fixed random sequence (mulberry32 with seed 19), so a reset
always tells the same story, just moved to "now". Everyone is fictional; emails use `.example`.

## 3. Found along the way

- **A day-dependent crash.** The tests (on a fixed Monday) passed, but seeding on the real
  date crashed: a loose end landed on a departure that was already full (no seats for its
  travellers). Loose ends now only use departures with room, and the test also seeds a
  Wednesday and a late Saturday.
- **A balance paid before it was booked.** A Badagry booking made 6 days ahead got a deposit,
  and its balance "8 days before" landed before the booking. The rule from 11c applies:
  booked within 7 days, pay in full.
- **Looking at the screens changed the story** (my API on :4300, the e2e database, headless
  Chrome):
  - first look: 6 bookings "made today" (the upcoming ones were mostly booked hours ago), a
    falling trend (−32%), trips 13–28% full, guides all "assigned at 13:46", two overdue
    balances, and the unguided departure with nobody on it
  - now: bookings spread over earlier days, a growing business (+18% money, +29% bookings),
    bigger groups (25–57% full), assignments over the week, one overdue balance, and the
    unguided departure has guests
  - Today shows five "Needs you" items; the alerts tab four
- **Four histories at once slowed everything.** The full run's database got busy enough that
  two race tests and the history file timed out. The extra test businesses now use a smaller
  story (40 past, 6 upcoming); the full one is seeded once.
- **A busy machine, then a stopped database.** For about an hour the load stayed between 24
  and 190 (Docker's VM, iCloud syncing, Wi-Fi daemons, Chrome, Figma), and timing-sensitive UI
  tests timed out at random in full runs (each passed alone). Then the project's Postgres, Redis
  and Mailpit containers stopped (cleanly, while the machine was being freed up), and every
  database test failed with "Can't reach database server at localhost:5432". I started them again
  with `pnpm services:up`, and the runs were clean.

## 4. Checks

- `packages/db/test/history.test.js` (20): the story (counts, channels, statuses, times, money),
  the live system's rules (books, seats, check-ins, the weather, Sojourna), fees and refunds in
  the books, a growing business and few bookings today, the loose ends (and their alerts), the
  dashboard has something to say, any day of the week, the same story twice.
- **Mutation checks:** 19 changes to the history writer; 3 survived at first (a refund posted
  as "owed", an overdue balance rule, the unguided departure's guests) and got tests. 3 more
  didn't apply at first (Prettier had changed the lines) and were caught once re-pointed.
- **Full runs** (after restarting the services): run 1 passed in full, 1,833 tests; run 2 had two
  Sojourna cancellation tests time out at load 37, which passed alone (13 of 13).
- **E2E:** all 12 journeys pass (they don't use the history).
- **To get it yourself:** `pnpm db:reset` (it wipes your dev data, so it's yours to run).

## 5. Concepts to study

- **Seed data as a product**: a story that shows the features, not random rows.
- **Invariants as tests**: checking generated data against the rules the live system keeps.
- **Deterministic randomness**: a seeded generator, so "random" data is the same every time.
