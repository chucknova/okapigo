# Stage 15a: Vans and boats, who guides what, the manifest, and check-in

This opens session 15 (the operator app, flow brief `docs/flows/07-operator-app.md`). 15a is
the **server side** the guide's screens will stand on; no screens yet (15c, from your designs).

| Stage   | What                                                                    |
| ------- | ----------------------------------------------------------------------- |
| **15a** | **resources, assignment, manifest (+ print), check-in, no-show, names** |
| 15b     | the sync API: an offline package, an outbox of check-ins, conflicts     |
| 15c     | the app shell and the guide's screens (O1–O5)                           |
| 15d     | journey 6: a guide checks in offline, then syncs                        |

## 1. What we built

| Piece                                              | Where                                                   |
| -------------------------------------------------- | ------------------------------------------------------- |
| Resources: vans and boats, with seats              | `schema.prisma` → `Resource`; seeded Van 1, Van 2, Boat |
| A departure's guide, resource and notes            | `Departure.guideId / resourceId / notes`                |
| Assigning, with "already busy" checks              | `packages/db/src/operations.js` → `assignDeparture`     |
| The manifest: who's coming, what they owe, add-ons | `manifest()`                                            |
| A printable manifest (print, or save as PDF)       | `GET /api/departures/:id/manifest/print`                |
| Check-in (by ticket code or booking), late, undo   | `checkIn()`                                             |
| No-show, only once the trip has started            | `noShow()`                                              |
| Naming a guest at check-in (optional)              | `nameTraveller()`, `PATCH /api/travellers/:id`          |
| The routes, with permissions                       | `apps/api/src/routes/operations.js`                     |

| Route                                      | Who                             |
| ------------------------------------------ | ------------------------------- |
| `GET/POST/PATCH /api/resources`            | see: operations; edit: products |
| `PUT /api/departures/:id/assignment`       | bookings edit (office)          |
| `GET /api/departures/:id/manifest(/print)` | operations view                 |
| `POST /api/departures/:id/check-ins`       | operations edit (the guide)     |
| `POST /api/departures/:id/no-shows`        | operations edit                 |
| `PATCH /api/travellers/:id`                | operations edit                 |

A **guide** (who can't edit bookings) only sees departures **they're assigned to**; any other
gives 404, as if it weren't there.

## 2. Your decisions, as built

| You said                                  | So                                                            |
| ----------------------------------------- | ------------------------------------------------------------- |
| Drivers: not a person in OkapiGo (yet)    | a van is a resource; the driver goes in the departure's notes |
| No-show: the guide marks it, offline too  | allowed from the start time; before it, "NOT_STARTED"         |
| Owes money: show it, warn before check-in | the manifest says "₦25,000 still to pay"; check-in asks once  |
| Names: optional at check-in               | unnamed guests read "Guest 2 of Adaeze’s booking"             |

The warning is a **refusal with a question**: the first check-in answers `BALANCE_OWED`
("They still owe ₦25,000. Check in anyway?"); the app sends it again with `confirmOwed: true`.
The server decides; the screen only asks.

## 3. "Kemi can't be in two places at once": an exclusion constraint

The easy check is in code: "does Kemi have another departure overlapping this one?". But two
office staff assigning at the same moment can both read "no" and both write. So the database
itself refuses it:

```sql
ALTER TABLE departures ADD CONSTRAINT departures_guide_not_double_booked
  EXCLUDE USING gist (guide_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE (guide_id IS NOT NULL AND status = 'scheduled');
```

Read it as: "no two scheduled rows may have **the same** guide **and overlapping** times".
`&&` is "overlaps" for ranges; `tstzrange(a, b)` includes the start, not the end, so a trip
ending at 13:00 and one starting at 13:00 are fine (a test checks back-to-back). It needs the
`btree_gist` extension (to compare plain ids inside a gist index). The same rule covers vans
and boats.

The code still checks first, to give a **useful** message ("Kemi Adeyemi is on the Badagry
Heritage Day Trip until 17:00."); the constraint is the safety net, and if it fires the API
says `ASSIGNED_ELSEWHERE`. A too-small van isn't refused, only warned (`RESOURCE_TOO_SMALL`):
the office may know better.

## 4. Deferred foreign keys

A departure points at its guide by **(guide id, operator id)**, so a guide from another
business can never be assigned. Deleting a whole business (tests do this) then failed:
Postgres checked the departure → guide link mid-delete. Making the links
`DEFERRABLE INITIALLY DEFERRED` moves the check to the **end of the transaction**, when both
rows are gone. (Migration `20261119181000_assignment_fk_deferred`.)

## 5. Check-in rules

- By **ticket code** (the QR) or by booking; per traveller, so 2 of 3 can arrive.
- A ticket for **another departure** says which ("This ticket is for Sat 5 Dec, 09:00.");
  another business's ticket: `NOT_OUR_TICKET`; cancelled: `BOOKING_CANCELLED`.
- **Doing it twice is harmless** (`already: true`, the first time is kept). This matters for
  15b: an offline phone may send the same check-in again after reconnecting.
- `late`, and back to `pending` (undo), are the same call with a different status.
- Each check-in is written to the booking's history (`checked_in` event, with who).

## 6. Also: when the business cancels

The cancellation message now says it's on you, with your reason: "We’re sorry: we had to
cancel this trip (Bad weather at sea). You’ll get a full refund of ₦X…", instead of the
guest's own-cancellation wording.

## 7. Found along the way

- A browser-free web test flaked: it answered a request **before** the page had made it (the
  button changes a moment earlier). It now waits for the request.
- **Still the shared database.** One of the two full runs had one failure: your `pnpm dev`
  sent a test's "payment didn't go through" notice before the test could. That file passed
  3 of 3 on its own. Same cause as 14c, same fix (the proposed "tests get their own database").

## 8. Checks

1,143 tests: the first full run all passing, the second with the one clash above; all 8
browser journeys pass. 17 mutation checks (drop the overlap check, the before-start rule, the
owed-money warning, the guide-only filter, …), all caught.

## 9. Concepts to study

- **Exclusion constraints** and **range types** in Postgres (`tstzrange`, `&&`, gist indexes)
- **Deferrable constraints**: checked at commit instead of per statement
- **Idempotent operations**: why "do it again" must be safe before going offline
