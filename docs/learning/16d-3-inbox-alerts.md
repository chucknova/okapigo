# Stage 16d-3: The inbox's alerts

The last part of the inbox (O9): **what needs dealing with**, in one list, each with the button
that deals with it, and **what the office dealt with this week**.

## 1. What we built

| Piece                                       | Where                                                    |
| ------------------------------------------- | -------------------------------------------------------- |
| The alerts and "Done this week", worked out | `packages/db/src/alerts.js` (`inboxAlerts`)              |
| …served                                     | `GET /api/inbox/alerts` (`apps/api/src/routes/inbox.js`) |
| Who assigned a guide, and when              | `departures.guide_assigned_by_id`, `guide_assigned_at`   |
| The Inbox badge counts the same alerts      | `packages/db/src/today.js`                               |
| The Alerts tab                              | `screens/Inbox.jsx` (`AlertList`, `DonePane`)            |

## 2. The alerts

| Alert                              | When                                                 | Button         |
| ---------------------------------- | ---------------------------------------------------- | -------------- |
| Cash to confirm: ₦45,500 from Femi | a guide reported cash the office hasn't confirmed    | Open booking   |
| Cash to sort out                   | …and the guest had also paid by link                 | Open booking   |
| Cash not handed in                 | marked "not received", while the guest still owes    | Open booking   |
| Refund failed: ₦62,500             | owed back, the last try failed                       | Sort it out    |
| Refund to send                     | owed back, never started                             | Sort it out    |
| Refund needs a look                | the bank hasn't settled it (12f-2's alert)           | Sort it out    |
| Balance due today / overdue        | a deposit paid, the rest due, the trip still to come | Send a link    |
| Departure without a guide          | in the coming week, with guests, and nobody guiding  | Assign a guide |

Most urgent first (red, amber, then blue).

## 3. Clearing by itself

An alert isn't a row someone has to tick off: it's **worked out from how things are**, each time
the tab looks. Confirm the cash, send the refund, take the balance, assign a guide, and it's
gone. There's no "dismiss" for money (designs): a failed refund can't be hidden, only fixed.

## 4. Done this week

What the office did in the last 7 days, newest first, from the bookings' timelines: cash
confirmed or marked not received, refunds sent or recorded as bank transfers, payment links sent;
and guides assigned. Each says who and when ("Refund of ₦31,250 sent by Kunle, Thu 3 Dec
15:02") and opens the booking or departure. A guest's own cancellation and a guide's tour-day
link aren't the office's doing, so they're not listed.

Guide assignments weren't on any timeline (a departure has none), so a departure now records
who assigned its guide and when.

## 5. Found in the browser check

- "Done this week" first landed inside the list column, above the alerts: an edit matched the
  wrong spot. It's in the right-hand pane now (under the alerts on a phone).
- Your dev data has a real one: **Refund to send: ₦100,000, Akinbote Temiloluwa (ILT-HP97TV)**,
  cancelled with money owed back and never started (before 16c-2 joined cancelling and
  refunding).

## 6. Tests

- `apps/api/test/alerts.test.js` (7): each kind appearing and clearing (cash, cash not handed
  in, refunds never sent → sending → failed → recorded, a balance overdue and one not yet due,
  a departure without a guide), Done saying who, only the office's own doings, most urgent
  first, the badge, office only.
- `apps/operator/test/inbox.test.jsx` (+3): the words, the tab, nothing to deal with.
- Mutation checks: 11 changes; 4 survived at first and got tests.
