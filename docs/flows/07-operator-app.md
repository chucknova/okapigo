# Flow brief 07: The operator app (sessions 15–16)

**Journey 6:** _"The guide opens the manifest, loses signal, checks guests in and marks a
no-show, then reconnects and everything syncs."_ (PRD; OPS-01, OPS-07, OPS-08, OPS-09)

This is the app **staff** use: the guide on tour day, the operations manager running the
schedule, the owner setting things up. It's a separate app from the guest web
(`apps/operator`), installed from the browser like an app (a PWA), and it must keep working
**with no signal for 72 hours** (PRD: "72 hours of offline actions sync with zero data loss").

Please design the screens below; I build what you design (as with the guest web). Everything
the server needs that doesn't need a screen, I can build first (section 6).

---

## 1. Who uses it, and on what

| Who                    | Device                                | Mostly does                                                       |
| ---------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| **Guide**              | their own phone, often with no signal | today's departures, the manifest, scanning tickets, no-shows      |
| **Operations manager** | laptop at the office, phone outside   | the schedule, assigning guides / vans / the boat, bookings, chats |
| **Owner**              | laptop and phone                      | everything above, plus settings (website, messages, staff)        |

What each sees comes from their role's permissions (already built, session 3): a guide sees
operations and the bookings on their departures; the manager can't change prices or staff.

**Phone first for guides** (one hand, outdoors, bright sun: big targets, strong contrast);
**desktop too for the office** (the schedule board and bookings want width).

---

## 2. The flows

### A. Sign in

Email or phone → a 6-digit code → in. (The code arrives by email now, stage 14b; WhatsApp
with templates later.) Staying signed in for 30 days on this device, because a guide can't
sign in again with no signal.

### B. Tour day (the guide) · journey 6

```
Today ─► my departures (time, tour, guests booked / checked in, my van / boat)
      ─► a departure ─► its MANIFEST: every traveller, grouped by booking
            ─► Scan a ticket (camera)  → that booking's travellers: Present / Late
            ─► or search by name       → same
            ─► mark a booking No-show  (after the start; the policy's refund applies)
      ─► (signal lost: everything above keeps working; changes wait in an outbox)
      ─► (signal back: the outbox sends itself, in order; anything that couldn't be applied
          is shown as a conflict to look at)
```

### C. Running the schedule (the manager)

```
Schedule ─► a week of departures, per tour ─► a departure:
             seats sold / held / left · guide · van or boat · notes
           ─► assign a guide, a van, the boat (a resource can't be in two places at once:
              the app says why, "Femi is on the Badagry trip until 17:00")
           ─► cancel a departure (weather): every booking gets the operator-cancels refund
```

### D. The bookings desk (manager, owner)

Find a booking (reference, name, phone) → see it (travellers, payments, messages sent, its
timeline) → act: send a payment link, change travellers, cancel with the policy's refund (or
a different amount), mark a no-show, add a note. Plus the inboxes that already have APIs:

- **Chats** (13b): who asked for a person first; take over, reply, hand back
- **Guest requests** (12f-2): "change my date", "a question": answer, mark done
- **Alerts** (11d, 12f-2): overdue balances, refunds that need attention

### E. Settings (owner)

Everything built with an API only, waiting for screens: the **website** (style, light/dark,
business details, approved websites + the embed snippet), the **messages** (the six
templates: edit, preview, back to default), **WhatsApp** (the number), **staff and roles**,
**tours** (products, prices, schedules, policies: already have APIs since sessions 4–9).

---

## 3. The screens

### Screen O1 · Sign in

**Shows:** email or phone; then the code (6 boxes), "Didn't get it? Send again" (after 30 s).
**States:** wrong code (and how many tries are left), too many tries (wait N minutes), no
connection ("You need signal to sign in the first time").

### Screen O2 · Today (the guide's home)

**Shows:** the date; each of MY departures today (and tomorrow, under it): time, tour, meeting
point, guests booked, checked in so far ("8 of 12"), my van / boat. A strip saying whether
this phone is **online, offline, or syncing**, and "N changes waiting" when there are some.
**States:** no departures today; offline (the copy saved at …); changes waiting; a conflict
to look at (a banner).

### Screen O3 · The manifest (one departure)

