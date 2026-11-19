# Stage 15c-2: The manifest (O3)

The guide's main screen on tour day, from your designs (O3 Manifest, O3 Manifest — states).
Every tap works offline: it goes into the outbox (15c-1) and the row says "Not sent yet".

| Stage     | What                                                                         |
| --------- | ---------------------------------------------------------------------------- |
| 15c-1     | the app, sign-in, first run, strip, tabs, saved package, Sync                |
| **15c-2** | **the manifest: search, traveller states, names, no-shows, money owed, PDF** |
| 15c-3     | Scan (O4) and its problem states                                             |
| 15c-4     | money on the day (QR, cash), pickup stops, the A4 printed manifest           |

## 1. What we built

| Piece                                                            | Where                                    |
| ---------------------------------------------------------------- | ---------------------------------------- |
| The screen                                                       | `apps/operator/src/screens/Manifest.jsx` |
| What it shows, what a tap means, the change it records           | `src/lib/manifest.js`                    |
| A long press (or right-click) opens the choices                  | `src/lib/long-press.js`                  |
| The printable manifest, with the sign-in token                   | `src/lib/print.js`                       |
| A centred dialog (questions), besides the bottom sheet           | `src/components/Sheet.jsx`               |
| Server: one traveller's no-show; late and no-show from the start | `packages/db/src/operations.js`          |
| Server: the no-show policy in the package                        | `manifest()` → `noShowRefundPercent`     |

## 2. A tap, and a long press

```
tap      Not yet → ✓ Present → Late 07:04 → ✕ No-show → Not yet …
         before the start: Not yet ↔ Present only (late and no-show unlock at 07:00)
hold     the choices, in a sheet: Present · Late (· from 07:00) · No-show · Not yet
```

Each tap records `{ kind: 'check_in', travellerIds: [one], status, seen }`. `seen` is the
state the phone showed, so the server can spot someone else's change (15b's conflicts).

**Money owed** (decided 2026-11-19: show it, ask first): the first check-in on a booking that
owes asks "Funmi still owes ₦45,500" → **Check in, still owing** or **Not now**. Once someone
on the booking is in, it doesn't ask again (the answer goes with each later tap). The QR and
the cash buttons from your design arrive in 15c-4.

## 3. Two kinds of no-show

Your design has a traveller's pill go to "No-show", and "Mark the rest of this booking
no-show". They aren't the same thing, so the server learned the difference:

| What happened                          | What's recorded                    | The policy?              |
| -------------------------------------- | ---------------------------------- | ------------------------ |
| one traveller isn't here (others came) | that traveller: `no_show`          | no (the booking came)    |
| **nobody** on the booking came         | the booking: a no-show (session 9) | yes: "no refund" at Ìrìn |

"Mark the rest of this booking no-show" picks the right one. For the whole booking it asks
first, with the policy: "1 traveller. Under Ìrìn Lagos Tours’s policy a no-show gets no
refund, and the balance of ₦45,500 stays unpaid. The office can change this later." The
policy's no-show rate now travels in the package, so this works offline.

Server rules added: **Late and a traveller's no-show only from the start time**
(`NOT_STARTED`, "Late can only be marked from 07:00."), and marking someone not-here never
asks about money.

## 4. Found along the way: a lost update

A test of "Save and mark present" (a name, then a check-in: two changes at once) kept only
one. The outbox was **read, then saved (which waits), then written back**: anything that
changed it during the wait, the second tap, or answers arriving from the server, was
overwritten. The classic **lost update**.

The fix: change the outbox in memory in **one step** (JavaScript runs one thing at a time, so
nothing can get in between), then save whatever it holds now. The same for answers coming
back. A test now records three changes at once and checks all three are kept, in order.

## 5. Other details from the designs

- **Search** by name (any traveller, accents ignored: "irin" finds "Ìrìn"), the reference,
  or the last digits of the lead's phone; "No one called “Okonkwo” on this trip."
- **Unnamed guests**: "Add a name (optional)" → "Save and mark present", "Save name only",
  "Skip". 2 to 80 characters, like the server.
- **Cancelled bookings** below, dashed and struck through: "Cancelled yesterday · don’t check in".
- **PDF**: made by the server, so offline it says **Needs signal**. It's fetched with the
  sign-in token (a plain link can't carry it) and opened from memory; the window opens
  first, straight from the tap, or the browser blocks it as a pop-up.
- **Neutral words** again: "Ask them to pay now" (the design says "her").

## 6. Checked in a real browser

Chrome at phone size, signed in as Kemi on tomorrow's Street Food Crawl: a tap → Present →
sent and confirmed ("Online · up to date"); a long press → the choices with Late and No-show
locked until 18:30; offline, a tap → "Not sent yet · 21:31" and "1 change waiting"; back
online → sent. I then tapped both travellers back to "Not yet" (their booking's history in
your dev database keeps these check-in events).

## 7. Checks

52 tests in the app (16 new: the manifest's logic and screen, and the lost update), 4 new or
changed on the server. 13 mutation checks (late before the start, `seen`, asking about money
once, rest-vs-whole no-show, rest only after the start, short names, phone search, the
policy's words, the lost update, the server's start-time rule, no money question for a
no-show, the policy in the package), all caught; one survived at first (no-show skipping the
money question had no test) and got one.

**Full runs: six, two of them clean** (the first and the last; 1,210 tests). The four in
between each had one to three failures, **each in a different test and suite** (the sign-in
screen, the simulator, the ledger's race test, the workers' queue, the embed and
guest-messages tests), each passing when run alone. All were timing failures ("Unable to
start a transaction in the given time", waits running out) while the machine's load was
10–25: your `pnpm dev` restarts its API and worker each time a file changes, and its worker
shares Redis with the workers' test (the same trap as the shared database). The browser
journeys: 8 of 8 on the second try (journey 2 timed out on the first). The fix for good is
the proposed follow-up: **tests get their own database and queues**.

## 8. Concepts to study

- **Lost updates** (read-modify-write races), and why single-threaded JavaScript still has
  them across an `await`
- **Long press vs tap** on touch screens (pointer events, the context menu)
- **Domain modelling**: when one word ("no-show") hides two different things
