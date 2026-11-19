# Stage 13c-1: The WhatsApp conversation, as you designed it

Your four design pages (`docs/designs/06-whatsapp/`) replaced my draft conversation. This stage
is the server side of them; the simulator app comes next.

| Stage     | What                                                                           |
| --------- | ------------------------------------------------------------------------------ |
| 13a, 13b  | the engine, seats held, paying, the ticket, staff take-over (my draft wording) |
| **13c-1** | **the conversation as designed**, plus short tour names and opening hours      |
| 13c-2     | the simulator app (your chat's look) and journey 2 in the browser              |
| 13c-3     | the real WhatsApp Cloud API connection                                         |

## 1. What changed

| Your design                                                                | Where it lives                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| Every message, word for word, under its catalogue id                       | `apps/api/src/whatsapp/messages.js`             |
| The steps: adults → "Anyone under 13?" → how many → each age               | `engine.js` (`adults`, `under`, `child_age`)    |
| Extras one at a time: list → how many → "Added. Anything else?"            | `engine.js` (`extras`, `extra_qty`, …)          |
| "Change something": change ONE part, straight back to a new summary        | `engine.js` (`change`, the `changing` flag)     |
| "cancel" asks first: [Yes, stop] [No, carry on]                            | `engine.js` (`confirm_cancel`, `reask()`)       |
| Sold-out dates listed; "Sorry, Fri 4 Dec is sold out"                      | `dateRows()`                                    |
| "Someone booked while we were chatting" [Book 1 seat] [Another date]       | `hold()` (the `SOLD_OUT` error) → `seats_short` |
| The deposit choice ON the summary (3 buttons, so Cancel is typed)          | `summary()`                                     |
| "Your payment didn't go through" [Try again] (the old link stops)          | `notices.js` (`chat_declined`), `pay()`         |
| "Your 30 minutes are up" [Hold them again] → "Done… a fresh link"          | `notices.js`, `hold(…, { thenLink })`           |
| The ticket: confirmed, the QR **with the reference**, trip link, after     | `notices.js`, `lib/qr.js` → `ticketPng()`       |
| Hand-over with opening hours; "The team is away now and back at 08:00"     | `handover()`                                    |
| "Tolu from Ìrìn joined · the assistant is paused" (a line, not a bubble)   | a new message kind, `notice`                    |
| "Welcome back, Adaeze. Here's where we were: …" with the summary's buttons | `welcomeBack()`                                 |

### Your answers to the gaps (2026-11-19)

1. **Short names**: tours have a `shortTitle` (24 characters at most, a database rule too), used
   in the WhatsApp list. Seeded with your five names.
2. **Opening hours**: the business details have `hours: { opens, closes }` (08:00–20:00 for
   Ìrìn). Pickup times already existed (stage 12c).
3. **The simulator's own parts** (guest picker, typing, failed, desktop): I'll make simple ones
   in 13c-2.
4. **After paying, anything typed goes to the team**: "Thanks, I've passed that on…", and the
   chat goes to the top of the staff list.

## 2. How "Change something" works

Before, the bot only went forwards. Now the state remembers **`changing: true`**: the guest is
fixing one part. Each part's last step checks it:

```
summary ─► Change something ─► Travellers ─► adults ─► under 13? ─► ages ─┐
                                                                      changing?
                                                       yes: hold again ─► NEW summary
```

The old hold is kept until the new one is made (`hold()` gives it back first), so the guest
never loses their seats halfway through a change, and there's only ever one hold per chat.

## 3. Choices I made where the designs were silent (please check)

All marked "Not in the designs" in `messages.js`:

| Situation                                               | What the bot says                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| A typed age of 13 or more                               | "Please type an age under 13, like 8. (13 or over counts as an adult.)" |
| A wrong answer in a list                                | "Sorry, I didn't catch that." then the list again                       |
| Seats ran out and **none** are left                     | "…{date} is now full." [Choose another date] [Talk to a person]         |
| "Book 1 seat" with children in the group                | not offered (who would be left out?); only another date                 |
| Hold expired and the seats have gone                    | "…and that date doesn't have enough seats any more."                    |
| Tapping Pay after the 30 minutes                        | "Sorry, the 30 minutes to pay are up, so the seats were released."      |
| Handed back mid-booking                                 | "Welcome back, Adaeze. Here's where we were:" + the question again      |
| Handed back with nothing in progress                    | "Welcome back, Adaeze. Anything else I can help with?"                  |
| An extra with stock below what's asked                  | "Sorry, only 3 left. Please type a smaller number."                     |
| "Would you like an extra? They're served at the stops." | without "They're served at the stops": not true for every tour          |
| "How many …? …, 10 left tonight."                       | "…, 10 left." ("tonight" only fits evening tours)                       |
| "Pay by card … · secured by Paystack" (preview)         | without "secured by Paystack": in test mode it's the simulator          |
| The tour list's order                                   | the website's (by title): Badagry first, not Heritage Walk              |
| "Your note 'vegetarian' is on the booking"              | not yet: staff can't add notes from a chat (a later stage)              |

## 4. Found along the way

- **Durations**: the website's cards say "3.5 h"; your chat says "3 h 30 min", so the chat has
  its own format.
- **VAT**: your summary's "(includes ₦5,163 VAT)" is exactly what the pricing code works out for
  ₦74,000 at 7.5% inclusive (rounded to the naira): the test checks that figure.
- **WhatsApp's 1,024-character limit**: a message WITH buttons or a list has a shorter body
  than a plain text (4,096). The builders now cut those at 1,024 and the tests check it.
- **The simulator's rate limit** (120 messages a minute) is now a setting; the tests raise it,
  and one test checks it still refuses message 3 when set to 2.

## 5. Checks

- **Tests**: 1,047, twice, all passing; the 7 browser journeys pass. The WhatsApp tests are in
  four files: the conversation (`whatsapp-booking`), changing and running out
  (`whatsapp-changes`), paying and the bot's own messages (`whatsapp-paying`), staff
  (`whatsapp-staff`).
- **Mutation checks**: 27 deliberate breaks. 7 first went unnoticed: "0 adults, no children",
  "Yes, stop" cancelling the link, extras when changing them, sold-out extras, the hold's clock
  (when the expiry job is late), and "declined" after the hold ran out. Each has a test now.
  The last one (skipping a failed payment already told) is also caught by the database's
  unique rule; the check only saves work, so no test can tell it apart.

## 6. Concepts to study

- **State machines with "return addresses"** (`changing`, `resume`): how a flow goes back to
  where it came from
- **Message catalogues**: wording kept in one place under stable ids, so design and code agree
- **Rendering text into images on a server** (satori → SVG → resvg → PNG), fonts included

## 7. What's next

**13c-2:** the simulator app (`apps/simulators`) in your chat's look: bubbles, buttons, the list
sheet, the ticket image, link previews, event lines, plus simple versions of the guest picker,
"typing…", a failed message and the desktop frame; then **journey 2** end to end in the browser.
