# Stage 17d-1: Sojourna, the guest side

| Part      | What                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------- |
| 17c…17c-3 | The channel manager, Settings › Channels, "via Sojourna" everywhere                            |
| **17d-1** | **Sojourna's storefront, tour page, checkout and booked page; OCTO content and pickups**       |
| 17d-2     | Sojourna's back office (its bookings, cancelling), its notifications, and journey 3 end to end |

Sojourna is a **pretend travel website** (an OTA, like Viator or GetYourGuide) built from your
designs, so the demo can show a business's tours sold somewhere else. It lives in
`apps/mock-ota`, runs on http://localhost:4400 (`pnpm dev` starts it), and talks to OkapiGo the
only way a real OTA could: **OCTO, over HTTP, with its own API key**. It never touches
OkapiGo's database or code; it would work against any OCTO supplier.

## 1. How it's built

```
the guest's browser ──▶ Sojourna's server (:4400) ──OCTO──▶ OkapiGo (:4000/octo)
     (its pages)          its API · its key · its store
```

**Why a server of its own?** The API key. A supplier's key lets whoever holds it hold seats and
make bookings, so it must never reach a browser. Sojourna's pages ask Sojourna's server; only
the server holds the key and talks OCTO. Every real OTA works this way.

| Piece                                    | Where                                   |
| ---------------------------------------- | --------------------------------------- |
| Talking OCTO (key, capabilities, errors) | `server/octo-client.js`                 |
| Its own bookings ("SJ-48213")            | `server/store.js` (a JSON file)         |
| Its pages' API                           | `server/app.js`                         |
| Starting it (Vite while developing)      | `server/main.js`                        |
| What the pages say (pure functions)      | `src/lib/words.js`, `src/lib/states.js` |
| The pages                                | `src/screens/*.jsx`                     |
| Its look (blue and coral, not OkapiGo's) | `src/styles/tokens.css`, `app.css`      |

**What Sojourna keeps, and what it asks for.** It keeps only what's its own: its reference, the
OCTO booking's uuid, who booked. Everything else (the status, the ticket, the date) belongs to
the supplier and is asked for when a page needs it, so the two can never disagree. A JSON file
is plenty for a handful of bookings; it's written to a temporary file and renamed, so a crash
can't leave half a file.

**One process in development.** The server runs Vite inside itself (middleware mode), so the
pages and the API share one address and no CORS is needed. Built (`build`, then `start`), it
serves `dist/` instead.

## 2. The pages

| Page               | Does                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 · experiences   | the business's tours, live: the kind on a coloured band, length, from-price, free cancellation                                                                                    |
| M2 · one tour      | a month calendar (open bold, "4 left", sold out struck, not running grey); the day's times; who's coming; a pickup point where needed; Continue holds the seats for 15 minutes    |
| M3 · checkout      | the countdown; the lead guest; "Pay (test)": nothing is charged; the order and its refund deadlines                                                                               |
| M4 · you're booked | both references; the ticket (the business's own QR code, from OCTO's voucher); where to meet or be collected; what to bring; who runs the trip; "Download ticket (PDF)" prints it |

**The states** (your "Sojourna — states") are built where they happen: the supplier not
answering (Try again), nothing listed, a pickup required, too many people ("infants need a seat
too"), a child without an adult, seats gone between loading and Continue ("Someone just took
the last seats"), the hold running out ("Your seats were released"), and the supplier not
confirming ("You haven't been charged"). "Too late to cancel online" belongs to the back office
(17d-2).

**The rules come from the supplier.** "A child needs an adult" isn't Sojourna's rule: OCTO's
units say which others must come along (`accompaniedBy`). The policy's tiers, the prices, the
seats left, the pickup points: all from OCTO, so changing them in OkapiGo changes Sojourna.

## 3. What OkapiGo's OCTO API gained

Your pages needed more than OCTO's core gives. The standard has **optional capabilities** for
exactly this; an OTA asks for them in the `Octo-Capabilities` header.

| Capability     | What it adds                                                                                                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `octo/content` | `features` (INCLUSION, EXCLUSION, HIGHLIGHT for the stops, PREARRIVAL_INFORMATION for what to bring and when to arrive, CANCELLATION_TERM), `locations` (where to meet: a START location with its place), `categoryLabels` (the tour's label: "Boat", "Walking"), `media` (photos) |
| `octo/pickups` | on the option: `pickupAvailable`, `pickupRequired`, `pickupLocations`; reserving takes `pickupLocationId`; the booking gets its pickup and the time on the day                                                                                                                     |

Both accept the bare name too (`content`, `pickups`): the docs write capabilities both ways.
17b's own `pickupPointId` still works; the standard's `pickupLocationId` is the name to use.

**One thing OCTO doesn't have:** the policy as numbers. Its cutoff is words only. So each option
also carries `refundRules` (`[{ hoursBefore: 48, refundPercent: 100 }, …]`), marked in the code
as **not in the spec** (OTAs ignore what they don't know, like the trip page link from 17b).
That's how Sojourna can say "Full refund until Thu 10 Dec, 10:00. 50% until Fri 11 Dec, 10:00."

## 4. Where the words differ from the designs

- The kind on the band comes from the tour's own label and length: Lekki is "Pickup included",
  Badagry "Day trip", the Street Food Crawl "Food tour" (from its name: its label is "Evening").
- "They'll send you a trip page with the map and reminders": OkapiGo has no trip reminders yet
  (17c-3), so it says "a trip page with the map and everything you need".
- The policy line names the business by its first word ("Ìrìn's policy"), as your M2 does.

## 5. Tests

- `apps/mock-ota/test/words.test.js` (11): dates and times; the cards (kind, band, price, free
  cancellation); the meeting point and content; the month grid; who's coming (prices, words,
  total, the rules); the policy and one trip's deadlines; a booking's lines and names.
- `apps/mock-ota/test/server.test.js` (12): against a pretend supplier: passing the tours on;
  the calendar and times (and bad dates); holding seats (unit items, 15 minutes, the pickup,
  refusals); seats gone ("taken", with the seats left) and the supplier down ("offline");
  paying (Sojourna's reference sent, kept, shown); refusals, the hold gone, not confirmed; a
  booking whose tour is off sale; the OCTO client (its key and capabilities, offline and OCTO
  errors); the store (kept across a restart).
- `apps/mock-ota/test/screens.test.jsx` (14): every page and its states, against a fake server.
- `apps/api/test/octo-catalogue.test.js` (+4): content, pickups, the policy's tiers, a booking
  with a pickup (and the standard's error when one is missing).
- Mutation checks: 35 changes; 4 survived at first. Three got tests: free cancellation holds
  until the latest full-refund tier (not the earliest); exactly the seats left is fine (only
  more is too many); a tier that gives nothing back isn't a deadline. The fourth pointed at a
  check that added nothing: only a refusal for want of seats carries the seats left, so that
  alone now decides "taken".
