# Session 9: Cancellation policies, cancelling and no-shows

**PRD coverage:** **BKG-26**: policies by product, applied automatically to cancellations and
no-shows, producing a refund amount or a forfeited deposit. Also lays the groundwork for
**PAY-08** ("refund amounts set by the cancellation policy or by staff"). The money itself moves
in session 10.

**Done when:** a booking can be cancelled with the refund worked out by its policy version; a
whole departure can be called off with full refunds; tests prove the rules. ✅ 334 tests.

---

## 1. What we built

```
packages/shared/src/
├── cancellation.js            computeRefund(): THE policy engine (pure function)
└── schemas/cancellation.js    policy rules (no "refund grows later" mistakes), cancel requests

packages/db/
├── prisma/…_add_cancellation_policies/   tables, CHECKs, and an IMMUTABILITY TRIGGER
├── src/policies.js            createPolicy, addPolicyVersion, currentPolicyVersion
└── src/cancellations.js       previewCancellation, cancelBooking, markNoShow, cancelDeparture

apps/api/src/routes/
├── policies.js                GET/POST policies, POST new version
├── bookings.js                + cancellation-quote, cancel, no-show
└── schedules.js               + POST /api/departures/:id/cancel
```

### Ìrìn's Standard policy (seeded, used by all five tours)

| When the guest cancels              | Refund           |
| ----------------------------------- | ---------------- |
| 48 hours or more before             | 100%             |
| 24 to 48 hours before               | 50%              |
| Less than 24 hours                  | 0%               |
| No-show                             | 0%               |
| Deposit                             | non-refundable   |
| **The operator cancels** (weather…) | **100%, always** |

### New endpoints

| Endpoint                                                                       | Permission                                    |
| ------------------------------------------------------------------------------ | --------------------------------------------- |
| `GET /api/cancellation-policies`                                               | products: view                                |
| `POST /api/cancellation-policies`, `POST …/:id/versions`                       | products: edit                                |
| `GET /api/bookings/:id/cancellation-quote?initiatedBy=guest`                   | bookings: view                                |
| `POST /api/bookings/:id/cancel` `{ initiatedBy, reason, refundOverrideKobo? }` | bookings: edit (+ payments: edit to override) |
| `POST /api/bookings/:id/no-show`                                               | bookings: edit                                |
| `POST /api/departures/:id/cancel` `{ reason }`                                 | bookings: edit                                |

## 2. How it works

### The engine (pure, like pricing)

```
operator cancelled?  ──yes──► refund everything paid
        │no
refundable base = paid − (deposit, unless deposits are refundable)
        │
no-show? ──yes──► no-show rate
        │no
first tier (most generous first) where  hoursBefore ≥ tier.hoursBefore  → its rate
        │
refund = rate × base, rounded to whole naira (same rule as pricing), never above the base
forfeited = paid − refund
```

Tested with the tier edges (exactly 48 h = full; 47.9 h = half), deposits, rounding,
"cancelled after the tour started", and 500 generated cases checking
`0 ≤ refund ≤ paid` and `refund + forfeited = paid`.

### Versions that can never change

```
CancellationPolicy "Standard"  ◄── products point here (so new bookings get the latest)
   ├── version 1  { 48h:100%, 24h:50%, 0h:0% }  ◄── bookings sold before the change
   └── version 2  { 72h:100%, 0h:0% }           ◄── bookings sold after
```

Each booking stores the **version** it was sold under. Changing the rules adds a version; it
never rewrites one. That isn't left to discipline. A **PostgreSQL trigger** rejects any
`UPDATE` on `cancellation_policy_versions`:

```sql
CREATE TRIGGER cancellation_policy_versions_immutable
  BEFORE UPDATE ON "cancellation_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION forbid_policy_version_update();   -- raises an error
```

Tested: even a direct `prisma.cancellationPolicyVersion.update(...)` fails with "immutable".

### What cancelling does (one transaction)

| Booking was…                                   | Seats                        | Refund due                 | Status                         |
| ---------------------------------------------- | ---------------------------- | -------------------------- | ------------------------------ |
| `held` (unpaid)                                | hold released                | 0                          | `cancelled`                    |
| `confirmed` / `part_paid` / `paid` / `amended` | `seats_sold −= n`            | policy (or staff override) | `cancelled`                    |
| `completed` etc.                               | —                            | —                          | refused (`INVALID_TRANSITION`) |
| no-show                                        | **stay sold** (the tour ran) | no-show rate               | `no_show`                      |

