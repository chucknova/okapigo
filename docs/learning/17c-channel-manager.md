# Stage 17c: the channel manager (server side)

| Part    | What                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------- |
| 17a     | OCTO catalogue: supplier, products, units, availability, the calendar; channel keys; contracts |
| 17b     | OCTO bookings: hold, confirm, cancel; the booking's channel and money; no oversell             |
| **17c** | **The channel manager: its API, "via Mock OTA" on bookings, the 60-second push**               |
| 17d     | The mock OTA app and journey 3                                                                 |

The Settings › Channels screen (O11) waits for your design (brief
`docs/flows/08-octo-and-channels.md`). Everything it needs from the server is here now, so
building the screen will be wiring your design to these answers.

## 1. What we built

| Piece                                                | Where                                     |
| ---------------------------------------------------- | ----------------------------------------- |
| The webhook address, the last push, what was told    | migration `20261121220000_channel_push`   |
| What changed since each OTA was last told; telling   | `packages/db/src/channel-sync.js`         |
| The job every 30 seconds; the signed POST            | `apps/workers/src/processors.js`, `index` |
| The channels API (the screen's answers, in words)    | `apps/api/src/routes/channels.js`         |
| What a new or changed channel may say (the contract) | `packages/shared/src/schemas/channels.js` |
| "via Mock OTA", "Paid by Mock OTA", "… owes you"     | `packages/db/src/desk.js`, `board.js`     |

| Endpoint                     | Who            | Does                                                                         |
| ---------------------------- | -------------- | ---------------------------------------------------------------------------- |
| `GET /api/channels`          | owner, manager | each channel in words: tours, this month's sales, what it owes, the push     |
| `GET /api/channels/:id`      | owner, manager | one, with every tour (on it or not, and a note if not on sale), last 10 sold |
| `POST /api/channels`         | owner          | connect one: **its key and signing secret, shown once**                      |
| `PATCH /api/channels/:id`    | owner          | name, commission (new sales only), tours, webhook, switch off                |
| `POST /api/channels/:id/key` | owner          | a new key: the old one stops at once                                         |

## 2. A channel, in words

The screen never does arithmetic. Each channel comes back with its lines ready:

```
Mock OTA · Connected · 20%
5 of 5 tours
1 booking · ₦80,000 this month
₦64,000 owed
Last booking 14:05
Updates sent · last 14:06
```

**What it owes** is worked out the way the ledger records it (17b): each sale's price less its
commission, less each refund less the commission on it, **at the share frozen at the sale**. So
changing a channel from 20% to 25% changes what the next sale owes, never an old one
(`owedBy()`, tested on its own and through real OCTO bookings).

**Keys are shown once.** The key itself is never stored (only its SHA-256, from 17a), so it
can't be shown again: lose it and make a new one. The list shows only its last four characters.

## 3. The push: "a sale anywhere updates every channel within 60 seconds"

OCTO OTAs **ask** for availability when they need it (17a). Many also keep their own copy for
their pages, so we also **tell** them when something changes, at a webhook address they give us:

| Event                 | When                                                               |
| --------------------- | ------------------------------------------------------------------ |
| `availability_update` | a departure's seats or status changed (lines like OCTO's)          |
| `product_update`      | a tour's prices changed, or it went off sale: fetch the tour again |

**How we know what changed.** Seats change in many places (the website, WhatsApp, OCTO, the
office, a hold running out, a departure called off). Instead of adding "tell the OTAs" to
every one of them (and missing one), we keep a **fingerprint** of what each OTA was last told
about each departure and tour, in `channel_sync_states`:

```
departure:<id>   "scheduled|7|12|2026-11-28T08:00:00.000Z"    status, seats left, seats, start
product:<id>     ["published",[["adult",4000000,18,null], …]]  on sale, the prices
```

