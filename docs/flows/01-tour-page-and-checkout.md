# Flow 01: Tour page and checkout

**Journeys:** 1 (guest books on the website) and 5 (deposit and balance).
**PRD:** BKG-32 (hosted booking page), BKG-02 (mobile checkout, ≤ 4 screens), BKG-06 (deposits),
INV-02/23 (live availability, holds), PAY-02/03 (card and transfer).
**Goal:** a guest on a phone books and pays in **under 2 minutes**.

```
 [Catalogue]──►[Tour page]──Book──►  1 Date  ──►  2 Who & extras  ──►  3 Details  ──►  4 Review & pay ──► Paystack ──► (brief 02)
  optional       shareable link        └──────────────── checkout: at most 4 screens ───────────────┘
                                                                          seats are HELD from here ▲
```

---

## Screen A: Catalogue (all tours) · `/irin-lagos-tours`

**Purpose:** a shareable link to every tour (BKG-32 "the full catalogue"). Also reused as the tour
list on the operator website (brief 04).

**Shows:** operator name; one card per published tour: title, summary (1–2 lines), duration,
**"from ₦25,000"** (the adult price), next available date ("Next: Sat 5 Dec").
**Actions:** tap a card → Tour page.
**States:** loading · no tours published ("No tours available right now") · offline.

## Screen B: Tour page · `/irin-lagos-tours/lagos-island-heritage-walk`

**Purpose:** the link operators share on Instagram, WhatsApp and QR codes (BKG-32). It must make
sense to someone who has never heard of Ìrìn.

**Shows (in roughly this priority):**

