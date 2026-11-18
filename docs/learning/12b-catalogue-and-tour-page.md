# Stage 12b: The catalogue, the tour page, and the share card

The first guest screens, built from your designs (file `01-catalogue-tour-and-checkout.html`):
**A · Catalogue**, **B · Tour page** (phone and desktop) with their states, and the **1200×630
share card** WhatsApp shows when a link is pasted.

## 1. What we built

| Piece                          | Where                                                                       |
| ------------------------------ | --------------------------------------------------------------------------- |
| Catalogue (A)                  | `apps/web/src/screens/Catalogue.jsx`                                        |
| Tour page (B), phone + desktop | `apps/web/src/screens/TourPage.jsx`, `styles/screens.css`                   |
| Which dates to show            | `apps/web/src/lib/dates.js` (pure, tested)                                  |
| Embedded data + `useApi`       | `apps/web/src/lib/data.js`                                                  |
| One source for public data     | `apps/api/src/lib/public-views.js` (public API **and** share pages)         |
| Share pages now load the app   | `apps/api/src/routes/share-pages.js`                                        |
| The share card                 | `apps/api/src/lib/share-card.js`, `/:operator/:tour/card.png`               |
| Words for facts                | `packages/shared/src/tour-facts.js`: "3.5 h", "Thu–Sat 18:30", policy lines |
| New data                       | `products.activity_label`, `operators.city`, meeting-point `note`           |

## 2. How it works

### A booking link, from tap to page

```
guest taps okapigo.app/irin-lagos-tours/badagry-heritage-day-trip
   │
   ▼  API (share-pages.js): ONE response containing
   │    <head>  link-preview tags · the app's CSS and script (/assets/…, cached a year)
   │    <script id="okg-data">  the tour, exactly as GET /public/… would return it
   │    <div id="root">  header + title + summary, styled  ← what a slow phone sees first
   ▼
   app starts → takeEmbedded() finds the tour → draws the page at once (no second request)
              → fetches only the LIVE part: seats per date (never cached)
```

On 3G, every request costs about a second. The page needs one request for the HTML plus one for
seats, not three. A test checks the app made no catalogue request when data was embedded.

**Embedding JSON in HTML safely.** A tour title containing `</script>` would end the data tag
early and let the rest run as HTML. `jsonForScript()` writes every `<` as `<`: the same
character to `JSON.parse`, invisible to the HTML parser. A test uses exactly that title, and a
mutation check proved the test catches it.

### One set of elements, two layouts

The phone and desktop designs arrange the same content differently. On a phone: one column,
price and Book in the hero, a sticky Book bar at the bottom. On desktop: a booking card on the
right (`position: sticky`) with the price note and a date list.

It's **one** React tree, laid out by CSS grid areas (`band`, `hero`, `book`, `content`). The few
phone-only and desktop-only bits use `display: none`, which also hides them from screen readers,
so nothing is announced twice.

### The dates

`summariseDates()` decides what "Next dates" shows:

| Situation                           | Shows                                              |
| ----------------------------------- | -------------------------------------------------- |
| normal                              | next 4 dates, **sold-out ones greyed, not hidden** |
| every date in the next 2 weeks full | "Sold out until Sat 5 Dec" + next 2 with seats     |
| nothing bookable                    | "No dates scheduled yet"                           |

"Only 3 left" appears from 3 seats down. Each tile links to checkout with that date chosen
(`/book?departure=…`, built in 12c).

### `useApi` and a lint rule that taught something

The first version set "loading" inside an effect. The React hooks lint (added in 12a) flagged
it: that renders twice for nothing. Now every answer is stored **with the request it answers**
(`path#attempt`). "Loading" means "no answer for the current request yet", and an answer for a
page the guest already left is never shown on the new one.

### The share card

```
tour ──► satori (lays out boxes and text, real font metrics, wraps the title)
     ──► SVG ──► resvg ──► PNG 1200×630 ──► memory cache (keyed by a hash of the card's text)
```

The card's address carries that hash (`card.png?v=LCg7L4MG06dTb1RL`). Change the title or
price, and the address changes. WhatsApp caches previews by address, so it fetches the new card.

Two bugs only showed up by **looking at the image**:

