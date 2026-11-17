# Guest web designs (v1)

Your first-version designs for the guest-facing screens, answering the flow briefs in
`docs/flows/`. They are the source of truth for session 12. The professional redesign after the
MVP will replace the **token values**, not the screens' logic.

| File                                    | Brief                                 | What's in it                                                                                                                            |
| --------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `00-tokens-lagoon.webp`                 | all                                   | **Lagoon**, the default token set: colour (light, dark), type, space, shape, elevation, buttons, inputs, stepper, chips, notices          |
| `01-catalogue-tour-and-checkout.html`   | 01                                    | Catalogue (A), tour page phone + desktop (B), the 1200×630 share card, checkout steps 1–4 (incl. Street Food extras, Lekki pickup, Badagry deposit), desktop checkout, all states, the WhatsApp link preview |
| `02-after-paying-and-messages.html`     | 02                                    | Confirming (C) and its states, confirmed full / deposit / phone-only (D), payment link page (E) and its 6 states, pay your balance (F), **message wording** (WhatsApp + email layout) |
| `03-booking-widget.html`                | 03                                    | Inline widget (one tour, all tours) on light and dark host sites, the Book now button, overlay (desktop, phone), loading, domain not approved, sold out, the Paystack notice |
| `04-operator-website.html`              | 04                                    | One-page site, phone and desktop; **Lagoon, Classic, Earth** × light and dark; no tours; missing optional content                        |
| `05-trip-hub.html`                      | 05                                    | Trip hub upcoming and trip day; 9 banners (balance due, overdue, after, cancelled ×2, refunded, request open, offline); cancel yourself (3 steps); ask Ìrìn (form, sent) |

**Viewing them:** they're bundled pages that draw themselves with JavaScript, so open them in a
browser, or run the `design-files` preview (`.claude/launch.json`, port 4890).

## How session 12 is staged

Each stage ends with screens that work against the real API, tests, a learning note and a
commit, like sessions 10 and 11.

| Stage   | Builds                                                                                                         | Designs           |
| ------- | -------------------------------------------------------------------------------------------------------------- | ----------------- |
| **12a** | **Foundation:** `apps/web` (React + Vite), the Lagoon tokens (light, dark) as CSS variables, the base components from the token sheet, the page shell, API client with offline/error states, served inside 11e's server-made pages, a 300 KB budget check in CI | 00                |
| 12b     | Catalogue (A) and tour page (B, phone + desktop) with their states; the 1200×630 share card image; the tour data the designs add (see gaps) | 01                |
| 12c     | Checkout 1–2: dates by week, who's coming, extras, pickup point, live price ("Updating…"), the adult rule, seat and stock limits, desktop layout | 01                |
| 12d     | Checkout 3–4: details and field errors, hold, review and pay, deposit choice, countdown, hold expired / seats ran out, payment set-up states. End-to-end test of journey 1 | 01                |
| 12e     | After paying: confirming → confirmed, declined, paid late; payment link page and its states; pay your balance; add to calendar. End-to-end test of journey 5 | 02                |
| 12f     | Trip hub: ticket (QR), map, checklist, route, all banners, offline copy; cancel yourself (new public cancel API); ask Ìrìn (new requests table + staff list) | 05                |
| 12g     | Operator website: the one page, Lagoon / Classic / Earth × light / dark, business details (new fields + staff API), empty and missing states | 04                |
| 12h     | Booking widget: embed script (inline + pop-up), resizing frame, booking-completed event, approved domains, UTM capture, its states | 03                |

The **message wording** in file 02 is kept for session 14, which sends the messages.

## Gaps: what the designs show that the system doesn't have yet

| Design shows                                                     | Plan                                                                          | Stage      |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------- |
| An activity label per tour: "Walking", "Boat", "Van, pickup"     | new tour field                                                                | 12b        |
| "Up to 15 guests", "Daily 09:00", "Thu–Sat 18:30"                | derived from capacity and schedules (no new data)                             | 12b        |
| Meeting point note: "by the fountain, guide in a green Ìrìn cap" | new `note` on the meeting point                                               | 12b        |
| Pickup point landmark and time: "Eko Hotel main gate · 07:15"    | add `time` to pickup points; seed updated to the design's landmarks          | 12c        |
| "Arrive by 08:50" / "please arrive 10 minutes early"             | new tour field (minutes early)                                                | 12e        |
| "Today's guide: Segun" on the trip day                           | needs guide assignment (session 15); the line stays hidden until then         | 15         |
| The "Ask a question" AI box                                      | placeholder only, as designed (session 17)                                    | 12f → 17   |
| Business tagline, about text, city, WhatsApp, phone, email, socials | new operator fields; the form is an operator screen (deferred)             | 12g        |
| Booking links at `irin.okapigo.site/…`, trip pages at `/t/<code>` | **question for you** (below)                                                  | 12a        |

## Question for you

**Booking link addresses.** The designs show one subdomain per operator (`irin.okapigo.site`),
with trip pages at `/t/<code>`. Stage 11e built path-based links: `okapigo.app/irin-lagos-tours/…`.

- **Subdomain per operator** (as designed): looks like the operator's own site and leads
  naturally to custom domains (v1). It needs wildcard DNS and certificates at deployment.
- **Path-based** (as built): simpler to deploy, already working; can move to subdomains later
  without breaking links if the old addresses redirect.
