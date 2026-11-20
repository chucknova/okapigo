# Stage 16c-3: Changing a booking's travellers

The last part of the bookings desk (O8): **Change travellers**, from your "Booking actions"
design. Adults and children with − and +, a name and age for each one added, and, as you go,
the new total, the extra to pay or the refund the policy allows, and whether the seats fit.

## 1. What we built

| Piece                                               | Where                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| The rules, the plan, the save                       | `packages/db/src/traveller-change.js`                                              |
| Preview (nothing saved) and save                    | `POST /api/bookings/:id/travellers/preview` and `…/change`                         |
| Who "−" takes off, the button's words, after saving | `apps/operator/src/lib/desk.js` (`nextToRemove`, `saveChangeLabel`, `changedNote`) |
| The sheet                                           | `TravellersSheet` in `apps/operator/src/screens/Bookings.jsx`                      |

## 2. One plan, two uses

`planTravellerChange()` works out everything a change would do: who goes, who comes, the new
price, the seats, the money. The **preview** calls it on each pause in typing (the sheet shows
the result). The **save** calls it again, under a lock on the booking and the departure, and
only then writes. So the office confirms exactly what happens: if the refund changed in
between (a clock passing a policy tier, say), the save refuses (`REFUND_CHANGED`) and the sheet
shows the new amount.

## 3. The price: from when it was booked

You decided an added traveller pays **the price from when the booking was made**. The booking
keeps its quote (the price per kind of traveller, the add-ons, the tax), so the change runs the
same pricing pipeline (`priceBasket`, session 5) again with those booked prices. A kind of
traveller the booking never had (its first child) has no booked price, so it takes today's,
and the sheet says "(today's price)".

A booking with a promo code or a fee is refused (`CANNOT_REPRICE`): its quote keeps the
discount's amount, not its rule, so it can't be worked out again faithfully. Ìrìn uses neither.

## 4. The rules

| Rule                                                          | Refused as                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| only a booking that's on: confirmed, part paid, paid, amended | `CANNOT_CHANGE` ("This booking isn't booked yet.")                         |
| before the trip starts                                        | `TRIP_STARTED`                                                             |
| the lead stays                                                | `LEAD_STAYS`                                                               |
| nobody already checked in is removed                          | `CHECKED_IN`                                                               |
| children and infants: an age, in their range                  | `AGE_NEEDED`, `AGE_OUTSIDE_CATEGORY` ("Child (3–12) is 3–12; Tobi is 15.") |
| at least one adult stays                                      | `ADULT_NEEDED`                                                             |
| more travellers fit the seats (the van's, if assigned)        | shown: "doesn't fit: 3 of 2 in Minivan"; refused on save (`SEATS`)         |

On the sheet, "−" takes off the newest added traveller first, then the last booked one of that
kind who can go; it's greyed when nobody can.

## 5. The money

- **More travellers:** the booking owes the extra. A paid booking becomes **amended** (the
  lifecycle's word for "changed after confirmation; settles once the difference is paid"), and
  the save sends a **payment link for the extra** ("Save and send a link for ₦35,000").
- **Fewer:** what's now paid beyond the new total goes back **as the policy allows** (the same
  cancellation rules, applied to the overpaid part): "₦25,000 of ₦25,000 (full refund, because
  it's 48 hours or more before)". Saving confirms it; the refund is owed in the books and
  started through Paystack.
- **Owing nothing any more** (a part-paid booking that drops a traveller): paid.

The seats sold on the departure move with the change, and the timeline says it: "travellers
changed by Tunde: added Tobi Ojo · ₦65,000 → ₦100,000".

## 6. Found on the way: a test that read the clock

Run at 21:48, the manager's Today test failed: it moved a departure to "2 h 20 min from now"
and expected it under **today's** departures with just a time. After 21:40 in Lagos that's
**tomorrow**, and the app rightly showed "Sat 21 Nov, 00:08" and left it off today's list. The
test now checks Lagos's date and expects either. (The widget journey also failed once in the
same busy run; it passed twice alone, in about 20 seconds each.)

## 7. Tests

- `apps/api/test/desk-travellers.test.js` (8): the preview; more travellers saved (amended, the
  seat, the link); the booked price kept and today's for a new kind; fewer (the refund confirmed,
  started, the seat freed); part paid → paid; the rules; the van's seats; held and started.
- `apps/operator/test/desk.test.jsx` (+4): who "−" takes; what's sent; the sheet adding a child
  (the age asked for, the link); the sheet removing an adult (the refund confirmed).
- Mutation checks: 20 changes; 1 survived at first (a baby's age of 0 read as "no age") and got
  a test.
