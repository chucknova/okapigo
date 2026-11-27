# Stage 19c-3: landmarks and main headings (axe's best practice)

| Part      | What                                                                   |
| --------- | ---------------------------------------------------------------------- |
| 19c-1     | Accessibility checks on every guest page (WCAG 2.1 AA)                 |
| 19c-2     | The staff app's script split                                           |
| **19c-3** | **axe's best-practice rules too: every page has a main and a heading** |
| 19d       | README and demo script                                                 |

**Decided (2026-11-27):** "fix them first, then 19d".

WCAG 2.1 AA (what the PRD asks for) already passed everywhere. axe's **best-practice** rules go
further, mostly for people using screen readers, who move around a page by its landmarks
("go to main content") and headings ("go to the main heading").

## 1. What the stricter rules found (every page checked)

The check now uses `expect.soft`: every page is checked and every problem listed, instead of
stopping at the first page with one.

| Page                                    | Found                                                                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Tour page (every style, phone and desk) | no `<main>`; then, on a phone, the sticky "from ₦… · Book" bar outside any region                                                       |
| Checkout, all four steps (phone)        | no main heading (the step's heading is desk-only); the "Test mode" bar, and on "Who's coming?" the sticky total bar, outside any region |
| The widget                              | no `<main>`; the all-tours list had no main heading                                                                                     |
| "Not found" (the server's own 404 page) | no `<main>`                                                                                                                             |

The website, the trip pages, booking confirmed and the payment link already passed.

## 2. The fixes

- **Tour page:** its layout is the `<main>`; the phone's sticky bar is a region, "Price and
  book".
- **Checkout:** the phone's step title ("Who's coming?") is the page's `<h1>` (the desk's is
  hidden on a phone, so there's always exactly one); "Test mode" is a region; the sticky bar is
  a region, "Total and next step".
- **The widget:** each page is a `<main>`; the all-tours list has a visually hidden heading,
  "Ìrìn Lagos Tours: tours" (the design shows only the rows).
- **The server's 404 page:** wrapped in `<main>`.
- **Nothing looks different.** A heading gets the browser's big heading size and the style's
  heading font (Classic's is Georgia): the checkout title and the trip day's line (19c-2) keep
  their own size and font.
- **The check stays on:** `a11y.spec.js` uses WCAG 2.0/2.1 A and AA **and** best practice, so
  they stay fixed.

## 3. Found along the way

- **One problem hid the rest.** The first look stopped at the first page with a problem;
  `expect.soft` showed the whole list, and it was only four patterns.
- **A test without the stylesheet sees both headings.** The unit tests (jsdom) don't load CSS,
  so the phone's and the desk's `<h1>` are both there; in a browser only one shows. The unit
  test asks for "at least one"; the browser check holds the real page to exactly the rules.
- **Turning text into a heading changes how it looks** unless its class says otherwise (size,
  and the heading font): checked for both.

## 4. Checks

- `apps/web/e2e/a11y.spec.js`: WCAG 2.0/2.1 A and AA **and** best practice, every page soft-
  checked: **all pass** (3 journeys, 26 checks).
- **Broken on purpose:** the tour page without its `<main>`, the checkout title back to a plain
  line, the "Test mode" bar outside a region, the widget's list without its heading: **all 4
  caught.**
- Unit tests: the checkout step's title is a level-one heading (`checkout-screens.test.jsx`).
- **Full runs:** run 1 had one failure, the WhatsApp paying file (the known clash in the shared
  test database; its fix is on the other session's branch, not merged here), which passed alone
  (17 of 17); run 2 passed in full, **1,910 tests**.
- **E2E:** all **15 journeys pass**.

## 5. Concepts to study

- **Landmarks**: `<main>`, `<header>`, `<nav>`, named `<section>`s, and how screen readers jump
  between them.
- **One main heading per page**, and headings as the page's outline.
- **axe's rule sets**: WCAG tags vs best practice, and `expect.soft` to see every failure.
