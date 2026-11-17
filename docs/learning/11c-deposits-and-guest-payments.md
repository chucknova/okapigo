# Stage 11c: Deposits and guest payments

A guest can now **pay**, from the review screen (checkout screen 4) and later from the trip hub:
in full, a deposit, or the balance. This finishes PRD journey 5's first half: "a Badagry guest
pays a 30% deposit". The reminders are stage 11d.

## 1. What we built

| Piece                                | Where                                           |
| ------------------------------------ | ----------------------------------------------- |
| The deposit rules (pure, tested)     | `packages/shared/src/deposits.js`               |
| A per-tour deposit setting           | `products.deposit_basis_points` (+ CHECK)       |
| What the guest can pay now           | `paymentOptions` in the guest booking view      |
| `POST /public/bookings/:token/pay`   | `apps/api/src/routes/public-checkout.js`        |
| One way to start a payment over HTTP | `startPaymentForHttp()` in `routes/payments.js` |

Badagry is seeded with a 30% deposit. The tour page now shows `depositBasisPoints` ("Reserve
with 30%") and the policy's `depositRefundable` (the "Deposits are non-refundable" small print).

## 2. How it works

### The rules, as one pure function

```
depositOffer({ totalKobo: 6_500_000, depositBasisPoints: 3000,
               departureLocalDate: '2026-12-05', todayLocalDate: '2026-11-17' })
→ { depositKobo: 1_950_000, balanceKobo: 4_550_000, balanceDueDate: '2026-11-28' }
```

- The balance is due **7 days before** the trip's date: `balanceDueDate()`.
- **On the due date or later, no deposit is offered**, because the balance would be due at once.
  This is your rule: "anyone booking later than that pays in full".
- No deposit if the tour has none, or if something has already been paid.
- The deposit is rounded to **whole naira, halves up**, with the same `divideRoundToNaira` the
  pricing pipeline uses. One rounding rule everywhere.

The dates are **local calendar dates** (`'YYYY-MM-DD'` in Lagos time). "Due by Sat 28 Nov" is a
date to a person, not an instant, and `'2026-11-27' < '2026-11-28'` compares correctly as text.

### Options, not amounts

```
review screen ──GET /public/bookings/:token──► paymentOptions: [
                                                  { type: 'full',    amountKobo: 6_500_000 },
                                                  { type: 'deposit', amountKobo: 1_950_000,
                                                    balanceKobo: 4_550_000, balanceDueDate } ]
"Pay ₦19,500" ──POST …/pay { option: 'deposit' }──► server recomputes the options
                                                    finds 'deposit' → amount 1_950_000
                                                    startPayment() → Paystack URL
```

The browser sends **which option**, never **how much**. The server works out the options again
from the database at the moment of paying, so:

- a tampered request (`amountKobo: 100`) is ignored. Zod strips unknown fields, and a test sends
  one to prove it.
- the screen can never offer something the server won't accept, because both use the same
  `paymentOptions()` function.
- if something changed in between (the hold expired, the due date passed at midnight), the
  answer is `409 OPTION_NOT_AVAILABLE` with the options that **are** available.

| Booking state                     | Options                     |
| --------------------------------- | --------------------------- |
| held, hold still on               | full (+ deposit if allowed) |
| part paid / confirmed, money owed | balance                     |
| paid, cancelled, hold expired…    | none                        |

### After the deposit

Nothing new was needed. Session 10's engine already handles it:

1. `startPayment()` labels the payment `deposit` (held booking, amount below the balance).
2. Paystack's signed webhook arrives, gets verified and settled. The booking becomes
   **part_paid**, and its seats move from **held** to **sold**, so the 15-minute hold no longer
   matters.
3. The guest view now shows `balanceDueDate` and a single `balance` option.
4. Paying it makes the booking **paid**.

The new code is only the rules and the edges. The money path is the one already tested in
session 10. Reusing it is why this stage is small.

### Shared error answers

The staff route and the guest route both start payments. Their error handling moved into
`startPaymentForHttp()`, so both answer alike:

- `409 PAYMENT_STARTING`: a double click during setup
- `404` / `409`: booking problems
- `502`: the provider failed

## 3. Why we chose what we chose

| Choice                               | Alternative            | Why                                                                                                                  |
| ------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Deposit % per tour                   | one % for the operator | Badagry needs one; the Heritage Walk doesn't                                                                         |
| Due date derived (trip − 7 days)     | stored on each booking | the rule is fixed; a stored copy would only matter if it became adjustable (then snapshot it, like the pickup point) |
| `CHECK (1–9999)` in the database too | Zod only               | a deposit of 0% or 100% is meaningless; the DB refuses it even if the API is bypassed                                |
| Guest sends an option                | guest sends an amount  | the server is the only one who decides money                                                                         |
| `method: 'any'` default for guests   | card only              | Paystack's page lets them pick card or transfer (popular in Nigeria)                                                 |

## 4. Concepts to study

- **Never trust the client with money**: compute amounts on the server
- **Local dates vs instants** (`'YYYY-MM-DD'` vs a timestamp), and why due dates are dates
- **Boundary testing**: the day before, on, and after the due date
- **Defence in depth**: Zod + database CHECK for the same rule

## 5. Try it yourself

Your dev database was seeded before Badagry had a deposit. Run `pnpm db:reset` first. Then,
with `pnpm dev` running:

1. Book Badagry on a Saturday **more than a week away** (as in the 11b note, using
   `badagry-heritage-day-trip`).
2. `GET /public/bookings/<token>` should show two `paymentOptions`.
3. `POST /public/bookings/<token>/pay` with `{"option":"deposit"}`, then open the
   `authorizationUrl` (the simulator's page) and approve it.
4. `GET` again: the booking is `part_paid`, with a `balanceDueDate` and one `balance` option.
5. Try `{"option":"deposit"}` on the **nearest** Saturday: `OPTION_NOT_AVAILABLE`.

## 6. Gotchas

- The nearest Badagry Saturday is always within 7 days, so it never offers a deposit. The tests
  rely on that ("too soon"), and on there being a Saturday more than a week out ("far enough").
- `balanceDueDate` is shown only once something has been paid with money still owed. A booking
  staff confirmed as "pay later" with nothing paid has no due date yet. Stage 11d decides what
  reminders do about it.
- Deposits are **non-refundable** under Ìrìn's Standard policy (`depositRefundable: false`). The
  cancellation engine from session 7 already applies that. The checkout just has to show it.

## 7. What's next

**Stage 11d:** balance reminders (proposal: 7, 3 and 1 day before the due date) and an alert to
staff when a balance is overdue. Nothing is cancelled automatically. The messages themselves are
sent from session 14, so 11d records what should be sent and when, and session 14 sends it.
