# Stage 12a: The guest web foundation

Session 12 builds your designs (see `docs/designs/README.md` for all eight stages). This stage
builds no guest screen yet. It lays down what every screen is made of: the app, your **Lagoon
tokens**, and the **base components** from your token sheet.

## 1. What we built

| Piece                 | Where                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| The guest web app     | `apps/web` (React 19 + Vite 8, routing by wouter)                                                      |
| Tokens, one source    | `packages/shared/src/tokens.js` (Lagoon, light and dark)                                               |
| Tokens as CSS         | `apps/web/src/styles/tokens.css` (generated: `pnpm --filter @okapigo/web tokens`)                      |
| Base components       | `apps/web/src/components/`: Button, TextField, Stepper, Chip, Notice, TestModeStrip, Shell, ErrorState |
| API client            | `apps/web/src/lib/api.js`                                                                              |
| Component gallery     | `/_gallery` in the dev server: the token sheet, rebuilt from real components                           |
| Serving the built app | `apps/api/src/lib/web-assets.js` + `/assets/*`                                                         |
| The 300 KB budget     | `apps/web/scripts/check-budget.js`, run by every build and in CI                                       |

Run it: `pnpm --filter @okapigo/web dev`, then open `http://localhost:5173/_gallery`. (Or the
`web` preview in `.claude/launch.json`.) API requests are passed through to `:4000`, so
start the API too once screens use it.

## 2. How it works

### Tokens: one source, three outputs

```
packages/shared/src/tokens.js   LAGOON = { color: { light, dark }, text, space, radius, … }
        │
        ├─► tokensToCss()  ─► apps/web/src/styles/tokens.css   --color-primary: #9BD10F; …
        ├─► the contrast tests (every text/background pair, light and dark)
        └─► later: emails (session 14), the share-card image (12b)
```

Components only ever say `var(--color-primary)` or `var(--radius-lg)`. The redesign after the
MVP changes **values in one file**, and every screen follows. A website style (Classic, Earth,
12g) is the same names with other values.

