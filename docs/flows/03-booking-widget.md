# Flow 03: Booking widget

**PRD:** BKG-01. _"The operator copies a snippet from an Embed page with live preview and pastes it
into any site; inline calendar or pop-up 'Book now' button; checkout runs in an iframe served by
OkapiGo, so card details never touch the operator's site; the frame resizes itself and sends a
booking-completed event to the parent page; UTM codes carry into the booking; only approved domains
can embed it."_

There are two sides: the **guest** (on the operator's own website) and the **operator** (making the
snippet).

---

## Guest side

The widget shows **the same checkout screens as flow 01**, inside a frame on someone else's website.
So the new design work is small: how the widget _starts_, and how it sits inside a foreign page.

### Mode 1: Inline calendar

```
┌ operator's website ───────────────────────────────┐
│  …their own content…                              │
│  ┌ OkapiGo widget (iframe) ─────────────────────┐ │
│  │  Lagos Island Heritage Walk · from ₦25,000   │ │
│  │  [Sat 5] [Sun 6] [Mon 7] [Tue 8] …  ›         │ │   ← checkout screen 1, compact
│  └──────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

Tapping a date continues **inside the frame** (screens 2 → 4), and the frame grows to fit.

### Mode 2: Pop-up button

A **Book now** button on the operator's page opens checkout in an overlay (full screen on phones).

**Please design:**

- the compact **inline** start (one tour, or a list of tours)
- the **button** (its style must sit nicely on unknown websites: the operator can set its colour)
- the **overlay**: close button, and what it looks like on a phone (probably full screen)
- the frame's **edges**: no own page background? a subtle border? (It must look fine on light and
  dark host sites.)

### Paying from inside a widget

Paystack's page can't run inside another site's frame, so **Pay** opens Paystack in the full
window (or a new tab), and the guest comes back to the confirmation page (flow 02). Please design the
small notice on screen 4: "You'll be taken to Paystack to pay securely."

### States

- loading inside the host page (the frame shouldn't jump around)
- **domain not approved:** the widget shows nothing to guests (the operator sees why in their preview)
- tour sold out / no dates

---

## Operator side: the Embed page (in the operator app)

**Shows:**

1. **What to embed:** one tour, or all tours
2. **How:** inline calendar, or pop-up button (with button text and colour)
3. **Live preview** of exactly what guests will see, using real content
4. **The snippet**, with a big **Copy** button and a one-line "Paste this into your website where you
   want it to appear"
5. **Approved websites:** a list of domains (`irinlagostours.com`), add / remove. Unlisted sites
   can't show the widget.
6. A short "**Tracking:** links with `?utm_source=…` are recorded on the booking" note

**States:** no approved domains yet (warning: "Add your website first, or the widget won't show");
copied ✓.

**❓ For you:** this page lives in the **operator app** (sessions 15–16). Design it together with the
operator app's look, or now with the guest tokens, as you prefer.
