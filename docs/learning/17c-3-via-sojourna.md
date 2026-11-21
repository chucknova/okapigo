# Stage 17c-3: "via Sojourna" everywhere else

| Part      | What                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------ |
| 17c       | The channel manager's server side                                                                      |
| 17c-2     | Settings › Channels (O11); OCTO notifications; payments from the OTA; Sojourna                         |
| **17c-3** | **"via Sojourna" on the desk, the booking, the departure, the manifest, the trip page; the trip link** |
| 17d       | Sojourna, the mock OTA (M1–M5), and journey 3                                                          |

Your design ("via Sojourna — everywhere else") answers one question for every screen: **this
booking came from a travel website: what's different about it?** Three things are:

1. **The money is with the website.** Sojourna took the guest's money; it owes the business the
   price less its share. So there's no payment link to send, and a refund is never the office's
   to send: Sojourna refunds its own guest.
2. **Changes go through the website.** The guest booked on Sojourna; changing who's coming or
   when, or cancelling, is done there. The office can still cancel (weather), and Sojourna is
   told.
3. **The trip is the business's.** The guide meets the guest like any other; the ticket scans the
   same; the business sends the trip page (decided 2026-11-21).

## 1. What we built

| Where                  | What changed                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| the bookings list      | a "via Sojourna" tag (only OTA bookings carry one); "Paid by Sojourna"; **Channel: all ▾**    |
| an OTA booking's page  | the header names Sojourna and its reference; the money as designed; the messages; the buttons |
| cancelling one         | everything back to the guest, from Sojourna; settled at once; Sojourna told through OCTO      |
| a departure called off | its OTA bookings settled the same way                                                         |
| the departure page     | "8 website · 3 via Sojourna · 1 seat left everywhere"; a Channel column                       |
| the guide's manifest   | "via Sojourna" beside "Paid" (the guide just sees "Paid")                                     |
| the guest's trip page  | "You booked through Sojourna": change or cancel there                                         |
| a new message          | **Trip page link**, by email, when Sojourna sells a booking                                   |

## 2. The money on an OTA booking's page

```
Price · guest paid Sojourna          ₦102,000
Sojourna's 20%                       − ₦20,400
─────────────────────────────────────────────
Sojourna owes Ìrìn Lagos Tours        ₦81,600
```

Refunds and Sojourna's payments (17c-2) show as lines between, so the bottom line is always what
Sojourna still owes for **this** booking, worked out the same way as the Channels page
(`owedFor`): the sale's net, less each refund's, less what its payments paid off. If Sojourna
had already paid for a booking that's then refunded, the bottom line turns round: "Ìrìn Lagos
Tours owes Sojourna ₦81,600".

## 3. Cancelling: one place for every path

An OTA booking can end four ways with money going back: Sojourna cancels through OCTO (17b),
the office cancels it, the office calls off its departure, or a no-show under a policy that
gives some back. In 17b only the
first settled the refund with the OTA; the others would have left "Refund to send" in the inbox
and tried a card refund that can't exist.

Now the settling lives in **one** place, `cancelBookingInTx` (and the no-show's twin): whoever
cancels, if the booking came from an OTA and money goes back, a refund is recorded as **already
processed by the OTA** (`provider: 'ota'`), in the same transaction. Every caller gets it for
free. The two routes that start card refunds afterwards (cancel and refund; call off a
departure) skip OTA bookings: there's nothing left to start.

When the office cancels, the design says Sojourna "refunds Hannah and owes Ìrìn ₦0": it's the
business calling it off, so **everything goes back** (the policy is for the guest's own
cancellations). So the cancel sheet has nothing to choose for an OTA booking: one line, one
button. Sojourna hears through its BOOKING_UPDATE notification (17c-2).

## 4. The trip page link

A new message, **Trip page link** (`trip_link`), the eighth in Settings › Messages:

```
Hi Hannah, this is Ìrìn Lagos Tours: we run your Tarkwa Bay Beach and Lagoon Trip on Sat 12 Dec, 10:00.
…
Your ticket, the map and what to bring:
https://…/trip/…

You booked through Sojourna: changes and cancellations go through them.
```

- **Email only.** OCTO always gives us the guest's email; a WhatsApp version would need another
  template approved by Meta. Your design shows "Email · delivered".
- `{booked_through}` is new: the website's name, kept with the message when it's planned.
- What an OTA's guest gets from us is now one list, `FOR_OTA_GUESTS`: the trip link, a date we
  moved, and what staff send on purpose. The confirmation, receipts and refund messages stay
  Sojourna's (the booking page says "Not sent: Sojourna sends its own").
- **"And reminders":** OkapiGo has no trip reminder yet (only balance reminders, and an OTA
  booking is paid in full). When one arrives, OTA guests get it too: add it to the list.

## 5. The channel filter

`GET /api/desk/bookings?channel=…`: `web`, `whatsapp`, `staff`, or an OTA's channel id. The list
sends its choices with it (Website, WhatsApp, each OTA by name, Staff), so the menu always
matches the business's channels. Settings › Channels' "All in Bookings ›" link
(`/bookings?channel=…`) now opens that channel's bookings, all of them.

## 6. What the browser check changed

On a throwaway business in the e2e database (your dev data has no Sojourna yet):

- **The lead is the first traveller.** OCTO names only the contact, so the booking showed
  "Guest 1 · Adult · lead". Confirming now gives the first traveller the lead's name, as your
  manifest design has it ("Hannah Weber", then "Guest 2 of Hannah Weber's booking").
- **Who tells the guests when a departure is called off.** It said "told by WhatsApp and email"
  for a Sojourna booking too. The server now says who tells whom: "Guests told by WhatsApp and
  email; Sojourna tells its guests" (`toldLine`).

## 7. Tests

- `apps/api/test/via-sojourna.test.js` (8): the list's tag, chip and filter (one OTA, website,
  WhatsApp, a bad value); an OTA booking's page (header, money, messages, buttons, the fixed
  cancel and its note), a website booking unchanged; cancelled by the office after Sojourna paid
  (settled, owed back, no messages from us but the trip link); a website booking cancelled the
  same way (still by card); a no-show under a policy that gives half back; a departure called
  off; the
  departure's counts and channels, sold out, a departure with none; the manifest; the trip page and a
  refused self-cancel.
- `apps/api/test/guest-emails.test.js` (+1): Sojourna sells, the guest's email arrives with the
  trip page, by email only.
- `apps/api/test/octo-bookings.test.js`, `whatsapp-templates.test.js`, `guest-messages.test.js`,
  `channels.test.js`: updated for the trip link and the new money lines.
- `apps/operator/test/desk.test.jsx` (+5): the address and the start from a link, hidden
  buttons, the row's tag and the filter, "All in Bookings ›", the OTA page and its cancel.
- `apps/operator/test/board.test.jsx`, `manifest.test.js`: the counts line, the Channel column,
  the manifest's tag.
- `apps/web/test/trip-hub.test.jsx` (+1), `trip-change.test.jsx` (+2): "use Sojourna".
- `packages/shared/test/message-templates.test.js`: the eighth message.
- Mutation checks: 35 changes; 4 survived at first. Three got tests: a website booking's
  cancellation still goes by card (the OTA settling must not catch it); "sold out everywhere";
  the "Change or cancel" page, not only "Cancel", sends OTA guests to the website. The fourth
  pointed at a guard that did nothing: a departure called off made its OTA bookings "refunded"
  at once, so the refund loop (which looks for "cancelled") never met them; it was removed, with
  a comment saying why. A fifth check, added afterwards, confirmed the no-show's settling is
  tested.
