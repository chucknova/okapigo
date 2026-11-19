# Stage 13c-3: The real WhatsApp (Meta's Cloud API)

The booking assistant now works on real WhatsApp too: a guest messages the business's
WhatsApp number, and the **same** conversation code that runs the simulator answers. This
closes session 13.

| Stage     | What                                                                  |
| --------- | --------------------------------------------------------------------- |
| 13a, 13b  | the engine, paying, the ticket, staff take-over                       |
| 13c-1     | the conversation as you designed it                                   |
| 13c-2     | the simulator app, and journey 2 in a browser                         |
| **13c-3** | **the real WhatsApp**: receiving, sending, receipts, the 24-hour rule |

## 1. What we built

| Piece                                                  | Where                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Our messages in Meta's format; reading Meta's webhooks | `apps/api/src/whatsapp/cloud-api.js`                                                                                                |
| The webhook: Meta's check, then signed messages        | `apps/api/src/routes/whatsapp-webhook.js`                                                                                           |
| ONE way messages leave, recording what happened        | `channels.js` → `deliver()`                                                                                                         |
| Each guest message handled once (Meta retries)         | `receive()`, plus a unique index                                                                                                    |
| The business's WhatsApp number                         | `operators.whatsapp_phone_number_id`, `GET/PATCH /api/whatsapp` (channels permission), `pnpm --filter @okapigo/api whatsapp:number` |
| Did it arrive? sent · delivered · read · failed (why)  | `chat_messages.delivery`, `delivery_error`                                                                                          |
| Settings                                               | `.env`: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`                                                     |

Without those settings nothing changes: guests chat in the simulator, as before.

## 2. How it works

```
guest's phone ─► Meta ─► POST /webhooks/whatsapp   (signed with the app secret)
                         check the signature (401 if wrong: nothing stored)
                         which business? Meta's "phone number ID" → operators
                         receive(): the SAME code as the simulator
                           lock the chat · seen this message id before? stop
                           store it · the bot's turn · store the replies
                         deliver(): one call to Meta per reply ─► the guest's phone
                         answer 200 (an error → 500, and Meta sends it again; still once)
Meta ─► POST /webhooks/whatsapp  "delivered", "read", "failed (131047…)"
                         → the message's delivery, forwards only (read never goes back)
```

**What a guest sends becomes what the bot understands**: typed text → text; a tapped button
or list row → its id (the same ids the simulator sends); a photo or voice note → "[image]",
which gets "Sorry, I didn't catch that" (and staff can see what it was).

**What the bot sends becomes Meta's format**: buttons → `interactive.button`, lists →
`interactive.list`, the ticket → `image` (by link, so Meta fetches it from our API), text →
`text`. A person from the team signs their message in the text (`*Tolu · Ìrìn team*`),
because WhatsApp shows everything as from the business; events ("Tolu from Ìrìn joined")
become a line in italics.

**The 24-hour rule.** WhatsApp lets a business send free-form messages only within 24 hours of
the guest's last message. Answers to a guest are always inside it. For everything else:

- **staff** writing after a day of silence get `409 OUTSIDE_24H` ("they need to write first")
- **notices** (the ticket, "30 minutes are up") are kept in the chat but marked failed with
  `OUTSIDE_24H`, not sent: Meta would refuse them. Template messages, which WhatsApp allows
  outside the window, come with session 14 (messages).

**Link previews.** Tour links show their preview card (stage 11e). Payment and trip links
deliberately don't (stage 12e: their address is the key), so WhatsApp shows them as plain
links. Your designs' preview cards for those stay in the simulator only.

## 3. Setting it up with Meta's test number (you do this; ~20 minutes)

Never paste the token or secret into the chat. They go in `.env` only (git ignores it).

1. **A Meta app.** developers.facebook.com → My Apps → Create app → choose the business type
   → add the **WhatsApp** product. Meta gives you a free **test number**.
2. **API Setup page** (WhatsApp → API Setup):
   - copy the **Phone number ID** (digits; not the phone number itself)
   - copy the **temporary access token** (it lasts about 24 hours; see step 8)
   - under "To", **add your own phone number** and confirm the code Meta sends. The test
     number only messages numbers you add here (up to 5).
3. **App secret.** App settings → Basic → App secret → Show. Copy it.
4. **A public address.** Meta must reach your API over HTTPS, and your laptop's `localhost`
   isn't reachable. Run a tunnel, for example:
   ```bash
   cloudflared tunnel --url http://localhost:4000
   ```
   It prints an `https://….trycloudflare.com` address.
