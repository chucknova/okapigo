# Stage 17c-2: Settings › Channels, as designed

| Part      | What                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------- |
| 17c       | The channel manager's server side: its API, "via" on bookings, the 60-second push              |
| **17c-2** | **Settings › Channels (O11): the screen; OCTO notifications; payments from the OTA; Sojourna** |
| 17c-3     | "via Sojourna" everywhere else: the bookings filter, the booking page, the manifest, schedule  |
| 17d       | Sojourna, the mock OTA (M1–M5), and journey 3                                                  |

Decided (2026-11-21), with your designs: the mock OTA is called **Sojourna**; the work is split
in three (17c-2, 17c-3, 17d); OTA guests **get the trip page link and the reminders from Ìrìn**
(the booking confirmation, receipts and refunds stay Sojourna's), which replaces 17b's "nothing
automatic" and is built in 17c-3.

## 1. What changed from 17c, and why

Your Connect screen asks for a name and a commission, nothing about a webhook. So where does
an OTA say where to send updates? The OCTO standard has an answer: its **notifications**
capability. The OTA **subscribes an address of its own** through OCTO, and the supplier tells it
there. 17c had invented its own webhook (an address set by the owner, signed messages); 17c-2
replaces it with the standard, so any OCTO OTA (not just Sojourna) can use it unchanged.

| 17c (own webhook)                    | 17c-2 (OCTO notifications)                                          |
| ------------------------------------ | ------------------------------------------------------------------- |
| the owner pastes the OTA's address   | the OTA subscribes itself: `POST /octo/notifications/subscriptions` |
| one address per channel              | as many as it likes, each with the kinds it wants                   |
| our signature header                 | the headers the OTA asks for (e.g. its own `Api-Key`)               |
| the full availability in the message | only what changed; the OTA fetches it again                         |

A new migration drops 17c's webhook columns and its table (never shown anywhere, so nothing to
keep) and adds the new ones. **An applied migration is never edited**: the fix is always a new
one on top.

## 2. OCTO notifications

| Endpoint                                      | Does                                             |
| --------------------------------------------- | ------------------------------------------------ |
| `POST /octo/notifications/subscriptions`      | subscribe: `{ url, notificationTypes, headers }` |
| `GET /octo/notifications/subscriptions`       | this channel's subscriptions                     |
| `GET`, `PATCH`, `DELETE …/subscriptions/{id}` | one of them                                      |

The spec spells the path `subcriptions` (a typo in the standard); both spellings work.

What we send, in OCTO's envelope `{ id, subscriptionId, notificationType, utcCreatedAt, data }`:

| `notificationType`    | `data`                                                  | When                                            |
| --------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| `PRODUCT_UPDATE`      | `{ productId }`                                         | prices changed; off sale; taken off the channel |
| `AVAILABILITY_UPDATE` | `{ productId, optionId, localDateStart, localDateEnd }` | seats or status changed on those days           |
| `BOOKING_UPDATE`      | `{ uuid }`                                              | one of its bookings changed (a weather cancel)  |

**Small messages, on purpose.** The message says _what_ changed; the OTA asks again for the
details with the endpoints it already uses. One message per tour covers all its changed days
(first to last), however many departures changed.

