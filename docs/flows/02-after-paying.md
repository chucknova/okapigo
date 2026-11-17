# Flow 02: After paying, payment links, and balances

**Journeys:** 1 (ending), 5 (deposit and balance). **PRD:** PAY-02 (state changes only from verified
webhooks), PAY-05 (payment links), BKG-06 (balance by a date, reminders).

```
Paystack ──► [Confirming…] ──(usually 2–5 s)──► [Booking confirmed] ──► trip hub (brief 05)
                  │
                  ├─ still waiting after ~30 s ──► [We'll confirm by message]
                  └─ declined / not paid ────────► back to screen 4 (if the hold is still on)

WhatsApp / email ──► [Payment link page] ──Pay──► Paystack ──► [Confirming…] ──► [Paid, thank you]
```

---

## Screen C: Confirming your payment · `/payments/callback?reference=…`

**Why it exists:** the guest's browser comes back from Paystack **before** we have proof of payment.
Proof is Paystack's signed message to our server, normally a few seconds later. This page waits for
it (it exists today as a plain page; you're designing the real one).

**Shows:** a calm "Confirming your payment…" with the booking reference; it then **becomes** the
confirmation (screen D) on its own.

**States:**

- **Confirmed** → screen D
- **Still confirming after ~30 s:** "Your payment is being confirmed. We'll send your confirmation
  to {email / phone} as soon as it's done. You can close this page." (Bank transfers can take a
  while.)
- **Declined / not completed:** "Your payment didn't go through." **Try again** (back to screen 4 if
  the hold is still active, otherwise hold again)
- **Paid after the hold expired** (rare): "We received your payment after your seats were released.
  Our team will contact you, and you'll get a full refund if we can't rebook you."

## Screen D: Booking confirmed

**Shows:**

- ✓ **Booking confirmed** · reference **ILT-7K4Q2M** (large, copyable: guests read it over the phone)
- Tour, **date and time**, **meeting point** (name, address, "Open in Maps")
- Travellers; add-ons
- **Amount paid**; for deposits, **balance due ₦45,500 by Sat 28 Nov**, with **Pay balance now**
- **Your trip page** button (→ trip hub: QR ticket, what to bring, map)
- **Add to calendar** · **Share on WhatsApp** ("I've booked the Heritage Walk on Sat 5 Dec!")
- "A confirmation was sent to {email/phone}" (messages arrive in session 14)

**States:** full payment vs deposit · lead gave only a phone (no email line).

## Screen E: Payment link page · `/pay/<token>`

**Why:** staff send this link (by WhatsApp or email) to collect a deposit, a balance, or any amount
(PAY-05). It exists today as a plain page.

**Shows (no personal details: anyone with the link can open it):** operator name, tour, date and
time, booking reference, **amount** and what it's for ("Balance", "Deposit"), **Pay ₦X**, "Card or
bank transfer on the next step".

**States:**

- **Already paid:** "This link has been paid. Thank you!" (+ the trip page link if the guest has it)
- **Expired** (links last 7 days by default): "This link has expired. Ask {operator} for a new one."
  - a WhatsApp contact button
- **Cancelled** by staff
- **Out of date:** the booking now owes less than the link asks (e.g. someone already paid part):
  "This link is out of date. Ask {operator} for a new one."
- **Being set up** (a double tap): "Setting up your payment…"
- Payment service unavailable → Try again

## Screen F: Paying a balance (from the trip hub or a reminder)

Same as screen E, but reached from the trip hub's **Pay balance** button or a reminder message, and
it can show a little more because the guest is on _their own_ trip page: "Balance for your
Badagry Heritage Day Trip on Sat 5 Dec: **₦45,500**, due by Sat 28 Nov".

---

## Messages to draft (sent from session 14)

Please draft the wording (and, for email, a simple layout). They'll use your tokens.

| Message              | When                                                         | Must include                                              |
| -------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| Booking confirmation | when paid / confirmed                                        | reference, tour, date/time, meeting point, trip page link |
| Deposit received     | after a deposit                                              | amount paid, balance and due date, pay link               |
| Balance reminder     | **7, 3 and 1 days** before the due date (decided 2026-11-17) | amount, due date, pay link                                |
| Payment link         | when staff send one                                          | amount, what it's for, link, expiry                       |
| Cancellation         | when cancelled                                               | reference, refund amount and when to expect it            |
| Refund sent          | when the refund is processed                                 | amount, "may take 5–10 working days to appear"            |

**✅ Decided (2026-11-17):**

- **The balance is due 7 days before the trip.** A guest booking later than that isn't offered a
  deposit: they pay in full (screen 4 shows no deposit choice).
- **Balance reminders go out 7, 3 and 1 days before the due date** (with a pay link).
- **If the balance isn't paid in time,** staff are alerted and **nothing is cancelled
  automatically**. Staff decide (call the guest, send a link, or cancel).
