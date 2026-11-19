# Flow 06: Booking on WhatsApp

**Journey 2:** _"Chats in the simulator, picks the Street Food Crawl, gets a payment link, pays by
test bank transfer and receives the ticket in the chat."_
**PRD:** BKG-09 (WhatsApp booking: _"a guest browses tours, picks a date, receives a payment link
and gets the ticket in the chat; staff can take over the conversation; the same flow runs through
the WhatsApp Cloud API test number when it is connected"_), PAY-03 (transfer), PAY-05 (links).
**Goal:** the same booking as the website (same prices, seats, rules), in a chat.

```
 guest: "Hi"  ──►  Tours (list)  ──►  Dates (list)  ──►  Who's coming  ──►  Extras / pickup  ──►  Name  ──►  Summary
                                                                                                    │ Pay
                                         seats are HELD from the summary ──────────────────────────┤
                                                                                                    ▼
                                                     payment link (flow 02, screen E) ──► paid ──► ticket in the chat
        at any point: "Talk to a person" ──► staff take over ──► "Back to the bot"
```

Two things to design: **the conversation** (the words and the choices at each step) and **two
screens** (the simulator, and staff taking over).

---

## Part 1: The conversation

WhatsApp only offers a few building blocks, and the design should use only these, so the same
conversation runs in the simulator **and** on the real WhatsApp test number:

| Block         | What it is                          | Limits (WhatsApp's own)                 |
| ------------- | ----------------------------------- | --------------------------------------- |
| Text          | a message                           | 4,096 characters; _bold_ and _italic_   |
| Reply buttons | up to 3 buttons under a message     | 20 characters per button                |
| List          | one button that opens up to 10 rows | row title 24 characters, description 72 |
| Image         | a picture with a caption            | the QR ticket                           |
| Link          | a URL in a text (shows a preview)   | the payment link, the trip hub          |

The guest can also **type** at any point: "hi", a number, "help", "cancel", "start again". The
bot should understand a few words and otherwise say what it can do.

The steps, with my **draft** wording, all yours to change:

### 1 · Hello

> Hi! I'm Ìrìn Lagos Tours' booking assistant. I can show you our tours and book one for you.
> [See tours] [Talk to a person]

### 2 · Tours (a list)

> Here are our tours. Prices are per adult and include VAT.
> **[Choose a tour]** → rows: _Lagos Street Food Crawl · from ₦35,000 · Thu–Sat 18:30_ …

Five tours today, so one list. (With more than 10: "More tours" as the last row.)

### 3 · A tour, then its dates (a list)

> _Lagos Street Food Crawl_ · 3 h 30 min · from ₦35,000
> An evening of suya, boli, amala and puff-puff across Yaba and Surulere. Free cancellation up to
> 48 hours before.
> **[Choose a date]** → rows: _Thu 19 Nov · 18:30 · 9 left_ … (up to 9, then "Later dates")
> [Tour details] (the tour page link)

Sold out or few seats: the row says so. No dates: "No dates in the next 3 months. [Talk to a
person]".

### 4 · Who's coming

The website asks with + / − counters. In a chat, the simplest is to ask one question per price
category, with buttons for common answers:

> How many adults (13+)? [1] [2] [3+]
> Any children (3–12)? [None] [1] [2+] ("3+" / "2+" → "Type the number")

Then the rules the website already has: at least one adult with any child; seats left; group of
over 20 → "contact us".

Ages: the price depends on the category, but the server checks each traveller's age
(stage 12d). **Question 1** below.

### 5 · Extras and pickup (only when the tour has them)

> Would you like an extra? [Palm wine sampler (+₦5,000)] [No thanks]
> Where should we pick you up? → list of pickup points (Lekki tour)

### 6 · Name (and email, optional)

The guest's **phone number is already known** (it's their WhatsApp). Ask:

> What name should the booking be under?
> An email for your receipt? (optional) [Skip]

### 7 · Summary, seats held

> _Lagos Street Food Crawl_ · Thu 19 Nov · 18:30
> 2 adults · ₦70,000 (includes VAT)
> Free cancellation until Tue 17 Nov, 18:30.
> I'm holding your seats for 15 minutes.
> [Pay ₦70,000] [Change something] [Cancel]

By tapping Pay the guest accepts the booking terms (the website has a tick box). **Question 3.**