1. **The bottom row fell off.** The layout engine sizes boxes like CSS's default
   `content-box`, so 64/72 px of padding was added on top of 1200×630. Its debug mode outlined
   the boxes: 1344×758. Fixed with `boxSizing: 'border-box'`.
2. **₦ came out as a "NO GLYPH" box.** Only the extended-Latin font file has the naira sign,
   and with all three files sharing the name "Inter", the engine didn't fall back between them.
   Each file now has its own name. A test asks the engine to report any character no font can
   draw, using "₦", "Ìrìn" and "Ọ̀ṣun". A mutation check gave the files one shared name again,
   and the test caught it.

The fonts ship with the app (Inter, open licence) because a server may have none installed.

### Words for facts (`tour-facts.js`)

| Data                                 | Words                                     |
| ------------------------------------ | ----------------------------------------- |
| `durationMinutes: 210`               | "3.5 h" (cards), "3 hours" (chips)        |
| schedule `[4,5,6] 18:30`             | "Thu–Sat 18:30"                           |
| schedule `[0,6] 10:00`               | "Weekends 10:00"                          |
| policy 48 h 100% / 24 h 50% / 0 h 0% | "48 hours or more before: full refund" …  |
| categories                           | "per adult · child ₦12,500 · infant free" |

They live in the shared package, so the operator website (12g) and emails (session 14) will say
the same.

## 3. Why we chose what we chose

| Choice                             | Alternative                | Why                                                             |
| ---------------------------------- | -------------------------- | --------------------------------------------------------------- |
| Embed the page's data in the HTML  | the app fetches it         | one fewer round trip on 3G; no flash of empty page              |
| Seats always fetched live          | embed them too             | the page is cached 5 minutes; seat counts must be current       |
| Server-made image (satori + resvg) | a headless browser         | ~3 s for the first card, then cached; no Chrome on the server   |
| Card colours fixed in the renderer | read the operator's tokens | the design is one dark card; styles per operator come with 12g  |
| Tours listed alphabetically        | the design's order         | there's no display-order field yet; alphabetical is predictable |

## 4. Concepts to study

- **Bootstrapping / hydrating data** (embedding JSON in server HTML)
- **XSS in `<script>` contexts** and why `<` must be escaped
- **CSS grid template areas**, `position: sticky`, `env(safe-area-inset-bottom)`
- **content-box vs border-box**
- **Font subsets** and fallback stacks, **glyph coverage**
- **Cache busting** with content hashes

## 5. Try it yourself

Your dev database was given this stage's new fields directly (activity labels, city, the
meeting-point note). Run `pnpm db:reset` whenever you like for a clean copy.

With the API (`:4000`) and web (`:5173`) running:

- `http://localhost:5173/irin-lagos-tours`, and tap a tour. Resize past 960 px for desktop.
- Open a share card:

  ```bash
  open "http://localhost:4000/irin-lagos-tours/badagry-heritage-day-trip/card.png"
  ```

- The production path: `pnpm --filter @okapigo/web build`, restart the API, and open
  `http://localhost:4000/irin-lagos-tours/badagry-heritage-day-trip`. View the page source to
  see the embedded `okg-data`.

## 6. Gotchas and differences from the designs

- **Not in the data yet:** the area on the card ("· Lagos Island"), a short business name ("If
  Ìrìn cancels" says "If Ìrìn Lagos Tours cancels"), the WhatsApp/contact button (business
  details, 12g), and a tour display order.
- **Desktop simplifications:** the cancellation card shows the full tier list on desktop too,
  and "Included / Not included" stay one card. Same content, slightly different arrangement.
- **Large downloads on a slow connection:** the card tools took 16 minutes to install, with
  retries. A failed install leaves a half-written `pnpm-lock.yaml`: restore it with
  `git checkout pnpm-lock.yaml` before trying again.
- **`fflate` advisory:** satori pulls in a decompression library with a moderate advisory
  (a loop on malformed ZIP archives). A pnpm **override** in `pnpm-workspace.yaml` forces the
  patched release.
- The desktop app stops preview servers that sit idle for hours. `preview_start` brings them
  back.

## 7. What's next

**Stage 12c:** checkout steps 1–2: choose a date (by week, month tabs), who's coming (counters
by category, the adult rule), extras with stock, the pickup point (with landmark and time), the
live price with "Updating…", and the desktop checkout layout.
