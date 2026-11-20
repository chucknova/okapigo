# Stage 16d-2: Guest requests, and moving a booking's date

Part 2 of the inbox (O9): what guests ask from their trip page ("Ask Ìrìn", 12f-2), answered
from the inbox, and the thing they ask most, **moving to another date**, built now (decided
2026-11-21).

## 1. What we built

| Piece                                        | Where                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| Moving a booking; the dates it could move to | `packages/db/src/move-booking.js` (`moveOptions`, `moveBooking`)                  |
| Replying to a request                        | `packages/db/src/guest-requests.js` (`replyGuestRequest`)                         |
| The Requests tab in words; reply             | `apps/api/src/routes/inbox.js`                                                    |
| Move routes                                  | `apps/api/src/routes/desk.js`                                                     |
| A new guest message, "Date changed"          | `message-templates.js` (`booking_moved`), its WhatsApp template, its email layout |
| The trip page shows the reply                | `packages/shared/src/trip-hub.js` (`requestNotice`), `TripHub.jsx`                |
| The Requests tab, the Move sheet             | `screens/Inbox.jsx`, `components/MoveSheet.jsx`                                   |

| Route                                    | Does                                                   |
| ---------------------------------------- | ------------------------------------------------------ |
| `GET /api/inbox/requests?tab=open\|done` | open oldest first; Done newest first, with who and how |
| `POST /api/guest-requests/:id/reply`     | `{ text, markAnswered }`: by WhatsApp and email, kept  |
| `POST /api/guest-requests/:id/answer`    | `{ note }`: answered another way (12f-2)               |
| `GET /api/bookings/:id/move-options`     | the tour's other dates in the next 90 days, seats free |
| `POST /api/bookings/:id/move`            | `{ departureId, requestId? }`                          |

## 2. A request, answered

A request card shows what they asked, who, when, how long it's been waiting, and the booking
(paid, when, how many). Then:

- **Move to another date…** (for a date change), **Cancel with a refund…** (the booking's own
  cancel, 16c-2), **Open booking**;
- **Reply** by WhatsApp and email ("Mark answered when sent" ticked by default). The reply goes
  as the business's own message (`staff_message`, from 16d-1), is kept on the request, and
  **the guest's trip page shows it** instead of "Your request was sent": "Ìrìn Lagos Tours
  replied on Tue 1 Dec: …". If they ask something newer, "sent" shows again (`requestNotice`);
- **Mark answered without replying**, with a short note ("Called her…").

**Done** lists each with who dealt with it and how: "Kunle · Tue 1 Dec · moved to Sun 6 Dec,
09:00 · replied by WhatsApp and email", or "note: “…”".

## 3. Moving a booking

The Move sheet lists the tour's other dates with their seats free ("4 seats free", "Only 1
free", "Full"); the ones that can't take everyone can't be chosen. Moving:

- only a booking that's on, before its trip; the same tour; a date still to come;
- the seats must fit (the van's too), counted with **both** departures locked, always in the
  same order (by id) so two moves at once can't wait on each other forever (a deadlock);
- the **price stays what was booked**; the seats move from one date to the other; check-ins
  reset (nobody's checked in on the new day);
- the guest is told by WhatsApp and email with the new message **"Date changed"**: "your booking
  ILT-… has moved. Now on Sun 6 Dec, 09:00 (was Sat 5 Dec)". The **ticket stays the same**: it
  belongs to the booking, not the date.

From a request, moving fills the reply for you ("Done! You're now booked for Sun 6 Dec, 09:00,
same meeting point. Your trip page has the new date.") and notes "moved to…" on the request.
On a booking's page it's **Move to another date** among the actions.

## 4. The seventh message

"Date changed" joins the six guest messages: a business can rewrite it in Settings › Messages
(16e) like the others, and it has its own WhatsApp template, `okapigo_booking_moved`. **For real
WhatsApp, submit it in Meta once** (with `okapigo_chat_followup` from 16d-1).

## 5. Tests

- `apps/api/test/requests.test.js` (6): the tab in words; a reply (both ways, the trip page);
  a reply left open; answered with a note; moving (options, seats on both dates, the guest told,
  the email, Done says "moved to…"); the rules (seats, same date, another tour, a past date, held);
  the trip page's banner.
- `apps/operator/test/inbox.test.jsx` (+4): the words; a request moved then replied; a reply
  left open and a note; no open requests.
- Mutation checks: 16 changes; 1 survived at first (moving to a date that had passed) and got a
  test.
