# Flow 09: The AI companion, posters and the dashboard (session 18)

**Journey 7:** _"'What should I wear for the Heritage Walk?' is answered from Ìrìn's own content;
an unclear question goes to staff."_ (GST-04, GST-16)
**Journey 8:** _"Picks a product, gets an auto-filled poster to download, then reviews today's
bookings and revenue on the dashboard."_ (MKT-01, MKT-02, RPT-01)

**PRD:**

- **GST-16** AI trip companion: _"Answers guest questions from Ìrìn's product content, policies and
  FAQs in English, and hands over to staff when unsure; usage capped per session."_
- **MKT-01** Poster templates: _"Three or four templates for new tours, offers and 'seats left'."_
- **MKT-02** Auto-fill from products: _"Product photo, price, date and a booking QR code inserted
  automatically; download as PNG."_
- **RPT-01** Dashboard: _"Today's departures, bookings, revenue and check-ins, with a 30-day trend."_

```
 Guest (trip page)                                  Staff (operator app)
 ──────────────────────────────                     ──────────────────────────────────────
 C1 Ask a question ──► answered from Ìrìn's notes
          │
          └─ not sure ──► handed to the team ─────► Inbox › Requests: "Question" (C3)
                              ▲                          │ reply (exists: WhatsApp, email)
                              └──── the reply shows on the trip page (exists)

                                                    P1 Posters: tour → template → PNG
                                                    D1 Dashboard: today, and 30 days
```

