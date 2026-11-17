# Stage 10c: Webhooks and settlement

**PRD coverage:** **PAY-02** completed ("payment state changes only from verified webhooks"),
**PAY-22** wired to real payments ("webhook handling is idempotent"), and the testing strategy's
"Paystack webhook handling with recorded fixtures, including duplicate and out-of-order events".

**Done when:** a signed `charge.success` marks the payment succeeded, moves the booking
`held → paid` (seats held → sold) and writes the ledger, exactly once, whatever the
duplicates, races or delays. ✅ 459 tests, plus a real run: API + workers + Redis + simulator,
booking `held → paid` about 2 seconds after clicking "Pay".

---

## 1. What we built

```
packages/payments/src/
├── webhooks.js            computeSignature, signatureMatches (HMAC-SHA512), parseWebhook
├── paystack.js            + verifyWebhookSignature (keyed with your secret key)
├── simulator.js           state in a STORE (Redis for the apps, a Map for tests); signed
│                          Paystack-shaped webhooks; sendWebhook()
└── test/fixtures/         a charge.success event in Paystack's documented shape

packages/db/
├── …_add_webhook_events/  webhook_events (+ payments.channel, payments.review_reason)
├── src/webhooks.js        recordWebhookEvent: store once (ON CONFLICT DO NOTHING)
└── src/settlement.js      processWebhookEvent, settleBooking, sweepWebhookEvents

packages/jobs              + "webhooks" queue: process-webhook, sweep-webhooks
apps/workers               processes webhooks; sweeps every minute
apps/api/src/routes/
├── webhooks.js            POST /webhooks/paystack (raw body, before the JSON parser)
└── payments.js            simulator checkout with working Pay / Decline buttons
```

## 2. How it works

### From click to "paid"

```
Guest clicks Pay ──► provider ──POST /webhooks/paystack (signed)──► API
                                                                 1. signature OK? else 401
                                                                 2. store once (dupes → 200)
                                                                 3. queue job, answer 200
workers ◄── Redis queue ◄────────────────────────────────────────────┘
  4. ask the provider: really succeeded? same amount and currency?
  5. ONE transaction, payment row LOCKED:
       payment → succeeded (fee, channel, paid at)
       ledger  → Dr Paystack clearing / Cr Tour sales;  Dr Payment fees / Cr Paystack clearing
       booking → amount paid +n;  held → paid (hold converted: seats held → sold)
```

### 1. The signature, over the raw body

`x-paystack-signature = HMAC-SHA512(secret key, exact request bytes)`. We compute the same and
compare in constant time. Tested: a forged signature fails; a body with one changed digit
(₦50,000 → ₦90,000) fails; **the same JSON re-serialised with different spacing also fails.**
That last one is why the webhook route is mounted **before** `express.json()` and reads the body
with `express.raw()`: once JSON is parsed, the original bytes are gone.

### 2. Store once, answer fast

Paystack retries until it gets a 200, so one event can arrive many times. Paystack events
have no event id, so ours is `"<event type>:<transaction id>"`, stored with
`INSERT … ON CONFLICT DO NOTHING` (the race-proof trick from 10a). Duplicates get `200 {duplicate:
true}` ("we have it, stop retrying") and aren't queued again. The route does nothing slow; the
real work is a background job with exponential-backoff retries.

### 3. Re-check with the source

The signature proves _who_ sent it; asking `verifyTransaction` confirms the **current** status,
amount and currency (Paystack recommends this). A mismatch is never settled automatically:
the event goes to `needs_review`. The call happens **outside** any database transaction.

### 4. Exactly once: the payment row lock

Processing locks the payment (`SELECT … FOR UPDATE`). A second worker waits, then sees
`succeeded` and stops (`ALREADY_SETTLED`). The ledger keys (`payment-received:<payment>`,
`payment-fee:<payment>`) are a second safety net. **Tested by removing the lock:** five workers
recorded one ₦50,000 payment **five times: ₦250,000 "paid"**. With the lock: once.

### 5. Settling the booking: every case

| Booking was…                                                      | What happens                                                | Review?                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| `held`, hold still valid                                          | hold converted (seats held → sold), `paid` / `part_paid`    | no                                 |
| `held`, hold **expired** (job not yet run)                        | hold expired now, booking `cancelled`, **full refund owed** | `HOLD_EXPIRED_BEFORE_PAYMENT`      |
| `cancelled` already                                               | money recorded, **full refund owed**                        | `BOOKING_CANCELLED_BEFORE_PAYMENT` |
| `confirmed` / `part_paid` (staff confirmed "pay later" meanwhile) | `paid` / `part_paid`, seats **not** sold twice              | no                                 |
| more than owed                                                    | owed part settled, **excess owed back**                     | `OVERPAID`                         |
| completed, refunded, already paid…                                | refund owed                                                 | `NOTHING_OWED`                     |

**Late money never takes seats back.** The guest's seats may have been resold since their hold
expired; forcing them back is exactly how overselling happens. The money is recorded honestly
(it _did_ arrive), owed back in full (`refund owed` → paid out in 10e), and flagged. Staff may
rebook the guest by hand if seats are free.