5. **`.env`** (then restart `pnpm dev`):
   ```
   WHATSAPP_ACCESS_TOKEN=…            (step 2)
   WHATSAPP_APP_SECRET=…              (step 3)
   WHATSAPP_VERIFY_TOKEN=…            any long random string you make up
   API_PUBLIC_URL=https://….trycloudflare.com   (step 4: Meta fetches the ticket image here)
   WEB_PUBLIC_URL=https://….trycloudflare.com   (links in the chat open here)
   ```
   The API's log says `chat channels ready {"whatsapp":"connected"}`.
6. **Tell OkapiGo which business the number is for**:
   ```bash
   pnpm --filter @okapigo/api whatsapp:number irin-lagos-tours <phone-number-id>
   ```
7. **Connect the webhook.** WhatsApp → Configuration → Webhook → Edit:
   Callback URL `https://….trycloudflare.com/webhooks/whatsapp`, Verify token = your
   `WHATSAPP_VERIFY_TOKEN` → Verify and save. Then **subscribe to `messages`**.
8. **Say Hi** from your phone to the test number. The bot answers.

If something fails, the chat shows why: each message the bot tried to send has a `delivery`
and, when it failed, Meta's reason (`/api/conversations/:id`). An expired token shows up as
`190: Error validating access token`: get a new one (step 2), or make a lasting one with a
"system user" (Meta Business settings → Users → System users).

## 4. Choices made (please check)

| Choice                                              | Why                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| Answer Meta AFTER handling the message              | a turn takes well under a second; a failure → 500 → Meta retries |
| …and handle each message id once                    | so a retry can never book twice or answer twice                  |
| The WhatsApp number under the `channels` permission | your roles already say managers "can't manage … channels"        |
| A terminal command to set the number, for now       | the screen comes with the operator app                           |
| Unknown numbers: 200 and nothing else               | an error would make Meta retry something we'll never handle      |
| Not sent outside 24 hours, marked failed            | Meta would refuse it anyway; staff can see why                   |

## 5. Found along the way

- **Full test runs on a busy machine.** Two of six runs timed out in the WhatsApp tests while
  everything else was also 2–3 times slower (the load average was 18–19). Those files are
  whole scripted chats, so they now have 60 s per test instead of 20 s. A real hang still
  fails.
- **A trip-page test raced the page.** It checked the saved offline copy the instant the page
  showed, but the copy is saved just after. Under load it lost the race; it now waits.
- **A mutation check that broke the whole file.** One check (the button reply's id) was
  written for a line Prettier had split, and the edit replaced every line instead. It
  "passed" for the wrong reason; redone properly, it's caught.

## 6. Checks

1,083 tests, twice, all passing (17 new for WhatsApp, against a fake Meta: no network); the 8
browser journeys pass. 15 mutation checks, all caught.

## 7. Concepts to study

- **Webhooks**: verifying signatures over raw bytes; idempotency (handling retries once)
- **Delivery receipts** as a small state machine that only moves forwards
- **WhatsApp's customer-service window** and template messages
- **Tunnels** (cloudflared, ngrok) for testing webhooks on a laptop

## 8. Session 13 is done

Left for later, as decided: the staff take-over **screen** (with the operator app), staff
adding notes to a booking from a chat, and template messages (session 14).
