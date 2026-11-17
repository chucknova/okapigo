# Stage 10b: Payments and the Paystack adapter

**PRD coverage:** the start of **PAY-02** (card payments through Paystack test mode, card data
never touching OkapiGo), the PRD's **adapter rule** ("a simulator and a real sandbox are
interchangeable"), and the **key-safety rule** ("the app refuses to start if a live Paystack key
is set").

**Done when:** a held booking can start a card payment through the simulator or Paystack test
mode, recorded before the provider is called; double clicks can't create two checkouts; live
keys are refused. ✅ 431 tests. The real Paystack round trip runs with
`pnpm --filter @okapigo/payments smoke` once your test keys are in `.env`.

---

## 1. What we built

```
packages/payments/                 NEW: payment providers behind one interface
├── src/provider.js                the interface (JSDoc), ProviderError, LiveKeyError
├── src/simulator.js               in-memory "Paystack": tests, CI, offline demos
├── src/paystack.js                the real Paystack API, TEST mode only
├── src/index.js                   createPaymentProvider(config)
├── scripts/smoke-paystack.js      one real round trip to Paystack's test API
└── test/adapters.test.js          21 tests with a fake fetch (no network)

packages/shared/src/payment-status.js   payment lifecycle + OKG-… references
packages/db/
├── …_add_payments/                payments table (+ ledger_entries.payment_id)
└── src/payments.js                startPayment()

apps/api/src/
├── config.js                      PAYMENT_PROVIDER, Paystack keys (LIVE KEYS REFUSED)
├── routes/payments.js             start/list payments; callback + simulator pages
└── server.js                      picks the provider from config
```

### Endpoints

| Endpoint                             | Who                    | What                                                 |
| ------------------------------------ | ---------------------- | ---------------------------------------------------- |
| `POST /api/bookings/:id/payments`    | bookings: edit         | start a card payment → `authorizationUrl`            |
| `GET /api/bookings/:id/payments`     | bookings: view         | the booking's payment attempts                       |
| `GET /payments/callback?reference=`  | public                 | "we're confirming your payment"; **changes nothing** |
| `GET /simulator/checkout/:reference` | public, simulator only | stand-in for Paystack's page                         |

## 2. How it works

### One interface, two providers

```
             startPayment()  ──►  provider.initializeTransaction()
                                         │
               ┌─────────────────────────┴──────────────────────────┐
     simulator.js (Map in memory)                      paystack.js (fetch → api.paystack.co)
     PAYMENT_PROVIDER=simulator                        PAYMENT_PROVIDER=paystack
```

Switching is a config change. OkapiGo's code never knows which one it's talking to.

### A payment's lifecycle

```
initiated ──► succeeded     (ONLY a verified webhook does this, stage 10c)
    ├──────► failed
    └──────► abandoned ──► succeeded   (a late completion is still possible)
```

### startPayment: three steps, on purpose

1. **Short transaction:** lock the booking row (`FOR UPDATE`), check it's payable (held, hold
   still active, something owed), **reuse** an open checkout if one exists, otherwise
   **record** the payment (`initiated`, our reference `OKG-…`).
2. **No transaction:** call the provider. Paystack can take seconds; holding a database
   transaction open across a network call would keep the booking locked and a connection busy.
3. **Short update:** save the checkout URL, or mark the attempt `failed` with the reason.

**Record first, call second.** Every Paystack transaction has a local record, even if we crash
right after Paystack answers or its webhook beats our response.

**Lock the booking.** Tested by removing the lock: five simultaneous "Pay" clicks produced
**2–3 separate checkouts**, each payable, which risks charging the guest twice. With the lock: one.

### The return page proves nothing

After paying, Paystack sends the guest's browser to `/payments/callback?reference=…`. Anyone
can type that URL, so the page only **displays** a message. Nothing changes until Paystack's
**signed webhook** arrives (stage 10c). Tested: the simulator says "paid", the guest lands on
the page, and the payment is still `initiated` and the booking still `held`.

The page also **escapes** everything it shows. Without that, a link containing
`<script>…</script>` would run an attacker's script on our page (**XSS**). Tested.

### Live keys: refused twice

1. **At startup** (`apps/api/src/config.js`): `sk_live_…` or `pk_live_…` → the API won't start,
   and says why. Proven by actually starting the server with a fake live key: exit code 1.
2. **In the adapter** (`createPaystackProvider`): throws `LiveKeyError`, so no other code path
   can create a live client either.

The secret key is sent only in the `Authorization` header, never logged, and never in error
messages (tested). Requests time out after 10 s.