The timeline event carries the reason, who initiated it, and the full refund calculation
(tier, hours before, policy version, and the policy's figure if staff overrode it).

### Calling off a departure

`cancelDeparture` locks the departure row (`FOR UPDATE`), cancels every booking as
**operator-initiated** (full refunds), releases loose holds and marks the departure
`cancelled`, all or nothing. While it runs, new holds wait for the lock and then see
"cancelled".

## 3. Why we chose what we chose

| Choice                                                      | Why                                                                       | Trade-off                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| **Versions + trigger**                                      | A guest's terms can't change after they book, guaranteed by the database. | No "fix a typo in v3"; you add v4.       |
| **Bookings point at a version, products at a policy**       | New bookings automatically use the latest rules; old ones keep theirs.    | Two tables instead of one.               |
| **Operator cancellations always refund in full**            | Fair and simple; the policy protects the operator, not the reverse.       | Not configurable (not needed).           |
| **Refunds can't increase as departure nears** (schema rule) | Prevents a mis-typed policy that pays people to cancel late.              | —                                        |
| **Override needs payments: edit**                           | Choosing an amount is a money decision.                                   | A front-desk role must ask a manager.    |
| **Record refund _due_ now, pay in session 10**              | Paystack refunds are their own careful job (webhooks, ledger).            | Cancelled bookings wait at "refund due". |
| **"Credit" instead of refund** (PRD mentions it)            | Parked: vouchers/credits are a v1 feature.                                | —                                        |

## 4. Concepts to study

- **Immutability and versioning** of business rules; **database triggers** (`BEFORE UPDATE`).
- **Snapshots vs references**: storing _which version_ applied rather than copying the rules.
- **Policy/strategy engines** as pure functions.
- **Boundary testing** (`>=` vs `>` at exactly 48 h).
- **Implicit locks**: an `UPDATE` locks the row it changes, just like `SELECT … FOR UPDATE`.
- **Sync vs async errors** in JavaScript: why a function that returns a promise should be
  `async`, so _every_ failure becomes a rejected promise.

## 5. Try it yourself

```bash
pnpm db:reset   # new tables + the Standard policy in the seed
pnpm dev
```

As Tunde (manager), make a booking on a Heritage Walk 3+ days away, then simulate payment in
psql (payments arrive next session):

```sql
UPDATE bookings SET status = 'paid', amount_paid_kobo = total_kobo WHERE reference = '<ref>';
```

(This skips the hold conversion and lifecycle, which is fine for poking around, never for real
code.) Then:

1. `GET /api/bookings/<id>/cancellation-quote`: 100% because it's 48 h+ away.
2. `POST /api/bookings/<id>/cancel` with `{"initiatedBy":"guest","reason":"Plans changed"}` and
   read the timeline.
3. Try to rewrite history: `UPDATE cancellation_policy_versions SET no_show_refund_basis_points = 10000;`
   in psql. The trigger refuses.
4. Add a version: `POST /api/cancellation-policies/<id>/versions` and see both in the list.
5. Book two seats on a Tarkwa Bay trip and call it off: `POST /api/departures/<id>/cancel`.

## 6. Gotchas

- **An empty migration got applied.** The schema edit failed silently, so `migrate diff` failed,
  my `&&` chain stopped before appending SQL, and `migrate deploy` happily applied (and recorded)
  an **empty** file. Nothing in the database changed, but Prisma believed it had. I removed the
  record and folder (local only, never pushed) and regenerated, now with a check that refuses to
  continue if the generated file is empty. **Lesson: check each step's result before the next.**
- **Silent no-op edits.** Twice, a Python `replace` matched nothing because Prettier had
  reformatted the text, and nothing complained. The second time, **lint** noticed an unused
  import, which revealed that a test was still setting `no_show` via `setBookingStatus`. That path
  **skipped the refund calculation**. `setBookingStatus` now refuses anything but `completed`,
  in the function itself, not just in the API schema.
- **A concurrency test that passed for the wrong reason.** With the departure lock removed, the
  "call off a departure while guests book" test still passed, because cancelling an existing
  booking _updated the departure row_, which took the lock anyway. The test now uses an empty
  departure; it fails 6/6 without the lock and passes 6/6 with it.
- **`throw` before the first `await`** made an error synchronous instead of a rejected promise;
  `setBookingStatus` is now `async`.
- **CI for session 8 passed on GitHub**; the rare local flake from last session didn't appear.

## 7. What's next: session 10

**Payments with Paystack test mode (PAY-02, PAY-03, PAY-05, PAY-08, PAY-22).** This is a big
one, likely split in two: the double-entry **ledger** first (every naira as balanced entries),
then Paystack: card and bank transfer, **webhooks** that are verified and idempotent, payments
confirming bookings (held → paid), payment links, and refunds paying out `refundDueKobo` and
moving bookings to `refunded`. You'll need a free Paystack account in **test mode**; I'll give
step-by-step instructions at the start.
