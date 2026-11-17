# Stage 10a: The double-entry ledger

**PRD coverage:** **PAY-22**: every payment, fee, refund and adjustment written as balanced
entries with a running balance; idempotent; exportable. Plus the NFR "double-entry, append-only
ledger … a nightly check that every account balances".

Session 10 (payments) is split into five stages: **10a ledger** → 10b payments + Paystack
adapter → 10c webhooks → 10d transfers + payment links → 10e refunds. The ledger comes first
because every later stage writes to it.

**Done when:** the database itself refuses unbalanced or edited ledger rows; postings are
idempotent even under races; balances, statements, checks and CSV export work. ✅ 384 tests.

---

## 1. What we built

```
packages/shared/src/
├── ledger.js              chart of accounts, POSTING RULES, assertBalanced, reverseLines
├── money.js               + koboToDecimal (for CSV: "50000.00")
└── schemas/ledger.js      adjustments, reversals, date ranges

packages/db/
├── prisma/…_add_ledger/   3 tables + deferred balance trigger + append-only trigger + backfill
├── src/ledger.js          postTransaction, reverseTransaction, accountBalances,
│                          accountStatement, verifyLedger, exportLedgerCsv
├── src/operators.js       new operators get their 7 accounts
└── src/cancellations.js   cancellations / no-shows now post "refund owed"

apps/workers               + verify-ledger, nightly at 03:00 Lagos
apps/api/src/routes/ledger.js   7 endpoints (payments: view / edit)
```

### The chart of accounts

| Code | Account              | Type           | Increases with |
| ---- | -------------------- | -------------- | -------------- |
| 1100 | Paystack clearing    | asset          | debit          |
| 2100 | Refunds payable      | liability      | credit         |
| 2200 | Unallocated receipts | liability      | credit         |
| 4000 | Tour sales           | revenue        | credit         |
| 4100 | Sales refunds        | contra-revenue | debit          |
| 5100 | Payment fees         | expense        | debit          |
| 5900 | Adjustments          | expense        | debit          |

### The posting rules (`POSTINGS` in shared)

| Event                      | Debit                            | Credit               |
| -------------------------- | -------------------------------- | -------------------- |
| Guest paid                 | Paystack clearing                | Tour sales           |
| Paystack fee               | Payment fees                     | Paystack clearing    |
| Refund owed (cancellation) | Sales refunds                    | Refunds payable      |
| Refund paid out            | Refunds payable                  | Paystack clearing    |
| Unmatched transfer         | Paystack clearing                | Unallocated receipts |
| Transfer matched           | Unallocated receipts             | Tour sales           |
| Adjustment                 | the chosen account ↔ Adjustments |                      |

A worked story (it's a test): paid ₦50,000, fee ₦750, cancelled with ₦25,000 owed, refund paid:
Paystack clearing **₦24,250**, Tour sales ₦50,000, Sales refunds ₦25,000, Fees ₦750, Refunds
payable **₦0** (owed, then paid).

## 2. How it works

### Three guarantees, enforced by the database

**1. Balanced or nothing: a _deferred constraint trigger_.**
A normal trigger fires after each row, but a transaction's first entry is always unbalanced on
its own. `DEFERRABLE INITIALLY DEFERRED` moves the check to **COMMIT**, when all entries are in:

```sql
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_transaction_balanced();
```

Tested with raw SQL that bypasses our code: debits 10,000 / credits 9,000 → the whole commit
fails and **nothing** is saved; a single-entry transaction fails too.

**2. Append-only.** `BEFORE UPDATE OR DELETE` triggers raise an error. The single exception:
deleting a whole operator (sandbox cleanup). By the time the cascade reaches the ledger, the
operator row is already gone, and that's how the trigger recognises it. Corrections are
**reversals**: a new transaction with every debit and credit swapped, linked to the original
(`reverses_id`, unique, so each can be reversed once).

**3. Idempotent posting.** Every transaction has a key (`refund-owed:<booking>`,
`adjustment:<client key>`). The insert is

```sql
INSERT INTO ledger_transactions (...) VALUES (...)
ON CONFLICT (operator_id, idempotency_key) DO NOTHING
RETURNING id
```

**Why not "check, then insert"?** I tested it (the mutation check): with 10 copies posted at
once, 2 runs in 3 crashed with `Unique constraint failed`. In PostgreSQL an error **aborts the
whole surrounding transaction**, which would take a booking cancellation down with it.
`ON CONFLICT DO NOTHING` makes the second insert wait for the first and then quietly do nothing.

### Running balances without storing them

```sql
SUM(sign * (debit_kobo - credit_kobo)) OVER (ORDER BY created_at, id) AS running_balance
```

A **window function**: for each row, add up this row and every earlier one. Nothing is stored,
so concurrent postings never fight over a "current balance" row. The window runs over _all_
rows before the date filter, so a statement from mid-month still opens with the right balance.

### Keeping SQL and JavaScript in sync

The migration's backfill has its own copy of the account list (SQL can't import JavaScript). A
test parses the migration file and compares it with `ACCOUNTS`, so the two can't drift.

