# Session 7: Checkout holds, background jobs and zero oversells

**PRD coverage:** **INV-23** (checkout holds: seats held for an operator-set time while the guest
pays, released by a background job, counting against availability on every channel) and
**INV-02** (no double-selling: holds use transactions and row locks; concurrency tests prove
zero oversells).

**Done when:** concurrency tests show zero oversells. ✅ 40 people racing for 10 seats → exactly
10 win; 30 racing for 10 tasting plates → exactly 10 win; 25 parallel HTTP requests → exactly
10 `201`s. 233 tests across the repo.

---

## 1. What we built

```
packages/db/
├── src/holds.js             createHold (row lock), releaseHold (exactly once), expireDueHolds
├── src/departures.js        + extendAllSchedules (nightly window roll, crash-tolerant)
└── test-support/global-setup.js   tidies test data left by failed runs

packages/jobs/               queue + job names, connectionFor(), createJobClient() (API side)

apps/workers/                NEW APP: runs the jobs
├── src/index.js             registers timetables, starts BullMQ workers, graceful shutdown
└── src/processors.js        expire-hold · sweep-holds · extend-schedules

apps/api/src/routes/holds.js POST /api/holds · GET /api/holds/:id · DELETE /api/holds/:id
```

New tables: `holds` (seats, status, channel, travellers, **price snapshot**, expiry) and
`hold_add_ons`. Operators gained `hold_minutes` (default 15).

## 2. How it works

### The race, and the lock that stops it

```
WITHOUT a lock                                   WITH  SELECT … FOR UPDATE
Guest A            Guest B                       Guest A                 Guest B
read: 1 seat left                                LOCK row, read: 1 left
                   read: 1 seat left                                     LOCK row… (waits)
take it ✓                                        take it ✓, COMMIT (unlock)
                   take it ✓   ← OVERSOLD                                …gets lock, reads: 0 left
                                                                         SOLD_OUT ✓
```

`createHold` runs one transaction:

1. **Lock** the departure row: `SELECT … FROM departures WHERE id = $1 FOR UPDATE`
2. **Check** seats (and add-on stock), reading _after_ the lock, so the numbers are current
3. **Claim**: `seats_held = seats_held + n`, insert the hold
4. **Commit**, which releases the lock

Only buyers of the _same_ departure queue, and only for milliseconds.

### Two layers, and what each test proved

| Removed      | Seats                                                                 | Add-ons                                              |
| ------------ | --------------------------------------------------------------------- | ---------------------------------------------------- |
| Nothing      | exactly 10 of 10                                                      | exactly 10 of 10                                     |
| `FOR UPDATE` | CHECK constraint **refused** the oversells (as errors, ugly but safe) | **19 of 10 sold**: real oversell, nothing stopped it |

The CHECK constraint from session 5 is the safety net for seats. Add-on stock is summed across
holds, so it has no CHECK, and the **lock is its only protection**. That's why the add-on race
test exists.

### Releasing exactly once

A hold can end four ways: expiry job, sweeper, staff/guest release, or (session 8) conversion
to a booking. Several could happen at the same moment. The release is one conditional update:

```sql
UPDATE holds SET status = 'expired', ended_at = now()
 WHERE id = $1 AND status = 'active' AND expires_at <= now()
RETURNING departure_id, seats
```

Only one caller gets a row back, and only that caller gives seats back. Tested: 20
simultaneous releases → 1 success, `seats_held` back to 0, not −4.

### Price snapshot

The hold stores the full priced basket (`quote`) and `totalKobo`. If the operator changes a
price mid-checkout, the guest still pays what they were shown (tested).

### Background jobs

```
API ──createHold──► database
 └──scheduleHoldExpiry(holdId, expiresAt)──► Redis "holds" queue (delayed job)
                                                   │ when due
apps/workers ◄─────────────────────────────────────┘
   expire-hold      → releaseHold(reason: 'expired')
   sweep-holds      → every 60 s: expire anything overdue (backup if a job was lost)
   extend-schedules → 02:00 Lagos daily: roll the 60-day window forward
```

- **Idempotent everything**: jobs can be retried or run twice safely.
- **Job ID = `expire-<holdId>`**: scheduling twice creates one job.
- **If Redis is down when a hold is made**, the API still returns 201 (the hold is safe in
  PostgreSQL) and the sweeper releases it on time. Tested with a broken job client.
- `upsertJobScheduler` registers the timetables on every start without duplicating them.

## 3. Why we chose what we chose

