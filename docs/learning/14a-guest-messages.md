# Stage 14a: Guest messages, decided once, in your words

Session 14 is **messages** (OPS-11: "confirmations, reminders, balance requests and
cancellation notices by WhatsApp simulator and email, from editable templates"), with the
wording from your design file 02. It's split in three (decided 2026-11-19):

| Stage   | What                                                                                 |
| ------- | ------------------------------------------------------------------------------------ |
| **14a** | the six messages, editable templates, decided once, sent into the guest's chat       |
| 14b     | email: your layout, the subject lines, a local mailbox in development, Resend        |
| 14c     | real WhatsApp outside the 24-hour window (Meta-approved templates); journeys 1, 4, 5 |

The confirmation page's "A confirmation was sent to…" (stage 12e) is now true for WhatsApp;
14b makes it true for email.

## 1. What we built

| Piece                                                        | Where                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| The six messages, your default wording, the placeholders     | `packages/shared/src/message-templates.js`                                                  |
| DECIDING a message (which, which channels), once             | `packages/db/src/guest-messages.js`                                                         |
| …hooked where things happen                                  | `transitionBookingInTx`, `markRefundProcessed`, the staff link route, the daily balance job |
| Putting it into words for one guest                          | `apps/api/src/messages/compose.js`                                                          |
| SENDING what's waiting (every 5 s, next to the chat notices) | `apps/api/src/messages/send.js`                                                             |
| A business's own wording                                     | table `message_templates`; `/api/message-templates`                                         |
| One outbox row per channel                                   | `notifications.channel`: `whatsapp` · `email`                                               |

## 2. How it works

### Decided once, with what caused it

```
a payment settles ─► transitionBookingInTx(held → paid)  ─┐ one database transaction:
                                                          │  the booking is paid AND
                     planForTransition()                  │  "booking_confirmed:whatsapp"
                     → planGuestMessage()                 │  "booking_confirmed:email"
                                                          ┘  are in the outbox, or neither
```

Every booking status change already goes through ONE function (stage 7), so that's where the
messages are decided: a confirmation exists exactly when the payment does. If anything rolls
back, so does the message. And the outbox's unique (booking, key) index means a retried
webhook or a re-run job never decides it twice.

| What happened                    | Message                                 | Where it's decided                      |
| -------------------------------- | --------------------------------------- | --------------------------------------- |
| held → paid, or confirmed (₦0)   | Booking confirmation                    | the status change                       |
| held → part paid                 | Deposit received                        | the status change                       |
| a sold booking → cancelled       | Cancellation (with the policy's refund) | the status change                       |
| the refund has left              | Refund sent                             | `markRefundProcessed`                   |
| staff make a payment link        | Payment link                            | the staff route (`send: false` to skip) |
| 7, 3, 1 days before the due date | Balance reminder                        | the daily job (11d)                     |

A hold that ran out or was given back gets nothing: the guest never had a booking.

### Which channels

One row per channel, so each can go, or fail, on its own:

- **WhatsApp** when the guest gave a phone, **except** the confirmation and deposit message
  for a booking made ON WhatsApp: its chat already has the ticket (13b)
- **email** when the guest gave an email, WhatsApp guests included (decided 2026-11-19)

### Sent, once

```
every 5 s: sendGuestMessages()
  waiting for 3+ days? → cancelled ("confirmed" a week late would only confuse)
  claim it: pending → sent in one UPDATE (two API processes: one wins)
  the template (the business's own, or the default) + this booking's values → the words
  WhatsApp: into the guest's chat, found by their number (a new simulator chat if they never
            wrote), then delivered like any chat message
  email:    waits for 14b
  refused? → failed, with why (e.g. OUTSIDE_24H on real WhatsApp, until 14c)
```

A payment link's address travels in its outbox row until it's sent, then the row forgets
it: only the message the guest received holds it (stage 10d: links are stored as hashes).

## 3. Editable templates

`GET /api/message-templates` lists the six, each with its default, the business's own (if
any), and the placeholders it may use. `PUT` saves an edit, **checked first**: only the
placeholders that message has, and the ones it must keep (the brief's "must include": the
confirmation keeps `{trip_url}`, a reminder keeps `{pay_url}`…), so an edit can't send a
guest a reminder with no way to pay. `DELETE` goes back to the default; `…/preview` shows
the words with a sample booking. Owners only (`settings`); the screen comes with the
operator app.

Ìrìn's **"Refund sent"** ends with your line "We hope to walk Lagos with you another time."
That line is Ìrìn's own, so it's seeded as **Ìrìn's** template; everyone else's default ends
"We hope to see you again soon." It's also the example of a business editing a message.

## 4. Choices made (please check)

| Choice                                                       | Why                                                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| One template per message (subject + words), not per channel  | your design: "Email uses the same words in the layout"                                   |
| The refund is one computed line (`{refund_line}`)            | it depends on the policy (100% / 50% / nothing / staff's amount)                         |
| "for your {tour_short} on {date}" in the reminder            | your "your Badagry trip" needs a name like "Badagry"; short names are "Badagry Day Trip" |
| A pay-later booking confirmed by staff gets the confirmation | the guest is booked; reminders follow for the balance                                    |
| Messages waiting 3 days are dropped                          | a very late "confirmed" would confuse more than help                                     |
| Staff-sent links are sent by default (`send: false` skips)   | the brief: "when staff send one"                                                         |

## 5. Checks

1,108 tests, twice, all passing (25 new: 15 for the messages, 10 for the templates); the 8
browser journeys pass. 19 mutation checks, all caught.

## 6. Concepts to study

- **The transactional outbox**: deciding a message in the same transaction as its cause
- **At-most-once vs at-least-once** sending (here: claim, then send; a crash in between loses
  the message rather than sending it twice)
- **Templates with checked placeholders**: why a template language with no logic is safer
  for people who aren't programmers

## 7. What's next

**14b: email.** Your layout (600 px, one column, system fonts, the details block, the footer),
your subject lines, Mailpit in Docker as a local mailbox (every email in development lands
there, at http://localhost:8025), and the Resend adapter for real sending.
