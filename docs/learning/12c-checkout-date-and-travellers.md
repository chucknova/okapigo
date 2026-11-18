# Stage 12c: Checkout steps 1–2 (choose a date, who's coming)

The first half of checkout, built from your designs (file 01: "1 · Choose a date", "2 · Who's
coming" for Heritage, Street Food and Lekki, "Checkout on desktop", and the step 1–2 states).

## 1. What we built

| Piece                                      | Where                                                         |
| ------------------------------------------ | ------------------------------------------------------------- |
| The frame of every checkout step           | `apps/web/src/screens/checkout/CheckoutFrame.jsx`             |
| Step 1 · Choose a date                     | `screens/checkout/ChooseDate.jsx` (`/:op/:tour/book`)         |
| Step 2 · Who's coming, extras, pickup      | `screens/checkout/WhoComing.jsx` (`/:op/:tour/book/who`)      |
| Pure checkout logic (tested)               | `apps/web/src/lib/checkout.js`                                |
| What's been chosen + the live price        | `apps/web/src/lib/checkout-state.js`                          |
| Styles                                     | `apps/web/src/styles/checkout.css`                            |
| Pickup points with landmark and time       | `PickupPointSchema.time`, seed: Eko Hotel main gate · 07:15 … |
| "Free cancellation until Thu 3 Dec, 09:00" | `freeCancellationUntil()` in shared `tour-facts.js`           |

Step 3 (`/book/details`) is a placeholder until 12d. The API serves every checkout address with
the tour's data embedded, as it does for tour pages.

## 2. How it works

### Step 1: dates by week

```
GET …/departures?from=today&to=today+91   (the API allows 92 days per request: 3 months)
   │
   ├── month tabs  Nov · Dec · Jan     opens on the first month with a free seat
   ├── weeks       "Mon 30 Nov – Sun 6 Dec", "Mon 7 – Sun 13 Dec"   (Monday to Sunday)
   └── rows        Sat 5 · 09:00 · [7 left]   ·   Fri 4 · Sold out (greyed, not a button)
```

Edge cases from the designs: "Show more dates" after 10 rows; an empty month ("No more trips in
December… The next one with seats: [Sat 2 Jan · 07:00]"); a fully booked month; and coming from a
date tile on the tour page (`?departure=id`), which picks that date and goes straight to step 2.

### Step 2: the server prices, the screen shows

```
guest taps + ──► counters change at once ──► 300 ms quiet ──► POST …/quote
                                                               │
     price card "Updating…", Continue off ◄── waiting          │
     price lines, total, VAT, Continue on  ◄── answer: quote, blocker, availability
```

- **Money only comes from the server.** The pricing pipeline (session 5) runs on every quote.
  The screen never adds up a price itself.
- **Debounced.** Three quick taps on + make **one** request, sent 300 ms after the last tap.
  Each answer is labelled with the basket it priced. "Updating…" means "the latest answer is for
  an older basket", so a slow answer never overwrites a newer one.
- **Limits come from the quote's availability.** Seats left on the date cap all the counters
  together (every traveller takes a seat, infants too), and stock left caps each extra.
- **The adult rule is the server's.** The quote returns
  `blocker: { code: 'ADULT_REQUIRED', message }`. The screen shows that message in the travellers
  card (I changed the server's wording to your design's) and turns it into
  "Add an adult to continue" under the button.

### Continue says why it's off

`continueState()` returns the first thing to fix, in words, under the button:

| Problem                  | Under Continue                     |
| ------------------------ | ---------------------------------- |
| no travellers            | Add at least one traveller         |
| more than the seats left | Only 7 seats left on this date     |
| children alone           | Add an adult to continue           |
| pickup tour, none chosen | Choose a pickup point              |
| a newer price on its way | _(disabled, no words: it's brief)_ |

Continue only works once the **newest** price has arrived, so the total the guest sees is the
total they agree to.

### Remembering choices

`useCheckout()` keeps the date, counters, extras and pickup in **sessionStorage**, per tour. A
refresh, a slow reload or going Back loses nothing ("Nothing you entered is lost"). It lasts as
long as the browser tab, so tomorrow's visit starts fresh. Storage can be blocked (private
mode), so every read and write is wrapped and the page works without it.

## 3. A bug found in the browser

Choosing a date did nothing. The row highlighted, but step 2 never appeared, and the console
showed no error. The saved state had `departure: null`. What happened:

```
step 1: update({ departure })   → React state now; storage written LATER (in an effect)
        navigate('/book/who')   → step 1 unmounts before its effect runs: storage never written
step 2: reads storage           → no date → "no date chosen" → back to step 1
```

The fix: `update()` writes storage **at the moment of the change**, using a ref that always
holds the latest state. A test now does exactly what I did in the browser (choose a date, expect
step 2, expect storage to have it), and a mutation check that brings the late write back makes it
fail.

Lesson: **when one screen hands data to another, the hand-over must be finished before the
navigation**, not "soon after".

Two more things came from testing in the browser:

- **Date rows had no clear accessible name.** A screen reader would hear the pieces ("Thu",
  "19", "09:00", "15 left") rather than one useful sentence. Each row now says
  "Thu 19 Nov, 09:00, 15 left".
- **A test that tapped twice too fast.** It fired both clicks before React re-rendered, so the
  second click saw stale counts. People can't tap faster than a render, so the test now taps
  like a person: one click, then the next.

## 4. Why we chose what we chose

| Choice                             | Alternative                | Why                                                                |
| ---------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| One step per address (`/book/who`) | one page with hidden steps | Back works, a refresh keeps your place, and steps can be linked to |
| sessionStorage                     | localStorage, the server   | survives refreshes, not tomorrow; nothing is held before step 3    |
| Debounce 300 ms                    | a request per tap          | fewer requests on 3G; the counter itself still changes instantly   |
| Seats/stock from the quote         | from the departures list   | the quote is fresher (it's asked after every change)               |
| Server message for the adult rule  | the screen's own words     | one rule, one wording, every channel (WhatsApp in session 13 too)  |

## 5. Concepts to study

- **Debouncing**, and labelling async answers to avoid race conditions
- **sessionStorage vs localStorage**, and why storage access is wrapped in try/catch
- **Effects run after rendering**: why a write in an effect can be too late
- **Accessible names** (`aria-label`), `role="progressbar"`, `aria-current="step"`
- `<fieldset>` + `<legend>` for radio groups

## 6. Try it yourself

With the API and web running, open
`http://localhost:5173/irin-lagos-tours/lekki-nature-and-craft/book`:

1. Pick a date, then remove the adult and add a child: the red message, and Continue explains
   itself.
2. Add the adult back: Continue still says "Choose a pickup point". Pick Ikoyi.
3. Refresh the page: everything is still there.
4. Widen past 960 px: the step list and the summary card ("Free cancellation until…").

Your dev database got the new pickup landmarks and times directly. `pnpm db:reset` gives a clean
copy.

## 7. What's next

**Stage 12d:** checkout steps 3–4. Your details (lead booker, travellers with ages, dietary needs,
"I'm travelling too", terms), the hold (15 minutes, with a countdown), review and pay (the deposit
choice on Badagry), and every state: field errors, seats running out while filling in, the hold
expiring, payment being set up or unavailable. Then the first end-to-end test of a whole booking.
