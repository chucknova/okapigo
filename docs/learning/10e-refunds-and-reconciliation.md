# Stage 10e: Refunds and reconciliation

**PRD coverage:** **PAY-08** (full or partial refunds to the original method, amounts set by the
cancellation policy or by staff), the last part of **PAY-22** (refunds in the ledger), and the
reconciliation the money-integrity NFR implies. **This completes payments** (PAY-02, 03, 05, 08, 22).

**Done when:** refunds go back to the payments the money came from, the ledger is written only when
money actually leaves, cancelled bookings end `refunded`, and anything webhooks miss is caught.
✅ 508 tests, four full runs clean, and a real-stack run: paid → cancelled → refund →
`refunded` in about 2 seconds, books balanced.

---

## 1. What we built

```
packages/payments/      refund() and fetchRefund() for Paystack and the simulator; refund webhooks
packages/shared/        + POSTINGS.receiptRefunded (Dr Unallocated / Cr Paystack clearing)
packages/db/
├── …_add_refunds/      refunds table; payments.refunded_kobo (CHECK: never above the amount)
├── src/refunds.js      requestBookingRefund, requestReceiptRefund, markRefundProcessed/Failed
├── src/settlement.js   + refund.* webhook events (re-verified with fetchRefund)
└── src/reconciliation.js  reconcile(): payments and refunds that webhooks missed
apps/workers            + reconcile, every 10 minutes
apps/api/src/routes/refunds.js   refund a booking or an unmatched receipt; list refunds
```

### Endpoints

