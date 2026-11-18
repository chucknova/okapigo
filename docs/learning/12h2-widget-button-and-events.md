# Stage 12h-2: The "Book now" button, the frame following the payment, and where bookings come from

From your designs (file 03: "The Book now button", "Overlay on desktop", "Overlay on a phone")
and PRD BKG-01: _"pop-up 'Book now' button … sends a booking-completed event to the parent page;
UTM codes carry into the booking"_. This finishes the booking widget (12h-1 was inline).

## 1. What we built

| Piece                                            | Where                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| The button and its overlay                       | `apps/api/src/lib/embed-script.js` (`data-widget="button"`)                    |
| Close (×) inside the overlay, Escape             | `CheckoutFrame.jsx`, `Embed.jsx`, `apps/web/src/lib/embedded.js`               |
| The frame following the payment in the other tab | `Review.jsx` (watches), `Confirm.jsx` inside the widget                        |
| "okapigo:booking-completed" for the host page    | `Confirm.jsx` → `embed.js` → a DOM event                                       |
| Where a booking came from                        | `bookings.attribution`; `AttributionSchema`; `apps/web/src/lib/attribution.js` |
| The button's corners from the operator's style   | `GET /public/:operator/embed-check` → `buttonRadius`                           |

## 2. How it works

### The button

```html
<div
  data-okapigo="irin-lagos-tours"
  data-tour="lagos-island-heritage-walk"
  data-widget="button"
  data-label="Book the Heritage Walk"
  data-colour="#0F4C5C"
></div>
<script src="https://okapigo.app/embed.js" async></script>
```

- **Shown only on an approved website.** It stays hidden until `/embed-check` says yes.
- **Its own look, on anyone's page:** system font, 48 px tall, the operator's colour, and its
  corners from the operator's style (12 in Lagoon, 4 in Classic, pills in Earth). The **text
  colour is chosen for contrast**: white on dark teal, dark on sand, whichever reads better
  (the same WCAG maths as our tokens).

### The overlay

```
[Book now] ──► dimmed page ── a box (520 × 760; full screen on phones) ── the checkout frame
                                                                          /embed/…/book?overlay=1
close it:  × in the frame (Back's place on step 1; beside Back from step 2)
           Escape (in the frame or on the page)
           a click on the dimmed page
→ focus goes back to the button
```

While it's open, the rest of the host page is **inert**: no keyboard focus, no clicks, and
screen readers skip it. The overlay is a `role="dialog"` with `aria-modal`. In the overlay the
frame has a fixed size and scrolls inside, so it doesn't report a height.

### After paying: the frame follows

```
Pay ─► Paystack in a new tab (12h-1)
       the frame (step 4): every 3 s look at the booking; every 9 s ask Paystack ("check")
       paid ─► the frame shows "Booking confirmed" ─► tells the host page:
               { type: 'okapigo:booking-completed', booking: { reference, operator, tour,
                 amountPaidKobo, currency } }
embed.js ─► a DOM event on the operator's <div> (it bubbles):
            document.addEventListener('okapigo:booking-completed', (e) => e.detail.reference)
```

**Nothing personal goes to the host page**: no name, email or phone, only what a host needs
for its own records or analytics. `embed.js` copies only the known fields, so even a changed
message can't add more. On the confirmation, "Open your trip page" opens a new tab: the host
page should never hold the guest's private link.

### Where a booking came from

```
https://irinlagostours.com/tours?utm_source=newsletter   (the host page)
  embed.js adds the UTM codes and the host's name to the frame's address
  the app keeps them for the visit (the first page wins), sends them with the booking
  → booking.attribution = { via: 'widget', host: 'irinlagostours.com', utm_source: 'newsletter' }
```

The operator's own site works the same way (`via: 'website'`). The codes come from a link
anyone can make, so `AttributionSchema` allows short plain text only and refuses unknown fields.
Staff see it on the booking.

## 3. Found along the way

- **A test relied on a race:** 12h-1's inline test ended on "Paystack is open in a new tab".
  Now that the frame moves on to the confirmation, it passed only if it looked fast enough. It
  checks the confirmation and the event now.
- **A test for the overlay clicked a button that wasn't shown yet** (approval not answered).
  A guest can't do that; the test now waits like a guest.
- **Two tests hung for 20 s** in one full run at a moderate load (about 6), and passed in the
  next. One of them ("a 30% deposit…") has timed out in several stages now. That looks less
  like slowness and more like two tests **waiting on each other in the database**. Worth its own
  investigation (suggested as a separate task) rather than a longer time limit.

## 4. Why we chose what we chose

| Choice                           | Alternative                  | Why                                                         |
| -------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| Close (×) inside the frame       | a × drawn by embed.js on top | your design: it sits where Back is, part of the header      |
| `inert` on the rest of the page  | trapping Tab by hand         | the browser does it properly, screen readers included       |
| Watch the booking from the frame | ask the guest to come back   | they stay on the operator's site and see their confirmation |
| Known fields only in the event   | the whole booking            | the host page belongs to someone else                       |
| First UTM codes of the visit win | the last ones                | that's the link that brought the guest                      |

## 5. Concepts to study

- **Modal dialogs**: `aria-modal`, `inert`, returning focus
- **Custom DOM events** (`CustomEvent`, `bubbles`) as a page's public API
- **UTM codes** and first-touch vs last-touch attribution
- **Contrast-based text colour** (relative luminance)

## 6. Try it yourself

```bash
node apps/web/e2e/host-server.js
```

```text
http://localhost:4200/?op=irin-lagos-tours&tour=lagos-island-heritage-walk&widget=button&colour=%230F4C5C&base=http://localhost:4000&utm_source=newsletter
```

Book, pay in the new tab, and come back: the overlay shows the confirmation. In the browser's
console: `okgEvents` (the test page keeps the events it heard).

## 7. Differences from the designs

- **The overlay's box** is 520 × 760 px on desktop (the design shows the size, not numbers).
- **A booking-completed event** fires when the frame sees the booking paid, which is a few
  seconds after paying, not at the click.
- **Reloading the confirmation inside the frame** isn't handled by the server (it's reached
  only by the frame itself, never by an address someone types).

## 8. What's next

That's session 12's guest web done: catalogue, tour pages, checkout, after paying, the trip hub,
the operator website and the booking widget. Next in the plan: **session 13** (WhatsApp booking).
