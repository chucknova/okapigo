# Stage 16d-1: The inbox, chats

The office's inbox (O9) in three parts (decided 2026-11-21):

| Part      | What                                                                                          |
| --------- | --------------------------------------------------------------------------------------------- |
| **16d-1** | **chats: take over, reply, hand back, a colleague's chat, the 24-hour rule, failed messages** |
| 16d-2     | guest requests: reply by WhatsApp and email, mark answered, Done; **moving a booking's date** |
| 16d-3     | alerts: what needs dealing with, clearing by itself; "Done this week"                         |

## 1. What we built

| Piece                                                  | Where                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| The chat list and one chat, in words                   | `apps/api/src/routes/inbox.js`                                           |
| Who has a chat; a colleague's; follow-up; retry; email | `apps/api/src/routes/conversations.js`                                   |
| "Can we help you finish booking?"                      | `apps/api/src/whatsapp/templates.js` (`chat_followup`)                   |
| A staff message by email                               | `compose.js`, `email.js` (`staff_message`); `planGuestMessage({ only })` |
| Who took a chat over, and since when                   | `conversations.handled_by_id`, `handled_since`                           |
| The screen and its words                               | `apps/operator/src/screens/Inbox.jsx`, `lib/inbox.js`                    |
| A clock that ticks, shared                             | `apps/operator/src/lib/now.js` (`useNow`)                                |

| Route                                                       | Does                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /api/inbox/chats`                                      | NEEDS A PERSON (waiting, or taken over), then WITH THE BOT (the last week) |
| `GET /api/inbox/chats/:id`                                  | the chat in words, and the booking beside it                               |
| `POST /api/conversations/:id/take-over` `{ fromColleague }` | take over (on purpose, from a colleague)                                   |
| `POST /api/conversations/:id/follow-up`                     | the approved message, outside 24 hours                                     |
| `POST /api/conversations/:id/messages/:mid/retry`           | a failed message, sent again                                               |
| `POST /api/conversations/:id/messages/:mid/email`           | …or by email, to the booking's lead                                        |

## 2. One person at a time

Since 13b a chat was either the bot's or "staff". Now it records **who** took it over, and
when. So:

- the list says "Taken over by you" or "Kunle is replying";
- **only that person replies** (`NOT_YOURS` for anyone else): two people answering the same
  guest at once would contradict each other;
- someone else takes over **on purpose**: "Take over from Ngozi? They'll see you have the chat,
  and only you can reply." (`TAKEN_BY_COLLEAGUE` without it). The guest isn't told again: they
  were told someone from the team joined;
- handing back clears it.

A chat taken over before 16d has no holder, so anyone in the office can reply to it.

## 3. WhatsApp's 24-hour rule, for staff

A business may write freely only within 24 hours of the guest's last message (13c-3). Outside
that, the chat says so ("Bayo last wrote 2 days ago. WhatsApp only lets you send approved
messages until they write again."), hides the reply box, and offers:

- **Send "Can we help you finish booking?"**: a new approved template,
  `okapigo_chat_followup`: "Hi {{1}}, it's {{2}} on WhatsApp. Can we help you finish booking?
  Just reply to this message and we'll pick up where you left off." It only ever goes outside
  the window, so it has **no editable wording** (Meta approves the exact text); Settings (16e)
  can list it. **For real WhatsApp, submit it in Meta once**, like the other six (see
  `docs/learning/14c-whatsapp-templates.md`).
- **Call instead.**

Simulator chats are always inside the window.

## 4. A message that failed

A message WhatsApp couldn't deliver shows "Not delivered: number unreachable" with:

- **Retry**: a new attempt below it (the failed one stays, so the chat shows what happened);
- **Send by email**: to the lead of the chat's booking, through the same outbox as every guest
  message (kind `staff_message`, email only), in the business's email layout, from the
  business: "A message from Kunle at Ìrìn Lagos Tours". Offered only when there's an email.

## 5. On the screen

Like the bookings desk: the list beside the open chat on a wide screen; one or the other on a
phone. The chat refreshes every 5 seconds (the list every 15; `useLive(path, { every })`), opens
at the newest message, and shows WhatsApp's `*bold*` as bold. Beside it, **the booking from this
chat** (its status chip, trip, people, total) with **Add a note** and **Open booking**.

## 6. Found on the way: the clock again

The full runs at 22:38 failed the bookings desk's "filters and search" test (16c-1) both times:
it moved a departure to "2 hours from now" and expected it under **Today**. After 22:00 in
Lagos that's tomorrow. It now sets the departure to noon today in Lagos, which is "today" at
any hour.

## 7. Tests

- `apps/api/test/inbox.test.js` (8): the words; the list and a chat; one person at a time
  (the owner and a manager); a plain preview; office only; the 24-hour rule and the follow-up
  template; a failed message retried and emailed (through the sender, to the guest); no email.
- `apps/operator/test/inbox.test.jsx` (9): the words; the list; nothing needs you; a chat
  taken over (reply, hand back); a colleague's; outside 24 hours; failed (retry, email); no
  email.
- Mutation checks: 16 changes; 1 survived at first (the preview's bold marks) and got a test.
