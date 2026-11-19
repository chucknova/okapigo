# Found: why the widget "Book now" browser journey flaked

The journey "the Book now button: checkout in an overlay, paid in a new tab, confirmed in the
overlay" failed now and then since stage 13b, always passing on rerun, always under heavy
machine load. It wasn't the test being impatient. There were **two** causes: a real (rare)
bug a guest could hit, and a trap in how the test pressed Escape.

## 1. What the failure looked like

Reproduced by running the widget journeys 6 times while the full unit-test suite loaded the
machine. The trace showed the payment tab:

```
POST /simulator/checkout/…/pay        303 → /trip/…/confirm      (the guest paid)
GET  /public/bookings/…               200   (2 s later)
GET  /public/bookings/…               200   ┐ then NOTHING for 27 seconds:
GET  /public/bookings/…               200   ┘ the page had stopped checking
```

and the page itself said **"We got your payment after your seats were released"**, although
the database showed the booking paid, with its hold converted after a few seconds, as normal.

## 2. Why

A payment settles in ONE transaction: the payment becomes "succeeded" and the booking
becomes "paid" together. Nobody can see one without the other… inside one query.

But the guest page's data comes from Prisma's `findUnique({ include: { payments } })`, which
is **several queries**: the booking first, then its payments. At PostgreSQL's default level
(READ COMMITTED), each query sees what's committed _when that query starts_. So a settlement
committing between them gives:

```
query 1: the booking     → status "held"          (before the commit)
         ────── the payment's transaction commits ──────
query 2: its payments    → status "succeeded"     (after the commit)
```

The page took "payment succeeded, booking not booked" to mean the rare **paid-after-the-hold**
case (screen C's "paid late" state), and since the payment was no longer "initiated" it
**stopped checking**: stuck on the wrong message for good. The window is a few milliseconds;
a busy machine stretches it, hence "only under load".

## 3. Cause 1's fix, on both sides

| Where                        | Change                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The API (`findGuestBooking`) | the booking and its payments are read in one **REPEATABLE READ** transaction: every query sees the same moment, so the two can't disagree                   |
| The page (`Confirm.jsx`)     | "payment succeeded, booking still held" is a moment **in between**, not an outcome: keep checking. "Paid late" now needs the booking to be really cancelled |

Either alone would have stopped this failure; together, the page also copes with anything
else that might show the two a moment apart.

## 4. Cause 2: the Escape key that never came back up

With cause 1 fixed, 20 runs in a row still timed out a few times, at the very first step:
`keyboard.press('Escape')`, which hung for the whole 90 seconds although every step before it
took under 3. What happens:

```
press('Escape') = key DOWN, then key UP, each waiting for the page to say "got it"
  key DOWN → inside the overlay's frame: "Escape closes" → tells the host page
             → the host page removes the frame AT ONCE
  key UP   → sent to the frame that had the focus… which no longer exists
             → no "got it" ever comes back: the test tool waits forever
```

A real browser just drops that key-up, so guests never notice; it's the test tool's wait.
The test now presses Escape as two steps: key down, **wait for the overlay to close**, key up
(which then lands on the host page, as it would). The widget itself is unchanged.

## 5. And one more: a clean-up that deadlocked

While the browser tests ran, one unit test's clean-up failed with "a write conflict or a
deadlock, please retry": deleting a test business locks many rows, and the browser tests' API
and worker sweep EVERY business on the shared database. Postgres breaks a deadlock by
cancelling one side and asking it to retry, so the clean-up now retries (briefly, 5 times).

**And the old trap, once more:** the last full browser run failed journey 2 (WhatsApp)
because `pnpm dev` was running: its API shares the database, and its notices pass sent the
ticket first, with its own address (`:4000`), which the test's browser (`:4100`) couldn't
load. Same as stage 13c-2. Until tests get a database of their own (proposed as a follow-up),
**stop `pnpm dev` before `pnpm --filter @okapigo/web e2e`**.

## 6. Tests

- **The page**: the first look shows "succeeded" on a "held" booking, the next look shows it
  paid → "Confirming your payment…", then "Booking confirmed", never the "paid late" message.
- **The API**: the database adapter really runs a transaction at REPEATABLE READ, and the
  guest's booking is read inside one.
- Each fix broken on purpose: a test notices (3 of 3).
- **The proof**: the "Book now" journey **20 of 20** with the full unit suite running at the
  same time (load average up to 22), and 20 of 20 without; then the full set of browser
  journeys. (A first attempt with TWO unit suites at once took 3 hours for 20 runs: the browser
  couldn't even start within 3 minutes. That's not a test; it's a machine out of breath.)

## 7. Also added

`E2E_KEEP=1 pnpm --filter @okapigo/web e2e` keeps the test business and its bookings after
the run, to look into a failure in the database (otherwise it's deleted, with the evidence).

## 8. Concepts to study

- **Transaction isolation levels**: READ COMMITTED vs REPEATABLE READ, and "non-repeatable
  reads" (this was one)
- **ORMs and hidden queries**: `include` can mean several round trips
- **Flaky tests as bug reports**: a test that fails only under load is often timing-sensitive
  code, not a slow test; raising the timeout would have hidden both causes
- **Reading a trace**: each step's start and end times showed which step really hung
- **Deadlocks**: why the database cancels one side, and why retrying is the right answer