**Dark mode.** The page follows the phone's setting (`prefers-color-scheme`), unless
`<html data-mode="dark|light">` forces one (the operator's choice, 12g). The CSS has the dark
values twice for that reason: once for "the phone says dark", once for "forced dark".

**Generated, so it can't drift.** `tokens.css` is written by a script and never edited by hand.
A test regenerates it in memory and compares. While building this stage, that test caught
Prettier reformatting the file (see Gotchas).

### Contrast, proven by tests

The PRD requires WCAG 2.1 AA. `packages/shared/test/tokens.test.js` computes the real contrast
ratio for 18 pairs (text on every surface, on-primary on primary, status colours on their soft
backgrounds, input edges at 3:1) **in light and in dark**. A mutation check made muted text a
little lighter, and three tests failed at once.

Your sheet didn't give every **dark** value: border-strong, the status colours and their soft
backgrounds, and the disabled greys. I chose them to pass the same contrast targets, and they're
marked ⚠ in `tokens.js`. **Please review them**: they're your call, not mine.

Two values came from the design files rather than the sheet:

- the "Paid" chip's soft green (`success-soft`, #DCF3D0)
- the three shadows (`elevation.1`, `elevation.2`, and the sticky bar's upward shadow)

### Components that only display

Each component shows what it's given and reports what the guest does. None of them knows a
business rule:

- **Stepper** reports "the guest pressed +". Whether a 4th seat is allowed comes from the server
  as `max`. A disabled + has a spoken label ("Add one Adult (13+)").
- **TextField** always shows its label (never only a placeholder), and its error text is linked
  to the input, so screen readers announce it.
- **Button** says _why_ it's disabled, in words underneath (your sheet: "plus a reason in words
  nearby").
- **Notice**: danger is announced at once (`role="alert"`), warnings politely.
- **Letter mark**: the first letter as people see it. "Ọ̀" is two code points even after
  normalising, so splitting by character would drop the tone mark. `Intl.Segmenter` splits by
  **grapheme** (what a reader counts as one letter).

### One API client, four kinds of failure

```
api('/public/…') ─► ok            → the JSON
                 ├► 'offline'     no connection (or the phone already knows it's offline)
                 ├► 'timeout'     no answer in 20 s
                 ├► 'server'      5xx: our fault                → "Something went wrong on our side."
                 └► 'api'         a normal "no": SOLD_OUT, ADULT_REQUIRED… with its message
```

Every screen gets your "offline / request failed" states for free. A mutation check found a gap
here: our API's 500 answers **do** carry an error body, so "has an error body" didn't
distinguish them from a normal "no". The status code decides now, and a test sends a realistic 500.

### The 300 KB budget

After each build, `check-budget.js` reads Vite's manifest, gzips everything the first page load
needs, and **fails the build** if the total passes 300 KB. CI runs it too. Today: **71.4 KB**
(24%), mostly React itself. The gallery is loaded only when opened (`React.lazy`), so guests
never download it.

### Serving it in production

Booking links answer with server-made HTML (11e) so previews work, and the app loads inside
that page. The API reads `dist/.vite/manifest.json` to know the file names
(`index-BcG8TJT0.js`). Those names contain a hash of the content, so `/assets/*` can be cached
for a year (`immutable`): a changed file gets a new name. The share pages start loading the app
in 12b, when there's a real screen for them to show.

## 3. Why we chose what we chose

| Choice                         | Alternative           | Why                                                                     |
| ------------------------------ | --------------------- | ----------------------------------------------------------------------- |
| Tokens in JS, CSS generated    | tokens written in CSS | one source for CSS, contrast tests, emails and images                   |
| Plain CSS with `okg-` prefixes | CSS-in-JS, Tailwind   | no runtime cost; can't clash with a host site's CSS in the widget (12h) |
| wouter for routes (~2 KB)      | React Router (~20 KB) | the same idea, a tenth of the size, within the 3G budget                |
| System fonts                   | a web font            | 0 files to download (your sheet: "0 font files on checkout")            |
| Budget check in the build      | measuring by hand     | a heavy library added by mistake fails CI, not a guest's phone          |

## 4. Concepts to study

- **Design tokens** and **CSS custom properties** (`var(--…)`)
- `prefers-color-scheme`, `color-scheme`
- **WCAG contrast ratio** (relative luminance), and why links use primary-ink, not primary
- **Accessible names** (`aria-label`, `<label for>`), `aria-describedby`, `role="alert"`
- **Content hashing** and immutable caching
- **Code splitting** (`React.lazy`, dynamic `import()`)
- **Graphemes** vs code points (`Intl.Segmenter`)

## 5. Try it yourself

```bash
pnpm --filter @okapigo/web dev
```

Open `http://localhost:5173/_gallery`, then tap "Show dark" / "Show light". Next, change
`primary` in `packages/shared/src/tokens.js` and run:

```bash
pnpm --filter @okapigo/web tokens
```

Every button follows. Then put the colour back, and try the budget check failing:

```bash
pnpm --filter @okapigo/web build && OKG_BUDGET_KB=50 node apps/web/scripts/check-budget.js
```

## 6. Gotchas

- **Run Prettier from the repo root.** It reads `.prettierignore` only from the folder it runs
  in. Run inside `apps/web`, it reformatted the generated `tokens.css` (lowercase colours,
  single quotes). The freshness test caught it straight away, which is why it exists.
- **Docker after a restart.** The database tests failed with `ECONNREFUSED` because Docker
  Desktop wasn't running. `pnpm services:up` once Docker is open.
- **macOS has no `timeout` command.** An early `timeout 40 pnpm view …` printed "fetch failed",
  which was really "command not found". Read errors to the end.
- ESLint's own unused-variable rule can't see JSX, so in `apps/web` it skips capitalised names
  (components). `eslint-plugin-react` would do it properly but doesn't support ESLint 10 yet.
  The **Rules of Hooks** plugin is on, and a deliberate mistake proved it.

## 7. What's next

**Stage 12b:** the catalogue (A) and the tour page (B), phone and desktop, with their states;
the share pages start loading the app; the new tour details the designs show (activity label,
meeting-point note); and the 1200×630 share card image.
