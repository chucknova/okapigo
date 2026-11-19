# Stage 15b: The sync API (the operator app with no signal)

PRD: _"72 hours of offline actions sync with zero data loss."_ (OPS-09; flow brief 07,
section 4.) This is the server side; the phone's half (saving, the outbox, screen O5) is 15c.

| Stage   | What                                                                   |
| ------- | ---------------------------------------------------------------------- |
| 15a     | resources, assignment, manifest (+ print), check-in, no-show, names    |
| **15b** | **the offline package, the outbox endpoint, conflicts; 72-hour tests** |
| 15c     | the app shell and the guide's screens (O1–O5), from your designs       |
| 15d     | journey 6: a guide checks in offline, then syncs                       |

## 1. What we built

| Piece                                                     | Where                                         |
| --------------------------------------------------------- | --------------------------------------------- |
| What the phone saves (the offline package)                | `packages/db/src/sync.js` → `offlinePackage`  |
| The outbox: apply each change once, in order, at its time | `applyChanges`                                |
| Each change's answer, kept (`sync_changes` table)         | `schema.prisma` → `SyncChange`                |
| Conflicts in plain words; "OK"                            | `explain`, `listConflicts`, `dismissConflict` |
| The routes                                                | `apps/api/src/routes/sync.js`                 |

| Route                                  | Who              | What                                                |
| -------------------------------------- | ---------------- | --------------------------------------------------- |
| `GET /api/sync/package`                | operations: view | today's + tomorrow's departures I guide             |
| `POST /api/sync/changes`               | operations: edit | `{ changes: [...] }`, oldest first, up to 500       |
| `GET /api/sync/conflicts`              | operations: view | waiting to be looked at (guide: mine; manager: all) |
| `POST /api/sync/conflicts/:id/dismiss` | operations: edit | "OK" on O5                                          |

A change, as the phone sends it:

```json
{
  "id": "a UUID the phone made",
  "at": "2026-11-19T08:05:00Z",
  "kind": "check_in",
  "departureId": "…",
  "code": "the scanned QR",
  "status": "present",
  "seen": { "<travellerId>": "pending" }
}
```

`kind` is `check_in` (present / late / undo), `no_show`, or `name`.

## 2. The package: what the phone saves

Today's and tomorrow's departures (in the business's time zone) **I'm the guide on**, each with
the whole manifest from 15a. Two details:

- **Tickets as fingerprints.** The phone must recognise a scanned QR with no signal. It's given
  each ticket's **SHA-256 fingerprint**, not the code: it fingerprints what it scans and looks
  it up. A lost phone gives nobody a ticket, and the phone can't make one (that needs the
  server's secret, 12f).
- **304 Not Modified.** The phone refreshes every few minutes. The package has no
  "generated at" inside, so the same data gives the same response; Express labels it with an
  **ETag** (a fingerprint of the response), the phone sends it back (`If-None-Match`), and gets
  an empty `304` when nothing changed. `Cache-Control: no-cache` means "keep it, but ask first".

## 3. The outbox: each change once

The hard case: the phone sends its outbox, the server applies it, and signal drops **before the
answer arrives**. The phone doesn't know, so it sends again. Two layers make that safe:

1. **Every change has the phone's own id.** The answer is stored under it (`sync_changes`,
   unique per person + id). Sent again: the stored answer comes back (`repeated: true`), and
   nothing is redone, even if it **would** apply now (a test: a "no longer your departure"
   conflict, the guide put back on it, the same change sent again: still that conflict).
2. **The changes are safe to repeat anyway** (15a: checking in twice changes nothing). So even
   two sends **racing** each other (both arrive before either stored its answer) do the same
   harmless thing, and whichever answer is stored first is the one both get
   (`createManyAndReturn` with `skipDuplicates`: an empty result means "someone got here
   first").

This pairing is the usual recipe for **exactly-once effects over an at-least-once network**:
an idempotency key, plus operations that are idempotent themselves.

Also:

- **In order, one at a time.** Present → undo → late ends late. A conflict doesn't stop the
  changes after it (they're usually about other guests).
- **At the time it happened.** A check-in tapped at 09:05 with no signal says 09:05, not when
  signal came back. Never later than now (a phone clock running fast).
- **Up to 500 changes per request**, so this one route accepts 1 MB (the rest keep 100 KB).

## 4. Conflicts: nobody guesses

A change that can't be applied any more becomes a **conflict**: nothing changes, the
server's version stands, and it waits, with its reason, until someone taps OK. The reason is
written for screen O5: what this phone did, what the server had, what happens now:

> You marked Adaeze Okafor present at 09:50, but the booking was cancelled at 09:40. Nothing changed.
> You marked Bisi Okafor present at 10:02, but Tunde Bakare had already marked Bisi Okafor late at 09:58. Theirs stands.

| Code                                                              | Means                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| `BOOKING_CANCELLED`                                               | cancelled while the phone was offline                    |
| `CHANGED_FIRST`                                                   | someone else changed this traveller (or name) first      |
| `CHECKED_IN`                                                      | a no-show, but someone checked them in                   |
| `NO_SHOW_MARKED`, `OTHER_DEPARTURE`, `BALANCE_OWED`, `NOT_BOOKED` | as at check-in (15a)                                     |
| `NOT_ASSIGNED`                                                    | this guide was taken off the departure                   |
| `NOT_STARTED`                                                     | a no-show before the start (is the phone's clock right?) |

**"Someone else first"** needs to know what the phone saw: each check-in carries `seen` (each
traveller's state on the phone when the guide tapped). If the server now has something else,
**and** it isn't what this change wanted anyway, someone changed it in between: conflict.
(Both marked Adaeze present? No conflict, same result.) Without `seen` (online), the last tap
wins, as in 15a.

A change that was **never** valid (a forged ticket, a traveller not on this departure) is
**rejected**, not a conflict: there's nothing for anyone to decide.

"Undo mine" on O5 isn't a server feature: it's just a new change in the outbox.

## 5. Changed in 15a's rules

- **No-show** now runs in one transaction holding the booking's lock (like check-in), so a
  check-in and a no-show of the same booking can't both happen; and it's refused if anyone on
  the booking was checked in (`CHECKED_IN`), online too. `markNoShowInTx` was split out of
  `markNoShow` for this.

## 6. 72 hours offline

Sessions last 30 days (session 3, chosen for this), so the phone is still signed in. The test
moves the clock forward by moving the data back: a tour that started 72 hours ago, a session
last used 73 hours ago, and three changes from then (a check-in, a late, a no-show). All
apply, each with its own time.

## 7. Checks

1,158 tests, both full runs all passing. The first browser run failed (I didn't capture which
journey; your `pnpm dev` was running, the shared-database trap again); the rerun passed all 8.
17 mutation checks (skip the stored answer, drop the clock clamp, the "only mine" filters,
the fingerprint, `seen`, the no-show-after-check-in rule, the 1 MB limit, …), all caught.

## 8. Concepts to study

- **Idempotency keys** and **at-least-once delivery** (why "exactly once" is built, not given)
- **HTTP caching**: ETag, `If-None-Match`, `304`, `Cache-Control: no-cache` vs `no-store`
- **Hashing as a lookup key** (a fingerprint you can match but not reverse)
- **Offline-first conflict handling**: last-write-wins vs "show it and let a person decide"