**Shows:** at the top: tour, time, meeting point, guide, van/boat, "8 of 12 checked in",
**Scan** (big). Then every booking: the lead (name, phone to call), each traveller (name, age
group, dietary needs: "no peanuts"), add-ons ("2 × palm wine sampler"), pickup point,
**payment status** ("Paid" / "₦45,500 still to pay"), and each traveller's state:
pending · **present** · **late** · **no-show**. Search by name. **Print / PDF** (OPS-07).
**States:** offline (works the same; "saved at 07:42"); a traveller with no name yet (WhatsApp
bookings name only the lead: "Guest 2 of Adaeze Okafor's booking"); a cancelled booking (kept,
struck through: "cancelled yesterday"); money still owed (how should it show? question 3).

### Screen O4 · Scan

**Shows:** the camera, a frame to aim at. A good scan: the booking, its travellers with a tick
each (all ticked), **Check in** · or **Late**. Search by name instead.
**States:** a ticket for ANOTHER departure or day ("This ticket is for Sat 5 Dec, 09:00"); a
cancelled booking ("Cancelled: don't check in"); scanned twice ("Already checked in at
08:52"); not one of ours / unreadable; no camera permission (how to allow it, and search
instead); offline (works: the tickets are checked on the phone, see section 4).

### Screen O5 · Sync and conflicts

