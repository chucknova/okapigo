# Stage 13a: The WhatsApp booking engine, up to "seats held"

Session 13 is **booking on WhatsApp** (BKG-09, journey 2). It's split in three:

| Stage   | What                                                                                      |
| ------- | ----------------------------------------------------------------------------------------- |
| **13a** | the conversation engine: tours → dates → who → extras → name → summary, seats held        |
| 13b     | paying (the payment link), the ticket in the chat, "talk to a person" and staff take-over |
| 13c     | the simulator app (your design), journey 2 end to end, the real WhatsApp adapter          |

The screens wait for your designs (flow brief `docs/flows/06-whatsapp-booking.md`); the engine
doesn't need screens, so it came first, tested with scripted chats.

## 1. What we built

| Piece                                       | Where                                                              |
| ------------------------------------------- | ------------------------------------------------------------------ |
| The flow brief, with your decisions         | `docs/flows/06-whatsapp-booking.md`                                |
| The steps (a state machine)                 | `apps/api/src/whatsapp/engine.js` → `converse()`                   |
| What the bot remembers between messages     | `apps/api/src/whatsapp/state.js` (checked when read)               |
| What the bot says, in WhatsApp's own shapes | `apps/api/src/whatsapp/messages.js` (the draft wording lives here) |
| A message arriving (lock, store, reply)     | `apps/api/src/whatsapp/conversations.js` → `receive()`             |
| Channels (simulator now, WhatsApp in 13c)   | `apps/api/src/whatsapp/channels.js`                                |
| The simulator's API                         | `apps/api/src/routes/whatsapp-simulator.js`                        |
| ONE way to book for a guest, every channel  | `apps/api/src/lib/guest-booking.js` → `bookForGuest()`             |
| Conversations and messages                  | tables `conversations`, `chat_messages`                            |

## 2. How it works

### A message's journey

```
POST /simulator/whatsapp/irin-lagos-tours/messages { phone, text | choice }
  receive()   find or start the guest's conversation, LOCK it (one message at a time)
              store the guest's message
              staff answering? → stop (the bot stays quiet)
  converse()  the bot's turn: the current step + what the guest sent → replies + new state
              store the replies, remember the state
  channel     deliver (the simulator reads them from the database)
```

### The steps

```
hello ─► choose_tour ─► choose_date ─► count (adults, children, infants)
      ─► age (each child and infant) ─► add_on (each extra) ─► pickup (if any)
      ─► name ─► email (or skip) ─► summary: seats HELD for 30 minutes
```

At every step the guest can **tap** (a button or list row), **type a number** ("2" = the 2nd
row) or **type a name** ("street food"); anything else gets "Sorry, I didn't get that…" and the
question again. From anywhere, "hi" / "menu" / "start again" go back to the start (giving back
any seats held), and "person" asks for the team.

### The same booking as the website

The website's booking route used to do it all itself: check the tour is on sale, price it, apply
the rules, match ages to categories, hold, book. That's now **`bookForGuest()`**, and both the
website and the chat call it. So a WhatsApp guest gets the same prices, the same "children need
an adult" (in the same words), the same seat limits. The website's tests and the 7 browser
journeys passed unchanged after the move.

The chat even checks the rules **before** asking the guest's name, with the same price check
the website uses, so nobody types their details and then hears "children need an adult".

### Only WhatsApp's building blocks

Text, up to 3 reply buttons (20 characters), a list of up to 10 rows (24 + 72 characters), an
image. The builders in `messages.js` **cut** anything longer (with "…"), and every reply in the
tests is checked against the limits, so the real WhatsApp can't refuse a message later.

## 3. Your decisions, built

| Decided (2026-11-18)                                | How                                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| The lead's name; ages only for children and infants | adults are stored with **no age** (`age` is now optional) and the others with **an empty name** for staff to fill in at check-in |
| Seats held 30 minutes on WhatsApp                   | `WHATSAPP_HOLD_MINUTES = 30` (the website keeps its 15)                                                                          |
| Staff take-over screen later; API now               | 13b                                                                                                                              |
| The QR image and the trip link                      | 13b                                                                                                                              |

`bookForGuest()` guards the age rule for **every** channel: a traveller without an age must be
in an adult category, or it's refused (`AGE_REQUIRED`) and nothing is held. A mutation check
first found this guard untested (the chat always asks children's ages); now it has its own test.

## 4. Two database rules changed (on purpose)

- **`travellers.age` may be empty**: "not asked", never a made-up age.
- **`travellers_name_present` → `travellers_name_trimmed`**: an empty name is allowed ("not given
  yet"); a name of only spaces still isn't. The website's form still requires every name.

## 5. Found along the way

- **The database refused the chat's first booking** with a rule from session 7 ("a traveller
  must have a name"). That rule was right for forms and wrong for your WhatsApp decision, so it
  changed (above). To see the hidden error I made the tests' logger optional:
  `TEST_LOG_LEVEL=error pnpm test` now prints what a 500 hid.
- **List rows are cut to 24 characters** ("Lagos Island Heritage W…"), so a test that compared
  the full title with a row failed: the test was wrong, not the bot.

## 6. Why we chose what we chose

| Choice                                   | Alternative         | Why                                                   |
| ---------------------------------------- | ------------------- | ----------------------------------------------------- |
| One `bookForGuest()` for every channel   | a copy for WhatsApp | the PRD's "same prices and availability in both"      |
| State saved on the conversation, checked | in memory           | survives restarts; an old or broken state starts over |
| Lock the conversation per message        | none                | two quick taps can't both act on the same step        |
| Builders that cut to WhatsApp's limits   | trust the wording   | the real API refuses oversize messages                |
| A signed token to read a simulator chat  | the phone number    | numbers are guessable; chats hold names and emails    |

## 7. Concepts to study

- **State machines** for conversations (steps, transitions, "anything else")
- **Idempotent, serialised handling** of incoming messages (row locks)
- **Adapters / ports**: one engine, several channels
- **WhatsApp Cloud API** interactive messages: reply buttons and lists

## 8. Try it yourself

With `pnpm dev` running:

```bash
curl -s -X POST localhost:4000/simulator/whatsapp/irin-lagos-tours/messages \
  -H 'content-type: application/json' -d '{"phone":"0803 123 4567","name":"Adaeze","text":"Hi"}'
```

Then send `{"phone":"0803 123 4567","choice":"tours"}`, and so on. The simulator app (13c)
will do this for you.

## 9. What's next

**Stage 13b:** "Pay" sends the payment link, the ticket (the QR image and the trip link) arrives
when the money settles, "Payment didn't go through" and "Your 30 minutes are up", and the
take-over API: staff see who needs a person, take over, reply, and hand back to the bot.
