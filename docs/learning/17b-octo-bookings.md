# Stage 17b: OCTO bookings

| Part    | What                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------ |
| 17a     | OCTO catalogue: supplier, products, units, availability, the calendar; channel keys; contracts         |
| **17b** | **OCTO bookings: hold, confirm, cancel; the booking's channel and money; no oversell across channels** |
| 17c     | The channel manager: Settings › Channels, tours per channel, keys, the 60-second webhook               |
| 17d     | The mock OTA app and journey 3                                                                         |

Decided (2026-11-21): **the OTA takes the guest's money** and owes Ìrìn the price minus its
commission; **Ìrìn sends OTA guests nothing automatic** (the OTA tells them, and gets the ticket
and the trip page link through OCTO to pass on); **an OTA's cancellation follows Ìrìn's policy
until the start**.

## 1. What we built

| Piece                                             | Where                                        |
| ------------------------------------------------- | -------------------------------------------- |
| The OCTO side of a booking (a migration)          | `channel_bookings` table                     |
| Reserve, confirm, cancel, extend; the OCTO status | `packages/db/src/channel-bookings.js`        |
| The money: two accounts, two postings             | `packages/shared/src/ledger.js`              |
| An OCTO booking from ours                         | `apps/api/src/octo/views.js` → `bookingOf()` |
| The endpoints                                     | `apps/api/src/octo/router.js`                |
| The Booking shape (the contract)                  | `packages/shared/src/octo.js`                |

| Endpoint                                         | Does                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `POST /octo/bookings`                            | **reserve**: seats held (up to 30 minutes); the same `uuid` twice is the same booking |
| `POST /octo/bookings/:uuid/confirm`              | the OTA's guest (a name and an email); the OTA's payment                              |
| `POST /octo/bookings/:uuid/cancel`               | held → seats back; sold → Ìrìn's policy, settled with the OTA                         |
| `POST /octo/bookings/:uuid/extend`               | more time on the hold (up to 30 minutes from now)                                     |
| `PATCH /octo/bookings/:uuid`                     | the OTA's reference, the notes, the contact (not the date or who's coming)            |
| `GET /octo/bookings/:uuid`, `GET /octo/bookings` | one; or this channel's, by its reference, ours, or the day                            |

## 2. One booking, two sides

An OCTO booking **is** one of our bookings. Reserving creates our booking, held, with its seat
hold (the same `createBooking` as the website and WhatsApp), and a `channel_bookings` row with
the OCTO side: the OTA's `uuid`, its reference, the unit items, and **the commission frozen at
the sale** (changing a channel's commission later never changes what an old sale owes).

The OCTO **status is never stored**: it's worked out from our booking and its hold
(`octoStatusOf`): held with time left → ON_HOLD; held with the time up, or ended by its hold's
expiry → EXPIRED; cancelled or refunded → CANCELLED; completed → REDEEMED; any other sold status
→ CONFIRMED. Two copies of a status would drift apart.

**Who's coming arrives late.** OCTO reserves before it confirms who the guest is, but every
booking needed a lead's email or phone (a database check). Now that check lets **only an OTA
booking that's still held, or was cancelled before being confirmed**, go without one; every sold
booking still has one, because confirming through OCTO requires the email. (A new migration: the
applied one was never edited.)

## 3. The money

Two ledger accounts, for every business:

| Account             | What                                                          |
| ------------------- | ------------------------------------------------------------- |
| 1300 Owed by OTAs   | what OTAs collected for us and owe (the sale less commission) |
| 5200 OTA commission | what they keep                                                |

**Confirming** records a payment from the OTA (provider and method `ota`) for the whole price,
and a sale (`ota_sale`):

```
Dr Owed by OTAs   ₦64,000      (₦80,000 less 20%)
Dr OTA commission ₦16,000
   Cr Tour sales           ₦80,000
```

The booking becomes **paid** through the same path as any payment (`settleBooking`): seats move
from held to sold. **Cancelling** a sold booking runs the usual cancellation with the guest as
the one cancelling, so Ìrìn's policy decides the refund; then the refund is **settled with the
OTA at once** (it refunds its guest itself), so no "refund to send" ever appears in the inbox:

```
Dr Refunds payable ₦40,000      (half back, 30 hours before)
   Cr Owed by OTAs          ₦32,000
   Cr OTA commission        ₦8,000    (its commission on the refund, handed back)
```

## 4. What the OTA gets

The OCTO booking, checked against the spec's Booking shape: status, the OTA's reference and ours
(`supplierReference`: "ILT-…"), when the hold runs out, the contact (once confirmed), the
departure as an availability, the unit items, the price and the OTA's net, the cancellation
(FULL, PARTIAL or NONE, the reason, when), whether it can still cancel (until the start), and once
confirmed **the voucher**: the same signed QR code as the trip page's ticket. Plus, outside the
spec (OTAs ignore what they don't know), the guest's **trip page link** to pass on.

## 5. Nothing sent to OTA guests

`planGuestMessage` now skips every automatic message for an OTA booking (confirmation,
reminders, cancellation, refund): the OTA tells its guest. What staff send on purpose (a message,
a payment link) still goes.

## 6. No oversell across channels

The test races **6 website checkouts and 6 OCTO reserves**, two seats each, for a 12-seat
departure, all at once. Every one locks the same departure row (`createHoldInTx`'s `FOR UPDATE`),
so exactly 6 succeed, whichever channel they came from, and the departure holds exactly 12. The
losers are told plainly (OCTO: UNPROCESSABLE_ENTITY with the seats left).

## 7. Pickups, in part

A tour that picks guests up (Lekki) needs to know where: the reserve sends `pickupPointId` (the
point's name made URL-safe: `victoria-island`, `ikoyi`), from OCTO's optional pickups capability.
Without it, the answer lists the choices. The rest of that capability (pickup points on the
option, with places and times) isn't built yet.

## 8. Tests

- `apps/api/test/octo-bookings.test.js` (12): reserve (held, the website's seats, idempotent, the
  hold's length); refusals (another tour's departure, an unknown unit, a child alone, too many, a
  cancelled departure); a pickup tour; confirm (the guest, the payment, the ledger, no messages,
  twice); refusals (no name, no email, a hold that ran out → EXPIRED); cancel on hold; 72 hours
  before (full, settled, the ledger); 30 hours (half), 10 hours (nothing), started (too late);
  extend; look up and list (only this channel's); update; **the race**.
- `apps/api/test/octo-views.test.js` (+3): the OCTO status, the hold's length, the refund kind,
  the contact, names.
- `packages/shared/test/ledger.test.js`: the OTA's sale and refund postings.
- `packages/db/test/ledger.test.js`: the migrations that add accounts match the code (now three).
- Mutation checks: 27 changes; 3 survived at first and 2 needed re-aiming after Prettier moved
  their lines. Two got tests (a retry of the same uuid when the departure is full is still the
  same booking, not "sold out": the shortcut matters; a hold whose time is up can't be
  extended) and one check was moved to where it belongs (the router gives the ticket code only
  once confirmed, so the view doesn't decide it again).
- No screen in this part: the OCTO tests above call the real API, with the database.
