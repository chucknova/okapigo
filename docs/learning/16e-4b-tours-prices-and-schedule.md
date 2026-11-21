# Stage 16e-4b: Settings › Tours: Prices, and Schedule and seats

Settings › Tours, part two of three:

| Part       | What                                                                     |
| ---------- | ------------------------------------------------------------------------ |
| 16e-4a     | the tour list, New tour, Basics (with the meeting point's pin), on sale  |
| **16e-4b** | **Prices ("existing bookings keep their price") and Schedule and seats** |
| 16e-4c     | Extras, pickup points, the cancellation policy, the deposit              |

## 1. What we built

| Piece                                                                | Where                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------- |
| The rules: price rows, money typed, ages in words, what changed      | `apps/operator/src/lib/tours.js` (Prices, Schedule)  |
| One save bar for a page of sections                                  | `apps/operator/src/lib/save-parts.js`                |
| Prices and Schedule and seats; one-off departures                    | `apps/operator/src/screens/SettingsTourSections.jsx` |
| All the prices at once; the tax line; bookings that keep their price | `apps/api/src/routes/products.js`                    |
| A schedule change's booked departures, in words                      | `apps/api/src/routes/schedules.js`                   |

## 2. One save bar for the whole tour

The design has one bar at the bottom ("Unsaved changes: Adult price"), but a tour's page has
several sections, each with its own form. `useSaveParts()` gives the page the bar; each
section calls `useSavePart(part, changed, blocked, save, discard)` to say what it has unsaved
and how to save or discard itself.

- The bar lists every section's changes: "Unsaved changes: Name, Child price".
- **Save changes** saves each section that has something, **in page order**, and **stops at
  the first refusal**: what was saved stays saved, the refused section keeps its changes and
  says why, and the bar now lists only what's left.
- **Discard** puts every section back. "Leave without saving?" covers them all.

React detail: a section reports from an effect, so the bar catches up one render after the
section's own "Saved" note. Tests wait for the bar to go rather than expecting it in the same
moment.

## 3. Prices

Each category: its **name**, its **ages** ("13 to [empty]" reads "13 and over"), and its
**price** in naira ("70,000" and "70000" are the same; 0 is "Free, needs a seat"). A category
with no upper age **counts as an adult** (children can't book without one). Add a category;
remove one. Above them, whether prices include the tax: "Prices include 7.5% VAT."

Checked as you type: a name, ages from 0 to 120 (the oldest not below the youngest), a price in
naira; and together: **"Adult and Senior cover some of the same ages."** A tour on sale must
keep at least one price.

**Before saving, what it means for bookings** (the design's words):

> You changed Adult from ₦65,000 to ₦70,000. New bookings pay ₦70,000; the 26 existing bookings
> keep their price.

"Existing bookings" are those still to travel that are confirmed or paid (a hold is minutes
long and isn't counted). They keep their price because each booking froze its quote when it
was made (session 7): changing a price never changes one.

### Saved all at once

The prices go to `PUT /api/products/:id/price-categories` **as a whole**, applied in one
transaction and checked as they'll be: no two for the same age, a tour on sale keeps one. A
price left out is **archived**, not deleted (bookings point at it), and placed after the active
ones; a new one gets a key from
its name ("senior-65", then "senior-65-2"). Either everything changes or nothing does: no
half-saved price list.

## 4. Schedule and seats

The days (Mon to Sun), the start time (more than one, separated by commas), seats per
departure, until when (empty: it keeps running), and the dates it doesn't run (chips with ×,
"Add a date"). "Runs: Saturdays 07:00" updates as you choose, from the same words as the tour
list. "The next 60 days are on sale; new dates open each day."

A tour with no schedule gets a new one starting today. With several, the first switched-on one
is shown ("The others keep running").

**After saving**: "8 departures added." A change never removes a departure with guests: those
stay, listed with links, for a person to decide:

> This booked departure stays until you decide: cancel from its page (guests get their refunds),
> or let it run.
> Sat 26 Dec, 07:00 · 4 guests · no longer in the schedule ›

(Or "more guests than the new seats", when the seats went below what's booked.) The words come
from the server, beside its sync (`sync.attention`).

**One-off departures**: the coming ones listed (with links), and "Add a one-off departure"
(date, time, seats). That's added straight away, not through the save bar: it's an action, not
a form.

## 5. Who

Owners change prices and the schedule (products: edit). A manager sees them switched off.

## 6. Tests

- `apps/api/test/settings-tours.test.js` (+5): the tax line; bookings that keep their price
  (held and cancelled don't count); all prices at once (changed, added, archived, in order,
  brought back, unique keys); refused as a whole (overlap, none on sale, someone else's price,
  a manager); a schedule change's booked departures in words.
- `apps/operator/test/settings-tour-prices.test.jsx` (14): the rules; a price changed and its
  words, saved; added and removed, overlap holds the save, discard; one save bar for the basics
  and prices, in order; a refusal stops there; the schedule changed, saved, the departures it
  leaves; a new schedule; a one-off; a manager.
- Mutation checks: 40 changes; 6 survived at first. Five got tests (an overlap isn't reported
  while a row is wrong; a section with something old to fix doesn't hold up another's save;
  "Save and leave" with a price to fix; a new schedule saved twice changes, not duplicates;
  "Add a date" needs a new date) and one line was simplified (the count of other schedules).
- Browser check (as Tunde, then the seed owner on the check server; nothing saved): on your
  data, "You changed Adult (13+) from ₦65,000 to ₦70,000. New bookings pay ₦70,000; the 4
  existing bookings keep their price."; Discard put it back. Fixed: the price rows were too
  cramped in four columns, so the name has its own line, with ages, price and Remove beneath.
