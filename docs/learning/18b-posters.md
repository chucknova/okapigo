# Stage 18b: posters

| Part    | What                                                                 |
| ------- | -------------------------------------------------------------------- |
| 18a     | The AI companion: its server (18a-1), its card and journey 7 (18a-2) |
| **18b** | **Posters: pick a tour and a template, download a PNG (P1–P2)**      |
| 18c     | The dashboard, journey 8                                             |

MKT-01: _"Three or four templates for new tours, offers and 'seats left'."_ MKT-02: _"Product
photo, price, date and a booking QR code inserted automatically; download as PNG."_ Built from
the canvas's P1–P2 and its four templates.

## 1. One picture, drawn on the server

```
 staff app (Posters)                       API
 ───────────────────                       ───────────────────────────────────────────
 choose tour, template, words, size  ──►   GET /api/posters/png?…
 the preview IS the PNG              ◄──   satori → SVG → resvg → PNG   (lib/poster.js)
 Download saves that same picture
```

The link-preview cards (12h) and the WhatsApp ticket (13c) already draw pictures on the server:
**satori** lays out boxes like a browser (flexbox, real font measurements), **resvg** turns them
into a PNG, and the fonts are files we ship (Inter, with ₦ and the Yoruba letters). Posters use
the same, so:

- **What you see is what you download:** the preview is the real PNG, never a look-alike.
- **Prices, seats and dates are read when it's drawn,** so a poster never shows an old price.
- **The phone draws nothing:** no heavy drawing code in the staff app.

**The four templates** (`apps/api/src/lib/poster.js`), each square (1080 × 1080) or story
(1080 × 1920):

| Template         | Fills in                                                                               | Panel (where a photo will go)                  |
| ---------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **New tour**     | the name, its story (cut at a word), "From ₦25,000", per adult · 3 hours · Daily 09:00 | **THE ROUTE**: up to five stops (or "MEET AT") |
| **Offer**        | the owner's words, big; a white card with the REAL price (and children's)              | a ring with the business's letter              |
| **Seats left**   | "4 seats left" (1 → "seat"), the day ("THIS SATURDAY"), the departure                  | waves under a sun                              |
| **This weekend** | the weekend's departures with seats; "3 left" on nearly full ones                      | (none: the list is the poster)                 |

Every one has the business's name and letter mark, and a **QR code**, black on white whatever
the colours (scanners need the contrast). It opens the tour's booking page, or the business's
website for This weekend.

**There's no discount engine:** an Offer poster shows the owner's words and the real price;
it changes nothing anyone pays.

**Long names** shrink (sizes step down with length) and, past 48 characters, the poster uses
the tour's short name. A square This weekend has room for four rows, a story for eight.

**Kept for a minute.** A drawing takes a second or two, so the same picture (same template,
tour, words, size, seats) is kept for 60 seconds: preview → Download doesn't draw twice, and
seats are never more than a minute old.

## 2. The rules, shared (`packages/shared/src/posters.js`)

| Rule                                               | Example                                              |
| -------------------------------------------------- | ---------------------------------------------------- |
| Seats left needs a departure with seats in 14 days | else greyed: "No departures in the next 14 days"     |
| This weekend needs something on this weekend       | else greyed: "Nothing on this weekend"               |
| The coming weekend                                 | Mon → Sat + Sun; Sat → today + tomorrow; Sun → today |
| The day's tag                                      | TODAY · TOMORROW · THIS SATURDAY · MON 30 NOV        |
| The file                                           | `lagos-island-heritage-walk-new-tour.png`, `-story`  |
| The headline                                       | up to 30 characters                                  |

## 3. The screen (P1–P2)

Posters is in **More** on a phone and in the **side menu** on the desk, for anyone with
_marketing_ access (the owner edits it, managers view it; making a poster changes nothing, so
viewing is enough). Guides don't see it.

1. **Tour:** each with "From ₦25,000 · 3 h · Daily 09:00".
2. **Template:** greyed with the reason when it can't be used.
3. **Headline:** the template's own words, editable (Seats left: which departure too).
4. **Size:** Square · Story.

The preview is fetched with the staff member's sign-in (a plain `<img>` can't send it), a
moment after the last change. **Download PNG · 1080 × 1080** saves it, then: "Saved:
heritage-walk-new-tour.png (1080 × 1080). Post it, or send it on WhatsApp."

States: no tours yet ("Nothing to make a poster of yet", Add a tour); drawing; a failed
drawing in words ("Couldn't make the PNG (no connection)…", or the server's reason: "That
departure is full."); a long name.

## 4. Found along the way

- **Satori adds padding outside a box's size.** The first drawings were all cut off at the
  bottom, even the tall stories with plenty of space: a poster of `height: 100%` plus 72 px of
  padding is 144 px too tall. `boxSizing: 'border-box'` puts the padding inside. Seen only by
  drawing every template and looking at them together.
- **"thu–Sat 18:30".** Lower-casing the schedule's first letter for a sentence broke day names;
  the check with real tours showed it. The line now reads as the tour pages say it.

## 5. Checks

- `packages/shared/test/posters.test.js` (7): templates and sizes; when one can't be used; the
  weekend from each day; the day's tag; the weekend's day; long names; file names.
- `apps/api/test/poster-render.test.js` (7): what each template says (five stops at most, "MEET
  AT" without stops, the real price with children's, "seat" for one, four rows on a square and
  seven on a story, "left" on nearly full ones); fitting and cutting text; real PNGs of both
  sizes.
- `apps/api/test/posters.test.js` (9): the choices; a full departure not offered; guides refused;
  each template's PNG (size, file name, never cached); words too long; Seats left's departure
  checks; nothing on this weekend; another business's or an unpublished tour.
- `apps/operator/test/posters.test.jsx` (11): the choices' rules, the address and file, fetching
  (offline, no answer, a refusal, a server error); the screen (P1, Seats left, Story, a failed
  drawing, no tours, More with and without marketing).
- **Mutation checks:** 34 changes; 2 survived at first and got tests (This weekend with nothing on;
  a server error's own words never shown).
- **Full runs:** run 1 had one timeout, the drawing test (two full-size drawings at load 10), which
  passed alone and in its package; it now has 60 s. Run 2 passed: 1,758 tests.
- **E2E:** all 11 journeys pass (posters join journey 8 in 18c).
- **Check with real data** (my API on :4300, the e2e database, a throwaway business, the
  manager's sign-in):
  - the five seeded tours listed with their lines; the weekend counted 7 departures
  - drawn and looked at: Seats left (Tarkwa Bay, Sat 28 Nov 10:00, "12 seats left"), This
    weekend, an Offer ("Friday night eats", Street Food Crawl), New tour as a story (Lekki)
  - the same poster again: 0.04 s (kept)
  - the business was deleted afterwards
  - the screen itself is checked by its tests, not in a browser this time

## 6. Concepts to study

- **Server-side rendering of images**: layout engines (satori) vs drawing by hand.
- **The box model**: content-box vs border-box, and why a renderer's default matters.
- **Short-lived caches**: what to key on, and how long is "fresh enough".