### 6. Nothing lost

If queueing fails, the event is still stored and the **webhook sweeper** (every minute) processes
anything left `received`. After 10 failed attempts an event becomes `failed`, for a human to look
at, instead of being retried forever.

### The simulator, now realistic

Its "transactions" live in **Redis** so the API (which creates them) and the workers (which
re-check them) see the same thing. Its checkout page has **Pay** (marks paid, sends a signed
`charge.success` to our own `/webhooks/paystack`, redirects back) and **Decline** (no webhook,
like Paystack). You can now demo a full payment with no account and no tunnel.

## 3. Why we chose what we chose

| Choice                                | Why                                                             | Trade-off                                |
| ------------------------------------- | --------------------------------------------------------------- | ---------------------------------------- |
| **Store, then process in a job**      | Fast 200s, retries, nothing lost on a crash.                    | Settlement takes a second or two (fine). |
| **Re-verify with the provider**       | Belt and braces; catches amount/currency surprises.             | One extra API call per payment.          |
| **Lock the payment row**              | Exactly-once under concurrent deliveries.                       | —                                        |
| **Late money → refund owed + review** | Never oversells; never loses track of money.                    | A human decides about rebooking.         |
| **Sweeper + max attempts**            | Self-healing, but stops hiding real problems.                   | Events can wait up to a minute.          |
| **Simulator state in Redis**          | Two processes must agree.                                       | Simulator data expires after 7 days.     |
| **No IP allowlist (yet)**             | Signatures already prove origin; IP lists break behind proxies. | Parked as extra hardening.               |

## 4. Concepts to study

- **Webhooks** vs polling; **at-least-once delivery** and why consumers must be idempotent.
- **HMAC** (keyed hashing) and **why signatures need the raw bytes**.
- **The inbox pattern**: store incoming messages first, then process.
- **Exponential backoff** and **dead-letter** handling (our `failed` status).
- **Express middleware order** (raw body before JSON parsing).
- **HTTP 303 See Other** after a form POST.

## 5. Try it yourself

```bash
pnpm dev     # API + workers, with PAYMENT_PROVIDER=simulator
```

As Tunde (manager): create a booking, start a payment (`POST /api/bookings/<id>/payments`), open
the `authorizationUrl` in your browser and click **Pay**. Within a couple of seconds
`GET /api/bookings/<id>` shows `paid`, with the payment's fee, and `GET /api/ledger/accounts`
shows the money in _Paystack clearing_ and _Tour sales_.

Then:

1. **Late money:** set `hold_minutes = 1` (psql), book, wait over a minute, then pay. The booking
   is `cancelled`, `refundDueKobo` equals the payment, and the payment has a `reviewReason`.
2. **Forge a webhook:**
   ```bash
   curl -i -X POST localhost:4000/webhooks/paystack -H 'x-paystack-signature: abc' -d '{"event":"charge.success"}'
   ```
   → 401.
3. **Watch the queue:** `docker compose exec redis redis-cli --scan --pattern 'bull:webhooks:*'`
4. **Real Paystack** (optional): Paystack must reach your laptop. Install
   [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/),
   run `cloudflared tunnel --url http://localhost:4000`, paste the `https://….trycloudflare.com`
   URL + `/webhooks/paystack` into Paystack → Settings → API Keys & Webhooks → **Test Webhook URL**,
   set `PAYMENT_PROVIDER=paystack` and `API_PUBLIC_URL=<that https URL>`, restart, and pay with a
   [Paystack test card](https://paystack.com/docs/payments/test-payments/).

## 6. Gotchas

- **Test data that belongs to no business leaks.** Two tests used _fixed_ transaction ids. Webhook
  events aren't tied to an operator, so cleanup didn't delete them, and the next run's deliveries
  were "duplicates". They only failed from the second run on. Fixed with unique ids, plus cleanup of
  each test's webhook events, plus the global setup now removing stale ones. (I also cleared 90 +
  45 leftover events and 34 orphaned test operators from your local database.)
- **A cleanup that throws fails every test** in the file. `afterEach` errors show up on each test,
  which looks scarier than it is: read the first error.
- **`Payment` has no `operator` relation**, only `operatorId`, so Prisma refused
  `where: { operator: … }`.
- **This time the stray-process lesson held:** the end-to-end run stopped both processes by their
  exact process IDs (session 8's stray worker swept test holds for 40 minutes).
- **The real end-to-end run left one booking** (`E2E Test Guest`) in your local database.
  `pnpm db:reset` clears it.

## 7. What's next: stage 10d

**Bank transfers and payment links (PAY-03, PAY-05).** Pay-with-transfer through Paystack (a
temporary account number per payment), automatic matching to the booking, and a **manual match**
screen API for transfers that can't be matched (the `Unallocated receipts` account from 10a).
Then **payment links** for any amount on any booking, which also unlocks paying deposits and
**balances** on `confirmed` / `part_paid` bookings.
