# Stage 12f-1: The trip hub

From your designs (file 05: "Trip hub · upcoming", "Trip hub · trip day", and the banners).
One light page per booking, at `/trip/<guest token>`, opened from the confirmation page and,
from session 14, from every message. **12f-2** adds "Cancel yourself" and "Ask Ìrìn".

## 1. What we built

| Piece                                          | Where                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| The page (replaces the 12e placeholder)        | `apps/web/src/screens/trip/TripHub.jsx`, `styles/trip.css`               |
| Which state to show (pure, shared)             | `packages/shared/src/trip-hub.js` → `tripSituation()`                    |
| The copy saved on the phone, checklist ticks   | `apps/web/src/lib/trip-copy.js`                                          |
| The small map, Google / Apple / WhatsApp links | `apps/web/src/lib/map.js`                                                |
| The signed ticket code                         | `ticketCode()` in `packages/db/src/guest-links.js`                       |
| The QR drawing                                 | `apps/api/src/lib/qr.js` (the `uqr` library)                             |
| Trip hub data in the guest view                | `guestView()` in `apps/api/src/routes/public-checkout.js`                |
| New fields                                     | `operators.phone`, `operators.whatsapp`, `products.arrive_minutes_early` |

## 2. How it works

### One function decides the state

```
tripSituation(booking, now) →
  phase      not_booked · upcoming · today · after · no_show · cancelled
  daysToGo   "In 18 days" / "Tomorrow", in Lagos time
  balance    { amount, due date, overdue }        → the amber or red banner, and Pay
  cancelNow  { refund, %, until }                 → "you'd get ₦62,500 back (full refund until…)"
  cancelled  { by guest or operator, reason, refund, refunded on… }
```

**Why on the phone and not on the server?** The page is often opened from the copy saved the
night before, with no signal. "Upcoming" last night is "today" this morning, so the state must
be re-worked from the saved data and the phone's clock. The page runs it again every minute.
It's in `packages/shared`, so the rules stay out of the screen, and tests cover every banner.

**Lagos time, not UTC.** "Today" starts at midnight in Lagos. At 00:30 on the 5th in Lagos it's
still the 4th in UTC. A test checks exactly that, and a mutation check (deciding by UTC) proved
the test catches it.

### The ticket: signed, never the private link

```
ticket code = "OKG1" + booking id (22) + signature (16)        42 characters → a 29 × 29 QR
```

Anyone who photographs a ticket mustn't get the booking page (from 12f-2 it has a Cancel
button). So the QR holds its **own** signed code, with a different label from the guest link.
The guide's app (session 15) turns it back into a booking with `bookingIdFromTicketCode()`.
The tests change every single character and check that each change is refused.

The **server draws the QR** as one SVG path (about 2 KB), and it travels inside the booking data.
So it's in the saved copy and works offline, and the guest app carries no QR library.

### Offline

```
open the page ──► show the saved copy at once ──► ask the server
                                                    ├─ answer → show it, save it ("last updated 08:12")
                                                    └─ no signal → keep the copy: "You're offline.
                                                       Showing what this phone saved at 08:12."
```

Buttons that need the internet say so ("Pay ₦45,500 · Needs a connection"). Copies are
deleted two weeks after the trip ends, so a shared phone doesn't keep everyone's bookings.

### The map, the light way

No map library: **four** OpenStreetMap tiles (about 60 KB), placed so the meeting point lands in
the middle, plus a pin drawn with CSS. Without signal, the box stays a plain colour and the
address and the Google / Apple Maps buttons still work. Two details:

- The server's security policy (helmet's CSP) only allowed images from our own site. It now
  also allows `tile.openstreetmap.org`.
- Trip pages send **no referrer** (12e), because the address holds the secret. OpenStreetMap asks
  for one, so the tiles use `referrerPolicy="origin"`, which sends only `http://our-site`,
  never the path.

## 3. Found along the way

- **A real bug in refunds:** the refund calculation always treated the deposit as 0 (a leftover
  from before deposits existed). A cancelled Badagry booking would have given back its
  "non-refundable" deposit. It now counts the deposit actually paid. There's a test for it, and
  a mutation check (back to 0) is caught.
- **Different tests failed on each full run:** while the database tests run, the screen tests
  render slowly and hit the 1-second default wait. They now wait up to 4 seconds (in
  `apps/web/test/setup.js`). Things that never appear still fail. Two full runs: 800 tests pass.
- **The checklist note matched the e2e locator** ("saved on this phone" appears twice): a
  stricter locator fixed it.

## 4. Why we chose what we chose

| Choice                                  | Alternative                  | Why                                                       |
| --------------------------------------- | ---------------------------- | --------------------------------------------------------- |
| State worked out on the phone (shared)  | the server says "today"      | the saved copy must change state overnight, offline       |
| A separate signed ticket code           | put the guest link in the QR | a photographed ticket must not open the booking           |
| QR drawn on the server, saved with data | a QR library in the app      | works offline, keeps the app under its 300 KB budget      |
| 4 map tiles + a CSS pin                 | Leaflet or Google Maps       | ~60 KB instead of hundreds; text works without it         |
| Staff's reason shown, quoted            | hide it                      | the design asks for it; it's what the guest needs to know |
| Guest's own reason not echoed           | show it back                 | they know it; it may hold something private               |

## 5. Concepts to study

- **Offline-first** pages: show what you have, then update
- **Capability URLs** and `Referrer-Policy` (why `origin` for the tiles)
- **Content-Security-Policy** `img-src`
- **Slippy map tiles** (Web Mercator, tile x/y at a zoom)
- **QR codes**: versions, error correction (we use "M", about 15% damage), the quiet zone
- **Domain separation** in signatures (one secret, different labels)

## 6. Try it yourself

With `pnpm dev` running, open the trip page from any confirmation ("Open your trip page"), or:

```bash
pnpm --filter @okapigo/web e2e
```

Then try it with the network off: open the page once, turn off Wi-Fi (or use the browser's
DevTools → Network → Offline), and reload. The ticket is still there.

**Your dev database** already has the new phone, WhatsApp and arrive-early values. After a
`pnpm db:reset` the seed sets them too.

## 7. Differences from the designs

- **"Change or cancel this booking"** isn't a button yet; it says "To change the date or cancel,
  message Ìrìn." The button and its three steps come in 12f-2.
- **"Ìrìn had to cancel this trip because of the weather":** the reason is free text written by
  staff, so it can't be fitted into the sentence. The title is "Ìrìn had to cancel this trip"
  and the reason follows, quoted.
- **"Today's guide: Segun"** is hidden until guides are assigned (session 15).
- **The AI box** is a disabled placeholder that says "Coming soon" (session 17).
- **No-show** and **not paid yet** weren't designed; they have plain banners.
- **Refunded** says "the card or account you paid with" (bank transfers are refunded too).

## 8. What's next

**Stage 12f-2:** "Change or cancel": cancel yourself in three steps (with the refund shown
first, from the same `tripSituation`), a new public cancel endpoint; "Ask Ìrìn" with a requests
table, a staff list and the "Your request was sent" banner.