**Decided (2026-11-22):** the companion runs on **Claude Haiku** (Anthropic's small, fast model)
behind one adapter, with a fake for tests; a question it can't answer goes to staff **as an inbox
request** (the trip page's "ask the operator" requests, kind _question_); posters have **a photo
slot now**, filled once tours have photos (uploads: session 19); session 18 in **three parts**:
18a the companion (journey 7), 18b posters, 18c the dashboard and journey 8.

Three things to design: **the companion on the trip page** (C1–C2, guest side), **its question in
the inbox** (C3, small), **posters** (P1–P2) and **the dashboard** (D1), in that order of need.

---

## Part 1: The AI companion (guest side, the trip page)

It replaces the trip page's "Ask a question · Coming soon" card. The page's rules still hold:
**opened on the day, outdoors, on a weak connection**: light, text first, useful offline.

### C1 · Ask a question

- **Shows:** a short line on what it is ("Answers from Ìrìn's tour notes. If it's not sure, it
  passes you to the team."); **two or three suggested questions** to tap, from the tour's FAQs
  ("What should I wear?", "Can you cater for allergies?"); a question field and Send.
- **Does:** send a question (typed, or a suggestion tapped).
- **Data it can use:** this booking's tour (description, meeting point, pickup, stops, what to
  bring, FAQs), Ìrìn's cancellation policy, this booking's own facts (date, time, travellers,
  paid or balance due). **Nothing about other guests.**

### C2 · The conversation

The guest's questions and the answers, newest last, on the card (not a full-screen chat: it's one
section of the trip page).

| State                      | What the guest sees                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Thinking**               | their question, then a "…" while the answer comes (a few seconds)                                                                                                                    |
| **Answered**               | a short answer (2–4 sentences), with where it came from: _"From Ìrìn's notes on the Heritage Walk"_                                                                                  |
| **About changing money**   | changes, cancelling, refunds: it explains the policy, then points to the page's own buttons: _"To change or cancel, use Change or cancel below"_ (it never changes a booking itself) |
| **Not sure → handed over** | _"I'm not sure, so I've passed your question to Ìrìn's team. They'll reply by WhatsApp or email, and here."_ The question becomes an inbox request at once (no extra tap)            |
| **The team replied**       | the reply appears on the page (this already exists for "ask the operator" requests)                                                                                                  |
| **Limit reached**          | about **20 questions per booking per day**: _"That's all the questions for today. Message Ìrìn below."_ (WhatsApp and call buttons are on the page)                                  |
| **Not available**          | the monthly spend cap reached, or the AI service down: _"The assistant isn't available right now. Message Ìrìn below."_, field disabled                                              |
| **Offline**                | the earlier answers still show (the page keeps what it last loaded); the field says it needs a signal                                                                                |
| **Trip over / cancelled**  | still there (guests ask about refunds and lost items), or hidden: **your call**                                                                                                      |

**Rules for the answers** (mine to build; listed so the design fits them):

- English, short, plain; **only from Ìrìn's content**: never invents prices, times or policies.
- Says "not sure" rather than guessing, and that's what hands it to staff.
- Common questions are answered from a cache (the same answer for the same question on the same
  tour), so the demo stays cheap and quick.
- A small label says it's automated: _"Automated answers · checked by Ìrìn's team when unsure"_
  (or your words).

## Part 2: The question in the inbox (staff side, small)

### C3 · A "Question" request

Inbox › Requests already lists "ask the operator" requests (change date, cancel, other). A handed
over question is one more kind, **Question**: the guest's words, **what the companion said**
(if anything), and the booking. Replying works as today (WhatsApp and email, and on the trip
page). Please design only what differs: the kind's label and how the companion's attempt shows.

---

## Part 3: Posters (operator app)

For the owner or a manager, to post on Instagram, WhatsApp status or a flyer. **Where it lives in
the app is your call** (suggestion: More › Posters).

### P1 · Make a poster

1. **Pick a tour.**
2. **Pick a template** (three or four):

   | Template       | Filled in automatically                                                    | The owner can change |
   | -------------- | -------------------------------------------------------------------------- | -------------------- |
   | **New tour**   | title, short description, "from ₦25,000", duration                         | the headline         |
   | **Offer**      | title, price, the dates it runs                                            | the offer's words    |
   | **Seats left** | a departure: "Only 4 seats left · Sat 5 Dec, 09:00" (live, from the seats) | which departure      |
   | (a fourth?)    | yours to suggest, e.g. "This weekend": the next few departures             |                      |

   Every poster has: **the tour's photo** (or, until tours have photos, a design that looks
   complete without one: colour, pattern, type), **Ìrìn's name**, and **a QR code to book**
   (the tour's booking page).

3. **Size:** square (1080 × 1080, Instagram and WhatsApp status) and tall (1080 × 1920, stories)?
   Your call.
4. **Download PNG.**

Note: there's **no discount engine**. An "Offer" poster shows the owner's words ("Easter
special") and the real price; it doesn't change what guests pay.

### P2 · States

No tours yet; a tour with no upcoming departures (Seats left can't be used); a long title; a tour
with no photo; the download being prepared.

---

## Part 4: The dashboard (operator app)

### D1 · Dashboard

For managers and the owner (it shows money; guides never see it). **Where it lives is your call:**
its own screen (More › Dashboard, or a tab on wide screens), or numbers on top of the manager's
Today (which already lists today's departures with their check-ins).

- **Today:** departures (and how many have started), **bookings** made today, **revenue** today,
  **check-ins** ("38 of 41").
- **30-day trend:** bookings and revenue per day, over the last 30 days (a small chart), perhaps
  against the 30 days before.
- **Perhaps:** by channel (website, WhatsApp, Sojourna), the busiest tours. Your call.

**One question for you: what is "revenue"?** Two honest answers:

- **Money in** (suggested): payments received that day, minus refunds sent; OTA sales count when
  Sojourna pays (that's when the money arrives).
- **Sales**: the value of bookings made that day, whatever's been paid so far (deposits, OTAs).

**States:** a day with nothing yet; the first days of a new business (less than 30 days of
history); offline (it says when the numbers are from, like Today does).

---

## Constraints (as for every screen)

Phone first (360 px), then wider; WCAG 2.1 AA (contrast, 44 px tap targets, labels, errors in
words); the trip page stays light (the companion adds no big scripts or fonts); tokens for every
colour; money as **₦25,000**. Posters are images, so their text needs good contrast too, and the
PNG should stay readable once WhatsApp compresses it.