1. Title, summary, duration, **from price**, a **Book** button visible without scrolling
2. Next few available dates with seats left (a teaser of screen 1)
3. Meeting point: name and address (a map is optional here; it's essential on the trip hub)
4. What's included / not included
5. Stops, in order (short descriptions)
6. What to bring
7. FAQs (collapsible)
8. Cancellation policy, in one line plus details: "Free cancellation up to 48 hours before"
9. Pickup points, where the tour has them (Lekki): "Pickup from Victoria Island, Ikoyi or Lekki Phase 1"

**Actions:** Book (sticky on mobile is a good idea) · share · tap a date in the teaser → screen 1
with that date chosen.

**States:** loading · tour not found / no longer sold (archived) · **sold out for the next 2 weeks**
("Sold out until… / see later dates") · tour has no upcoming dates at all.

**Link preview (please design this too):** when the link is pasted in WhatsApp, Instagram DMs or
Facebook, they show a card with **title, one line of description, an image, and the price**. Design
the image: a 1200 × 630 px share card per tour (photo or a branded fallback, the title, "from
₦25,000"). The server generates these from product data.

---

## Checkout screen 1: Choose a date

**Shows:** upcoming departures (the next 60 days exist). Each one shows the date, start time and
**seats left**. A calendar or a list both work; on phones a scrollable list of dates grouped by week
is often clearer. Some tours run daily, others only on weekends, so the design must handle both
"every day" and "two days a month" without looking empty.

**Actions:** pick a departure → screen 2.

**Rules:**

- Show **"Only 3 left"** when ≤ 3 seats remain; show sold-out dates **disabled**, not hidden (so
  guests understand it's popular rather than closed).
- Cancelled departures (e.g. weather) don't appear.
- Times are Lagos time ("Sat 5 Dec · 09:00").

**States:** loading · no departures in this period ("Next available: …") · all sold out · a date
that sold out **while the guest was looking** (shown on screen 3→4, see below).

## Checkout screen 2: Who's coming, and extras

**Shows:**

- **Travellers by price category**, each with a − / + stepper and the price per person:
  "Adult (13+) ₦25,000 · Child (3–12) ₦12,500 · Infant (0–2) Free"
- **Add-ons** where the tour has them, each with a stepper, price, short description and stock when
  it's limited: "Extra tasting plate · ₦5,000 · 4 left tonight"
- **Pickup point** where the tour has them (Lekki): choose one of 3
- **Price summary**, updating live: lines per category and add-on, the **total**, and "Includes VAT"

**Actions:** change counts → price updates; Continue → screen 3.

**Rules:**

- At least 1 traveller. The total of travellers can't exceed seats left on the chosen date ("Only 3
  seats left on this date").
- Add-on quantities can't exceed stock.
- Prices come from the server's pricing engine (identical on every channel); the screen never
  calculates money itself.

**States:** price updating · seats limit reached · add-on sold out.

**✅ Decided (2026-11-17):**

- **Children and infants can't book without an adult.** A basket with no adult can't continue:
  design the message beside the counters ("Children must travel with an adult"), and keep
  **Continue** disabled until there is one. The server enforces it too (stage 11b).
- **Pickup points:** the guest picks one on this screen (required for tours that have pickup
  points). The choice is stored on the booking (stage 11b) and shown on the confirmation, the trip
  hub and the guide's manifest.

## Checkout screen 3: Your details

**Shows:**

- **Lead booker** (the person paying; may or may not travel): full name; **email or phone**, at
  least one (both welcome); "Send me offers and news" checkbox, **unticked by default**
- **Each traveller:** name and **age** (needed for the right price, the manifest, and age rules);
  **dietary needs** (optional; emphasise it on the Street Food Crawl: "Allergies or dietary needs?")
- "I'm travelling too" shortcut that copies the lead's name into traveller 1
- **"I accept the booking terms"** checkbox, **required**, with links to the terms and the
  cancellation policy

**Actions:** Continue to payment → **this is the moment seats are held for 15 minutes** and the
booking is created (status "held"), then screen 4.

**Rules:**

- A traveller's age must match the category chosen on screen 2 (e.g. a "Child" must be 3–12). Say
  so beside the field: "Children are 3–12. For age 13, choose Adult."
- Phone accepts `0803 123 4567` or `+234 803 123 4567`.
- Say before the button: "We'll hold your seats for 15 minutes while you pay."

**States:**

- field errors (missing name, invalid email or phone, terms not accepted)
- **sold out while filling in** (someone else got the last seats): "Sorry, only 1 seat is left now",
  with options to change the date or the number of travellers. The guest's details must be kept.
- add-on ran out meanwhile (same idea)
- network error on Continue (Try again keeps everything)

## Checkout screen 4: Review and pay

**Shows:**

- Tour, date and time, meeting point (name + address), pickup (if any)
- Travellers (names, categories), add-ons
- Price lines, **total**, "Includes ₦X VAT"
- **Hold countdown:** "Seats held for 14:32", visible but calm (not alarming)
- Cancellation policy in one line, with details available
- **Deposit choice, only for tours that allow one (Badagry):**
  - ( ) **Pay in full: ₦65,000**
  - ( ) **Pay a 30% deposit now: ₦19,500.** The balance of ₦45,500 is due by **Sat 28 Nov** (we'll
    remind you by email/WhatsApp, with a link to pay)
  - and in small print: "Deposits are non-refundable" (from the policy)
- "You'll choose **card or bank transfer** on the next step, secured by Paystack."

**Actions:** **Pay ₦X** → the browser goes to Paystack's page (card, transfer, USSD…) and returns to
the confirmation flow (brief 02) · Edit (back to any earlier screen while the hold lasts).

**States:**

- **Hold expired** before paying: "Your 15 minutes are up and the seats were released." Offer to
  **hold them again** (if still available) without re-entering anything.
- Payment being set up (a double tap): "Setting up your payment…", then it continues
- Payment service unavailable: "Payment is temporarily unavailable. Your seats are still held for
  12:10. Try again."
- Deposit not available for this tour (no choice shown)

---

## Data and API (for reference)

| Need                                     | Endpoint                           | Status                                          |
| ---------------------------------------- | ---------------------------------- | ----------------------------------------------- |
| Tours, prices, content                   | public catalogue API               | **new, session 11** (staff version exists)      |
| Seats per departure                      | public availability                | **new, session 11** (`listAvailability` exists) |
| Live price                               | public quote (same pricing engine) | **new, session 11** (`POST /api/quotes` exists) |
| Hold + create booking                    | public booking (channel "web")     | **new, session 11** (`createBooking` exists)    |
| Start payment (full or deposit)          | public payment start               | **new, session 11** (`startPayment` exists)     |
| Deposit rules (30%, due date, reminders) | product settings                   | **new, session 11**                             |
| Link previews (title, image, price)      | server-rendered meta tags          | **new, session 11**                             |

All of the booking, pricing, hold and payment logic already exists and is tested; session 11 adds the
public endpoints and these screens on top.
