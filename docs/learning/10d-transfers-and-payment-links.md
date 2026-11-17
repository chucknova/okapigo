# Stage 10d: Bank transfers, manual matching and payment links

**PRD coverage:** **PAY-03** (pay by transfer; matched to its booking automatically, with a
**manual match** fallback) and **PAY-05** (payment links for any amount on any booking). Also
unlocks **deposits and balances** (groundwork for BKG-06, whose rules and reminders come with
checkout in session 11).

**Done when:** transfers settle automatically by reference; wrong-amount and reference-less
transfers land in **unmatched receipts** that staff can match; staff can make payment links
that guests pay. ✅ 483 tests, six full runs in a row clean, plus a real-stack run: link → ₦100-short
transfer → manual match → second link for ₦100 → `paid`, books balanced.

---

## 1. What we built

```
packages/db/
├── …_transfers_and_payment_links/   payment_links; payments: nullable booking, suggested
│                                     booking, allocated at, link; method/receipt CHECKs
├── …_unmatched_receipt_unique/      a PARTIAL unique index (one receipt per provider tx)
├── src/payments.js                   startPayment: any amount ≤ balance; payableBalance()
├── src/settlement.js                 unmatched receipts, wrong amounts, allocateReceipt()
└── src/payment-links.js              create / find / pay / cancel links

packages/payments/src/simulator.js    transfers, wrong amounts, reference-less transfers

apps/api/src/routes/
├── payment-links.js                  links API, /pay/:token pages, unmatched receipts, allocate
└── payments.js                       simulator: Pay by transfer, ₦100 short; unmatched-transfer tool
```

### Endpoints

| Endpoint                                                                 | Permission                     | Does                                                       |
| ------------------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------- |
| `POST /api/bookings/:id/payments` `{ amountKobo?, method? }`             | bookings: edit                 | full, deposit, balance or part; card / bank_transfer / any |
| `POST /api/bookings/:id/payment-links` `{ amountKobo?, expiresInDays? }` | bookings: edit                 | link → URL (**shown once**)                                |
| `GET /api/bookings/:id/payment-links`                                    | bookings: view                 | links, without URLs                                        |
| `POST /api/payment-links/:id/cancel`                                     | bookings: edit                 |                                                            |
| `GET /api/payments/unmatched`                                            | payments: view                 | money waiting to be matched                                |
| `POST /api/payments/:id/allocate` `{ bookingId }`                        | payments: edit                 | the manual match                                           |
| `GET` / `POST /pay/:token`                                               | public                         | link page; Pay → provider checkout                         |
| `POST /api/simulator/unmatched-transfer`                                 | payments: edit, simulator only | demo: money with no reference                              |

## 2. How it works

### Transfers: automatic first, manual as the fallback

Paystack's "Pay with transfer" sends the same signed `charge.success` with **our** reference, so
the 10c settlement matches it automatically. The new work is what to do when that fails:

| What arrived                               | Recorded as                                                                      | Ledger                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------- |
| right amount, our reference                | payment succeeded, booking settled (10c)                                         | Dr Clearing / Cr Tour sales               |
| **wrong amount**, our reference            | original attempt `failed`; an **unmatched receipt** _suggested_ for that booking | Dr Clearing / Cr **Unallocated receipts** |
| **no reference** (straight to the account) | an **unmatched receipt** for that operator                                       | Dr Clearing / Cr Unallocated receipts     |

