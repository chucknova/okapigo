# Stage 12g-2: The operator's one-page website

From your designs (file 04, "Operator site · phone" and "· desktop", and the empty and
missing-content states) and PRD MKT-08. It replaces stage 12b's catalogue at the same address,
`/irin-lagos-tours`, so every link already shared still works, now as the full site.

## 1. What we built

| Piece                           | Where                                                               |
| ------------------------------- | ------------------------------------------------------------------- |
| The site (phone and desktop)    | `apps/web/src/screens/Catalogue.jsx`, `styles/site.css`             |
| The business details, checked   | `SiteSchema` in `packages/shared/src/schemas/website.js`            |
| Where they're kept              | `operators.site` (one JSON value), plus `phone`, `whatsapp` (12f-1) |
| Reading and saving them (staff) | `GET` / `PATCH /api/website` (`apps/api/src/routes/website.js`)     |
| What the public page gets       | `publicSite()` in `apps/api/src/lib/public-views.js`                |
| Ìrìn's words, from the design   | `IRIN_SITE` in `packages/db/src/seed/demo-operator.js`              |

## 2. How it works

### The page, top to bottom

```
header      Ì  Ìrìn Lagos Tours                  [Book]     (desktop: Tours · About · Contact · Book a tour)
hero        City and food tours · Lagos                         kind · city
            Walk Lagos with people who love it                  tagline
            Small groups, local guides, …                       intro
            [See tours and dates]
Our tours   3 h · walking · daily 09:00 / title / summary / from ₦25,000 / [Book · Wed 18 Nov]
About Ìrìn  ·  Why book with us (1, 2, 3)                       side by side on desktop
Questions   expandable answers
Get in touch  phone · email · address · socials      [Chat on WhatsApp]
footer      © Ìrìn Lagos Tours · Bookings by OkapiGo
```

All of it is drawn from tokens, so it takes the operator's style (12g-1): the hero is the dark
band, and its ring and dot are the style's accent (green, pale teal, or sand).

### Missing content: the page always looks finished

| Missing         | The page                                                                               |
| --------------- | -------------------------------------------------------------------------------------- |
| tagline         | the business name is the title, "Tours in Lagos" above it                              |
| about           | About hides (and leaves the menu); "Why book with us" moves up                         |
| the 3 points    | "Why book with us" hides                                                               |
| questions       | Questions hides                                                                        |
| WhatsApp        | Get in touch shows phone and email; nothing at all → it hides                          |
| published tours | "New tours coming soon · Message us on WhatsApp to hear first"; nothing offers to book |

A test covers each row, and also data from before this stage (no site at all).

### The business details

One JSON value, like a tour's content: the site reads it whole and nobody searches by
tagline. **`SiteSchema` guards it**, because operators type it and the public reads it:

- a length limit on every field (tagline 80, about 1500…), 3 points, 12 questions
- emails checked; social links **https only**, from a fixed list of networks
- an empty string means "not given"

`PATCH /api/website { site: { tagline: … } }` **merges** over what's stored (send `null` to
clear a field), so a form can save one section at a time. It takes a row lock, so two people
saving different sections at the same moment don't undo each other. Unknown fields are refused,
which catches typos like `colour`. It needs **marketing: edit** (the owner).

## 3. Found along the way

- **"saturdays 07:00", "thu–Sat":** I lower-cased the first letter of every schedule to match
  the design's "daily 09:00". Only words like daily and weekends should be; day names keep
  their capitals.
- **The hero's bright dot sat behind the title** on narrow phones (light text on bright green).
  On phones it now sits in the corner.
- **The tests timed out under load again** (Figma, iCloud): a 5-second pricing test took 5.6 s
  in one run but 0.1 s alone. The last full run passed: 946 tests. Earlier runs each had one
  time-out in old, unrelated tests.

## 4. Why we chose what we chose

| Choice                          | Alternative                | Why                                                   |
| ------------------------------- | -------------------------- | ----------------------------------------------------- |
| The site replaces the catalogue | a new address for the site | shared links keep working; one home page per operator |
| One JSON value for the details  | a column per field         | read whole, grows without migrations; Zod checks it   |
| Merge on save, `null` clears    | replace everything         | a form per section can't wipe the others              |
| Hide what's missing             | placeholder text           | your design: "the page still looks finished"          |
| No social links in the seed     | made-up handles            | an invented handle could be a real person's account   |

## 5. Concepts to study

- **Progressive disclosure**: `<details>` / `<summary>` for questions, no JavaScript
- **In-page anchors** (`#tours`) as navigation on a one-page site
- **Validation at the edge** with Zod, and `rel="noopener noreferrer"` on outside links
- **Partial updates** (merge-patch) and lost updates (the row lock)

## 6. Try it yourself

```text
http://localhost:5173/irin-lagos-tours
http://localhost:5173/irin-lagos-tours?style=earth            (any style, 12g-1)
http://localhost:5173/irin-lagos-tours?preview=off
```

To change Ìrìn's words, as the owner: `PATCH /api/website` with, say,
`{"site": {"tagline": "Lagos, at walking pace"}}`. Your dev database already has the
design's words; `pnpm db:reset` seeds them too.

## 7. Differences from the designs

- **Footer links** (Booking terms, Cancellation policy, Privacy) aren't there yet: those pages
  don't exist. They need the operator's own terms, a later step.
- **No tagline:** "Tours in Lagos" sits above the name, in the eyebrow's place; the design
  puts it under. Say if you'd like it moved.
- **No social links** for Ìrìn (see above); the site shows them when an operator adds some.
- **The letter mark** stays the style's mark (dark square in Lagoon); the phone design shows
  a green square.
- **Tour titles on cards are now headings**, so in Classic they're in Georgia too (12g-1's note
  said only page headings were).

## 8. What's next

**Stage 12h: the booking widget** (file 03): the embed script (inline and pop-up), the frame
that resizes itself, approved domains, the booking-completed event, UTM capture, and its states.
