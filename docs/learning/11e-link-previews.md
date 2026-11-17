# Stage 11e: Link previews (and the end of session 11)

PRD BKG-32: every tour and the catalogue have a **shareable booking link** that works anywhere
a link can go (WhatsApp, Instagram bio, X, QR codes) **with proper link previews**. In Nigeria,
WhatsApp is where tours get shared, so the preview card often decides whether anyone taps.

## 1. What we built

| Address                                       | What a crawler sees                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/irin-lagos-tours`                           | "Ìrìn Lagos Tours", "5 tours from ₦25,000: Badagry Heritage Day Trip, …"                                              |
| `/irin-lagos-tours/badagry-heritage-day-trip` | "Badagry Heritage Day Trip · Ìrìn Lagos Tours", "A full day in Badagry… · From ₦65,000 · 10 hours · Next: Sat 21 Nov" |

Files:

- `apps/api/src/routes/share-pages.js`: the two pages, server-rendered
- `packages/shared/src/preview.js`: `formatDuration`, `formatDay`, `truncate`,
  `tourPreviewDescription` (pure, tested; the guest web will show the same words)
- `packages/shared/src/slug.js`: **reserved slugs**
- `WEB_PUBLIC_URL`: the address guests see links under (defaults to `API_PUBLIC_URL`)

## 2. How it works

### What happens when a link is pasted

```
you paste a link ─► WhatsApp's server fetches it ─► reads <head>:  og:title
   in a chat         (a "crawler", no JavaScript)                   og:description
                                                                    og:image (if any)
                                                                    og:url
                    ◄── draws the preview card from those tags
```

These are **Open Graph** tags, a format Facebook introduced and almost everyone now reads.
X reads its own `twitter:card` too: `summary_large_image` when there's a picture, `summary`
(a small text card) when there isn't.

**Crawlers don't run JavaScript.** If the page were a React app that fills itself in after
loading, the crawler would see an empty shell, and the preview would be the bare address. So the
**server** writes the tags into the HTML. In session 12 the guest web app will load inside this
same page. The `<head>` stays server-made, and today's simple `<body>` is replaced.

### What goes in the description

`tourPreviewDescription()` puts the **summary first** (it's the most persuasive line), then
the facts people decide on:

```
A full day in Badagry: the Point of No Return, … · From ₦65,000 · 10 hours · Next: Sat 21 Nov
└──────────── summary, cut at a word, ≤150 chars ┘  └ from price ┘ └ length ┘ └ next date w/ a seat ┘
```

- **From price**: the adult-style price, the same rule as the tour cards (11a).
- **Next date**: the next departure **with a free seat**, the same `DISTINCT ON` query as 11a.
  If all are full, it's left out rather than advertising a date nobody can book.
- **Dates in Lagos time**: "Sat 21 Nov" from `Intl.DateTimeFormat('en-GB', { timeZone })`.
  A test checks 23:30 UTC on a Friday shows as Saturday.

### Escaping

Operators type tour titles and summaries. A title like `"><script>…` written straight into
`content="…"` would close the attribute and run a script on our page (**XSS**). Every value goes
through `escapeHtml()`, and a test with exactly that title proves it shows as text.

### Root paths and reserved words

Booking links live at the **root**: `okapigo.app/irin-lagos-tours`. The app's own paths live
there too: `/api`, `/health`, `/pay`, `/webhooks`…

1. **Order**: the share routes are mounted **last**, so every existing route wins.
2. **Reserved words**: `RESERVED_OPERATOR_SLUGS` (api, pay, health, checkout, embed, trip…)
   are skipped by the share routes, and **sign-up never hands one out**. "API Tours" gets
   `api-3f9a`, just as if `api` were taken.
3. **Tour slugs** like `checkout` or `embed` are reserved too, so the guest web can use
   `/irin-lagos-tours/checkout` later without ever clashing with a tour. Staff typing one get
   a 400. A title that would make one ("Checkout") becomes `checkout-tour`.

An existing test caught the one change in behaviour: `/does-not-exist` used to answer a JSON
404, but now it's shaped like a booking link, so it gets the HTML "not found" page (with
`noindex`, so search engines don't list it). That's the intended meaning of the root now, so
the test was moved to a path that can't be a booking link.

### What's deliberately NOT here: the card image

The flow brief (01, screen B) asks **you** to design the **1200×630 preview card**: the
image WhatsApp shows big. Following our rule (you design screens, I build them), the page uses
a tour **photo** when one exists. With no photos yet (uploads arrive in session 18) it shows a
text card. The designed card image is built in session 12 from your design.

## 3. Why we chose what we chose

| Choice                            | Alternative                    | Why                                                                   |
| --------------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| Server-rendered `<head>`          | client-side React only         | crawlers don't run JavaScript                                         |
| Pages at the root, reserved words | `/t/irin-lagos-tours/…`        | the PRD's short links; easy to read out and type from a poster        |
| Reserve words now                 | when needed                    | once a business owns `checkout`, taking it back breaks their links    |
| `og:url` from configuration       | from the request's Host header | the Host header is attacker-controlled ("host header injection")      |
| 5-minute cache                    | no cache                       | crawlers fetch often; the next date can be 5 minutes stale harmlessly |

## 4. Concepts to study

- **Open Graph protocol** (ogp.me) and **X cards**
- **Server-side rendering (SSR)** vs client-side rendering, and why crawlers care
- **XSS** and context-aware escaping
- **Host header injection**
- **Canonical URLs** (`<link rel="canonical">`)

## 5. Try it yourself

With `pnpm dev` running:

```bash
curl -s localhost:4000/irin-lagos-tours/badagry-heritage-day-trip | grep -E 'og:|twitter:'
```

```bash
curl -s localhost:4000/irin-lagos-tours | grep og:description
```

Then open `localhost:4000/irin-lagos-tours` in a browser. Real crawlers can't reach
`localhost`; to see a true WhatsApp preview you need a public address (session 18, or a tunnel
such as `cloudflared` if you're curious). Facebook's Sharing Debugger and similar tools show
exactly what a crawler reads.

## 6. Gotchas

- Previews are **cached by the apps themselves** (WhatsApp keeps one for a while). Changing a
  title won't update a link already shared. Our own 5-minute cache is only the first layer.
- `og:image` must be an **absolute** URL. When uploads arrive (session 18), photo URLs must be
  full addresses, not `/uploads/…`.
- A one- or two-word path at the root is now a booking link. New app routes must either use a
  reserved word or live under one (`/api/…`).

---

# Session 11 in one page

| Stage | What guests (and staff) can do now                                             |
| ----- | ------------------------------------------------------------------------------ |
| 11a   | Browse tours, tour pages and dates with seats, without signing in              |
| 11b   | Get live prices, hold seats, book, come back via a private link, release seats |
| 11c   | Pay in full, a 30% deposit (Badagry), or the balance                           |
| 11d   | Get balance reminders 7/3/1 days before the due date; staff see overdue alerts |
| 11e   | Share links that preview properly in WhatsApp, Instagram and X                 |

Your decisions built in: no children without an adult (13+), pickup points stored, balance due
7 days before the trip, late bookers pay in full, reminders 7/3/1 days before, nothing
cancelled automatically.

Along the way: the test suite was made stable under load (measured, not guessed), a flaky worker
test became deterministic, and two of my own slips were caught and fixed (a base64 spelling
weakness in guest links, and processors reading `job.data` wrong).

**Every screen in briefs 01 and 02 now has its API.** Session 12 builds the screens from your
designs.
