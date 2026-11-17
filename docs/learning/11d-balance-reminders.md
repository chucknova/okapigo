# Stage 11d: Balance reminders and overdue alerts

The second half of PRD journey 5: "gets balance reminders and pays the rest by link". Your
decisions from 2026-11-17:

- reminders go out **7, 3 and 1 days** before the balance due date
- the due date is **7 days before the trip** (stage 11c)
- if it's not paid in time, **staff are alerted** and **nothing is cancelled automatically**

The messages themselves are sent from session 14 (email and WhatsApp). This stage decides
**what** should be sent and **when**, and records it.

## 1. What we built

| Piece                               | Where                                                  |
| ----------------------------------- | ------------------------------------------------------ |
| The rule: which notice is due today | `balanceNotice()` in `packages/shared/src/deposits.js` |
| The outbox table                    | `notifications` (migration + CHECKs)                   |
| The daily job (09:00 Lagos)         | `balance-reminders` → `queueBalanceNotices()`          |
| Staff alerts                        | `GET /api/alerts`, `POST /api/alerts/:id/dismiss`      |

## 2. How it works

### A timeline

Trip Sat 5 Dec → balance due Sat 28 Nov. Booked 10 Nov, deposit paid, ₦45,500 owed.

```
21 Nov  09:00  job ─► guest  balance_reminder:7   "₦45,500 due by Sat 28 Nov"
25 Nov  09:00  job ─► guest  balance_reminder:3
27 Nov  09:00  job ─► guest  balance_reminder:1
29 Nov  09:00  job ─► staff  balance_overdue      → GET /api/alerts → staff call / send a link
 5 Dec          trip day: no more notices
```

### The outbox pattern

The job doesn't send anything. It **writes a row** ("this message should go out"). Session 14
adds a sender that delivers pending rows and marks them `sent`.

```
daily job ──writes──► notifications (pending) ──session 14 sender──► email / WhatsApp
                                                                      └─► status 'sent'
```

Why split deciding from sending?

- **Deciding never fails because WhatsApp is down.** The decision is a database write.
- **A failed send can be retried without re-deciding**: the row is still there, pending.
- **Everything is visible**: what was due, what went out, what was withdrawn.

This is the **transactional outbox**, a standard pattern for "do something in the database AND
tell the outside world" without losing either.

### Once, and only once

`@@unique([bookingId, key])` with keys like `balance_reminder:3`. The job inserts with
`skipDuplicates` (SQL `ON CONFLICT DO NOTHING`), so:

- running it twice a day changes nothing
- a retry after a crash changes nothing
- the uniqueness lives in the **database**, so two workers racing can't both insert

### Catching up, without spamming

`balanceNotice()` returns the **tightest milestone reached**, not "is it exactly 3 days
before?". If the worker was down on the 3-day morning, the next morning still answers
"reminder:3", and the unique key stops it repeating once it's written.

Two refinements keep this from being annoying:

- **Milestones that passed before the booking was made are skipped.** Someone who books 5
  days before the due date gets the 3-day and 1-day reminders, not a "7 days left".
- **A new reminder replaces an older one nobody sent yet**, in the same transaction. Until
  session 14 nobody sends anything, so without this a guest would one day receive all three at
  once.

### Tidying up

Each run first cancels pending notices that no longer make sense, in one `UPDATE … FROM`:

| Situation                                | Caught by                        |
| ---------------------------------------- | -------------------------------- |
| balance paid (booking now "paid")        | status no longer an owing status |
| total lowered to what's paid ("amended") | `total_kobo <= amount_paid_kobo` |
| booking cancelled                        | status                           |
| trip called off, or started              | the departure's status / time    |

A mutation check found that the second row wasn't really tested. Every "paid" test also
changed the status, so deleting the money check broke nothing. The fix was a test for an
amended booking whose balance is ₦0 while its status still says it owes. That's the point of
mutation checks: they test the **tests**.

The alerts list tidies before it reads, too, so staff never see an alert about a balance that
was paid this morning.

### Staff alerts

`GET /api/alerts` (anyone with `bookings: view`, guides included) shows each open alert with
what's needed to act **without opening the booking**: reference, lead name and phone, tour,
date, the **current** balance, and the due date. `POST /api/alerts/:id/dismiss` needs
`bookings: edit`. Another operator's alert answers 404, the same as one that doesn't exist.

## 3. Why we chose what we chose

| Choice                                        | Alternative                            | Why                                                                                   |
| --------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| Outbox table                                  | send directly from the job             | deciding can't fail on a messaging outage; retries don't re-decide                    |
| One daily job                                 | a delayed job per reminder per booking | nothing to reschedule when dates or payments change; the job re-reads the truth daily |
| Tightest milestone + unique key               | "exactly N days before" check          | survives a missed day; never sends twice                                              |
| One table for guest messages and staff alerts | separate tables                        | same lifecycle (pending → handled), same uniqueness rule; `audience` tells them apart |
| "Pay later" bookings get reminders too        | deposits only                          | they owe their whole balance by the same date                                         |

## 4. Concepts to study

- The **transactional outbox** pattern
- **Idempotency keys** and `ON CONFLICT DO NOTHING`
- **Cron in a time zone** (BullMQ `upsertJobScheduler` with `tz`)
- **Mutation testing**: when a deliberately broken rule doesn't fail any test, the test is
  missing

## 5. Try it yourself

The job runs at 09:00 Lagos time. To see it now, call it directly with a chosen date (from the
repo root, with the database running):

```bash
node --input-type=module -e "
import { createPrismaClient, queueBalanceNotices } from '@okapigo/db';
process.loadEnvFile('.env');
const p = createPrismaClient(process.env.DATABASE_URL);
console.log(await queueBalanceNotices(p, { now: new Date('2026-12-20T09:00:00+01:00') }));
await p.\$disconnect();"
```

Then sign in as a manager and look at `GET /api/alerts`, or open the `notifications` table in
`pnpm --filter @okapigo/db studio`.

## 6. Gotchas

- **A bug from 11b, found and fixed here.** The worker calls each processor with `job.data`,
  not the job. In 11b, `extend-schedules` read `job.data.operatorId`, and its test passed a
  fake `{ data: … }`, so test and code agreed with each other and both were wrong. A real
  queued job would have ignored its `operatorId`. Lesson: a test's fake must look like what
  the real caller passes.
- The Heritage Walk skips 25 December, so a test asking for "the walk exactly 20 days from
  today" would fail if run in early December. The tests take the first walk **at least** that
  far ahead.
- Times: the job compares **local dates** in the operator's time zone. 09:00 Lagos is 08:00
  UTC, so `new Date()` in UTC would get the date wrong near midnight.

## 7. What's next

**Stage 11e**, the last of session 11: **link previews**. When someone shares
`okapigo.app/irin-lagos-tours/badagry-heritage-day-trip` on WhatsApp, Instagram or X, the
preview should show the tour's title, summary, price and picture (BKG-32's "proper link
previews").
