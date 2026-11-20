# Stage 16b: The schedule and a departure's page

The manager's week (O6) and one departure (O7), from your designs: who's guiding, which van
or boat, who's booked, the guide's notes, and calling a trip off for the weather.

## 1. What we built

| Piece                                                  | Where                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| The week, a departure's page, who can take it          | `packages/db/src/board.js`                                          |
| …served to the office                                  | `apps/api/src/routes/board.js`: `GET /api/schedule/week?start=`,    |
|                                                        | `/api/departures/:id/overview`, `/api/departures/:id/options`       |
| What a departure can sell: the smaller of tour and van | `packages/db/src/seats.js` (`seatsOf`, `seatsLeft`)                 |
| Each tour's transport: on foot, van or boat            | `products.transport` (migration `20261120120000_…`)                 |
| The reason a departure was cancelled                   | `departures.cancel_reason`                                          |
| Cancelling starts everyone's refund                    | `POST /api/departures/:id/cancel` → `refundsStarted, refundsFailed` |
| The schedule's and departure page's words              | `apps/operator/src/lib/board.js`                                    |
| The office's changes (sent now, never queued)          | `apps/operator/src/lib/office.js` (`act`, `actionError`)            |
| The screens                                            | `src/screens/Schedule.jsx`, `src/screens/Departure.jsx`             |

## 2. The schedule

On a wide screen, the week from Monday: seven columns of cards. Each card: the time, the
tour, **seats sold of what it can sell**, the guide, the van or boat; and a tag: **SOLD OUT**,
**NEEDS GUIDE** (red border) or **CANCELLED** (struck through, with its reason in a word:
"Cancelled · weather"). ‹ › and This week move between weeks; chips filter by tour; "2
departures without a guide" counts what needs you.

On a phone: the seven days as tabs, a red dot on a day with a departure needing a guide;
today's tab first (or Monday, for another week); a menu of tours.

"Needs a guide" means guests are booked and nobody is guiding. An empty departure without a
guide isn't a problem (every tour has a departure every scheduled day).

## 3. A departure

| Part         | Shows                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| the numbers  | booked · held right now (someone at checkout) · seats left · the van's or boat's seats      |
| who's booked | the lead, how many, extras and dietary needs, Paid or Owes ₦…                               |
| notes        | for the guide: at the top of their manifest and the PDF                                     |
| guide        | free ones to choose; busy ones greyed, saying where ("on the Badagry Day Trip until 17:00") |
| van or boat  | only for tours that use one; busy, too small or the wrong kind are greyed, saying why       |
| cancel       | how many bookings, the refund total, who's freed; the reason guests will see                |

On a phone the guide and the van are rows that open a sheet; on a wide screen they're chosen
right on the page.

## 4. The rules decided with the designs

**A van too small is refused** (you chose "as designed"). If 12 are booked, a 10-seat van
can't be chosen: _"Van 3 has 10 seats; 12 are booked. Choose a bigger one, or move 2 guests to
another date first."_ The server refuses it too (`RESOURCE_TOO_SMALL`), not just the screen.

**Once a van is assigned, sales stop at its seats.** A tour may sell 14; with a 12-seat van,
the website, WhatsApp and the widget all stop at 12. One function says it everywhere:

```js
export const seatsOf = (d) => Math.min(d.capacity, d.resource?.seats ?? Infinity);
```

The hold (the moment seats are taken, under a lock) reads the van's seats in the same locked
query, so two guests can't both get the last seat.

**Each tour says how it travels** (you chose "add to each tour"): on foot, van or boat. A walk
needs no van; Tarkwa Bay goes by boat, so the vans say "not for boat trips" and the server
refuses them (`WRONG_TRANSPORT`). Editing a tour's transport comes with Settings (16e).

**The guide hears about it on their phone** (you chose "phone only, for now"): it appears on
their Today next time it syncs. Messaging guides when they're assigned is in the parking lot.

## 5. Cancelling for the weather

The manager types the reason guests will see, and the screen shows the sentence as it will be
sent: _Ìrìn Lagos Tours: "We're sorry: we had to cancel this trip because of the weather on the
lagoon."_ Then:

1. every booking is cancelled, seats and the guide and van freed, the reason kept;
2. each paid booking's refund **starts** (sent to Paystack); one that fails doesn't stop the
   others, and shows on Today;
3. guests are told by WhatsApp and email.

The page says what happened: "Cancelled. 4 refunds started, 4 bookings told."

## 6. Changes from the office go straight to the server

A guide's check-ins queue on the phone and sync later (offline is normal on a boat). The
office's changes don't: assigning a guide on old information would be wrong, so `act()` sends
it now and says "No connection: nothing was changed" if it can't. After every change (or a
refusal: someone else just assigned that guide), **every screen already loaded reloads**, so
the schedule, the departure and Today agree.

## 7. Found in the browser check

- Your dev business has **no vans or boats yet** (seeded before 15a), so the picker was an
  empty box. It now says "No vans or boats yet. Add them in Settings." `pnpm db:reset` adds
  them.
- A wide-only part (the week arrows, the tour chips) showed on a phone: a screen's own
  `display: flex`, later in the CSS, beat `.wide-only { display: none }`. Fixed once for all
  screens: the two helpers have the last word at the end of `app.css`.

## 8. Tests

- `apps/api/test/board.test.js`: the week, a departure's numbers and rows, who can take it,
  sales stopping at the van's seats, held seats counting, cancelling with refunds (an unpaid
  booking isn't refunded).
- `apps/api/test/operations.test.js`: the wrong kind and too-small vans refused.
- `apps/operator/test/board.test.jsx`: the words, the schedule on wide screens and phones, a
  departure (pickers, assigning, a refusal in the server's words, notes, cancelling, no vans).
- Mutation checks: 25 changes to the code; 22 caught at first, tests added for the 3 that
  weren't (held seats, "full" counting held seats, only refunding bookings that paid).
