# Stage 16e-4c: Settings › Tours: Extras, Pickup points, Cancellation and deposit

Settings › Tours, part three of three. This finishes Settings (O10).

| Part       | What                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| 16e-4a     | the tour list, New tour, Basics (with the meeting point's pin), on sale |
| 16e-4b     | Prices ("existing bookings keep their price") and Schedule and seats    |
| **16e-4c** | **Extras, pickup points, the cancellation policy, the deposit**         |

## 1. What we built

| Piece                                                              | Where                                                |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| The rules: extra rows, pickup rows, the terms form and their words | `apps/operator/src/lib/tours.js`                     |
| The three sections, on the tour's one save bar                     | `apps/operator/src/screens/SettingsTourSections.jsx` |
| All of a tour's extras at once; the holds line; the balance's days | `apps/api/src/routes/products.js`                    |
| A policy in one line ("Full refund 48 h+ · 50% 24–48 h · …")       | `packages/shared/src/tour-facts.js` → `policyLine()` |

## 2. Extras

Each extra: its name, its price ("₦8,000 each", or "Free"), a **limit per departure** (empty:
"No limit per departure"; the stall makes 10 plates a night: 10), and a line about it. Add one,
remove one. Saved **as a whole** (`PUT /api/products/:id/add-ons`), like the prices: in one
transaction, one left out **archived** (bookings that bought it keep it), placed after the
active ones.

## 3. Pickup points

Each one: the **area** ("Victoria Island"), the **place** ("Eko Hotel main gate") and the
**time** ("07:15", optional). Guests choose one at checkout. A booking **copied** the pickup
it chose (stage 11b), so changing or removing one here never moves a guest who's already
booked. With none: "No pickup points: guests meet at Ìrìn office."

## 4. Cancellation and deposit

- **The policy**: chosen from the business's policies, each in one line ("Standard: Full
  refund 48 h+ · 50% 24–48 h · No refund under 24 h", shown in full under the menu, which may
  cut it short), or **None: you set each refund yourself** (checked: without a policy the
  server refuses a guest's own cancellation, "Set the refund amount yourself", and staff decide). Writing
  new policies stays with the API for now: the design only chooses one.
- **The deposit**: none ("Guests pay in full when they book"), or a whole percentage from 1 to
  99: "Guests may pay 30% now; the balance is due 7 days before the trip. Booking later than
  that, they pay in full." (The 7 days are the same for every tour: `BALANCE_DUE_DAYS_BEFORE`.)
- **What it means for bookings**: "New bookings get these terms. The 5 existing bookings keep the
  terms they were made with." Each booking froze its policy version and deposit when it was
  made (sessions 9 and 11c).
- **How long seats are held**, business-wide: "Seats are held 15 minutes on the website and 30
  minutes on WhatsApp, for every tour." (The website's from the business's settings; WhatsApp's
  is the chat's own.)

## 5. One save bar, six sections

Basics, Prices, Schedule, Extras, Pickup points, Cancellation and deposit all report to the same
bar (16e-4b's `useSaveParts`) and save in that order.

## 6. Settings is done

| Section            | Stage                  |
| ------------------ | ---------------------- |
| Website, Embed     | 16e-1                  |
| Messages, WhatsApp | 16e-2                  |
| Staff and roles    | 16e-3                  |
| Tours              | 16e-4a, 16e-4b, 16e-4c |

## 7. Tests

- `packages/shared/test/tour-facts.test.js`: a policy in one line.
- `apps/api/test/settings-tours.test.js` (+2): all extras at once (changed, added, archived after,
  someone else's, a manager); the holds line and the balance's days.
- `apps/operator/test/settings-tour-terms.test.jsx` (12): the rules; an extra changed and
  added, saved whole; one to fix holds the save, removed, discarded; pickup points changed,
  added, removed (one without a place held); none; the policy and deposit changed with their
  words; no deposit; a manager.
- Mutation checks: 24 changes; 1 survived at first (the website's hold time read from the
  business's setting, not assumed to be 15) and got a test.
- Browser check (as Tunde, then the seed owner on the check server; nothing saved): Lekki's three
  pickup points, the policy, the deposit's words, Discard. Fixed: **the whole tour page ran off
  the side of the screen**. A `<fieldset>` is never narrower than its widest child by default,
  and the policy menu's long option made it wide: fieldsets may now shrink (`min-width: 0`) and
  menus stay in their box. Also the pickup time's box was too narrow for "07:15".