Money that arrived is **always recorded**; it's just not _applied_ until a person decides.
The wrong amount is never applied automatically (₦49,900 against ₦50,000 could be a typo, a
bank charge or someone else's payment).

### The manual match

`POST /api/payments/:id/allocate { bookingId }`, in one transaction with the receipt **locked**:

1. the receipt gets its booking
2. ledger: **Dr Unallocated receipts / Cr Tour sales** (the money becomes a sale)
3. the booking is settled by the **same `settleBooking`** as a normal payment: held → paid or
   part-paid, balances, and **any excess owed back**

Refused for bookings that can't take money (cancelled, already paid…): those receipts get
refunded instead (stage 10e). **Tested by removing the lock:** two staff matching one ₦10,000
receipt to two different bookings at once **both succeeded**, so the money would count twice.

### Paying any amount

`startPayment` now takes an amount (default: the whole balance) and a method. The purpose is
named automatically: `full`, `deposit` (part of a held booking), `balance`, or `custom`. Amounts
above what's owed are refused **before** reaching Paystack (an overpayment only creates a refund).

### Payment links

```
Staff: POST …/payment-links ──► token = 24 random bytes; store sha256(token); return the URL ONCE
Guest: GET /pay/<token>     ──► tour, date, reference, amount. No names, emails or phones.
       POST /pay/<token>    ──► startPayment(amount from the link, method "any") ──► checkout
Webhook settles it          ──► link marked "paid"
```

- **Stored hashed** (as session tokens are): a database leak doesn't hand out working links.
- **Re-checked when used:** a ₦50,000 link made before a ₦15,000 deposit is refused afterwards,
  so it can't overcharge (tested).
- Expires (7 days by default), can be cancelled; sending by WhatsApp or email arrives in session 14.

### A partial unique index

```sql
CREATE UNIQUE INDEX payments_one_receipt_per_provider_transaction
  ON payments (provider, provider_transaction_id)
  WHERE booking_id IS NULL AND provider_transaction_id IS NOT NULL;
```

It covers **only unmatched receipts**. The original payment of a wrong-amount transfer shares
the provider's transaction id with its receipt but has a booking, so it's outside the index.
It's the backstop if the webhook job and the sweeper ever record the same transfer at once.

## 3. Why we chose what we chose

| Choice                                                 | Why                                                                               | Trade-off                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Record all money, apply only when certain**          | Nothing lost, nothing misapplied.                                                 | Staff have a queue to clear.                      |
| **Suggested booking is a plain id, not a foreign key** | It's a hint; a SET NULL rule on top of these cascades is what broke in session 7. | Could point at a deleted booking (shown as none). |
| **Payments link to the operator directly**             | Unmatched receipts have no booking to cascade through.                            | One more relation.                                |
| **Links store a hash; URL shown once**                 | Same safety as sessions.                                                          | Lost URL = make a new link.                       |
| **Link pages show no personal data**                   | Anyone with the link can see the page.                                            | Guests see a reference, not their name.           |
| **No overpayment by staff or links**                   | An overpayment is just a refund waiting to happen.                                | —                                                 |

## 4. Concepts to study

- **Reconciliation** and **suspense accounts** ("unallocated receipts").
- **Partial indexes** in PostgreSQL.
- **Capability URLs** (a secret in the link _is_ the permission) and why to hash them.
- **Bank transfer realities**: missing references, wrong amounts, bank charges.
- **Prisma interactive transaction limits** (`maxWait`, `timeout`) and what happens when they hit.

## 5. Try it yourself

```bash
pnpm dev
```

As Tunde (manager), create a booking, then:

```bash
curl -s -X POST localhost:4000/api/bookings/<id>/payment-links -H "$T" -H 'content-type: application/json' -d '{}'
```

Open the `url` in your browser → **Pay** → on the simulated checkout, click
**"Transfer ₦100 too little"**. Then:

1. `GET /api/payments/unmatched`: your receipt, suggested for the booking.
2. `POST /api/payments/<receipt id>/allocate` with `{"bookingId":"<id>"}` → the booking is `part_paid`.
3. Make another link with `{}`: it asks for exactly the ₦100 left. Pay it → `paid`.
4. Send money with no reference:
   `POST /api/simulator/unmatched-transfer` with `{"amountKobo":2000000}`, then find it in the
   unmatched list.
5. `GET /api/ledger/accounts`: watch **Unallocated receipts** go up when money arrives unmatched
   and back down when you match it.

## 6. Gotchas

- **Session 8's "open issue" is solved.** About one full test run in five, the first test of every
  API file failed. The saved log finally showed it: seeds, all starting at once, sometimes took
  longer than **Prisma's default 5-second interactive-transaction limit**. Prisma then rolled back,
  and a query already on its way ran **outside** the transaction, failing with a misleading
  _foreign-key_ error (one of the seven failures did show the honest "expired transaction"
  message). My first guess was disproved by experiment: a deliberately tiny limit gave only the
  honest error, until I read every failure in the log, not just the first. The seed and the
  schedule sync now allow 30 s. **Six full runs in a row are clean** (previously ~1 in 5 failed).
  Lesson: save the log of a failing run; read _all_ of it.
- **A missing branch, found by a test.** Matching more money than is owed to a _held_ booking
  paid it but never owed the excess back. That couldn't happen before 10d (`startPayment` refuses
  overpayments), so the branch had never been exercised.
- **The assert-or-stop edit guard caught another reformatted method** (`complete()`), and nothing
  was half-applied.
- **One unexplained failure, seen once:** in the run before the timeout fix, a workers test found its
  hold already released. It may be the same load problem (it didn't recur in the six runs after
  the fix), but that isn't proven. Noted here, not claimed as fixed.
- **Two real-run bookings** (`ILT-NAYT34`, `ILT-RMKT0B`) are in your local database;
  `pnpm db:reset` clears them.

## 7. What's next: stage 10e

**Refunds (PAY-08) and reconciliation.** Paying out `refundDueKobo` through Paystack's refund API
(cancellations, late money, overpayments) and refunding unmatched receipts, full or partial, staff
partial refunds, **refund webhooks** (Dr Refunds payable / Cr Paystack clearing), bookings moving
`cancelled → refunded`, and a reconciliation job that re-checks payments stuck in "initiated". That
finishes payments, and then session 11 is the guest website.