The job still compares **fingerprints** every 30 seconds (17c's idea, kept). Two things are new:

- the fingerprints are kept **per subscription** (`notification_states`), since two
  subscriptions may want different things;
- a departure's fingerprint now starts with its **tour** and ends with its **start time**
  (`tour|status|left|capacity|start`). When a departure disappears (deleted from the schedule,
  or its tour taken off the channel), we no longer have the row, but the fingerprint still says
  which tour and which day to tell about. A day already past is simply forgotten.

**Never a door into our own network.** In production a subscription's address must be public
`https://` (no localhost, private ranges, `169.254.x`, `.internal`, raw IPv6). Its headers can't
be ones we set ourselves (`Host`, `Content-Type`, `Content-Length`, `Cookie`…), and can't hold a
line break (which could smuggle in a second header).

## 3. Payments from the OTA

The OTA collects its guests' money and owes the business the price less its commission (17b).
Every few weeks it pays. **"Record a payment from Sojourna"** writes that down:

- the payment (`channel_payments`: amount, the day it arrived, the bank's reference, who recorded
  it);
- **which bookings it paid off, oldest first** (`channel_payment_allocations`): the order an
  OTA's statement lists them, and the order an owner would tick them off by hand;
- the ledger: `ota_payment`, **Dr Bank / Cr Owed by OTAs**.

So each booking knows what's still owed for it:

```
owed = the sale's net − each refund's net − what payments paid off
```

| What the booking says                    | When                                           |
| ---------------------------------------- | ---------------------------------------------- |
| Owes ₦81,600                             | sold, not paid off yet                         |
| Settled                                  | paid off                                       |
| Cancelled · owes ₦0                      | cancelled before anything was paid             |
| Refunded after paying: owed ₦64,000 back | refunded after the OTA had already paid for it |

The last one is real: an OTA pays for a booking, then the guest cancels and the OTA refunds
them. Now the business owes the OTA. The total shows it ("You owe ₦6,000 back"), the ledger
already has it (Owed by OTAs goes below zero), and the next payment from the OTA will be smaller.

A payment is refused when it's **more than the OTA owes** (a typo, most likely), or **dated in
the future**. Two payments recorded at once can't pay off the same booking twice: the first
locks the channel's row (`SELECT … FOR UPDATE`) until it's done.

## 4. The screen

`SettingsChannels.jsx` builds your design; the words and checks are in `lib/channels.js`; the
numbers and most lines come from the server, already in words.

| Part              | Does                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------- |
| the cards         | each OTA: connected or off, commission, tours, last booking, this month, what it owes |
| Tours on Sojourna | a switch per tour, sent at once; a draft can't be switched on (and says why)          |
| Latest bookings   | the last 10 sold, each with what it still owes                                        |
| Money             | this month's sales, the OTA's share, what it owes; the last payment; Record a payment |
| Commission        | new sales only; the save bar (and "leave without saving?")                            |
| Connection        | the OCTO address; the key's last 4, when made, when last used; New key; Switch off    |
| Connect a channel | a name (with "via …" beneath) and a commission → the key, shown once                  |

**Asked first:** a new key ("the old key stops working at once") and switching off ("Sojourna
won't be able to sell. Its bookings stay."). Both say what will happen before it happens.

**"Last used 10:42"** comes from the OCTO API itself: each request with the key updates it, at
most once a minute (a busy OTA asks many times a second; one write a minute is plenty).

On a phone: the cards, then tap one to open it (`/settings/channels/:id`), with "‹ Channels" back.
On a wide screen: the cards with the open one's page beneath, as designed.

**What the browser check changed** (on a throwaway business in the e2e database, since your dev
database has no Sojourna yet):

- "Sales this month" leaves out sales cancelled since. Your design's numbers only add up that
  way (₦412,000 less 20% is exactly the ₦329,600 owed); what's owed is worked out on its own,
  refunds and all.
- An OTA switched off before selling anything says "No past bookings", not "0 past bookings
  kept".
- The latest bookings keep the guest's name readable: our page has the app's menu and the
  settings menu beside it (the design had one), so each booking's state goes under its price.
- On a phone, inside one channel, "‹ Channels" is the way back, so the page's header and the
  bold "open" border are wide-screen only.

## 5. Sojourna

The seed's OTA is now **Sojourna** (your name for the mock OTA). Your dev database needs
`pnpm db:reset` to get it (the old one was called "Mock OTA", or there's none at all).

## 6. Tests

- `apps/api/test/channels.test.js` (12): the cards and the page in words; managers look, guides
  don't; a hold, last month's sale and a half refund; one channel's own bookings; the tours'
  notes (pickups, deposits, drafts); the key's dates; connect (published tours only, key once);
  refusals; tours one by one; commission for new sales; switched off and on; a new key; a
  payment paying off oldest first, the ledger, then a refund after it; refusals; the words.
- `apps/api/test/octo-notifications.test.js` (9): subscribe, list, read, change, delete (both
  spellings); refusals (types, reserved headers, line breaks, addresses); another channel's
  aren't visible; the address rule; the push: everything the first time, then only what
  changed (a hold, a price, a departure called off and one deleted, one whose time came); off
  sale and off the channel; bookings; an OTA that's down; a switched-off channel.
- `apps/workers/test/push-channels.test.js` (2): the POST with the OTA's own headers; the words
  for a 503, a timeout, an unreachable address.
- `apps/operator/test/settings-channels.test.jsx` (11): the rules (commission, connect, payment,
  questions); the screen against a fake server: the cards and the page, a tour switched off,
  the commission's save bar, a new key (asked, shown once, copied), switching off and on, a
  payment (checked, sent), connecting from the empty page, a manager who can only look.
- `packages/shared/test/ledger.test.js`: the OTA payment posting.
- Mutation checks: 55 changes; 8 survived at first. One was aimed badly (it broke the file
  instead of the rule) and was re-aimed. Seven got tests: only the OTA's own successful payments
  count; a payment passes by a booking that owes nothing; a last booking on another day shows
  the day; a booking whose day has passed isn't "upcoming"; a new key starts "not used yet";
  "last used" is refreshed after a minute; a booking whose day has long passed is forgotten.
