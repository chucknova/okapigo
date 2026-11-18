# Stage 12d: Checkout steps 3–4 (your details, review and pay) + the first end-to-end test

The second half of checkout, from your designs (file 01: "3 · Your details", "4 · Review and
pay", the Badagry deposit version, and the states), and **PRD journey 1 tested end to end in
a real browser**.

## 1. What we built

| Piece                                    | Where                                                         |
| ---------------------------------------- | ------------------------------------------------------------- |
| Step 3 · Your details                    | `apps/web/src/screens/checkout/Details.jsx` (`/book/details`) |
| Step 4 · Review and pay                  | `screens/checkout/Review.jsx` (`/book/review`)                |
| Hold + book, start a payment             | `apps/web/src/lib/checkout-actions.js`                        |
| Missing fields, server errors, countdown | `apps/web/src/lib/checkout.js`                                |
| Cancellation terms as dates              | `policyDeadlines()` in shared `tour-facts.js`                 |
| Phone numbers the way people write them  | `formatPhoneForDisplay()` in shared `contact.js`              |
| The end-to-end test                      | `apps/web/e2e/`, `apps/web/playwright.config.js`              |

## 2. How it works

### Step 3: the moment seats are held

```
Continue to payment
  ├─ anything MISSING?  (name, email-or-phone, ages, the terms box)  → errors by the fields
  ├─ same basket as the booking already held?                        → reuse it, go to step 4
  ├─ an older held booking?                                          → give its seats back first
  └─ POST /public/:operator/bookings  → seats held 15 min + booking (held) + a guest token
        ├─ 201  → keep the token → step 4
        ├─ 400 VALIDATION_ERROR / AGE_CATEGORY_MISMATCH → the server's words, under the field
        ├─ 409 SOLD_OUT        → "Sorry, only 1 seat is left now" + choices, details kept
        └─ 409 ADD_ON_SOLD_OUT → "The palm wine sampler sold out" + Continue without it
```

**Who checks what.** The screen only checks that things are **filled in**. Whether a phone number
is valid ("Enter 11 digits like 0803 123 4567, or start with +234."), or an age fits its counter
("Child: ages 3–12. For age 13, go back and choose Adult."), is the **server's** answer. I changed
the server's messages to your design's wording, so WhatsApp (session 13) will say the same.

The field paths match on both sides: the server says `lead.phone` or `travellers.2.age`, and the
screen keeps its errors under those same keys. That's how each message lands next to its field.

**One guest, one hold.** If the guest goes back and changes the date or travellers, the old
booking's seats are released before the new hold. Otherwise they'd hold two sets of seats for 15
minutes. If nothing changed, the same booking is reused. A test checks the order: release first,
then book.

### Step 4: everything from the held booking

`GET /public/bookings/:token` returns what the server holds: the price snapshot, travellers,
`paymentOptions` (full, plus a deposit on Badagry with its due date), and `holdExpiresAt`.

- **The countdown** ("Seats held 14:32") ticks every second from `holdExpiresAt`.
- **The hold has ended** when the clock passes it **or** the server offers nothing to pay. You see
  "Your 15 minutes are up", the summary dimmed, and "Hold my seats again", which makes the same
  booking from what the guest entered, with no retyping.
- **Pay** sends an **option** (`full` or `deposit`), never an amount (the rule from 11c), then
  `window.location.assign(…)` to Paystack's page (the simulator in test mode).
- **A double tap** sends one request: the button is disabled while "Setting up your payment…", and
  the handler also ignores a second call. A mutation check removed both guards to prove the test
  catches it.
- **The provider being down** gives "Payment is temporarily unavailable · Your seats are still
  held for 12:10", with Try again.

### The end-to-end test (Playwright)

```
pnpm --filter @okapigo/web e2e
  vite build ──► API on :4100 (serves the built app) ──► Postgres, Redis ──► worker
                    ▲
  Chrome, sized as a Pixel 7:
    catalogue → Heritage Walk → date tile → + child (₦37,500) → details → Continue to payment
    → Pay ₦37,500 → simulator "Pay" → callback page → poll the booking → status "paid" ✓
```

`e2e/global-setup.js` seeds a throwaway Ìrìn (`test-e2e-…`), starts the worker (it processes the
payment webhook that confirms the booking), and on the way out stops the worker and deletes the
operator. Everything is found **by visible labels**, the way a guest finds it: if a button's name
changes, the test fails, and that's a feature.

**Locally it uses your installed Google Chrome**, because Playwright's own browser (190 MB) kept
timing out on this connection. CI downloads Playwright's Chromium on GitHub's network.

## 3. Found along the way

- The phone showed as stored (`+2348031234567`). People write `0803 123 4567`, as your design shows.
  It's now formatted for display only; it's stored the same way as before.
- **A real gap:** nothing tested that changing the basket releases the old hold. A mutation check
  produced broken code, which hinted at it. The new test covers it.
- A script of mine **stopped half-way**: Prettier had reformatted a line it was looking for, so
  later edits didn't apply, but a file deletion before them did, which left a broken import.
  Lint and the next check caught it. Lesson: one edit per step, or check everything after a script
  fails.

## 4. Why we chose what we chose

| Choice                                     | Alternative                    | Why                                                                     |
| ------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------- |
| Required-ness on screen, formats on server | duplicate all rules in the app | one set of rules for web, staff, WhatsApp and OTA                       |
| Reuse the held booking if nothing changed  | always book again              | going back to check something shouldn't cost a new hold                 |
| Release the old hold before a new one      | let it expire                  | a 10-seat Street Food night can't afford one guest holding 6            |
| Hold again with the same details           | send back to step 3            | your design: "hold them again with everything you entered"              |
| End-to-end through the real API + worker   | mock the server in the browser | proves the parts work together: the webhook really confirms the booking |

## 5. Concepts to study

- **End-to-end testing** vs unit tests; Playwright's locators (`getByRole`, `getByLabel`)
- **Idempotent UI actions** (double taps) and `aria-busy`
- **Field-path error mapping** between server and form
- **303 See Other** after a form POST (the simulator's redirect)
- Test **setup/teardown** that cleans up even if a run is killed (the `test-` prefix)

## 6. Try it yourself

```bash
pnpm --filter @okapigo/web e2e
```

Then by hand, with `pnpm dev` running: book the **Badagry** trip on a Saturday more than a week
away, and on step 4 choose the 30% deposit. Or wait 15 minutes on step 4 and press "Hold my seats
again".

## 7. Differences from the designs

- "Book 1 traveller instead" takes you to step 2 with the limit set, rather than dropping a
  traveller automatically (which one to drop is the guest's choice).
- "Hold ended" doesn't say how many seats are still free; "Hold my seats again" finds out.
- The phone hint ("Give an email or a phone number, or both.") sits above the field, not below.
- The terms text links to the tour page's policy rather than separate terms pages (those pages
  come with the operator's business details).

## 8. What's next

**Stage 12e: after paying.** "Confirming your payment…" becoming "Booking confirmed" (it
replaces today's plain callback page), the deposit version with "Pay balance now", the payment
link page and its six states, paying a balance, "Add to calendar", and journey 5 (deposit, then
balance) end to end.
