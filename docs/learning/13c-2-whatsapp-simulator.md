# Stage 13c-2: The WhatsApp simulator app, and journey 2 end to end

The bot had no screen until now: tests talked to it through the API. This stage adds the
**simulator**, a phone chat in the browser drawn from your chat designs, and the browser test
for **PRD journey 2**: book on WhatsApp, pay the link, get the ticket in the chat.

| Stage     | What                                                      |
| --------- | --------------------------------------------------------- |
| 13c-1     | the conversation as designed (server)                     |
| **13c-2** | **the simulator app** and **journey 2** in a real browser |
| 13c-3     | the real WhatsApp Cloud API connection                    |

## 1. What we built

| Piece                                                   | Where                                                 |
| ------------------------------------------------------- | ----------------------------------------------------- |
| The app (React + Vite, its own small package)           | `apps/simulators`                                     |
| Its look: your chat's colours and sizes as tokens       | `packages/shared/src/tokens.js` → `CHAT`              |
| Turning stored messages into bubbles, events, day lines | `apps/simulators/src/lib/format.js`                   |
| Sending, "typing…", "Not sent", polling, new chat       | `apps/simulators/src/lib/use-chat.js`                 |
| The phone, a message, the list sheet, the guest bar     | `apps/simulators/src/components/`                     |
| "New chat" on the server                                | `POST /simulator/whatsapp/conversations/:token/reset` |
| The API serves the built app                            | `/simulator/whatsapp/` (`app.js`, `simulatorDir`)     |
| Journey 2 in a browser                                  | `apps/web/e2e/journey-2-whatsapp.spec.js`             |

Open it with the API running: **http://localhost:4000/simulator/whatsapp/** (after
`pnpm --filter @okapigo/simulators build`), or while editing, `pnpm --filter
@okapigo/simulators dev` → http://localhost:5174/simulator/whatsapp/. `?operator=` picks the
business (Ìrìn by default).

## 2. How it works

```
you type or tap ─► the bubble shows at once ("Sending…"), the bot is "typing…"
                ─► POST …/messages (the same engine as the real WhatsApp)
                ─► GET …/messages: the chat as stored, drawn again
every 2 seconds ─► GET …/messages: what nobody asked for arrives by itself
                   (the ticket after paying, "30 minutes are up", a person from the team)
```

**The logic stays out of the screens** (your rule): `format.js` decides what each stored
message looks like (yours on the right, theirs on the left, a person's name, an event line,
a day line), and `use-chat.js` decides what happens when you send. The components only draw.

**Each guest is their own chat.** The guest bar picks Adaeze, Tunde, Ngozi or someone you
type; each one's private chat token is remembered in this browser. Choosing another guest
mounts a fresh chat (React's `key`), so nothing from one guest leaks into the other's.

**The link's preview card** shows the link, so its bare line is taken out of the bubble (your
design). The real WhatsApp builds its own preview from the page.

## 3. From your designs, and the simple parts (decided 2026-11-19)

| From your chat designs                                                                              |
| --------------------------------------------------------------------------------------------------- |
| the header: picture, name, "Booking assistant" / "Ìrìn team is replying"                            |
| bubbles: the guest's (green, right), the bot's (white), a person's (pale green, "Tolu · Ìrìn team") |
| reply buttons under a message; a list's button with the list icon                                   |
| day lines and events ("Tolu from Ìrìn joined · the assistant is paused")                            |
| the ticket picture with its caption; link preview cards                                             |
| the text box and the round Send button                                                              |

| Simple, for you to restyle (not in the designs)                                            |
| ------------------------------------------------------------------------------------------ |
| the **guest bar** above the phone: "Chatting as" and **New chat**                          |
| the **list sheet**: rows slide up from the bottom of the phone, × to close                 |
| **"typing…"** as a bot bubble while a message is on its way (never while a person answers) |
| **"Not sent. Tap to try again."** under a message that failed                              |
| **desktop**: the phone framed in the middle; on a phone, it fills the screen               |
| the empty chat: "Say “Hi” to start chatting with Ìrìn Lagos Tours’ booking assistant."     |

Every colour passes WCAG AA (a test checks each text on its background).

## 4. Found along the way

- **Two servers, one database.** Journey 2's ticket first came with the address
  `localhost:4000`, not the test server's `:4100`, and the picture didn't load. The API I had
  started to look at the app shares the database, and **its** notices pass sent the ticket
  first. Same trap as the dev worker in 12f-2: **stop `pnpm dev` before running the browser
  tests.** (In production each environment has its own database, so it can't happen there.)
- **Your local database needs `pnpm db:reset`** to get the short tour names and opening hours
  (13c-1's seed); until then the list shows cut titles ("Lagos Island Heritage W…").
- **React's lint rules** refused setting state directly inside an effect (it renders twice
  for nothing). The chat now sets state only when an answer arrives, and remounts per guest
  instead of resetting itself.
- **Mutation checks**: 14 deliberate breaks; 2 first went unnoticed ("New chat" on a real
  WhatsApp chat, and "typing…" while a person answers). Each has a test now.

## 5. Checks

1,065 tests, twice, all passing (14 of them the simulator's own); the 8 browser journeys pass,
journey 2 included.

## 6. Concepts to study

- **Optimistic UI**: show the message at once, confirm or mark it failed later
- **Polling vs pushing** (WebSockets, server-sent events): why polling is enough here
- **React `key`** to reset a component's state, instead of an effect
- **Serving a single-page app under a path** (Vite's `base`, Express static)

## 7. What's next

**13c-3**: the real WhatsApp Cloud API: receiving messages from Meta (a signed webhook),
sending the bot's replies, delivery receipts, and the 24-hour rule. Your Meta test number's
token and app secret go in `.env`, never in the chat.
