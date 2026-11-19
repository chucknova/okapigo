# Stage 14c: Real WhatsApp templates, and the journeys check the messages arrive

This closes session 14 (messages, OPS-11).

| Stage   | What                                                                          |
| ------- | ----------------------------------------------------------------------------- |
| 14a     | the six messages, editable templates, decided once, sent into the chat        |
| 14b     | email in your layout (Mailpit locally, Resend for real)                       |
| **14c** | **WhatsApp templates** outside the 24-hour window; **journeys 1, 4, 5** check |

## 1. What we built

| Piece                                                      | Where                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| The six messages as WhatsApp templates (Meta's rules)      | `apps/api/src/whatsapp/templates.js`                              |
| Outside the window: send the template instead of failing   | `channels.js` → `deliver()`                                       |
| …in Meta's template format                                 | `cloud-api.js` → `toGraph(…, { useTemplate })`                    |
| A website guest gets a real WhatsApp chat (when connected) | `send.js` → `toChat()`                                            |
| The simulator finds a chat the business started            | `POST /simulator/whatsapp/:operator/conversations`, `use-chat.js` |
| Journeys read the guest's chat and mailbox                 | `apps/web/e2e/messages.js`                                        |
| Setting                                                    | `WHATSAPP_TEMPLATE_LANGUAGE` (default `en`)                       |

## 2. Why templates

WhatsApp lets a business write freely only within **24 hours** of the guest's last message.
A website guest has never written at all, and a balance reminder may come weeks after the
last chat. Outside that window Meta only delivers **templates**: fixed words it has approved,
with numbered blanks `{{1}} {{2}}…` filled in when sending.

```
a guest message to send on WhatsApp
  inside the window  → the business's own words (editable, 14a), as a normal message
  outside            → the approved template, filled in: Meta delivers it
  (the chat stores the business's words either way, so staff and the simulator read them)
```

The business's **edited** wording can't go outside the window (Meta approves each text
once), so the templates are OkapiGo's, close to your design file 02. Meta's rules shaped them:

- a template **can't start or end with a blank**, so each ends with a short fixed line
  ("See you soon!", "Thank you!", "Reply here if you have any questions.")
- a blank can't hold a line break, so the refund line is joined into one line

Messages without a template (the chat's own: the ticket, "30 minutes are up") are still
marked failed outside the window, as in 13c-3; they're nearly always inside it.

## 3. Setting up the templates in Meta (you do this, once)

1. WhatsApp Manager (business.facebook.com → WhatsApp accounts → Message templates) →
   **Create template** → Category **Utility** → Language **English** (`en`).
2. For each of the six: the **name** and the **body** exactly as below. Meta asks for a sample
   value per blank: any of the examples works.
3. Wait for "Approved" (usually minutes). Until then Meta refuses them, and the outbox records
   why (`132001: Template name does not exist in the translation`).

| Name                        | Body (the `{{n}}` are filled in by OkapiGo)                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `okapigo_booking_confirmed` | Hi {{1}}, your booking is confirmed!⏎⏎{{2}}⏎{{3}}, {{4}}⏎Meet at {{5}}⏎{{6}} · Ref {{7}}⏎⏎Your ticket and map:⏎{{8}}⏎⏎See you soon!               |
| `okapigo_deposit_received`  | Hi {{1}}, we got your deposit of {{2}} for the {{3}} on {{4}}. You’re booked!⏎⏎Balance: {{5}}, due by {{6}}.⏎Pay any time here:⏎{{7}}⏎⏎Thank you! |
| `okapigo_balance_reminder`  | Hi {{1}}, a reminder: {{2}} is due by {{3}} for your {{4}} on {{5}} ({{6}}).⏎⏎Pay here:⏎{{7}}⏎⏎Can’t make it? Just reply and we’ll help.          |
| `okapigo_payment_link`      | Hi {{1}}, here’s your payment link from {{2}}.⏎⏎{{3}}⏎{{4}}⏎Valid until {{5}}⏎⏎{{6}}⏎⏎Reply here if you have any questions.                       |
| `okapigo_booking_cancelled` | Hi {{1}}, your booking {{2}} ({{3}}, {{4}}) is cancelled.⏎⏎{{5}}⏎⏎Reply here if you have any questions.                                           |
| `okapigo_refund_sent`       | Hi {{1}}, your refund of {{2}} for {{3}} has been sent.⏎⏎It may take 5–10 working days to show in your account, depending on your bank.           |

(⏎ = a new line.) The texts are also in `apps/api/src/whatsapp/templates.js`, and a test
checks each one against Meta's rules.

## 4. The journeys now check the messages

| Journey                       | Checks                                                                 |
| ----------------------------- | ---------------------------------------------------------------------- |
| 1 · Book on the website, pay  | the confirmation in the guest's chat AND by email, with the trip page  |
| 4 · Cancel yourself           | the cancellation (with the policy's refund) and "refund sent" by email |
| 5 · Deposit, then the balance | "deposit received" in the chat (this guest gave a phone only)          |

The browser tests' API sends email to Mailpit (`EMAIL_PROVIDER=mailpit` in its settings), so
**Mailpit must be running** (`pnpm services:up`); the journeys say so if it isn't. Mailpit
keeps earlier runs' emails, so an email is found by its address and this run's reference.

**Website guests in the simulator:** a confirmation now lands in a chat the guest never
opened. The simulator asks the API for "this number's chat" when it has none remembered, so
choose the guest (e.g. Adaeze · 0803 123 4567) and the business's message is there.

## 5. Found along the way

- **Still the shared database.** One of the two full test runs failed a message test while
  `pnpm dev` was running: its every-5-seconds pass looks at every business and claimed the
  test's message at the same moment. The other run, same code, was green; so were all 8
  journeys. The fix is the proposed follow-up (tests get their own database).

## 6. Checks

1,132 tests, the second full run all passing (the first: the dev-server clash above); all 8
browser journeys pass, with the new message checks. 8 mutation checks, all caught.

## 7. Concepts to study

- **WhatsApp's customer-service window** and **template messages** (categories: utility,
  marketing, authentication; why approval exists)
- **End-to-end checks of side effects**: reading a real (local) mailbox from a test

## 8. Session 14 is done

Left for later: the operator app's screens for editing templates and reading chats, booking
notes from a chat, and giving the tests their own database.