**Shows:** what's waiting to send (each change: "Adaeze Okafor: present, 08:52"), the last
sync. A conflict: what this phone did, what the server had, and what happens now (e.g. "You
marked Tunde present at 09:05, but his booking was cancelled at 08:30. Nothing changed.").
**States:** all synced; sending; a conflict (with **OK** to dismiss, or **Undo mine**).

### Screen O6 · Schedule (the manager)

**Shows:** a week, departures as cards per day (phone: one day at a time): time, tour, seats
"9 / 15", guide, van/boat, a mark when someone's missing. Filter by tour.
**States:** a departure with no guide; a double assignment refused (why); a cancelled
departure; sold out.

### Screen O7 · A departure (assign, cancel)

**Shows:** the departure's numbers, the manifest summary, **Guide** (pick from guides free
then), **Van / boat** (pick from resources free then, with their seats: "Van 1 · 14 seats"),
notes for the guide, **Cancel departure** (with what it does: "12 bookings refunded in full,
guests told by WhatsApp and email").
**States:** the guide or van is busy then (why, and when they're free); the van is too small
for the guests booked; cancelling (confirm, then the result).

### Screen O8 · Bookings (find, see, act)

**Shows:** search (reference, name, phone), filters (today, upcoming, owes money, cancelled);
a booking: lead and travellers, the tour and date, payments and refunds, the messages it was
sent (and whether they arrived: "WhatsApp · read", "Email · failed: …"), its timeline;
**Send payment link**, **Cancel**, **Mark no-show**, **Add note**.
**States:** paid / part paid / held (the hold's countdown) / cancelled / refunded; a refund
that needs attention.

### Screen O9 · Inboxes: chats, requests, alerts

**Chats:** the list (needs a person first), one chat (the messages as the guest saw them,
the booking it led to), **Take over** · reply · **Hand back** (API since 13b).
**Requests:** the guest's question or change request, the booking, **Mark answered** (+ a
note). **Alerts:** what's wrong and the action ("Balance overdue: send a link").
**States:** empty; WhatsApp's 24-hour rule ("They last wrote 2 days ago: they need to write
first"); a message that failed to send.

### Screen O10 · Settings

The deferred screens, together (from briefs 03, 04, 05): **Website** (style picker with live
previews, light/dark, business details form, approved websites + embed snippet with a live
preview), **Messages** (the six templates: edit with placeholder chips, preview, reset),
**WhatsApp** (the number, the webhook address to paste in Meta), **Staff and roles**.

---

## 4. Offline, in plain words (OPS-09)

| What                            | How                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| What's saved on the phone       | today's and tomorrow's departures **I'm assigned to**, with their manifests         |
| When it's refreshed             | whenever there's signal: on opening the app, and every few minutes                  |
| What works with no signal       | the manifest, search, scanning, present / late / no-show, notes                     |
| How a ticket is checked offline | the QR holds a signed code (12f); the phone matches it to its saved manifest        |
| What's saved meanwhile          | each change, in order, in an **outbox** on the phone                                |
| When signal returns             | the outbox sends itself, oldest first, each change once (even if sent twice)        |
| What the server does            | applies each change, unless it can't any more: then it's a **conflict**             |
| A conflict (examples)           | the booking was cancelled meanwhile; another guide marked it differently first      |
| Who decides a conflict          | nobody guesses: it's shown (O5), and the server's version stands until staff choose |
| How long it can be offline      | 72 hours (PRD), tested with the clock moved forward                                 |

Staff screens that need fresh data (the schedule, bookings, settings) say "You're offline"
rather than showing something stale as if it were current.

---

## 5. Questions for you

1. **Resources.** Vans and the boat are new (nothing exists yet). Is a resource just a name and
   its seats ("Van 1 · 14 seats", "Boat · 12")? Do vans and the boat also need a driver /
   skipper assigned, or is the guide enough for the MVP?
2. **No-show.** Marking a no-show applies the policy's no-show refund (built in session 9: at
   Ìrìn, nothing back). Should a **guide** be able to mark it (offline too), or only mark the
   travellers "not here", with the manager confirming the no-show later?
3. **Money owed on tour day.** A guest who still owes their balance arrives. Does the manifest
   just show it ("₦45,500 to pay"), or should check-in warn / need the manager?
4. **Unnamed travellers** (WhatsApp bookings name only the lead). Does the guide type their
   names at check-in, or is "Guest 2 of Adaeze Okafor's booking" fine for the MVP?
5. **One app or two?** One operator app for everyone (what you see depends on your role), or a
   separate, simpler "guide" app? (I'd suggest one app; the guide just sees less.)

---

## 6. What I can build before your designs

Like the WhatsApp engine (13a), the server side doesn't need screens:

- **Resources and assignment** (OPS-01): vans and the boat; assigning guides and resources to
  departures; refusing a double assignment, with why
- **The manifest** (OPS-07): one call with everything screen O3 shows, and the PDF
- **Check-in** (OPS-08): by ticket code or by traveller; present / late / no-show
- **The sync API** (OPS-09): today's offline package for a guide, and the outbox endpoint that
  applies changes in order, once each, and returns conflicts
- **Cancel a departure**: every booking refunded per the operator-cancels rule, guests told

Then, with your designs: the app itself (sign-in, today, manifest, scan, offline outbox,
schedule, bookings, inboxes, settings) and **journey 6 end to end with the network off**.

## 7. Proposed stages

| Stage | Builds                                                                                     |
| ----- | ------------------------------------------------------------------------------------------ |
| 15a   | resources and assignment; the manifest (+ PDF); check-in; cancel a departure (server)      |
| 15b   | the sync API: the offline package, the outbox endpoint, conflicts; 72-hour tests (server)  |
| 15c   | the app's shell (PWA, sign-in, offline storage, the outbox) and the guide's screens: O1–O5 |
| 15d   | journey 6 end to end with the network off                                                  |
| 16a   | schedule and departure screens (O6, O7)                                                    |
| 16b   | bookings desk and inboxes (O8, O9)                                                         |
| 16c   | settings (O10: website, messages, WhatsApp, staff)                                         |

**Please design:** screens O1–O10 (phone first; O6–O8 on desktop too), with their states.
The guide's screens (O1–O5) first, if you'd like to start smaller: 15c needs only those.

---

## Decided (2026-11-19)

- **Question 1, resources:** a name and its seats ("Van 1 · 14 seats", "Boat · 12 seats").
  **No drivers or skippers in the MVP**: a departure's note can say who's driving ("Driver:
  Sola"); proper driver assignment can come later if Ìrìn needs it.
- **Question 2, no-show:** the **guide** marks it, after the start time, **offline too**; it
  syncs like check-in, and the manager can still change it later.
- **Question 3, money owed on tour day:** the manifest and the scan **show** it ("₦45,500 still
  to pay"), and checking that booking in **asks first** ("They still owe ₦45,500. Check in
  anyway?").
- **Question 4, unnamed travellers:** shown as "Guest 2 of Adaeze Okafor's booking", with an
  **optional** name the guide can type at check-in (it syncs like check-in).
- **Question 5, one app** for everyone (assumed, as suggested): what you see depends on your
  role; the guide just sees less.
