# Session 5: Schedules and departures

**PRD coverage:** **INV-03** (daily, weekly and custom departures with exceptions per date) and
the read side of **INV-02** (availability per departure). Completes build step 2.

**Done when:** seeded tours show correct prices and availability through the API. ✅
`GET /api/products/:id/availability` returns the next departures with seats left, in Lagos time.
179 tests across the repo.

---

## 1. What we built

```
packages/shared/src/
├── time.js              Lagos wall-clock ↔ UTC: zonedTimeToUtc, localDate, localTime, addDays…
├── schedule.js          expandSchedule(rule, window) → departure times (pure function)
└── schemas/schedules.js Zod: dates 'YYYY-MM-DD', times 'HH:MM', schedules, departures

packages/db/
├── prisma/…_add_schedules_and_departures/   tables + the overselling CHECK
├── src/departures.js    syncScheduleDepartures() (reconcile), listAvailability()
└── src/seed/            each tour now has a schedule → 60 days of departures

apps/api/src/routes/schedules.js   7 endpoints (schedules, departures, availability)
```

### Ìrìn's schedules (from the day you seed)

| Tour                   | Runs                                | Seats |
| ---------------------- | ----------------------------------- | ----- |
| Heritage Walk          | Daily 09:00, **except 25 December** | 15    |
| Street Food Crawl      | Thu, Fri, Sat 18:30                 | 10    |
| Lekki Nature and Craft | Wed, Sat 08:00                      | 12    |
| Tarkwa Bay             | Sat, Sun 10:00                      | 12    |
| Badagry                | Sat 07:00                           | 14    |

### The endpoints

| Endpoint                                     | Permission         | Notes                                                  |
| -------------------------------------------- | ------------------ | ------------------------------------------------------ |
| `GET /api/products/:id/schedules`            | products: view     |                                                        |
| `POST /api/products/:id/schedules`           | products: edit     | departures appear immediately                          |
| `PATCH /api/schedules/:id`                   | products: edit     | re-syncs; reports booked departures it couldn't change |
| `GET /api/departures?from&to&productId`      | products: view     | staff calendar (default 14 days, max 92)               |
| `POST /api/products/:id/departures`          | products: edit     | one-off "custom" departure                             |
| `PATCH /api/departures/:id`                  | **bookings: edit** | capacity, cancel, reopen                               |
| `GET /api/products/:id/availability?from&to` | products: view     | bookable departures + `seatsAvailable`                 |

## 2. How it works

### Rule vs event

```
Schedule (a RULE)                                Departures (EVENTS, one row each)
───────────────────────────                     ──────────────────────────────────────────────
Heritage Walk                    expand          Tue 1 Dec 09:00  cap 15  sold 0  held 0
daily · 09:00 · from 1 Dec   ───────────────►    Wed 2 Dec 09:00  cap 15  sold 0  held 0
skip 25 Dec · capacity 15        (60 days)       …                (no 25 Dec)
                                                 Sat 30 Jan 09:00 cap 15  sold 0  held 0
```

Guests book **departures**. In session 6, placing a hold **locks a departure row** and changes
`seats_held`; this CHECK makes overselling impossible even if our code has a bug:

```sql
CHECK (seats_sold >= 0 AND seats_held >= 0 AND seats_sold + seats_held <= capacity)
```

### Time zones: say it in Lagos time, store it in UTC

Operators think in local time ("09:00"). The database stores instants in UTC. `zonedTimeToUtc`
converts by asking the system's time-zone database for the offset _at that moment_:

```
'2026-12-01' + '09:00' in Africa/Lagos  →  2026-12-01T08:00:00Z   (Lagos is UTC+1, all year)
'2026-07-15' + '09:00' in Europe/London →  2026-07-15T08:00:00Z   (summer time, UTC+1)
'2026-01-15' + '09:00' in Europe/London →  2026-01-15T09:00:00Z   (winter, UTC+0)
```

Lagos has no daylight saving, so "minus one hour" would work today. It wouldn't for v2's trips
abroad, and the general version is barely longer. API responses include **both** `startsAt`
(UTC, for machines) and `localDate`/`localTime` (for people), so no client ever does
time-zone maths.

### Reconcile, don't patch: `syncScheduleDepartures`

When a rule changes, we don't try to work out "what exactly changed". We compute what _should_
exist, compare it with what _does_, and fix the difference:

| Situation                         | Action                                                                  |
| --------------------------------- | ----------------------------------------------------------------------- |
| should exist, doesn't             | create                                                                  |
| exists, shouldn't, **empty**      | delete                                                                  |
| exists, shouldn't, **has guests** | keep and report (`needsAttention`); a person decides                    |
| capacity changed                  | update departures still on the old capacity, unless guests wouldn't fit |

It's **idempotent**: run it twice and the second run does nothing. That makes it safe to call
from the API, the seed, and (session 6) a daily job that rolls the 60-day window forward.

The "only if empty" rule sits **inside the DELETE's WHERE clause**, not in a check beforehand,
so a hold landing in the same instant can't sneak past it. Same idea as the atomic OTP claim
in session 3.

