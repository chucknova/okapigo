# Stage 13b: Paying on WhatsApp, the ticket in the chat, and staff taking over

Session 13 is **booking on WhatsApp** (BKG-09, journey 2). 13a built the conversation up to
"seats held". 13b finishes the guest's side and adds the staff's:

| Stage   | What                                                                                    |
| ------- | --------------------------------------------------------------------------------------- |
| 13a     | the conversation engine: tours → dates → who → extras → name → summary, seats held      |
| **13b** | paying (the payment link), the ticket in the chat, "30 minutes are up", staff take-over |
| 13c     | the simulator app (your design), journey 2 end to end, the real WhatsApp adapter        |

## 1. What we built

| Piece                                               | Where                                                         |
| --------------------------------------------------- | ------------------------------------------------------------- |
| "Pay": full or deposit, then the payment link       | `apps/api/src/whatsapp/engine.js` → `pay()`                   |
| What a guest can pay right now (website AND chat)   | `apps/api/src/lib/payment-options.js` (moved from checkout)   |
| A link for the whole price: purpose `full`          | `packages/db/src/payment-links.js`, the `/pay` page title     |
| Messages the bot sends ON ITS OWN (ticket, time up) | `apps/api/src/whatsapp/notices.js` → `sendChatNotices()`      |
| The ticket's QR as a picture                        | `GET /public/bookings/:token/ticket.png` (`lib/qr.js`)        |
| Staff: list, read, take over, reply, hand back      | `apps/api/src/routes/conversations.js` (`/api/conversations`) |
| One set of channels for everyone                    | `apps/api/src/whatsapp/channels.js` → `createChannels()`      |
| Messages in the order they were written             | `chat_messages.seq`                                           |

## 2. How it works

### Paying

```
summary  [Pay ₦50,000]
  │  can the guest pay a deposit? (the SAME rule as the website's review screen)
  ├─ no  → "Pay ₦50,000 here: …/pay/AbC…  Your seats are held until 14:35."
  └─ yes → [Pay ₦65,000] [Deposit ₦19,500] [Cancel]  → the link for the one chosen
```

The link is the website's own payment-link page (stage 12e), so paying works exactly as it
does for a link staff send: Paystack, or the simulator in test mode. Nothing new to trust.

If the 30 minutes ran out before "Pay", there's no link: "Sorry, the 30 minutes to pay are up".

### The ticket, and "your 30 minutes are up"

Nobody's message triggers these: the money settles (a webhook, a check), or a hold expires
(the worker). We could have made the payment code call the chat… but then paying would need
to know about WhatsApp, and a chat outage could break a payment. Instead:

```
every 5 seconds (server.js)          sendChatNotices()
  find WhatsApp bookings that are       paid / part-paid / confirmed  → chat_ticket
  in one of these states, with no       cancelled because the hold    → chat_hold_over
  notice yet                            EXPIRED
  for each: lock the chat, CLAIM the notice (a row in `notifications`, unique per booking and
  key), write the messages, all in ONE transaction; then hand them to the channel
```

This is the **outbox** pattern from session 11 (balance reminders) again. The unique
(booking, key) index is what makes it safe: three dispatchers at once (three API processes)
still send ONE ticket. A test runs three passes at the same time to prove it.

The ticket is three messages (decided 2026-11-18: the QR image and the trip link):

```
✓ Booking confirmed · ILT-7K4Q2M
*Lagos Island Heritage Walk*
Sun 22 Nov · 09:00
2 travellers
Meet at: Tinubu Square
Paid ₦50,000
[the QR code, as an image]   Your ticket · ILT-7K4Q2M. Show this QR code at check-in.
Your trip page (ticket, map, changes): …/trip/…
```

WhatsApp sends pictures, not SVG, so the trip hub's QR (drawn as an SVG path in 12f) is turned
into a PNG with resvg (black on white: scanners read contrast, not brand colours). The image's
address carries the guest's own signed token, and a booking that isn't paid has no ticket (404).

