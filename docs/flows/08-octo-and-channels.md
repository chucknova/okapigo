# Flow 08: Selling through OTAs (OCTO, the channel manager, the mock OTA)

**Journey 3:** _"The mock OTA storefront books a Tarkwa Bay seat through OCTO; availability drops
everywhere and the booking shows its channel."_
**PRD:** DST-01 (an OCTO-compliant API, checked by contract tests), DST-02 (a channel manager:
two-way availability and price sync; _"a sale anywhere updates every channel within 60 seconds"_),
DST-03 (a mock OTA: _"a small separate app built to the OCTO specification, with its own
storefront, that books Ìrìn's tours through the OCTO API"_).
**Goal:** an online travel agency (an **OTA**: Viator, GetYourGuide…) sells Ìrìn's tours from the
same seats and prices as the website and WhatsApp, and Ìrìn sees every OTA sale like any other.

```
 Mock OTA (its own app, its own look)                       OkapiGo (Ìrìn)
 ─────────────────────────────────────                      ─────────────────────────────────
 M1 Tours ──► M2 A tour: date, time, who ──► M3 Checkout     OCTO API (17a, 17b)
                       │ seats HELD (OCTO "reserve")  ──────►  the same seats as the website
                       ▼                                       │
               M4 Booked (ticket) ◄──── OCTO "confirm" ───────►  a booking, channel: Mock OTA
               M5 The OTA's bookings: cancel ─────────────────►  cancelled, under Ìrìn's policy
                                                               │
                                             Settings › Channels (O11): connect, tours, money
```

Two things to design: **the mock OTA** (a pretend travel website, screens M1–M5) and **one
operator screen**, Settings › Channels (O11). Everything else already exists: an OTA booking
appears in Bookings, the schedule, the manifest and the inbox like any other, with its channel.

Decided (2026-11-21): **the OTA takes the guest's money** and owes Ìrìn the price minus its
commission (20% for the mock OTA); session 17 in four parts (below); you design these screens.

---

## Part 1: The mock OTA (its own app: `apps/mock-ota`)

A small, separate website standing in for Viator or GetYourGuide: **its own name and look, not
Ìrìn's and not OkapiGo's** (a fictional name: yours to choose; please not a real company's). It
knows nothing about OkapiGo's database: everything comes through the OCTO API with its own key,
exactly as a real OTA would. In the demo video it's the "other website" where a Tarkwa Bay seat is
bought.

### M1 · Tours

Ìrìn's tours, as an OTA lists a supplier's products.

- **Shows:** each tour's title, short description, duration, "from" price (₦, per adult), and
  the supplier's name ("by Ìrìn Lagos Tours"). Photos come later (uploads, session 19).
- **Does:** open a tour.
- **Data:** OCTO `GET /products` (with pricing).
- **States:** loading; the supplier's API can't be reached ("Ìrìn Lagos Tours isn't answering
  right now"); no tours.

### M2 · A tour: date, time, who's coming

- **Shows:** a calendar (open days; sold-out and closed days), the day's start times with seats
  left ("4 left"), and counters per unit: Adult (13+), Child (3–12), Infant (0–2), with prices.
  The rule from Ìrìn: children and infants need an adult (OCTO's `accompaniedBy`).
  The total. Ìrìn's cancellation terms in one line ("Full refund 48 h+ · 50% 24–48 h · No refund
  under 24 h").
- **Does:** choose a date, a time, how many; **Continue** holds the seats.
- **Data:** OCTO `POST /availability/calendar` (days), `POST /availability` (times, seats,
  prices), then `POST /bookings` (hold).
- **States:** sold out; not enough seats for that many; a child without an adult; the seats
  went while choosing ("Someone just took the last seats").

### M3 · Checkout

- **Shows:** the summary (tour, date, time, who, total), a countdown while the seats are held
  ("Seats held for 14:52"), the lead guest's name, email and phone.
- **Does:** **Pay** with a pretend card (the OTA's own; nothing real is charged, and no card
  details are typed: a "Pay ₦96,750 (test)" button is enough), then the booking is confirmed.
- **Data:** OCTO `POST /bookings/{uuid}/confirm`.
- **States:** the hold ran out ("Your seats were released: choose again"); confirming failed.

### M4 · Booked

- **Shows:** "You're booked", the OTA's own reference and Ìrìn's (ILT-…), the QR ticket from
  Ìrìn, where to meet (with the map link), what to bring. A note that Ìrìn runs the tour.
- **Does:** back to the tours; see "My bookings".
- **Data:** the confirmed OCTO booking (its voucher: a QR code).

### M5 · The OTA's bookings (its staff's view)

A simple list, as an OTA's back office would have it, so the demo can show a cancellation.

- **Shows:** each booking: reference, tour, date, who, total, status (confirmed, cancelled).
- **Does:** **Cancel**: shows what Ìrìn's policy gives back first ("Cancelled 72 hours before:
  full refund"), then cancels.
- **Data:** OCTO `GET /bookings/{uuid}`, `POST /bookings/{uuid}/cancel`.
- **States:** too late to cancel online (past the cutoff): "Ask Ìrìn".

---

## Part 2: Settings › Channels (O11, the owner)

A seventh section in Settings, beside Website, Embed, Messages, WhatsApp, Staff and Tours.

- **The list:** each connected channel: its name ("Mock OTA"), connected or switched off, its
  commission (20%), how many tours it sells ("5 of 5 tours"), sales this month ("6 bookings ·
  ₦412,000"), what it owes Ìrìn ("₦329,600 owed"), last activity ("Last booking 10:42").
- **Connect a channel:** its name and commission → **the API key, shown once**, with the
  OCTO endpoint to paste in the OTA's settings and Copy buttons. "Store it now: you won't see
  it again." (Like the WhatsApp page, nothing secret is ever shown twice.)
- **One channel:**
  - **Tours on this channel:** a switch per tour (only published tours can be on).
  - **Commission:** the % it keeps (new sales use the new %; past ones keep theirs).
  - **Its bookings:** the latest few, linking to the bookings desk (filtered by this channel).
  - **New key** (the old one stops working at once, asked first) and **Switch off** (it can't
    see or sell anything; its existing bookings stay).
- **States:** no channels yet ("Sell on OTAs: connect one with OCTO"); a key just made (shown
  once); switched off.

**Elsewhere (no new screens):** a booking from an OTA shows **"via Mock OTA"** on the bookings
desk, the booking's page, the departure and the manifest, and its money as "Paid by Mock OTA:
owes ₦32,000 (₦40,000 less 20%)" rather than a guest payment.

---

## Rules every screen must respect

- **One stock of seats.** An OTA hold counts against the website and WhatsApp immediately, and
  theirs against the OTA (it's the same departure row). Journey 3 checks "availability drops
  everywhere".
- **One price.** The OTA's prices are the website's (the same pricing pipeline); the OTA's net
  is the price less its commission.
- **Holds.** The OTA's seats are held for as long as it asks, up to 30 minutes (the WhatsApp
  hold), then released by the same background job.
- **Sync within 60 seconds** (DST-02). OCTO OTAs ask for availability when they need it; the
  channel manager also **tells** connected OTAs when a departure's seats or prices change
  (a webhook), so their own pages are never more than a minute stale.
- **The supplier's rules win.** Children with an adult; Ìrìn's cancellation policy; Ìrìn's
  cutoff.

## Questions for you

1. **The mock OTA's name and look.** A fictional name and its own simple style (not Ìrìn's
   Lagoon). Any preference? (Suggestion: something plain like "Tripwell".)
2. **Who tells an OTA guest about their booking?** Real OTAs send their own confirmations.
   Should Ìrìn's own messages (WhatsApp and email: confirmation, reminders) also go to OTA
   guests? Suggestion: **yes for the trip page and reminders** (Ìrìn runs the tour), **no
   confirmation** (the OTA already sent one).
3. **Does an OTA cancellation follow Ìrìn's policy?** Suggestion: **yes**: the OTA refunds its
   guest; Ìrìn's books say the OTA owes the part the policy keeps.

## Session 17, in four parts (decided 2026-11-21)

| Part    | What                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------ |
| **17a** | OCTO catalogue: supplier, products, units, availability, the calendar; channel keys; contract tests    |
| 17b     | OCTO bookings: hold, confirm, cancel; the booking's channel and money; no oversell across channels     |
| 17c     | The channel manager: Settings › Channels (your design), tours per channel, keys, the 60-second webhook |
| 17d     | The mock OTA app (your design) and journey 3 end to end                                                |
