# Stage 19c-1: accessibility checks on every guest page

| Part      | What                                                                      |
| --------- | ------------------------------------------------------------------------- |
| 19b       | Photos and the logo                                                       |
| **19c-1** | **axe checks every guest page against WCAG 2.1 AA; what it found, fixed** |
| 19c-2     | Polish: the staff app's script over 500 kB                                |
| 19d, 19e  | README and demo script; deploy (December)                                 |

PRD: _"Guest pages meet WCAG 2.1 AA."_

## 1. The check

`apps/web/e2e/a11y.spec.js` runs **axe** (`@axe-core/playwright`) in the real browser, with the
real API and the built pages, against **WCAG 2.0 and 2.1, levels A and AA**:

| Pages                                                                                    | How                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| The website and a tour page                                                              | **every style (Lagoon, Classic, Earth), light and dark**, phone and desk |
| Checkout: choose a date, who's coming, details (with its errors showing), review         | phone                                                                    |
| Booking confirmed; the paid trip page (ticket, map, companion); change; ask the business | phone                                                                    |
| A payment link; the widget's own pages (all tours, one tour); "not found"                | phone                                                                    |

- **Its own business** with the demo's 18 photos and logo (the journeys' business has none), so
  pictures, alt text and credits are checked too. The e2e API keeps its pictures in a
  temporary folder (`MEDIA_DIR` in `playwright.config.js`), never the repo.
- **Styles without touching the database:** `?style=earth&mode=dark` is the site's own preview
  (MKT-09).
- **Contrast is measured on what's drawn**, so the check waits for the pictures to load.
- A failure lists each problem with where it is ("`a[aria-label=…]`: Text inside the element
  is not included in the accessible name"), so it can be fixed without guessing.
- It runs with the journeys: `pnpm e2e`, every stage.

**What axe can't judge** (and a person still should): whether an alt text is GOOD, whether the
order of things makes sense read aloud, whether everything works with only a keyboard all the
way through. It catches the mechanical problems, every run.

## 2. What it found, and the fixes

| Found                                                                                                                                                                                                                            | Rule                                                | Fix                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The tour page's photo strip** (19b-2b) scrolls sideways, but a keyboard couldn't reach it                                                                                                                                      | 2.1.1 Keyboard (`scrollable-region-focusable`)      | With more than one photo it's a Tab stop, a region named "Photos, scroll sideways for more"; the arrow keys scroll it; the app's focus ring shows                                                |
| **The widget's date tiles** show "Fri", "27", "14 left" but were named "Fri 27 Nov, 09:00: 14 left"; **checkout's date rows** the same pattern. Someone using voice control says what they see ("click 27"), and nothing matched | 2.5.3 Label in name (`label-content-name-mismatch`) | No more `aria-label`: each button's name is its **own text**, read in order, with the parts not shown (month, time) in visually hidden text between the shown ones: "Fri 27 Nov, 09:00, 14 left" |

Everything else passed in all six looks: contrast, names for every button, link and field,
headings, landmarks, alt text on every photo, the page language, the form errors.

## 3. Found along the way

- **A name trims each part's edges.** My first fix put the space at the START of the hidden
  text (`<span hidden> Nov, 09:00,</span>`): the name came out "Wed 18Nov, …". The spaces sit
  outside the hidden spans now. (In a flex row, spaces between items don't change the layout.)
- **Guessing what axe counts as "visible text" doesn't work** when the parts are separate
  spans: my first attempt (a label starting "Fri 27, 14 left") still failed. Letting the text be
  the name is simpler and certain.
- **My checkout test looked for a heading only desks show** ("Choose a date"); on a phone the
  step says "Step 1 of 4".
- **A test that depended on the date**: the widget's "Book now" journey took the 4th date of
  the month's first tab; at the end of November there were three. Its earlier failure (19b-2b)
  wasn't load after all.
- **Chrome spaces flex items when it builds a name**: "09:00 , 13 left". Keep punctuation inside
  the item it belongs to.
- **A public booking's reply has no `reference`**: my payment-link test then picked up the
  other test's paid booking ("A paid booking can't take payments"). It finds its own by the
  guest's email.

## 4. Checks

- `apps/web/e2e/a11y.spec.js` (3 journeys, 19 pages, 26 axe checks): the website and a tour
  page in 3 styles × light and dark on a phone, and on a desk; checkout's four steps (details
  with its errors); booking confirmed; the paid trip page, change, ask; a payment link; the
  widget's two pages; "not found". **All pass.**
- **The check itself, broken on purpose** (does axe really notice?): the photo strip unreachable
  by keyboard, a date tile's label not matching again, the hero photo without alt text, a
  photo credit too faint to read. **All 4 caught.**
- Unit tests: `dates.test.js` (+1: a date's parts), `photos.test.jsx` (the strip is a Tab stop
  only when it scrolls), and the date names in `embed.test.jsx` and `checkout-screens.test.jsx`.
- **Full runs:** run 1 passed in full (**1,909 tests**). Run 2: the WhatsApp paying tests failed
  again (their fix is on the other session's branch, not merged here) and one guest-messages
  test, which passed alone twice (the same shared-database kind of clash); the paying file
  passed alone (30 of 30 with the templates file).
- **E2E:** the widget's "Book now" journey failed in the full run: it picked the 4th date of
  the month's first tab, and on Thu 26 Nov the tab held three. It picks the last now, and
  passes. (In 19b-2b I'd put its failure down to load: it was this.)
- **Then all 15 browser journeys passed** (the 12 PRD journeys and widget cases, and the 3
  accessibility journeys).
- **Also fixed:** Chrome read the checkout's date names as "09:00 , 13 left" (a space before
  the comma: in a flex row the browser spaces the items). The comma sits in the time's own
  span now.

## 5. Concepts to study

- **WCAG 2.1 AA**, especially 1.4.3 contrast, 2.1.1 keyboard, 2.5.3 label in name, 4.1.2 name,
  role, value.
- **The accessible name**: how a browser computes a button's name from `aria-label`, or its
  text (and how it trims and joins the parts).
- **Visually hidden text**: words for screen readers that take no space on screen.
- **Automated vs manual accessibility testing**: what tools like axe can and can't catch.