A job every **30 seconds** works out today's fingerprints for the next 60 days and compares.
Whatever differs is sent; **it's remembered only once the OTA accepted it**, so an OTA that's
down is simply told again on the next run (nothing is lost, nothing queued). 30 seconds leaves
room inside the PRD's 60.

The edges:

- **A tour goes off sale:** `product_update` with `available: false`, and every departure
  CLOSED.
- **A departure is removed** (an empty one deleted from the schedule) or **a tour is taken off
  the channel:** its departures are told CLOSED once, then forgotten.
- **A departure in the past** is just forgotten (nothing to tell).
- **An OTA refuses or doesn't answer:** the run stops for that channel (in order: the next run
  starts from there), keeps the reason in words, and the others carry on. The screen says
  "Updates aren't reaching it: it answered 503. Trying again every 30 seconds."

## 4. Signed, so the OTA knows it's us

Every POST carries `Octo-Webhook-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is
HMAC-SHA256 of `"<t>.<the exact body>"` with the channel's **signing secret**. The OTA works
out the same and compares; the time inside the signed text stops someone replaying an old
message later.

The secret is **derived**, not stored: `HMAC(AUTH_SECRET, "channel-webhook:" + channelId)`. So
there's nothing new in the database to leak, and each channel's is different.

## 5. Never a door into our own network

A webhook address is somewhere **our server** sends requests. If anyone could set it to
`http://localhost:5432` or `http://169.254.169.254/` (where cloud machines keep their
secrets), our own server would knock on its own doors (called **SSRF**). In production,
`checkWebhookUrl()` allows only `https://` to a public host: no localhost, no private networks
(10.x, 172.16–31.x, 192.168.x), no 169.254.x, no `.internal`, no raw IPv6. In development,
`http://localhost` is fine (the mock OTA will live there). The sender also **never follows a
redirect** (a public address could otherwise bounce us somewhere private) and gives up after 5
seconds.

## 6. "via Mock OTA"

An OTA booking now says where it came from everywhere staff look:

| Where                 | Says                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| the bookings desk row | `… · via Mock OTA`                                                        |
| the booking's page    | `ILT-… · MOCK OTA · …`; `Paid by Mock OTA`; the timeline's                |
|                       | `booked through Mock OTA`; `Mock OTA owes you ₦64,000 (₦80,000 less 20%)` |
| the departure's list  | `via Mock OTA` under the lead's name; `Paid by Mock OTA`                  |

## 7. Tests

- `apps/api/test/channels.test.js` (15): the seeded channel's lines; who may look and change;
  a sale, a hold, last month's sale and a half refund (sales, owed); one channel's tours and bookings; another business's
  channel is a 404; connect (key shown once, never stored, works with OCTO); refusals (a name
  taken, someone else's tour, bad commissions, a bad address); change (tours, commission only
  for new sales, webhook cleared, switched off: key refused); a new key; the address rule;
  `owedBy`; "via Mock OTA" on the desk, the booking's page and the departure; the push (first
  time everything, then nothing, a hold, a price change, called off, removed and forgotten;
  off sale; taken off the channel; an OTA that's down then back; switched off; the signature).
- `apps/workers/test/push-channels.test.js` (2): the real job with a pretend `fetch`: the POST,
  the headers, **the signature checked the way an OTA would**; the words for a 503, a timeout
  and an unreachable address.
- Mutation checks: 41 changes, 8 survived at first. Six got tests: a hold that isn't confirmed
  isn't a sale; a sale from last month isn't this month's but is still owed; a new webhook
  clears the last one's error; one channel's page lists only its own bookings; a full departure
  is "not available"; a departure now in the past is forgotten without telling; and the desk's
  "owes you" after a half refund (₦32,000 of ₦40,000). Two pointed at code that did nothing
  extra (a "confirmed only" filter that the month check already does, and a "forget removed
  tours" rule the general "forget what isn't being closed" already covers): both were removed.
- No screen in this part (Settings › Channels waits for your design); the tests call the real
  API, with the database.