### 8 · Paying

> Here's your secure payment link (card or bank transfer, by Paystack):
> https://okapigo.app/pay/… ← the payment link page you designed (flow 02, screen E)

Deposits: on tours with a deposit, "Pay a 30% deposit (₦19,500)" is a choice here.

### 9 · Paid → the ticket

> ✓ Booking confirmed · ILT-7K4Q2M
> Lagos Street Food Crawl · Thu 19 Nov · 18:30 · Yaba Tech main gate
> [the QR ticket as an image]
> Your trip page, with the map and what to bring: https://okapigo.app/trip/…

Also: "Payment didn't go through" (a declined card) with "Try again", and "Your 15 minutes are up"
with "Hold them again".

### Talking to a person

At any step: [Talk to a person] (or the word "agent" / "person"):

> I've asked the Ìrìn team to join. They usually reply within a few minutes. (Until they do, you
> can still type "menu".)

While staff are talking, **the bot stays quiet**. When staff hand back, the bot says where things
were.

---

## Part 2: The screens

### Screen G: The WhatsApp simulator · `apps/simulators` (its own small app)

**Purpose:** a free, reliable stand-in for WhatsApp, for demos, the walkthrough video and the
tests. It should **look like a phone chat** but needn't copy WhatsApp's branding.

**Shows:** a phone-width chat: the operator's name and picture at the top, messages as bubbles
(the guest's on one side, the bot's and staff's on the other), reply buttons under a message, a
list opening as a sheet, images, links with previews, a text box and Send.
**Also needed (it's a simulator):** choose **which guest** you are (a phone number and name, e.g.
"Adaeze · 0803 123 4567"), and **start a new chat**.
**States:** empty (before "Hi"); the bot "typing…"; a message that failed to send; staff have
joined ("Ìrìn team is replying"); the chat on a desktop screen (a phone frame in the middle?).

### Screen H: Staff taking over

**Purpose:** staff see conversations, read them, and reply in person (BKG-09 "staff can take
over").

**Shows:** a list of conversations (newest first, "needs a person" at the top), and one
conversation: its messages, the booking it led to (if any), a reply box, and **Take over** /
**Hand back to the bot**.

**Question 4:** this is an **operator** screen. Like the Embed page (flow 03), it could wait for
the operator app's designs; or a simple version could live inside the simulator for now.

---

## Decided (2026-11-18)

1. **Travellers:** the lead's name, and an **age only for each child or infant** (to check the
   price category). Other travellers are named by staff at check-in.
2. **Seats are held for 30 minutes** on WhatsApp (the website keeps 15).
3. **Terms:** "By tapping Pay you accept the booking terms" with the link (no separate step).
   Change it if you'd like a separate [I accept].
4. **The staff take-over screen** is designed later, with the operator app (like the Embed
   page). Its **API** is built now.
5. **The ticket:** the QR image and the trip page link.

So **please design:** the conversation's wording (Part 1) and the simulator (screen G).

## What I can build before your designs

The **conversation engine** doesn't need screens, like the backend sessions: the steps above as
a state machine on the server, using the same quote, hold, booking and payment-link code as the
website; the ticket sent when the payment settles; the take-over API; and an adapter interface so
the simulator and the real WhatsApp Cloud API are two plugs into the same engine. It'll be tested
with scripted chats. Your wording replaces my drafts in one place.

## Decided (2026-11-19): your designs (`docs/designs/06-whatsapp/`)

The **message catalogue** is the source of the bot's wording. Where the pages differ, the
catalogue wins (e.g. "Enjoy the trip!", not "Enjoy the food!"). Your answers to the gaps:

1. **Short tour names:** a new optional field on tours (24 characters at most), used in the
   WhatsApp list; the full title when it's empty.
2. **Pickup times and opening hours:** each pickup point gets a time; the business gets opening
   hours (one range for every day). Staff API now, screens with the operator app.
3. **The simulator's own parts** (choose the guest, new chat, "typing…", a failed message, the
   desktop view): I make simple versions in the style of your chat; you restyle later.
4. **After paying, anything the guest types goes to the team:** "passed on", and the chat goes to
   the top of the staff list.

The stages of 13c: **13c-1** the conversation as designed (server); **13c-2** the simulator app
and journey 2 in the browser; **13c-3** the real WhatsApp Cloud API connection.
