# Flow briefs: what to design

These briefs describe the **guest-facing screens** for sessions 11–12, so you can design the first
version before I build them. Each brief lists the screens **in order**, what each one **shows** and
**lets the guest do**, the **data** behind it, the **states** to design, and the **rules** the design
must respect. Business logic already exists in the API; screens only display data and call it.

| Brief                                                     | Covers                                                                        | PRD                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------- |
| [01 Tour page and checkout](01-tour-page-and-checkout.md) | Finding a tour, choosing a date, travellers, details, paying (incl. deposits) | BKG-32, BKG-02, BKG-06, journeys 1 and 5 |
| [02 After paying](02-after-paying.md)                     | Confirmation, "confirming your payment", payment links, paying a balance      | PAY-05, BKG-06, journey 5                |
| [03 Booking widget](03-booking-widget.md)                 | Embedding booking on another website; the operator's Embed page               | BKG-01                                   |
| [04 Operator website](04-operator-website.md)             | The one-page site generated from products, in 2–3 styles                      | MKT-08, MKT-09                           |
| [05 Trip hub](05-trip-hub.md)                             | One light page per booking: itinerary, map, what to bring, QR ticket          | GST-04                                   |

**Suggested design order:** 01 → 02 → 05 → 04 → 03. Checkout is the critical path; the widget
reuses checkout's screens inside a frame, so it needs the least new design.

---

## Constraints for every screen

| Constraint                                                                     | Why                                                   | Source              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------- |
| **Design for a phone first** (360 px wide), then scale up                      | Most Nigerian guests book on mid-range Android phones | PRD NFR "Mobile"    |
| **Checkout in no more than 4 screens**                                         | Date → travellers and add-ons → details → pay         | BKG-02              |
| **Light pages**: checkout's first load under **300 KB**; works on throttled 3G | Data is expensive; connections are slow               | NFR "Mobile"        |
| **WCAG 2.1 AA**                                                                | Accessibility checks must pass                        | NFR "Accessibility" |
| **Booking in under 2 minutes** on a phone                                      | Success criterion                                     | Goal 1              |
| **Card details never on our pages**                                            | Card entry happens on Paystack's hosted page          | PAY-02              |

What these mean for your designs:

- **Contrast:** text ≥ 4.5:1 against its background (≥ 3:1 for large text and UI controls).
- **Tap targets** at least 44 × 44 px.
- **Every input has a visible label**, not only a placeholder.
- **Errors are said in words** next to the field, not only shown in red.
- **Photos are optional decoration:** every tour has real content without them (photos arrive later),
  so design the text-only version first. Use few, compressed images.
- **No custom web fonts on checkout**, or one at most (each font file is weight against 300 KB).
  System fonts are a good default.
- **Money** is always shown as naira with the ₦ sign and thousands separators: **₦25,000**. Whole
  naira only (the system rounds to naira).
- **Times** are Lagos time, shown like **Sat 5 Dec, 09:00**. No time-zone label needed for guests.
- **Phone numbers** may be typed as `0803 123 4567` or `+234…`; both are accepted.

## Design with tokens, so the later redesign is a reskin

The plan is that a professional designer restyles the UI after the MVP **without touching logic**.
Please define your design as **tokens** (named values), and I'll build every component from them:

| Token group | Examples                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour      | `color.bg`, `color.surface`, `color.text`, `color.text-muted`, `color.primary`, `color.on-primary`, `color.border`, `color.success`, `color.warning`, `color.danger` |
| Type        | `font.family`, sizes `text.xs` → `text.2xl`, weights, line heights                                                                                                   |
| Space       | a scale, e.g. 4 · 8 · 12 · 16 · 24 · 32 · 48                                                                                                                         |
| Shape       | `radius.sm`, `radius.md`, `radius.lg`, border widths                                                                                                                 |
| Elevation   | 1–2 shadow levels at most                                                                                                                                            |

The operator website (brief 04) needs **2–3 styles** that are just different token sets, plus light
and dark mode. If checkout and the website share the same token names, a style switch restyles both.

## States to design for every screen

Each brief lists the states specific to it. These apply everywhere:

| State                        | What the guest sees                                            |
| ---------------------------- | -------------------------------------------------------------- |
| **Loading**                  | A skeleton or spinner. On 3G this can last seconds.            |
| **Offline / request failed** | "You're offline" or "Something went wrong", plus **Try again** |
| **Validation error**         | A message beside the field, in words                           |
| **Empty**                    | e.g. no departures in the chosen week                          |

## Real content to design with

Use **Ìrìn Lagos Tours** (from the seed data) so designs face real lengths and real edge cases.

| Tour                                   | Adult   | Child (3–12) | Infant (0–2) | Runs                     | Seats | Add-ons                                                                         |
| -------------------------------------- | ------- | ------------ | ------------ | ------------------------ | ----- | ------------------------------------------------------------------------------- |
| Lagos Island Heritage Walk (3 h)       | ₦25,000 | ₦12,500      | free         | Daily 09:00 (not 25 Dec) | 15    | none                                                                            |
| Lagos Street Food Crawl (3.5 h)        | ₦35,000 | ₦20,000      | free         | Thu–Sat 18:30            | 10    | Extra tasting plate ₦5,000 (10 a night) · Palm wine sampler ₦4,000 (10 a night) |
| Lekki Nature and Craft Half-Day (5 h)  | ₦45,000 | ₦25,000      | free         | Wed, Sat 08:00           | 12    | none · **3 pickup points** (VI, Ikoyi, Lekki Phase 1)                           |
| Tarkwa Bay Beach and Lagoon Trip (6 h) | ₦40,000 | ₦22,000      | free         | Sat, Sun 10:00           | 12    | Beach chair & umbrella ₦7,500 (6 a trip) · Packed lunch ₦8,000                  |
| Badagry Heritage Day Trip (10 h)       | ₦65,000 | ₦35,000      | free         | Sat 07:00                | 14    | Lunch ₦8,000 · **30% deposit allowed**                                          |

- Prices **include 7.5% VAT** (the receipt can show "includes ₦4,360 VAT").
- **Cancellation policy (Standard):** full refund 48 h or more before; 50% from 24 to 48 h; nothing
  after, or for no-shows. If Ìrìn cancels (e.g. weather), a full refund.
- **Seats are held for 15 minutes** while the guest pays.
- Example booking reference: **ILT-7K4Q2M**.

Every tour also has: a summary, a description, a meeting point (name, address, map position), stops
in order, inclusions, exclusions, "what to bring", and FAQs. See
`packages/db/src/seed/tours.js` for the full text.

## How to hand designs back

Any tool is fine: Figma, Penpot, even photos of sketches. For each screen, please include:

1. the **phone** layout (360 px), plus desktop where it differs a lot
2. the **states** listed in its brief
3. your **tokens** (colours, type, spacing), even roughly

Questions or changes to a flow? Note them on the design, or tell me and I'll update the brief.
Anything here can change: these are a starting point, not a spec to obey.
