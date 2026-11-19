# Stage 14b: The guest messages as emails, in your layout

14a decided and sent the six guest messages into the guest's chat. Now they go by **email**
too, in your email layout from design file 02.

| Stage   | What                                                                      |
| ------- | ------------------------------------------------------------------------- |
| 14a     | the six messages, editable templates, decided once, sent into the chat    |
| **14b** | **email**: your layout, the subject lines, a local mailbox, Resend        |
| 14c     | real WhatsApp outside the 24-hour window (templates); journeys 1, 4 and 5 |

## 1. What we built

| Piece                                                   | Where                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| The email: your card, the template's words, a text copy | `apps/api/src/messages/email.js`                                           |
| How it leaves: Mailpit (local) or Resend (real)         | `apps/api/src/messages/mailers.js`                                         |
| A local mailbox                                         | `docker-compose.yml` → `mailpit`, http://localhost:8025                    |
| Sending from the outbox                                 | `send.js` → `toEmail()`                                                    |
| Settings                                                | `EMAIL_PROVIDER` (none · mailpit · resend), `RESEND_API_KEY`, `EMAIL_FROM` |

**To see the emails on your laptop:** add `EMAIL_PROVIDER=mailpit` to your `.env` (it's in
`.env.example`), run `pnpm services:up` (Mailpit now starts with Postgres and Redis), restart
`pnpm dev`, book a tour, and open **http://localhost:8025**. Nothing leaves your laptop.

## 2. The email (decided 2026-11-19: your card, plus the words)

```
 [Ì] Ìrìn Lagos Tours
 ─────────────────────────────────────────────────
 Booking confirmed                    ← coloured line (green · amber · red)
 See you on Sat 5 Dec, Adaeze!        ← the headline
 Hi Adaeze, your booking is confirmed!   ← the TEMPLATE's words (editable), without the
 Lagos Island Heritage Walk …               link line: the button carries it
 ┌ Booking reference  ILT-7K4Q2M        ₦62,500 paid ┐
 └                              includes ₦4,360 VAT ┘
 Tour        Lagos Island Heritage Walk
 When        Sat 5 Dec, 09:00 · 3 hours
 Meet at     Tinubu Square / Broad Street, Lagos Island
 Travellers  Adaeze Okafor, Chidi Okafor, Kamsi Okafor (child)
 [        Open your trip page        ]
 Your QR ticket, the map and what to bring are on your trip page.
 Free cancellation until Thu 3 Dec, 09:00. After that, 50% back until Fri 4 Dec, 09:00.
 ─────────────────────────────────────────────────
 Questions? Reply to this email or WhatsApp Ìrìn on 0809 000 0123.
 Ìrìn Lagos Tours · Yaba, Lagos · Booking terms
 Bookings by OkapiGo
```

The same layout for every message; only the middle changes:

| Message              | Coloured line     | Headline                    | In the box               | Button              |
| -------------------- | ----------------- | --------------------------- | ------------------------ | ------------------- |
| Booking confirmation | Booking confirmed | See you on {date}, {name}!  | paid · includes VAT      | Open your trip page |
| Deposit received     | Deposit received  | You’re booked, {name}!      | paid · still to pay by … | Pay {balance}       |
| Balance reminder     | Balance reminder  | {balance} due by {due date} | to pay · by …            | Pay {balance}       |
| Payment link         | Payment request   | {amount} to pay             | amount · valid until …   | Pay {amount}        |
| Cancellation         | Booking cancelled | Your booking is cancelled   | refund (if any)          | none                |
| Refund sent          | Refund sent       | Your refund is on its way   | refunded · 5–10 days     | none                |

Your design shows the confirmation; the other five rows follow it (please check).

**Why it's built the way it is:**

- **Styles inline, layout in tables.** Most mail apps drop `<style>` blocks and many draw
  layouts their own way; inline styles in tables look the same nearly everywhere.
- **Your tokens** (Lagoon, light): emails can't follow a phone's dark mode reliably.
- **Everything typed is escaped**: a guest named `<b>Ada</b>`, or a template with
  `<script>`, stays text. A test sends exactly that.
- **A plain-text copy** goes with every email, for mail apps that don't show HTML.
- **From the business** ("Ìrìn Lagos Tours" as the sender's name, our sending address), and
  replies go to **the business's own email** (business details, 12g-2).

## 3. Resend (real email, when you want it)

Resend has no "test mode" like Paystack's. Instead, without a domain of your own it only lets
you send **from `onboarding@resend.dev` to your own Resend account's email**: anything else
is refused, and the outbox records Resend's reason ("You can only send testing emails to your
own email address"). So trying it can't email the fictional guests by mistake.

1. resend.com → sign up → API Keys → create one (starts with `re_`).
2. `.env`: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=re_…` (never in the chat).
3. Book with **your own** email address as the guest's. The email arrives in your inbox.

The app refuses to start with `EMAIL_PROVIDER=resend` and no key.

## 4. Found along the way

- **Deadlines in the past.** The first look at a real email (a trip tomorrow) said "Free
  cancellation until Wed 18 Nov": yesterday. The note now only lists deadlines still ahead.
- **Phone numbers** are shown the way people write them here ("0809 000 0123"), as in your
  design, not "+234809…".
- **Two test files sending each other's messages.** The new tests passed alone and failed in
  full runs: each test's sender picked up EVERY waiting message in the shared test database,
  including another file's, running at the same time. The senders can now be limited to one
  business (`operatorId`), like the balance job already could; the tests use it.
- **The widget "Book now" journey** timed out once more (it did in 13b too), under heavy load;
  it passes on rerun. Logged in the parking lot to find properly.

## 5. Checks

1,117 tests, twice, all passing (9 new for email); the 8 browser journeys pass (after one
rerun, above). 13 mutation checks, all caught (one needed a stricter test: the deposit
email's BUTTON goes to the balance page, not just some link in the words).

## 6. Concepts to study

- **HTML email**: inline styles, table layouts, why `<style>` and web fonts are unreliable
- **Multipart email**: HTML and plain text in one message
- **Sender identity**: the "From" name vs address, Reply-To, and why services need a verified
  domain (SPF, DKIM) before sending as you
- **Test isolation**: shared state between test files running in parallel

## 7. What's next

**14c**: real WhatsApp for these messages outside the 24-hour window (Meta-approved
templates), and journeys 1, 4 and 5 checking the messages arrive (the simulator's chat and
the local mailbox).
