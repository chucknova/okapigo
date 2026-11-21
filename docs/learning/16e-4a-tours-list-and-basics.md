# Stage 16e-4a: Settings › Tours: the list, a new tour, Basics

Settings › Tours, in three parts (decided 2026-11-21):

| Part       | What                                                                               |
| ---------- | ---------------------------------------------------------------------------------- |
| **16e-4a** | **the tour list, New tour, Basics (with the meeting point's pin), on sale or not** |
| 16e-4b     | Prices ("existing bookings keep their price") and Schedule and seats               |
| 16e-4c     | Extras, pickup points, the cancellation policy, the deposit                        |

## 1. What we built

| Piece                                                            | Where                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| The rules: the list, the basics form, the text lists, a new tour | `apps/operator/src/lib/tours.js`                         |
| Reading a pasted map link                                        | `packages/shared/src/map-pin.js` → `readMapPin()`        |
| The screen                                                       | `apps/operator/src/screens/SettingsTours.jsx`            |
| Each tour's schedule in words; the city's pin; transport, arrive | `apps/api/src/routes/products.js`, `schemas/products.js` |
| No map for a pin that's only the city's                          | `apps/web/src/screens/trip/TripHub.jsx`, `Confirm.jsx`   |

Addresses: `/settings/tours`, `/settings/tours/new`, `/settings/tours/<id>`.

## 2. The list

Each tour, when it runs and its seats ("Daily 09:00 · 15 seats", "Saturdays 06:30 · 1 seat",
"Not scheduled yet"), and **ON SALE**, **DRAFT** or **RETIRED** (retired last). The words come
from the server (`runs`), built by the same `scheduleSummary()` the website uses for its chips:
a switched-off schedule doesn't count; a schedule's own seats win over the tour's.

## 3. A new tour

The least it takes to make a draft: name, summary, duration (hours and minutes), seats per
departure, how it travels, where guests meet, the address, and the map pin. It opens as a
**draft**: nobody can book it until it's on sale. The description starts as the summary.

## 4. Basics

Name, short name (24 characters, for WhatsApp's lists; empty uses the name), summary,
duration, how it travels (**on foot**, **van**, **boat**: 16b's choice, now editable), the
activity on its card, the meeting point (where, the address, how to find the guide, the map
pin), "arrive this many minutes early", and the text lists. Checked as you type, the save bar,
"Leave without saving?", only what changed is sent: the pattern from 16e-1.

**The text lists**, the way people write them (design: "as text lists"):

| List                                  | Written as                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| Included, not included, what to bring | one per line                                                                   |
| Stops                                 | one per line; what happens there after a dash: "Freedom Park — the old prison" |
| FAQs                                  | the question, its answer under it, a blank line between FAQs                   |

## 5. The map pin (decided 2026-11-21: paste a map link)

The trip page shows a map and directions, so a meeting point needs a pin. Owners rarely know
coordinates, so they **paste what Google Maps gives them**, and `readMapPin()` reads the pin
from the text itself, with **no map service called**:

- coordinates: `6.4541, 3.3947`
- a place link: `…!3d6.4541!4d3.3947` (the place itself, preferred over the map's centre)
- a map link: `…/@6.4541,3.3947,17z`; `?q=`, `?query=`, `?ll=`
- a **short link** (`maps.app.goo.gl/…`) hides the place behind a redirect we won't follow:
  "Short links can't be read. Open it, then copy the full link…"

**No pin yet?** The server stores the business's city's pin (Lagos, Abuja, Ibadan…; Lagos
when unknown) marked **`approximate`**, and the trip page shows **no map and no directions**
until the real one: a guest is never sent to the middle of the city. The confirmation page's
"Open in Maps" searches the place's name and address instead (the browser check's catch: it
used the pin whatever it was). Settings shows it as "Not
set: guests see the address, with no map or directions, until you add the pin."

## 6. On sale or not

"Published (on sale)" or "Draft (not on sale yet)", with **Put on sale** (only with a price:
the server's rule, now said plainly: "Add at least one price before putting it on sale.") or
**Take off sale**, asked first: "Guests can't book it any more. Bookings already made stay, and
their trips still run."

## 7. Who

Owners edit (products: edit). A manager sees Tours look-only: "Only the owner can change this.
You can look."

## 8. Tests

- `packages/shared/test/map-pin.test.js` (4): coordinates, links, short links, out of range.
- `apps/api/test/settings-tours.test.js` (5): the schedule in words; the city's pin,
  approximate, replaced by a real one; another city's; transport and arrive by, checked; on
  sale needs a price; a manager looks.
- `apps/web/test/trip-hub.test.jsx`: an approximate pin shows no map or directions.
- `apps/operator/test/settings-tours.test.jsx` (11): the rules; the list; a manager; a new
  tour (checked, the pin read, made, opened); basics (checked, only what changed, saved); on
  sale (asked first; no prices, no button).
- `apps/web/test/after-paying.test.jsx`: "Open in Maps" uses the address for an approximate pin.
- Mutation checks: 34 changes; 3 survived at first. Two got tests (the exact 15-minute and
  14-day limits; "Save and leave" with something to fix) and one was a filter done twice (the
  query already loads only active schedules).
- Browser check (as Tunde, then the seed owner on the check server; nothing saved): the list
  matches the design ("Saturdays 07:00 · 14 seats", ON SALE); Tunde sees a tour look-only; a
  pasted place link was read as the place, not the map's centre; a too-long short name was
  said and held Save; Discard. Fixed: the duration's boxes now fit side by side, and the
  confirmation page's map link.