| Endpoint                                                                          | Permission     |
| --------------------------------------------------------------------------------- | -------------- |
| `POST /api/bookings/:id/refunds` `{ amountKobo?, reason }` (default: what's owed) | payments: edit |
| `GET /api/bookings/:id/refunds`                                                   | bookings: view |
| `POST /api/payments/:id/refund` `{ amountKobo?, reason }` (unmatched receipt)     | payments: edit |
| `GET /api/refunds?status=`                                                        | payments: view |

## 2. How it works

### A refund's life

```
requested ──provider accepts──► pending ──refund.processed (verified)──► processed
    │                                │                                       │
    └──provider refuses──► failed ◄──┘ refund.failed                ledger + maybe "refunded"
```

1. **Record first** (booking locked): split the amount across the booking's payments, **newest
   first**, raising each payment's `refunded_kobo` (a CHECK keeps it ≤ the payment).
2. **Call the provider** (no transaction open): one refund per payment, to its original transaction.
3. **Only when the money leaves** (a verified `refund.processed`): Dr Refunds payable / Cr Paystack
   clearing. If everything a cancelled or no-show booking was owed has gone out, it becomes
   **`refunded`**.

A failed refund releases its amount (staff can retry); the money is still owed.

### Staff amounts

The default is exactly what's still owed (`refundDueKobo` minus refunds already under way). Staff
may choose more, e.g. a goodwill ₦5,000 on a booking that **stays paid**. The extra is recorded as
**owed first** (Dr Sales refunds / Cr Refunds payable), then paid, so Refunds payable never goes
negative. Never more than was paid (`REFUND_TOO_HIGH`).

### Who bears the fee

Paystack keeps its fee on a refunded payment. Refunding ₦50,000 in full leaves Paystack clearing
at **−₦850**: the operator's cost, visible in the books (tested).

### Reconciliation: one path for money, never two

Every 10 minutes the workers ask the provider about anything unfinished:

- payments `initiated` for over 30 min → `verifyTransaction`. On success, **record a webhook
  event with the same dedup key Paystack's would have** and process it normally. If the real webhook
  comes later, it's a duplicate (tested).
- checkouts unfinished after 24 h → `abandoned`
- refunds `pending` for over 1 h → `fetchRefund` → the same refund-event path

Refunds recorded but never sent (a crash between steps 1 and 2) are **counted, not guessed**: there's
no provider id to ask about.

## 3. Why we chose what we chose

| Choice                                         | Why                                                                          | Trade-off                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------- |
| **Split across payments, newest first**        | "Refunds to the original method" (PAY-08); providers refund per transaction. | Several refund rows per booking.          |
| **Ledger at `processed`, not at request**      | "We asked" isn't "they have it".                                             | Refunds payable stays up until confirmed. |
| **Extra refunds owed first, then paid**        | Accounts stay consistent with the same two-step pattern.                     | Two postings.                             |
| **Reconciliation feeds the webhook path**      | One code path for money, deduplicated.                                       | —                                         |
| **Lock refunds while processing**              | Exactly once, not just "the ledger once" (see Gotchas).                      | —                                         |
| **409 PAYMENT_STARTING on a click in the gap** | No second checkout while the first is being set up.                          | The guest clicks again a second later.    |

## 4. Concepts to study

- **Refunds vs reversals vs chargebacks.**
- **Partial refunds and allocation across transactions.**
- **Reconciliation** (comparing your records with the provider's) and **eventual consistency**.
- **Defence in depth:** row locks, idempotency keys and CHECK constraints each catching a different failure.
- **Deterministic concurrency tests:** controlling _when_ an async step finishes (a "gate"), instead
  of hoping a race happens.

## 5. Try it yourself

```bash
pnpm dev
```

As Tunde: book a Heritage Walk at least 3 days away, pay through the simulator, then:

```bash
curl -s -X POST localhost:4000/api/bookings/<id>/cancel -H "$T" -H 'content-type: application/json' -d '{"initiatedBy":"guest","reason":"Change of plans"}'
curl -s -X POST localhost:4000/api/bookings/<id>/refunds -H "$T" -H 'content-type: application/json' -d '{"reason":"Cancelled in time"}'
```

About 1.5 seconds later the simulator "processes" the refund and sends its webhook:
`GET /api/bookings/<id>` shows `refunded`. Then:

1. Pay a different booking and give a ₦5,000 goodwill refund
   (`{"amountKobo":500000,"reason":"Rain delay"}`): the booking stays `paid`.
2. Refund an unmatched receipt: `POST /api/payments/<receipt id>/refund`.
3. Watch `GET /api/ledger/accounts`: Refunds payable rises on cancel and falls back to ₦0 when paid out.

## 6. Gotchas

- **A flaky race test found a double-checkout bug.** "Five clicks at once create ONE payment" failed
  once in about a dozen runs: two checkouts. The booking lock covers only step 1 of `startPayment`,
  and the reuse check skipped attempts **without a checkout URL yet**, so a click arriving while the
  first was still talking to the provider created a second checkout the guest could also pay. Fix:
  in-flight attempts count, and that click gets `409 PAYMENT_STARTING`. I then wrote a
  **deterministic** test with a provider that waits until the test releases it. It fails 3/3 against
  the old rule. **Lesson: a flaky concurrency test is usually telling the truth. Turn it into a
  deterministic one.**
- **I briefly wrote a test that asserted nothing** (placeholder code ending in `void token`). It
  would have "passed" forever. Replaced before running. Read your own tests as critically as the code.
- **Two layers, two jobs.** Without the refund row lock, five copies of `refund.processed` each
  believed they'd processed it. The ledger still showed one payout (its idempotency key held), but the
  booking got five timeline events. The lock makes the _whole_ step happen once.
- **A mutation that didn't happen.** My first attempt to re-break the payment rule matched its
  anchor text twice, so the guard stopped it, and the "passing" runs were the _fixed_ code. Make sure
  the experiment actually ran before trusting its result.
- **Edit scripts that write as they go** can stop halfway. One did (two files changed, three not); the
  rest were then applied with a script that checks every edit before writing anything.

## 7. What's next

**Payments are finished.** The next sessions build screens, so first comes the agreed step:
**flow briefs** in `docs/flows/` for the guest booking and checkout journeys (screens in order, what
each shows and does, the API behind it, the states to design). You design the screens from those;
I build them. Session 11's backend parts (a public catalogue API, deposit rules and reminders, link
previews) don't need designs and can go ahead meanwhile.
