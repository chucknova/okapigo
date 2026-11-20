# Stage 16c-2: The money at the bookings desk

Part 2 of the bookings desk (O8): everything about money the office does from a booking's
page. Part 1 (16c-1) found and showed bookings; part 3 (16c-3) changes travellers.

## 1. What we built

| On the page                                                              | What happens                                                               | Where                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Send payment link** (Balance or Other; 7 days, 2 days, 24 hours)       | a link, sent by WhatsApp and email (or **copied** instead, sent to nobody) | `POST /api/bookings/:id/payment-links` (10d), `send: false` to copy |
| **Cancel booking**: the policy's refund, or another amount with a reason | cancelled, and the refund **started at once**                              | `POST /api/bookings/:id/cancel` with `startRefund: true`            |
| **Confirm ₦45,500 received**                                             | the guide's cash becomes a real payment; the balance closes                | `POST /api/cash-reports/:id/confirm`                                |
| **Received a different amount**                                          | that much is paid; the rest is still owed                                  | the same, with `amountKobo`                                         |
| **Not received**                                                         | still owed; the owner is alerted (on Today)                                | `POST /api/cash-reports/:id/not-received`                           |
| **Try the refund again** / **Send the refund**                           | the refund through Paystack again                                          | `POST /api/bookings/:id/refunds` (10e)                              |
| **I refunded by bank transfer** (amount, date sent, reference)           | recorded; the guest is told "Refund sent"                                  | `POST /api/bookings/:id/refunds/bank-transfer`                      |

The rules live in `packages/db/src/desk-money.js` (`confirmCash`, `cashNotReceived`,
`recordBankRefund`); the words in `desk.js` (`policyWords`, `tripIn`, the "act note") and
`apps/operator/src/lib/desk.js`; the sheets in `screens/Bookings.jsx`.

## 2. Two new ledger accounts

Until now the books knew one place money sits: **Paystack clearing** (money Paystack holds for
the business). Cash in a guide's pocket, and money the business sends from its own bank, are
somewhere else, so they get their own accounts:

| Code | Account | What                            | Entry                                            |
| ---- | ------- | ------------------------------- | ------------------------------------------------ |
| 1000 | Cash    | cash guides handed in           | cash confirmed: Dr Cash / Cr Tour sales          |
| 1200 | Bank    | the business's own bank account | refund by transfer: Dr Refunds payable / Cr Bank |

A new business gets them in code (`ACCOUNTS`); existing ones got them in the migration
`20261121090000_cash_and_bank`. A test checks the code and the migrations list the same
accounts.

## 3. Cash becomes a payment

When the office confirms, the cash is recorded like any payment (provider `cash`, method
`cash`), and then the **same** `settleBooking()` a card payment goes through decides what it
means: the balance closes (paid), or part of it does, or, if the guest had also paid by link
(a "possible double"), the cash is **owed back** and the booking shows "Refund to send".

A cash payment has no Paystack transaction, so Paystack refunds skip it. The page knows how
much could go back by card (`byCardKobo`): if part was paid in cash, **Try the refund again**
isn't offered, only **I refunded by bank transfer**.

## 4. A refund sent by bank transfer

Recorded as processed refunds (split across the payments, like any refund), with the transfer's
reference. What happens next is shared with a Paystack refund that went through:
`processRefundInTx()` (split out of `markRefundProcessed`) writes the ledger (from the Bank,
not Paystack), tells the guest "Refund sent", and marks the booking refunded once everything
owed is back. It refuses more than is owed back, and a date in the future.

## 5. Cancelling, in words

The sheet says what the policy gives back and why: "₦12,500 50%, because it's 24–48 hours
before", "nothing back: the trip has started", and, for a deposit booking, "nothing back: the
₦19,500 deposit isn't refundable" (the browser check caught it first saying "₦0 full refund").
Another amount needs a reason, which goes on the timeline. The button says the result: "Cancel
and refund ₦31,250".

Under the actions, one line says what cancelling now would mean: "Cancelling now: the ₦19,500
deposit isn't refunded (deposits are non-refundable)."

## 6. Database rules that needed widening

Four migrations, because each rule was found by a test (and an applied migration is never
edited, only followed by another):

| Migration                          | Allows                                         |
| ---------------------------------- | ---------------------------------------------- |
| `…090000_cash_and_bank`            | payments by `cash`; the Cash and Bank accounts |
| `…090100_cash_received_type`       | the ledger transaction type `cash_received`    |
| `…090200_cash_not_received_alert`  | the staff alert `cash_not_received`            |
| `…090300_cash_not_received_status` | a cash report's status `not_received`          |

## 7. Tests

- `apps/api/test/desk-money.test.js` (11): cash confirmed, a different amount, a possible
  double, not received (and Today), a guide refused; a bank-transfer refund after a failed card
  refund (too much, a future date, the ledger, refunded); cancelling with the policy, without
  starting the refund, another amount, a deposit; the words.
- `apps/operator/test/desk.test.jsx` (+7): the words; cash; a payment link (sent, copied);
  cancelling; a failed refund; part paid in cash.
- `packages/db/test/ledger.test.js`: both migrations against the accounts.
- Mutation checks: 29 changes; 2 survived at first (cancelling without "start the refund"; cash
  not refundable by card) and got tests.
