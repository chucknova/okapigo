# Stage 11b: The public checkout

Stage 11a let a guest's browser **read**. This stage lets it **write**: price a basket, hold seats,
create a booking, come back to it, and give the seats back. Paying is stage 11c.

## 1. What we built

| Endpoint                                           | Checkout screen  | What it does                                                                        |
| -------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `POST /public/:operatorSlug/tours/:tourSlug/quote` | 2 (who & extras) | live price, a `blocker` if it can't be booked yet, and seats/stock left on the date |
| `POST /public/:operatorSlug/bookings`              | 3 → 4            | hold seats + create the booking (channel `web`) → returns a **guest token**         |
| `GET /public/bookings/:token`                      | 4 (review)       | the guest's own booking, guest-safe fields only                                     |
| `POST /public/bookings/:token/release`             | 4 (Edit / leave) | gives the seats back; the held booking is cancelled                                 |

Plus your decisions from 2026-11-17, enforced on **every channel** (web, staff, and later
WhatsApp and the OTA):

- **No children or infants without an adult.** An adult is anyone in the tour's adult price
  category (13+ at Ìrìn).
- **Pickup points:** required on tours that have them (Lekki), refused on tours that don't, and
  a **copy** of the chosen point is stored on the booking.

And two pieces of infrastructure: **per-IP rate limits** and **signed guest links**.

New files: `apps/api/src/routes/public-checkout.js`, `apps/api/src/middleware/rate-limit.js`,
`packages/db/src/guest-links.js`, a migration adding `bookings.pickup_point`, and tests
(`public-checkout.test.js`, `rate-limit.integration.test.js`, `guest-links.test.js`).

## 2. How it works

### One engine, many doors

```
staff  POST /api/bookings ─────┐
guest  POST /public/…/bookings ┼─► quotes.quoteForBooking()  price + booking rules (adult)
later  WhatsApp, OTA ──────────┘           │
                                           ▼
                                    createBooking()          row lock, seats, add-on stock,
                                                             pickup point, policy version
```

The public route is thin. It finds the operator by slug, checks that the departure is theirs and
on a **published** tour, then calls the same two functions as the staff route. That's why one
rule change (no children alone) reached every channel at once, and why a test on the **staff**
route proves it.

### Two quote methods

A guest tapping counters might go "+ child" before "+ adult". Refusing to price that would make
the screen flicker with errors. So:

- `quote()` always prices, and adds `blocker: { code: 'ADULT_REQUIRED', message }` when the
  basket can't be booked yet. The screen shows the message and disables **Continue**.
- `quoteForBooking()` is the same, but **refuses** a blocked basket (400). Everything that holds
  seats uses this one.

The rule itself is a pure function in `packages/shared/src/catalogue.js`
(`accompanimentProblem`). "Adult" means a category with no upper age, the same definition as
the "from ₦…" price in 11a. One definition, so the two can't disagree.

### Age vs. counter

Screen 2 counts travellers **by category**; screen 3 asks each traveller's **age**. The price
comes from the age. If they disagree (the "Child" counter, but age 13), the guest would pay a
different price from the one they saw, so the server refuses with
`AGE_CATEGORY_MISMATCH`: _"For age 13, choose Adult (13+), not Child (3–12)."_

### Pickup points are copied

`bookings.pickup_point` holds `{ name, address }` copied from the tour, not a pointer to it. If
Ìrìn later renames "Ikoyi" or changes its address, a guest who booked last week is still told
where **they** were promised. (The same idea as the price snapshot and the pinned cancellation
policy version: a booking records the terms it was sold on.)

### Signed guest links

Guests have no accounts, so a link is their key. The token is
`base64url(booking id) + base64url(HMAC-SHA256(secret, booking id))`, 44 characters.

```
create booking ─► token = id ‖ HMAC(key, id) ─► browser keeps it ─► GET /public/bookings/<token>
                                                                     │ split, recompute HMAC,
                                                                     │ compare in constant time
                                                                     ▼ match → booking id
```

I first stored a hash of a random token (like payment links), then changed it before
committing. The confirmation message (session 14) is sent by a **worker** after payment, long
after the booking was created. With a random token, only its hash would be left by then, and the
link could never be rebuilt. With a signature, any part of the server holding the secret can
rebuild it, and the database stores nothing secret.

A unit test that changes one character at a time found a subtle bug. 16 bytes need 22 base64
characters (132 bits), so the last character carries 4 spare bits that decoding ignores, and two
different strings decoded to the same bytes. The fix rebuilds the one correct token and compares
**whole strings**. Lesson: compare the canonical form, not a decoded one.

### Rate limits

```
key = rl:public-booking:<ip>:<window number>   INCR → first hit also gets EXPIRE … NX
count > limit → 429 Too Many Requests, Retry-After: <seconds>
```