"Your 30 minutes are up" comes with **[Hold them again]**: the chat still remembers the tour,
the date and the people, so one tap holds the same seats again (if they're still free, at
today's price).

### Staff take over

```
guest: "person"   → the chat is marked "needs a person since 14:02", top of the list
staff: take over  → the guest sees "Tunde from the Ìrìn team has joined the chat."
                    the bot goes quiet (even for "menu")
staff: reply      → the guest sees it, signed by that member of staff
staff: hand back  → "Thanks for chatting with the team…" [See tours]; the bot answers again
```

`GET /api/conversations` lists who's waiting first (longest wait at the top), then the most
recent chats. Reading needs **bookings: view** (guides can); taking over and replying need
**bookings: edit**. Another business's chat is a 404, as everywhere else.

Every change takes **the same lock** as a guest's message, so a take-over can't land halfway
through the bot's turn, and the two never answer at once. Staff can only reply after taking
over (409 `NOT_TAKEN_OVER`): one voice at a time.

The screen for this is designed later with the operator app (decided 2026-11-18).

## 3. Decisions made along the way (please check)

| Decided                                                          | Why                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| After a link was sent, "hi" / "menu" **keeps** the seats held    | the bot said "held until 14:35", and the guest may still pay that link                   |
| ...but before any link, "menu" gives them back (as in 13a)       | nothing was promised yet                                                                 |
| Tapping Pay again sends a fresh link (the old one still works)   | guests lose messages; both links pay the same booking, and a booking can't be paid twice |
| A hold that runs out after the guest moved on: no message        | "Hold them again" would hold a booking they already left                                 |
| The ticket goes to the guest's chat even after they typed "menu" | found by phone number, not by "the booking this chat is on"                              |
| Hand back starts the bot from the top                            | staff may have changed anything meanwhile                                                |

## 4. Found along the way

- **Messages in the wrong order.** A guest's message and the bot's replies are written in one
  transaction, and Postgres' `now()` is the time the transaction STARTED, so they all share one
  `created_at`. Sorting by time could show the reply before the question. Messages now carry
  `seq`, a number that counts up as they're written, and are sorted by that. (A mutation check
  first showed no test noticed; there's now one that stores two messages with the same time.)
- **"Latest 500" was really "first 500".** Reading a chat took the first 500 messages oldest
  first, so a very long chat would have stopped showing new messages. Now it takes the latest
  500 and shows them oldest first.
- **The rate limit counts tests too.** 120 simulator messages a minute per address is generous
  for people, but one test file sending 20 scripted chats went over it. The 13b tests have their
  own file (and share the helpers in `test/whatsapp-chat.js`).
- **Mutation checks**: 15 deliberate breaks; 3 first went unnoticed (sending a notice twice
  when two dispatchers race, the "moved on" rule, the message order). Each has a test now, and
  one check that couldn't be told apart (two guards for the same thing) became one guard.
- **Browser journeys**: two widget journeys failed once in a full run and passed alone; the next
  two full runs were 7/7 with no server warnings. Recorded here in case they flake again.

## 5. Why we chose what we chose

| Choice                                | Alternative                       | Why                                                        |
| ------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| An outbox dispatcher for the ticket   | payment code calls the chat       | paying never depends on WhatsApp being up                  |
| Claim + messages in one transaction   | send, then mark as sent           | for the simulator, "sent" IS written: all or nothing       |
| The website's /pay page for WhatsApp  | a WhatsApp-only payment page      | one payment path, already proven with real Paystack test   |
| `paymentOptions()` shared             | the chat works out amounts itself | the guest is only ever offered what the server will accept |
| A sequence number for message order   | timestamps                        | timestamps tie inside a transaction                        |
| The dispatcher in the API (every 5 s) | in the worker                     | it needs the channels and wording, which live in the API   |

## 6. Concepts to study

- **The transactional outbox**: claim-once rows, unique keys, "at most once" vs "at least once"
- **`now()` in Postgres** is the transaction's start (`clock_timestamp()` is the wall clock)
- **Sequences / identity columns** for ordering
- **Hand-off between bot and human** in support tools (who has the floor, and showing it)

## 7. Try it yourself

With `pnpm dev` running, book on the simulator's API as in 13a until the summary, then:

```bash
curl -s -X POST localhost:4000/simulator/whatsapp/irin-lagos-tours/messages \
  -H 'content-type: application/json' -d '{"phone":"0803 123 4567","choice":"pay"}'
```

Open the link, pay with the simulator, and within 5 seconds the ticket is in the chat
(`GET /simulator/whatsapp/conversations/<token>/messages`).

## 8. What's next

**Stage 13c** waits on your designs: the simulator app (screen G of
`docs/flows/06-whatsapp-booking.md`), journey 2 end to end in the browser, and the real
WhatsApp Cloud API adapter (a second channel next to the simulator).