### Pure functions are easy to test

`expandSchedule` has no database and no clock: same input, same output. The tricky calendar
logic (weekdays, exceptions, month ends, DST) is tested with plain values in milliseconds. The
database code only compares lists. Database tests pin **"now"** to 1 December 2026 so their
counts are exact (60 Heritage Walk departures, 27 food crawls).

## 3. Why we chose what we chose

| Choice                                           | Why                                                                                                    | Trade-off                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **Materialise departures** (real rows)           | Each needs its own seat counts and a row to lock.                                                      | Must keep them in sync with rules (the reconcile function).                          |
| **60-day rolling window**                        | PRD figure; enough to book ahead.                                                                      | Needs a daily job (session 6).                                                       |
| **`daysOfWeek` covers daily and weekly**         | One shape for both; "custom" = one-off departures.                                                     | Monthly rules ("first Sunday") aren't supported; not needed for the MVP.             |
| **Booked departures are never auto-removed**     | Cancelling a guest's trip needs refunds and a message, so a human decides.                             | Staff must act on `needsAttention`.                                                  |
| **Hand-edited capacity survives schedule edits** | Detects "still on the old schedule capacity" without an extra column.                                  | If staff hand-set a departure to _exactly_ the old value, it'll follow the schedule. |
| **Departure edits need bookings: edit**          | Managers cancel for weather; guides (operations: edit) must not.                                       | —                                                                                    |
| **Can't cancel a departure with guests (yet)**   | That requires refunds under the policy (session 7).                                                    | Temporary restriction.                                                               |
| **`listAvailability` in packages/db**            | The public booking pages (session 10) and the OTA (session 16) will reuse it, so every channel agrees. | —                                                                                    |

## 4. Concepts to study

- **UTC vs local time**, IANA time zones, daylight saving, `Intl.DateTimeFormat`.
- **Calendar dates vs instants**: why `'2026-12-01'` and `2026-12-01T00:00Z` are different things.
- **Materialised data vs computing on the fly.**
- **Reconciliation / desired-state** (Kubernetes and React both work this way).
- **Idempotency.**
- **Pure functions** and why they make testing easy.
- **Dependency injection of the clock** (`now`).
- **Conditional writes** (`UPDATE … WHERE seats_sold + seats_held <= $new`).

## 5. Try it yourself

```bash
pnpm db:reset      # reseed: your current copy has no schedules
pnpm dev
```

Sign in as Adaeze (owner), then:

```bash
T='Authorization: Bearer <token>'
# Find the Badagry product id
curl -s localhost:4000/api/products -H "$T" | python3 -c "import sys,json; [print(p['id'], p['title']) for p in json.load(sys.stdin)['products']]"
# Its availability for the next 4 weeks: Saturdays at 07:00
curl -s "localhost:4000/api/products/<id>/availability" -H "$T" | python3 -m json.tool | head -40
# The whole calendar for the next two weeks
curl -s "localhost:4000/api/departures" -H "$T" | python3 -c "import sys,json; [print(d['localDate'], d['localTime'], d['seatsAvailable']) for d in json.load(sys.stdin)['departures']]"
```

Experiments:

1. Add a skip date to the Heritage Walk schedule (`PATCH /api/schedules/:id` with `skipDates`)
   and watch `sync.removed` become 1.
2. In `psql`, give a departure `seats_sold = 2`, change its schedule so that date no longer runs,
   and see it appear in `sync.needsAttention` instead of disappearing.
3. Try `UPDATE departures SET seats_sold = 99 WHERE …` in `psql` and read the CHECK error.
4. `node -e "console.log(new Date('2026-12-01T08:00:00Z').toLocaleString('en-NG', {timeZone:'Africa/Lagos'}))"`.
5. Sign in as Kemi (guide) and try `PATCH /api/departures/:id` with `{"status":"cancelled"}` → 403.

## 6. Gotchas

- **I repeated last session's Prisma mistake**: `operatorId` in a nested child create. Nested
  children inherit it from the parent. The comment in `demo-operator.js` is now a reminder.
- **Proving tests can fail:** I removed the "only if empty" condition from the delete and
  the test caught it. The booked Wednesday departure vanished, which in real life would silently
  wipe out a guest's trip.
- **API tests use the real clock** (the seed starts "today"), so they assert relationships, not
  dates. A run that crosses midnight in Lagos _could_ misbehave; the exact-date tests live in
  `packages/db` with a pinned clock instead.
- **Your local database needs `pnpm db:reset`** to get schedules and departures.
- **Nothing rolls the window forward yet.** Seed today and in 60 days there'll be no
  departures, until session 6's daily job (or reseeding).

## 7. What's next: session 6

**The pricing pipeline (INV-24), checkout holds (INV-23) and the first background jobs.** One
fixed price calculation (base → category → add-ons → promo → fees → tax) in `packages/shared`;
seat holds that **lock the departure row** while counting seats; BullMQ jobs that release expired
holds and roll the schedule window forward; and concurrency tests firing many simultaneous holds
at one departure to prove **zero oversells**. This is the heart of the PRD's "no double-selling".