| Limit   | Per IP       | Why this size                                            |
| ------- | ------------ | -------------------------------------------------------- |
| quote   | 120 / minute | every counter tap asks for a price                       |
| booking | 30 / 10 min  | each holds seats for 15 min; enough for a busy shared IP |
| guest   | 120 / minute | reading or releasing your own booking                    |

Counters live in Redis so every API process shares them. If Redis is down the limiter lets
requests through (**fails open**) and logs a warning. A limiter outage shouldn't stop all
checkouts, and the row locks still prevent overselling.

## 3. Why we chose what we chose

| Choice                              | Alternative                  | Why                                                                                              |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| Adult rule in `quoteForBooking`     | in the pricing pipeline      | pricing stays pure maths; a quote for a half-built basket is still useful                        |
| Pickup rule in `createBooking` (db) | in each route                | one place every channel goes through                                                             |
| Signed tokens                       | random token, hash stored    | links can be rebuilt by workers; nothing secret in the DB. Cost: one link can't be revoked alone |
| Fixed-window counter in Redis       | sliding window, token bucket | simplest correct option; a burst at a window edge (2× limit) is harmless at these sizes          |
| Generous limits                     | strict limits                | carrier-grade NAT: one Nigerian mobile IP can be hundreds of real people                         |
| Fail open                           | fail closed                  | a Redis blip shouldn't stop every checkout; holds still expire and never oversell                |

## 4. Concepts to study

- **HMAC** and why `timingSafeEqual` (timing attacks)
- **Canonical encodings** (why two strings can decode to the same bytes)
- **Rate limiting algorithms**: fixed window, sliding window, token bucket
- **Carrier-grade NAT** (CGNAT) and why IP-based limits must be generous
- **Fail open vs fail closed**
- **Snapshotting** data at sale time (price, policy version, pickup point)

## 5. Try it yourself

With `pnpm dev` running, book a Heritage Walk as a guest:

```bash
DEP=$(curl -s localhost:4000/public/irin-lagos-tours/tours/lagos-island-heritage-walk/departures | jq -r '.departures[0].id')
```

```bash
curl -s -X POST localhost:4000/public/irin-lagos-tours/bookings -H 'content-type: application/json' -d "{\"departureId\":\"$DEP\",\"lead\":{\"name\":\"Ada\",\"phone\":\"0803 123 4567\",\"acceptTerms\":true},\"travellers\":[{\"name\":\"Ada\",\"age\":30},{\"name\":\"Obi\",\"age\":7}]}" | jq '{token, ref: .booking.reference, total: .booking.totalKobo, expires: .booking.holdExpiresAt}'
```

Then try:

- the same booking with only Obi (age 7): `ADULT_REQUIRED`
- `GET /public/bookings/<token>`, then change one character of the token: 404
- `POST /public/bookings/<token>/release`, and watch the seats come back on the departures list
- the Lekki tour without `"pickupPoint": "Ikoyi"`: `PICKUP_POINT_REQUIRED`, with the list of
  points

## 6. Gotchas

- **Flaky tests, and what they were really saying.** The full suite sometimes failed with 20 s
  timeouts, always on the **first test of a file**. I measured instead of guessing:
  - one seed takes 0.1 s, and ten seeds in parallel take 0.8 s, so the seed wasn't it
  - database connections peaked at 66 of 100, so that wasn't it either
  - the same test alone took 0.8 s, but 11–24 s when every file started together

  A fresh database client prepares each new query shape the first time it sees it. With 7 test
  files per package starting at once (and two packages hitting Postgres together, on the same
  8-core laptop as Docker), that start-up work starved everything. Capping each package at
  half the CPU cores made the API suite **faster** (59 s → 40 s) and gave four clean full runs in
  a row. More parallelism is not always faster.

- The **workers** test for the nightly schedule job walked every schedule in the database, so
  its run time depended on what other test files had seeded at that moment. It now runs for one
  operator (`extendAllSchedules({ operatorId })`), and "a schedule deleted mid-run is skipped" is
  tested **deterministically**. A Prisma `Proxy` deletes a schedule at exactly the moment between
  listing and syncing, instead of hoping another test does it at the right time.
- `req.ip` is the proxy's address behind a load balancer until Express's `trust proxy` is set.
  That goes in the deployment session (parking lot); otherwise every guest would share one rate
  limit.
- A booking's reference uses the operator's slug: `ILT-…` for Ìrìn, `T-…` for test operators.

## 7. What's next

**Stage 11c:** deposit rules per tour (Badagry's 30%), the balance due date (7 days before the
trip; later bookings pay in full), and `POST /public/bookings/:token/pay` to start a full or
deposit payment through the payments engine from session 10.
