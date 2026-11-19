# Stage 15c-4: Money on the day, pickup stops, the A4 manifest

The last of the guide's screens, from your designs ("Money owed on the day", "Manifest with
pickup points — Lekki", "Printed manifest — A4") and your decisions with them: both money
features, and pickup times now.

| Stage     | What                                                                    |
| --------- | ----------------------------------------------------------------------- |
| 15c-1…3   | the app, Sync; the manifest; Scan                                       |
| **15c-4** | **the payment QR, cash reports, pickup stops, the A4 printed manifest** |
| 15d       | journey 6: a guide checks in offline, then syncs                        |

## 1. What we built

| Piece                                                        | Where                                        |
| ------------------------------------------------------------ | -------------------------------------------- |
| Tour-day payment links; cash reports                         | `packages/db/src/cash.js`, `cash_reports`    |
| In the package: the link, cash reported, the guide's cash    | `packages/db/src/sync.js` → `offlinePackage` |
| A new outbox change, `cash`; its conflict, `PAID_MEANWHILE`  | `sync.js` (server), the `/api/sync` routes   |
| The manifest's pickup stops (the tour's, in order)           | `operations.js` → `manifest()`               |
| The A4 printed manifest                                      | `apps/api/src/routes/operations.js`          |
| The money panel (ask · QR · cash), used by manifest and scan | `apps/operator/src/components/MoneyOwed.jsx` |
| Cash rules, the chips, today's cash, the QR's squares        | `src/lib/money.js` (QR: `uqr`, as the API)   |
| A pickup tour by stop; "Everyone here"                       | `src/lib/stops.js`                           |

## 2. The payment QR, with no signal

The guest pays on **their** phone and data; the guide's phone only shows a QR of the
booking's balance link. So the link must already be on the phone: it's in the package.

The catch: payment links store only a **hash** of their token (10d), so a link's URL can be
shown once, when it's made. Making a new link on every refresh would pile up links and
change the package every time (no more 304s). So the tour-day link's token is **derived**:

```
token = HMAC(server secret, "tour-day-link:" + booking + ":" + amount owed)   (24 bytes)
```

The same booking and balance always give the same token, so the same link: made once, found
again by its hash. A different balance (they paid part) gives a new one. Only the server can
make it (the secret). It's made **without messaging the guest**, and good until the day after
the tour. If the office cancels it, the phone stops showing it.

"They’ve paid · check them in" records the check-in with `paidBy: 'link'`: the chip says
"Paid by link · confirming" until the next sync shows the money arrived.

## 3. Cash: reported, not paid

"They paid me cash" → an amount up to what's owed (less is fine) → **cash reported by Femi**.
It's a new kind of change in the outbox, and a new table, `cash_reports`. It is **not a
payment**: nothing in the books moves, and the booking keeps showing as owing until the office
confirms the money was handed in (the bookings desk, session 16). Meanwhile:

- the chip: "Cash ₦45,500 reported · office to confirm"
- Today: **"Femi’s cash today: ₦45,500 from 1 booking · hand in to the office"**

**Paid twice?** If the guest also paid by link before the phone synced, the report is kept as
a **possible double payment** and comes back as a conflict, in O5's parts:

> YOU DID Reported ₦45,500 cash from Funmi Adeyemi at 07:12 (offline).
> THE SERVER HAD They paid ₦45,500 by link at 07:14, before you synced.
> SO NOW Their booking is paid. Your cash report is kept as a possible double payment…
> [OK] [I gave the cash back]

A detail worth knowing: the report must be kept even though the change is a conflict. Raising
the conflict **inside** the database transaction would have rolled the report back with it,
so the transaction commits first, and the conflict is raised after.

## 4. Pickup stops

Pickup times already existed (12c: Lekki's 07:15 · 07:30 · 07:45), so the manifest just
carries the tour's stops, in the van's order. A pickup tour's manifest is grouped by them:

- **DONE · 07:16** once nobody there is "Not yet" (a no-show counts as settled)
- **NEXT STOP** the first that isn't, highlighted, with **Directions** (a maps link) and
  **"Everyone here: check in 4"**, one check-in per booking. A booking that owes is left out,
  so its money question is asked one by one.
- **LATER** the rest; "3 of 9 picked up" at the top

## 5. The A4 printed manifest

Your design: the business · MANIFEST; the tour; date, time, back about, meeting point; guide,
van and note, when printed; four boxes (travellers by group, each add-on, dietary needs, still
owed); then one row per traveller with a box to tick, the booking's details on its first row,
"Guest 2 (name: ____________)" for unnamed guests, dietary needs in capitals; a pickup tour's
rows under their stops; cancelled bookings below. Checked in Chrome as a PDF.

## 6. Where I followed the designs loosely

- **Neutral words**: "They paid me cash", "They’ve paid · check them in" (the design: "She").
- **The cash on Today** shows whenever there's cash not yet confirmed (the design: "after the
  trip"): simpler, and nothing is forgotten.
- **"Page 1 of 1"**: a browser can't number printed pages, so the footer says "Bookings by
  OkapiGo".

## 7. Checked

- Chrome at phone size, offline, with a saved package shaped like the server's: the stops
  (next with directions, "Everyone here"), the QR, the cash form (₦45,500 prefilled), Femi's
  cash on Today. I didn't add owing bookings to your dev database just for this; the server's
  side is covered by its own tests (the link, cash, the double payment, "I gave it back").
- The real printed manifest of Kemi's Street Food Crawl, from the API, as an A4 PDF.

## 8. Checks

81 tests in the app (12 new), 6 new on the server. 13 mutation checks (the same link each
refresh, a cancelled link not shown, the possible double, the cash given back, unconfirmed
cash only, cash on the booking, the printout by stop, cash up to what's owed, the "paid by
link" chip, cash shown at once, a no-show settling a stop, "Everyone here" leaving out who
owes, "I gave the cash back" sent), all caught; three survived at first and got their tests.

Full runs: both all green (1,249 tests). Browser journeys: 7 of 8, twice. Journey 2 (WhatsApp)
fails waiting for the ticket picture, also on the previous commit. **Found why**: the
picture's address is on **:4000**, your `pnpm dev` API, which claimed the test's ticket notice
from the shared database (13c's trap again); the test page on :4100 refuses images from
another address (its Content-Security-Policy). Giving the tests their own database is the fix.

## 9. Concepts to study

- **Deterministic tokens** (HMAC) vs random ones, and when each is right
- **Transactions and errors**: what rolls back, and keeping a record while reporting a conflict
- **Content-Security-Policy**: why a page refuses an image from another address
