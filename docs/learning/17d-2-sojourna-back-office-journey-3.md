# Stage 17d-2: Sojourna's back office, and journey 3

| Part      | What                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| 17d-1     | Sojourna's guest side: storefront, tour page, checkout, booked; OCTO content and pickups |
| **17d-2** | **Its back office (M5), its subscription to OkapiGo's updates, and journey 3**           |

Session 17, OCTO, is done with this part: a business's tours sell on a travel website through
the standard, and journey 3 proves it end to end.

## 1. The back office (M5)

http://localhost:4400/bookings: every booking Sojourna made with the business.

| Column    | From                                                                          |
| --------- | ----------------------------------------------------------------------------- |
| Reference | Sojourna's own ("SJ-48213"), with the business's beneath ("Ìrìn: ILT-6WQ3PZ") |
| Status    | **asked of the business through OCTO when the page opens**                    |
| Cancel    | while the trip hasn't started                                                 |

**Statuses come from the business.** Sojourna keeps only its references; each time the page
opens it asks OCTO for every booking. So when the business cancels for weather, the row says
"Cancelled by supplier · full refund" by itself. Sojourna tells its own cancellations apart from
the business's because it notes when _it_ cancelled (`cancelledAt`).

**Cancelling asks first, with the business's own numbers.** "Cancelled 20 days before: full
refund · ₦102,000 back to the guest, under Ìrìn Lagos Tours' policy." That figure is the
business's preview of _that_ booking, by the policy it was sold under (a policy changed since
doesn't apply to it). OCTO has no such field, so each booking carries our own
`refundIfCancelledNow` (`{ amount, percent, hoursBefore }`), and once cancelled, the
cancellation carries `refundAmount` (OCTO says only FULL, PARTIAL or NONE). Both are marked in
the code as **not in the spec**.

**Too late.** Once the trip has started, Cancel opens your "PAST THE CUTOFF" state: "can't be
cancelled online any more … Ask Ìrìn Lagos Tours directly", with their phone. If the trip starts
while the guest is deciding, the business refuses and Sojourna says so in its words.

## 2. Hearing from the business (OCTO notifications)

At start, Sojourna **subscribes** to the business's updates through OCTO (17c-2's endpoint):
bookings, seats and tours, at `http://localhost:4400/octo-updates`, with a fresh key it asks the
business to send back (`X-Sojourna-Key`). Any old subscription to the same address (from its
last run) is removed first. If the business isn't answering yet, it tries again every 30
seconds.

When a notification arrives with the right key, Sojourna notes the time: the back office's
"Supplier connected through OCTO · **last sync 10:42**". Anyone else gets a 401. There's
nothing to copy: the pages ask afresh each time.

## 3. Journey 3, end to end

`apps/web/e2e/journey-3-ota.spec.js`, with Sojourna started in the e2e set-up on :4500 (its key
belongs to the run's throwaway business, so it starts there, like the worker):

1. On Sojourna: the business's tours; the Heritage Walk, five days ahead, two adults.
2. Continue holds the seats: **the business's own website has two fewer at once** (one stock).
3. Pay (a test); booked: both references and the business's own QR ticket.
4. The office (signed in with a code, first run done) finds it on the desk "via Sojourna":
   "VIA SOJOURNA (SJ-…)", "Paid by Sojourna", "Sojourna owes …", "Not sent: Sojourna sends its
   own".
5. The guest cancels on Sojourna: "full refund", ₦50,000; then "Cancelled · ₦50,000 refunded".
6. Both agree: the office's page says "Cancelled · refunded", "Refunded to the guest by
   Sojourna"; the seats are back on the website.

**What journey 3 found** (the point of an end-to-end test):

- **A contact with nulls was refused.** With no phone, Sojourna sent `phoneNumber: null`, and
  OkapiGo's OCTO API only took a missing field. OCTO's contact fields are nullable, so OkapiGo
  now accepts null for each, and Sojourna leaves an empty phone out anyway.
- **A day picked quickly was overwritten.** Sojourna's tour page chose its default day in an
  effect that ran just after the calendar drew; a click in between was then replaced by the
  default, and the seats were held on another day. The defaults (the first open day, two
  adults) are now worked out while drawing, from what the guest picked so far, so nothing can
  overwrite a choice.

## 4. Tests

- `apps/mock-ota/test/words.test.js` (+4): a row; the statuses (ours or the supplier's, refunds,
  checked in, expired); the question before cancelling (full, half, nothing, no preview); last
  sync and "started at".
- `apps/mock-ota/test/server.test.js` (+5): the bookings with live statuses (unreachable ones and
  tours off sale still listed); cancelling (noted as Sojourna's; too late; unknown); the
  notifications receiver (the key, or 401); subscribing (old ones removed, a fresh key) and
  trying again.
- `apps/mock-ota/test/screens.test.jsx` (+4): M5 and cancelling; too late; refused at the last
  moment, nothing yet, offline; and a day picked straight away staying picked.
- `apps/api/test/octo-bookings.test.js` (+1, and the cancel tests): the preview and the refunded
  amount; a contact with nulls.
- `apps/web/e2e/journey-3-ota.spec.js`: journey 3.
- Mutation checks: 22 changes; 4 survived at first, and got tests: a "NONE" refund with no
  amount reads "no refund"; an empty key never opens the notifications door; updating a booking
  Sojourna doesn't have changes nothing; after "too late" the list asks again.
