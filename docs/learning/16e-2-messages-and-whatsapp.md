# Stage 16e-2: Settings: Messages and WhatsApp

Settings (O10), part two of four:

| Part      | What                                                                                    |
| --------- | --------------------------------------------------------------------------------------- |
| 16e-1     | the settings menu, the save bar and form errors, Website, Embed on your site            |
| **16e-2** | **Messages (the editor, details to insert, preview, a test) and WhatsApp**              |
| 16e-3     | Staff and roles (invite, edit, remove); invitations emailed, words to copy for phones   |
| 16e-4     | Tours (basics, prices, schedule, extras, pickups, policy, deposit, transport, new tour) |

## 1. What we built

| Piece                                                                    | Where                                                    |
| ------------------------------------------------------------------------ | -------------------------------------------------------- |
| The rules: the list, inserting a detail, what it must keep, the 24h rule | `apps/operator/src/lib/settings.js` (Messages, WhatsApp) |
| Messages: the list and the editor                                        | `apps/operator/src/screens/SettingsMessages.jsx`         |
| WhatsApp: how it stands, the number, connect, the webhook, a test        | `apps/operator/src/screens/SettingsWhatsApp.jsx`         |
| One message to one phone (guests' messages and staff's tests)            | `apps/api/src/messages/send.js` → `sendToPhone()`        |
| The preview with a real booking; approved texts; the test send           | `apps/api/src/routes/message-templates.js`               |
| WhatsApp in words; the test send                                         | `apps/api/src/routes/whatsapp-settings.js`               |

Each message has its own address: `/settings/messages/balance_reminder` (the route is now
`/settings/:section?/:item?`), so "‹ Messages" and the browser's Back both work.

## 2. Messages

**The list**: the seven messages, each with when it goes and **Default** or **Edited**. Below,
the one message that only exists as WhatsApp-approved wording ("Can we help you finish
booking?"), shown read-only.

**One message**:

- **WhatsApp · Email**. The body is the same words in both; the Email tab adds the subject.
- **Insert a detail**: a chip for each detail this message may use ("+ Pay link"). It goes
  **where the cursor is** (replacing a selection), in the last field the cursor was in, and the
  cursor lands just after it. The rule is `insertDetail()`, a pure function: tested without a
  screen.
- **Must keep: Balance ✓ Due date ✓ Pay link ✗**. A message can't drop the link or the amount.
  The problems underneath ("The message must include {pay_url}.") come from the **same
  `checkTemplate()` the server uses** (`@okapigo/shared/message-templates`), so the screen and
  the server can never disagree. Save waits until there are none.
- **Preview**: "With a real booking: Funmi Adeyemi, ILT-3MZ8RB", the business's latest paid or
  confirmed booking, filled by the same `messageValues()` the sender uses. With no bookings yet,
  a made-up one. It's asked for 300 ms after the typing stops (not on every key). A message
  about money still owed (deposit received, balance reminder) uses a booking that **still owes
  some**, or the made-up one: the browser check caught "₦0 is due" from a fully paid booking.
  A detail the booking can't give (a payment link's amount) comes from the made-up one, never
  blank.
- **If they haven't written in 24 hours**: Meta's approved version, its gaps labelled
  ("[Balance]"), and the rule in words.
- **Send a test to my WhatsApp**: the words on screen (even unsaved), marked `[Test]`, to the
  phone on your own account.
- **Back to OkapiGo's wording** (only when edited), asked first.
- The save bar and "Leave without saving?" from 16e-1.

### The 24-hour rule, said accurately

The design said "Meta approves your edit". That isn't how WhatsApp works: Meta approves a
**fixed** wording, once, ahead of time; it doesn't approve each business's edits. So:

- A guest who messaged you in the **last 24 hours** gets **your** wording.
- **Anyone else** gets **OkapiGo's approved version**: WhatsApp only lets a business write
  first with wording Meta has approved.
- **Email** always uses your wording.

The editor says this beside the approved version, so nobody is surprised.

## 3. WhatsApp

- **How it stands**, in words from the server: "Connected · last message 10:51", "Waiting for
  Meta to call the webhook" (a number is set, nothing has arrived yet), or "Not connected ·
  using the simulator", and **why** (this server has no WhatsApp, or the business has no Phone
  number ID yet).
- **The business number** and the name guests see.
- **Phone number ID**: Meta's long ID, not the phone number. Checked as you type (digits only),
  saved with `PATCH /api/whatsapp`.
- **The webhook address** to paste into Meta, with Copy.
- **Send a test to my WhatsApp**; **Disconnect**, asked first.

**No tokens on screen.** The access token and the verify token are OkapiGo's, kept in the
server's `.env`. The page never shows them or asks for them (the project's rule: keys stay in
`.env`).

## 4. A test that can't go says why

WhatsApp won't let a business write first to a phone that hasn't messaged it in 24 hours,
**including your own**. So a test can be refused. The server answers **422 TEST_NOT_SENT**
with the reason in words:

> WhatsApp only lets a business write first to someone who messaged it in the last 24 hours.
> Send any message to your business number from your phone, then try again.

Why 422 and not 502? The app treats any 5xx as "OkapiGo is having trouble", which would hide
the reason. A refusal with a code is shown as it is.

## 5. A bug fixed on the way

A reply to a guest's request (16d-2) is a `staff_message`, which has **no approved WhatsApp
template**. On real WhatsApp the sender tried to fill one anyway and crashed. `sendToPhone()`
now attaches a template only when the message has one. `requests.test.js` now sends the reply
and expects nothing to fail.

## 6. Who can change it

| Section  | Needs          | Owner | Manager                                                |
| -------- | -------------- | ----- | ------------------------------------------------------ |
| Messages | settings: edit | edits | can't open it ("This page is for the owner")           |
| WhatsApp | channels: edit | edits | looks: "Only the owner can change this. You can look." |

## 7. Tests

- `apps/api/test/settings-messages.test.js` (5): the approved versions, named; the preview with
  a real booking; the test send ([Test], invalid wording, no phone, a manager refused);
  WhatsApp not set up here; a connected server: no ID → waiting → connected, a test refused
  (24 hours) then sent.
- `apps/operator/test/settings-messages.test.jsx` (16): the rules; the list; the editor (a
  detail at the cursor, must keep, save); the email tab; a test sent or refused; back to
  OkapiGo's wording; a manager; WhatsApp (states, the ID checked and saved, disconnect asked
  first, a test, look-only).
- Mutation checks: 27 changes; 3 survived at first and each got a test: "Save and leave" with
  wording that can't be saved (nothing sent), a detail the booking can't give (not blank), and
  a message in the simulator (not "connected").
- Browser check (as Tunde, then the seed owner on the check server; nothing saved or sent):
  Tunde gets "This page is for the owner" on Messages and look-only WhatsApp. Fixed on the way:
  the state dot and labels' layout, a long link running out of the preview bubble, "₦0 is due",
  and two back links inside a message on a phone.
