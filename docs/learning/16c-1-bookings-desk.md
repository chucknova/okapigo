# Stage 16c-1: The bookings desk, finding and reading a booking

The office's bookings desk (O8), from your designs, in three parts (decided 2026-11-20):

| Part      | What                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **16c-1** | **find a booking; its page in every status; notes; releasing held seats; desk no-shows**                                     |
| 16c-2     | the money: payment links, cancelling (policy or another amount), confirming a guide's cash, failed and bank-transfer refunds |
| 16c-3     | changing travellers (an added traveller pays the price from when it was booked)                                              |

## 1. What we built

| Piece                                                   | Where                                                    |
| ------------------------------------------------------- | -------------------------------------------------------- |
| The list, a booking's page, notes (worked out in words) | `packages/db/src/desk.js`                                |
| …served to the office                                   | `apps/api/src/routes/desk.js`                            |
| Notes on the guide's manifest (app and printed)         | `packages/db/src/operations.js` (`manifest()` → `notes`) |
| Which chat message a WhatsApp notice became             | `apps/api/src/messages/send.js` (`data.chatMessageId`)   |
| Query strings checked (and 16b's `?start=`)             | `apps/api/src/middleware/validate.js`                    |
| The desk's words: filters, countdown, "nothing found"   | `apps/operator/src/lib/desk.js`                          |
| The screen                                              | `apps/operator/src/screens/Bookings.jsx`                 |

| Route                               | Who            | Does                                                                      |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------- |
| `GET /api/desk/bookings?filter=&q=` | bookings: edit | Today · Upcoming · Owes money · Cash to confirm · Cancelled · All; search |
| `GET /api/desk/bookings/:id`        | bookings: edit | one booking's page                                                        |
| `POST /api/bookings/:id/notes`      | bookings: edit | `{ text, onManifest }`                                                    |

Releasing held seats uses `DELETE /api/holds/:id` (session 7); a no-show from the desk uses
`POST /api/departures/:id/check-ins` with `status: "no_show"` (15a), so the guide's phone and
the desk follow the same rules, conflicts included.

## 2. Finding a booking

Search takes a **reference**, **any part of the lead's name**, or **a phone as people write
it**. Phones are stored `+2348059876543`; someone types `0805 987`. `searchTerms()` drops the
spaces and the leading `0` (or `234`) and looks for `805987`. ("yemi" finds Yemi Ojo and Funmi
Ade**yemi**: a name anywhere.)

The search waits until typing pauses (300 ms), so typing "okonkwo" asks the server once, not
seven times. Nothing found says where it looked ("No upcoming bookings match “Okonkwo”") and
offers **Search all bookings (past and cancelled)**.

## 3. One status chip: the thing to do first

Each booking gets one chip, chosen in this order:

| Chip                                              | When                                              |
| ------------------------------------------------- | ------------------------------------------------- |
| **Held · 12:40** (counting)                       | the guest is paying right now                     |
| **Refund failed** (red)                           | owed back, the last try failed, nothing sending   |
| **Refund to send** (red)                          | owed back, never started                          |
| Cancelled · refund sending / refunded / Cancelled | the rest of the cancelled ones                    |
| **Cash to confirm** (blue)                        | a guide reported cash the office hasn't confirmed |
| **Owes ₦45,500** (amber)                          | money still due                                   |
| No-show · Paid                                    |                                                   |

"Owed back and not on its way" is `refundDueKobo` minus every refund that hasn't failed
(`notStartedKobo`). A booking cancelled by the office has its refund owed but **not started**
(starting it is a separate step: 16c-2 joins the two). That state wasn't visible anywhere
before: it is now, in red.

## 4. A booking's page

- **The banner** says what needs doing: seats held until 17:58 (12:40 left) with **Release
  the seats now**; the balance due today (or "was due Sat 28 Nov") and whether the last
  reminder arrived, with **Call 0813 902 4417**; cash reported by Femi; a refund that failed
  and why; or how it was cancelled and what was refunded.
- **Money** as a ledger: the price, each payment (deposit, card, date), cash waiting, refunds
  (sent, sending, failed), and the bottom line (still owed · due when / kept / owed back).
- **Travellers**, with check-in (Present 07:12) and who checked them in.
- **Messages sent**, and whether they arrived: "WhatsApp · read", "Email · failed: …". For
  that, each WhatsApp notice now remembers the chat message it became, whose delivery receipts
  (13c-3) say sent, delivered, read or failed.
- **The timeline** in words: "booked on WhatsApp", "part paid ₦19,500", "cash ₦45,500
  reported by Femi", "note by Tunde: “…” · on the guide's manifest".
- **Actions**, each with why it can't be used now ("Not booked yet", "Trip is on Sat 12
  Dec", "Everyone is checked in"). Greyed on a wide screen, left out on a phone (as designed).
  16c-1 shows the ones built: **Add note** and **Mark no-show**.

## 5. Notes

A note goes on the timeline with who wrote it and when. Tick **Show on the guide's manifest**
and it also appears under the booking on the guide's manifest and the printed one. Guests
never see notes.

## 6. Found on the way

- The `validate()` middleware ignored `query` schemas: 16b's `?start=` was never checked (an
  odd value became a server error). Query strings are now checked, and the route gets the
  checked values with their defaults.
- In the browser: the status chip squeezed the phone header; it now sits beside the name, as
  in the phone design. "0 results for …" above "No bookings match …" said the same thing
  twice; the count shows only when there are results.

## 7. Tests

- `apps/api/test/desk.test.js` (13): search words, the chip order, filters and search, every
  status's page (paid, held and released, owes due and overdue, cash, refund to send → failed
  → sending → sent), WhatsApp receipts, another business's booking, notes and the manifest.
- `apps/api/test/validate.test.js` (2): query strings checked, defaults applied.
- `apps/operator/test/desk.test.jsx` (7): the words, the list and search, a booking's page,
  releasing held seats, a note, no-shows.
- Mutation checks: 28 changes; 4 survived at first and got tests (an empty note refused by the
  rule itself, query defaults, the search waiting for typing, notes on the app's manifest).