### Testing Paystack without Paystack

`createPaystackProvider({ secretKey, fetch })` takes `fetch` as a parameter. Tests pass a
**fake fetch** that records the request (URL, method, headers, body) and returns realistic
replies, covering success, refusal, 404, 5xx/429, an HTML error page, and a timeout, all
offline, in milliseconds.

## 3. Why we chose what we chose

| Choice                                      | Why                                                        | Trade-off                                                           |
| ------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| **Adapter interface + simulator**           | PRD rule; CI and demos never depend on Paystack being up.  | The simulator must stay faithful (tests compare behaviours).        |
| **Our own reference (`OKG-…`)**             | Generated before the call; the key to idempotency in 10c.  | —                                                                   |
| **Record intent first**                     | No "orphan" Paystack transactions.                         | Failed attempts remain as rows (useful history).                    |
| **No DB transaction across HTTP**           | Locks and connections aren't held for seconds.             | Three steps instead of one.                                         |
| **502 when the provider fails**             | "Bad Gateway": we're fine, the service we depend on isn't. | —                                                                   |
| **Placeholder email for phone-only guests** | Paystack requires one; `.example` can never receive mail.  | Those guests get no Paystack receipt (we send our own, session 13). |
| **Smoke script, not a CI test**             | Real API calls need secrets and network; CI has neither.   | You run it by hand once.                                            |

## 4. Concepts to study

- **Adapter / ports-and-adapters pattern** (hexagonal architecture).
- **Hosted checkout**: why card data never touches our servers (PCI DSS scope).
- **Never trust the redirect**: webhooks vs return URLs.
- **Long transactions and network calls**: why to keep them apart.
- **HTTP status codes for dependencies**: 502 vs 503 vs 504.
- **Timeouts with `AbortSignal.timeout()`.**
- **XSS and output escaping.**
- **Secrets hygiene**: env vars, `.gitignore`, never logging keys.

## 5. Try it yourself

**With the simulator** (no account needed):

```bash
pnpm dev
```

As Tunde (manager), create a booking (note 08), then:

```bash
curl -s -X POST localhost:4000/api/bookings/<id>/payments -H "$T" -H 'content-type: application/json' -d '{}'
```

Open the `authorizationUrl` it returns in a browser: the simulated checkout page. Run the same
command again and you get `"reused": true`.

**With real Paystack test mode:**

1. Paystack dashboard → **Settings → API Keys & Webhooks**, with **Test Mode** on. Copy the
   _test_ secret key (`sk_test_…`) and public key (`pk_test_…`) into `.env`:
   `PAYSTACK_SECRET_KEY=sk_test_…` and `PAYSTACK_PUBLIC_KEY=pk_test_…`.
2. Run the smoke test:
   ```bash
   pnpm --filter @okapigo/payments smoke
   ```
   You should see `1. initialize ✓` with a `checkout.paystack.com` link and `2. verify ✓`.
3. Optional: set `PAYMENT_PROVIDER=paystack`, restart `pnpm dev`, start a payment for a booking,
   and open its `authorizationUrl`: Paystack's real test checkout. Paying there won't confirm the
   booking yet; that's webhooks, in 10c.
4. Try `PAYSTACK_SECRET_KEY=sk_live_x pnpm dev` and watch it refuse to start.

## 6. Gotchas

- **`timeout` doesn't exist on macOS.** My first "start with a live key" check returned exit
  code 127 (_command not found_), so it never ran. A run that "didn't fail" isn't a run that
  passed: always read the exit code.
- **pnpm hides a script's own output** when the script exits with an error. Run the script
  directly (`node scripts/smoke-paystack.js`) to read its message.
- **A live key fails two rules** (it's live, _and_ it isn't a test key), so the startup error
  lists the field twice. Both statements are true.
- **Webhooks need a public URL.** Paystack can't reach `localhost`. Tests won't need one (they
  replay recorded webhooks), but for a real end-to-end payment in 10c you'll use a tunnel.

## 7. What's next: stage 10c

**Webhooks.** Paystack's signed `charge.success` events: verify the **HMAC-SHA512 signature over
the raw body**, store each event exactly once, process it in a background job, and then mark the
payment succeeded, move the booking `held → paid` (converting the hold), and post _payment
received_ and _Paystack fee_ to the ledger, idempotently, even when Paystack sends the same event
twice or out of order. Plus the hard case: **money arrives after the hold expired** (the seats
may be gone), which goes to staff review instead of overselling. The simulator gains "Pay" /
"Decline" buttons that send real-shaped webhooks.