### Already wired in

- **Cancellations and no-shows** that owe money post _refund owed_, in the same transaction.
  The books show the debt to the guest until stage 10e pays it out.
- **Nightly check** (03:00 Lagos): books balanced per operator, every transaction balanced;
  warnings for suspicious states (e.g. clearing negative = paid out more than came in). The
  job fails loudly on an error so it shows on the jobs dashboard.

## 3. Why we chose what we chose

| Choice                                            | Why                                                                                | Trade-off                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Guarantees in the database**                    | A bug, a script or a person in psql can't unbalance or rewrite the books.          | Triggers are less visible than code, so they're documented here and tested with raw SQL. |
| **Revenue at payment, refunds as contra-revenue** | Simple, honest; the original sale stays visible.                                   | True accrual (deferred revenue until the tour runs) is a v1 refinement.                  |
| **Refunds payable as a liability**                | Shows what we _owe_ guests between cancellation and payout.                        | One more posting per refund.                                                             |
| **Computed running balances**                     | No contention, never out of date.                                                  | Slightly heavier reads (fine at our scale).                                              |
| **Idempotency-Key header on adjustments**         | Retries on bad connections don't double-post.                                      | Clients should send one.                                                                 |
| **CSV in naira decimals, formulas defused**       | Accountants' spreadsheets; a description starting with `=` can't run as a formula. | —                                                                                        |

## 4. Concepts to study

- **Double-entry bookkeeping**: debits, credits, normal balances, the accounting equation
  (_Assets = Liabilities + Equity + (Revenue − Expenses)_), contra accounts.
- **Deferred constraints** and **constraint triggers** in PostgreSQL.
- **Append-only / immutable ledgers**; reversals instead of edits.
- **Idempotency keys** (Stripe and Paystack both use them).
- **`INSERT … ON CONFLICT`** ("upsert"), and why errors abort PostgreSQL transactions.
- **Window functions** (`SUM(...) OVER (ORDER BY ...)`).
- **CSV injection.**

## 5. Try it yourself

No reset needed: the migration gave your Ìrìn its accounts. With `pnpm dev` running, sign in as
Tunde (manager) and:

```bash
T='Authorization: Bearer <token>'
curl -s localhost:4000/api/ledger/accounts -H "$T" | python3 -m json.tool
curl -s -X POST localhost:4000/api/ledger/adjustments -H "$T" -H 'content-type: application/json' \
  -H 'Idempotency-Key: my-first-adjustment' \
  -d '{"account":"PROVIDER_CLEARING","direction":"debit","amountKobo":1000000,"reason":"Practice entry"}'
```

Send the same command again: 200 instead of 201, same transaction, balance unchanged. Then:

1. Reverse it: `POST /api/ledger/transactions/<id>/reverse` with `{"reason":"Practice over"}`.
2. Read the statement: `GET /api/ledger/accounts/PROVIDER_CLEARING/statement`.
3. Download `GET /api/ledger/export.csv` and open it in a spreadsheet.
4. **Attack the books** in psql: `UPDATE ledger_entries SET debit_kobo = 1;`, then
   `DELETE FROM ledger_transactions;`. Both are refused.
5. Cancel a paid booking (see note 09) and find its _refund owed_ transaction in
   `GET /api/ledger/transactions?bookingId=<id>`.

## 6. Gotchas

- **Asserting edits pays off.** My edit scripts now stop if the text isn't found. One stopped
  halfway through this stage (Prettier had reformatted the target), and because the script writes
  only at the end, **nothing was half-applied**. Compare session 9, where a silent no-op hid
  a real bug.
- **Balanced isn't the same as correct.** Flipping the fee posting's direction is still
  balanced, so the "any sequence balances" test can't see it. The worked-story test, with
  expected balances, is what caught it.
- **Ties again.** Both entries of one transaction share a timestamp, so their order in the CSV
  depends on random ids. My first CSV test assumed an order and failed about 1 run in 3. It now
  looks rows up by content. (Same lesson as session 4: never rely on the order of tied rows.)
- **Express omits quotes** around simple filenames (`filename=ledger-….csv`); valid HTTP, and the
  test accepts both forms.
- **Payments don't post yet.** Only refunds _owed_ are recorded. _Payment received_ and _fees_
  arrive with webhooks in 10c, and _refund paid_ in 10e.

## 7. What's next: stage 10b

**Payments and the Paystack adapter.** A `payments` table with its own small state machine; a
**provider adapter** interface with two implementations (a **simulator** for tests and offline
demos, and **Paystack test mode**); starting a card payment for a held booking; and the startup
guard that **refuses a live Paystack key**. You'll add your Paystack _test_ keys to `.env`; I'll
show you exactly where, and they never go in chat or in git.
