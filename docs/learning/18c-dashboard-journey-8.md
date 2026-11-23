# Stage 18c: the dashboard, and journey 8

| Part    | What                                                                 |
| ------- | -------------------------------------------------------------------- |
| 18a     | The AI companion: its server (18a-1), its card and journey 7 (18a-2) |
| 18b     | Posters                                                              |
| **18c** | **The dashboard (D1), and journey 8. Session 18 is done.**           |

RPT-01: _"Today's departures, bookings, revenue and check-ins, with a 30-day trend."_ Journey 8:
_"Picks a product, gets an auto-filled poster to download, then reviews today's bookings and
revenue on the dashboard."_

## 1. What the numbers mean

**Money in** (decided on the canvas): money that arrived minus refunds sent, by the day it
happened. It's read from the **ledger** (PAY-22), not added up from payments. The ledger
already records every money event, each on the day it happened, and the books must balance.
So the dashboard can't disagree with the accounts.

| In the ledger (money accounts: Cash 1000, Paystack 1100, Bank 1200) | On the dashboard               |
| ------------------------------------------------------------------- | ------------------------------ |
| a guest pays (`payment_received`)                                   | money in                       |
| a guide's cash handed in (`cash_received`)                          | money in                       |
| an OTA pays what it owes (`ota_payment`)                            | money in, for that OTA         |
| a refund leaves (`refund_paid`)                                     | money out ("₦25,000 refunded") |
| a refund owed but not sent (`refund_owed`)                          | nothing yet (no money moved)   |
| Paystack's fee (`payment_fee`)                                      | **left out**: not a refund     |
| a mistake reversed (`reversal`)                                     | nets to zero, as it should     |

One SQL query adds each transaction's change to the money accounts, then groups the
transactions by the **Lagos** day (`occurred_at AT TIME ZONE 'Africa/Lagos'`). 23:30 in Lagos is
that day, 00:30 the next, whatever the server's clock says.

**A booking made** is one whose **hold was converted** (confirmed or paid). A guest who held
seats and walked away also ends up "cancelled", but never made a booking, so they aren't
counted.

| The rest                 | From                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Departures today         | under way · to come · ended (cancelled ones not counted)                            |
| Checked in today         | travellers of bookings that are coming: present or late, of all of them             |
| The 30-day trend         | each day's money in and bookings; against the 30 days before ("+12%")               |
| Where bookings came from | bookings by channel (an OTA by its own name), and the money they brought            |
| Seats filled, by tour    | the last 30 days' departures: sold ÷ seats, a smaller van counting as its own seats |

No percentage when there was nothing before ("+∞%" helps nobody); "Same" when it rounds to 0.

## 2. Where things live

| Piece                                     | What                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `packages/db/src/dashboard.js`            | `dashboardFigures()`: the figures (two SQL queries, the rest Prisma) |
| `packages/shared/src/dashboard.js`        | `dashboardView()`: every word ("1 under way · 2 to come")            |
| `GET /api/dashboard` (reports: view)      | the view, never cached (it shows money)                              |
| `apps/operator/src/screens/Dashboard.jsx` | draws it; More › Dashboard on a phone, the desk menu                 |

The owner and managers see it (reports); guides don't.

## 3. Journey 8, end to end

`apps/web/e2e/journey-8-poster-dashboard.spec.js`:

1. A guest books a Heritage Walk and pays. The books show one more booking today and ₦25,000
   more in.
2. A manager signs in. It's a new one, made for this journey: journeys 3 and 7 already sign in
   the business's manager and owner, and one address gets one code a minute.
3. **Posters:** the Heritage Walk, Seats left, its departure. The preview really loads, and
   **Download** saves `lagos-island-heritage-walk-seats-left.png`, a real 1080 × 1080 PNG.
4. **Dashboard:** today's bookings and money exactly as the books say, from the website, with
   the 30 days and where bookings came from.

**All eight PRD journeys now have their e2e test.**

## 4. Found along the way

- **The poster preview never showed in the real app** (a bug from 18b, found now).
  - The API's security policy (Content-Security-Policy) allowed images only from the site,
    `data:` and the map tiles. The preview is a picture the page fetched itself, shown from a
    `blob:` address.
  - The tests fake the server, so the policy never applied there. Journey 8's "visible" check
    passes for a broken picture too, and Download kept working.
  - The browser check's screenshot showed the alt text where the poster should be.
  - Fixed: `blob:` images are allowed, a test checks the header, and journey 8 now checks the
    picture's real width (1080).
  - **Lesson:** in 18b I checked the screen only through its tests. A screenshot of the real
    built app is worth the minute.
- **A lapsed hold isn't a booking.** The first version counted bookings that weren't "held" or
  "expired", but "expired" isn't a booking status: a lapsed hold leaves its booking
  "cancelled". The database refused the test's "expired", which is how I noticed. Counting
  converted holds is exact.
- **Run 1's one failure** was the WhatsApp ticket test (a known trap under load); it passed
  alone.

## 5. Checks

- `packages/shared/test/dashboard.test.js` (10): every line's words; the change (up, down, same,
  none); bars (refund days draw nothing); dates and channel names; the view (tiles, trend,
  channels by bookings, tours by fill, none without seats).
- `apps/api/test/dashboard.test.js` (8):
  - money: in, out, fee left out, a reversal undone, a reversed fee
  - days: the Lagos day; the 30 days before, with their refunds; 60 days ago left out
  - bookings: by channel, a lapsed hold left out, the OTA's own name and what it paid
  - seats filled: a smaller van; cancelled departures left out
  - today: under way, to come, ended; check-ins (late counts; a cancelled booking's guests don't)
  - the route: words, never cached, guides refused
- `apps/operator/test/dashboard.test.jsx` (4): who; D1 (tiles, trend, 30 bars with today's,
  channels, tours); an empty 30 days; More with and without reports.
- `apps/api/test/posters.test.js` (+1): the preview's `blob:` image is allowed.
- **Mutation checks:** 25 changes; 3 survived at first and got tests (refunds in the 30 days
  before, a smaller van, a cancelled booking's guests).
- **Full runs:** run 1: the known WhatsApp ticket timeout (passed alone); run 2 passed: 1,780.
- **E2E:** all 12 pass, journey 8 included (twice: before and after the preview fix).
- **Browser check:** a headless Chrome against my API on :4300 and the e2e database, signed in
  as a manager of a throwaway business with a paid booking today. I took screenshots of the
  Dashboard and Posters at desk and phone sizes:
  - the broken preview (fixed, then shot again)
  - the dashboard's missing gap between the tiles and the trend (fixed)
  - your browser pane wasn't used, so its saved sign-in is untouched
  - the business was deleted afterwards

## 6. Concepts to study

- **Double-entry ledgers as the source of truth for reports.**
- **Time zones in SQL**: `AT TIME ZONE` and why "today" is the business's, not the server's.
- **Content-Security-Policy**: what `img-src` allows, and `blob:` and `data:` addresses.