| Choice                                                                                     | Why                                                                             | Trade-off                                                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Pessimistic lock (`FOR UPDATE`)**                                                        | Simple, correct, and the PRD asks for row locks. Losers get a clean `SOLD_OUT`. | Buyers of one departure queue briefly.                                   |
| **Alternative considered: one conditional UPDATE** (`… WHERE capacity - sold - held >= n`) | Lock-free and great for seats alone.                                            | Can't also check add-on stock atomically; the lock covers both.          |
| **Every traveller takes a seat** (infants too)                                             | Boat seats and life jackets; simplest rule.                                     | An operator wanting lap-infants would need a setting (v1).               |
| **Per-hold job + every-minute sweeper**                                                    | Precise timing, plus a safety net.                                              | Availability can show an expired hold for up to a minute.                |
| **Separate workers app**                                                                   | Background work never slows API requests; can scale separately.                 | One more process to run (Turborepo starts both).                         |
| **HTTP holds need bookings: edit**                                                         | Phone bookings by managers; guides only view.                                   | —                                                                        |
| **`hold_add_ons → add_ons` CASCADE**                                                       | See Gotchas: the only rule that lets a whole operator be deleted.               | An add-on deletion would remove hold history, but the app only archives. |

## 4. Concepts to study

- **Race conditions** and the **read-modify-write** problem.
- **Pessimistic locking** (`SELECT … FOR UPDATE`) vs **optimistic concurrency** (version
  columns, conditional updates).
- **Transaction isolation levels** (we use Postgres's default, READ COMMITTED, plus explicit locks).
- **Deadlocks**: why locking one row per transaction avoids them.
- **Idempotency** and **exactly-once effects** via conditional updates.
- **Job queues**: delayed jobs, retries with exponential backoff, cron schedules, workers.
- **`ON DELETE` RESTRICT vs NO ACTION vs CASCADE**, and multi-path cascades.

## 5. Try it yourself

```bash
pnpm dev     # now starts the API AND the workers
```

Sign in as Tunde (manager: bookings edit), get a Street Food departure id from
`/api/products/<id>/availability`, then:

```bash
T='Authorization: Bearer <token>'
curl -s -X POST localhost:4000/api/holds -H "$T" -H 'content-type: application/json' \
  -d '{"departureId":"<id>","travellers":[{"age":30},{"age":31}]}' | python3 -m json.tool
```

Watch `seatsAvailable` drop by 2. Then:

1. **See expiry happen**: set Ìrìn's hold time to 1 minute
   (`UPDATE operators SET hold_minutes = 1;` in psql), make a hold, and watch the workers log
   `expire-hold … released: true` about a minute later. Availability goes back up.
2. **See the jobs in Redis**: `docker compose exec redis redis-cli --scan --pattern 'bull:*' | head`
3. **Break the lock**: delete `FOR UPDATE` in `packages/db/src/holds.js`, run
   `pnpm --filter @okapigo/db test`, and read "expected 19 to be 10". Undo with
   `git checkout packages/db/src/holds.js`.
4. Make holds until the departure is full and read the `SOLD_OUT` response with
   `seatsAvailable`.

## 6. Gotchas

- **RESTRICT vs NO ACTION vs CASCADE.** Deleting a test operator failed because
  `hold_add_ons` points at add-ons with RESTRICT. NO ACTION didn't fix it either: Postgres runs
  each cascade as its own internal statement, and two cascade paths reach `hold_add_ons`
  (via products → add-ons, and via departures → holds). The check fired before the second path
  had cleaned up. CASCADE is the honest answer there. I added a **new** migration rather than
  editing the applied one.
- **A global job vs concurrent deletes.** `extend-schedules` loops over _every_ schedule. In the
  full test run, other packages deleted operators mid-loop and the job crashed. That would have
  happened in production when a sandbox is deleted at 02:00. Now a failed schedule that no
  longer exists is skipped; others are reported and the job retries.
- **Test data leaking from failed runs.** When a run fails or times out, cleanup may not run.
  38 orphaned test operators had piled up and slowed the global job until a test timed out.
  A **global setup** now deletes `test-…` operators older than 10 minutes before each run (I
  also deleted the 38; your `irin-lagos-tours` was untouched).
- **pnpm wrote a placeholder** for `msgpackr-extract` in `pnpm-workspace.yaml`, so my added line
  became a duplicate YAML key. pnpm now asks about each new package with an install script.
- **BullMQ 6** takes `{ url, maxRetriesPerRequest: null }` as its connection; `null` is required
  for workers.

## 7. What's next: session 8

**The booking lifecycle (BKG-23, BKG-25, BKG-26).** Bookings with a reference and a channel;
statuses (held → confirmed → part-paid → paid → amended → cancelled / no-show → completed →
refunded) with allowed transitions enforced in one place and a timeline of events; a lead booker
and separate travellers (names, ages, dietary needs); converting a hold into a booking (seats
move from held to sold); and the cancellation policy engine that works out refunds.
