# Stage 12g-1: Three website styles (Lagoon, Classic, Earth) × light and dark

From your designs (file 04, "Three styles × light and dark") and PRD MKT-08 / MKT-09. 12g is in
two parts: **this one gives every guest page the operator's style**; 12g-2 builds the
one-page site itself with its business details.

## 1. What we built

| Piece                                                  | Where                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| Classic and Earth as token sets, beside Lagoon         | `packages/shared/src/tokens.js` (`CLASSIC`, `EARTH`, `STYLES`)   |
| All styles in one CSS file                             | `stylesToCss()` → `apps/web/src/styles/tokens.css`               |
| Choosing a style and mode (staff)                      | `GET` / `PATCH /api/website` (`apps/api/src/routes/website.js`)  |
| The style in the HTML (no flash)                       | `lookAttributes()` in `apps/api/src/routes/share-pages.js`       |
| The style once a page knows its operator, and previews | `apps/web/src/lib/look.js`                                       |
| New and changed fields                                 | `operators.website_mode`; `website_style` now defaults to Lagoon |

## 2. How it works

### One set of names, three sets of values

```
tokens.css
  :root { --color-primary: #9BD10F; --radius-button: 12px; … }          Lagoon (the default)
  :root[data-style='classic'] { --color-primary: #0F4C5C; --radius-button: 4px;
                                --font-family-heading: Georgia, …; … }
  :root[data-style='earth']   { --color-primary: #A3431C; --radius-button: 999px; … }
  (each with its dark values: following the phone, and forced with data-mode="dark")
```

The screens didn't change: they already said `var(--color-primary)`, never a colour. That's
the 12a decision paying off. A style is just other values for the same names.

**Every style passes the same contrast tests** as Lagoon, light and dark: 162 checks
(27 pairs × 3 styles × 2 modes). A test also checks every style has exactly Lagoon's names, so
a style can't forget one.

**Three new tokens**, because Lagoon used its bright green in two places where Classic's dark
teal would vanish (on the dark band, and in the letter mark): `band-accent`, `mark-bg` and
`mark-text`. Plus `radius-button`: Earth's buttons are pills while its fields stay rounded.
Lagoon's values are unchanged.

### Who sets the style

```
catalogue, tour page, checkout   the SERVER writes <html data-style="earth" data-mode="dark">
                                 → the right style from the first paint
trip pages, payment links        private: the HTML knows nothing → the app sets it from the
                                 booking's data (useLook), also from the saved offline copy
```

`lookAttributes()` only lets the known words through (`lagoon · classic · earth`,
`light · dark`), so nothing typed anywhere can reach the HTML that way.

### Previews (MKT-09: "preview any style with real content")

Add `?style=earth&mode=dark` to any guest address. It lasts for the visit (sessionStorage), so
you can click through to a tour and checkout in that style. Only your browser sees it.
`?preview=off` ends it. This is also how the operator app's style picker (designed later) can
show live previews: the real pages, in an iframe, with `?style=`.

### Choosing (staff)

`PATCH /api/website { style, mode }` needs **marketing: edit**: by the preset roles that's the
**owner** (the manager can view it, guides can't). Only the look changes: content, tour links
and booking links stay the same, so links already shared keep working.

## 3. Found along the way

- **The old default was "classic"** although nobody had chosen it. Lagoon is the designs'
  default, so the migration moves every "classic" to "lagoon". Classic stays available to pick.
- **The screenshot pane can lag** behind the page. Reading the page's state (`data-style`,
  the text) was the reliable check.
- **A test assumed managers own the website.** The presets say owners do: the test was wrong,
  not the code.

## 4. Why we chose what we chose

| Choice                                 | Alternative                     | Why                                                        |
| -------------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| One CSS file with every style          | load the style's CSS on demand  | 2.5 KB more first load in all, no second request, no flash |
| Server writes the attributes           | the app sets them after loading | the first paint is already right on slow phones            |
| New tokens for band accent and mark    | reuse primary everywhere        | Classic's dark teal fails contrast on the dark band        |
| `radius-button` apart from `radius-md` | pill inputs too                 | a pill-shaped text box looks broken                        |
| Preview in the address                 | a staff-only preview screen     | the picker (later) can reuse the real pages                |

## 5. Concepts to study

- **CSS custom properties** and the **cascade**: specificity (`:root` vs
  `:root[data-style]`) and order decide which value wins
- **`prefers-color-scheme`** vs a forced mode
- **Flash of unstyled content** and why the server sets the attributes
- **Design tokens** across themes

## 6. Try it yourself

```text
http://localhost:5173/irin-lagos-tours?style=classic
http://localhost:5173/irin-lagos-tours/lagos-island-heritage-walk?style=earth&mode=dark
http://localhost:5173/irin-lagos-tours?preview=off
```

To change Ìrìn's real style: as the owner, `PATCH /api/website` with `{"style": "earth"}`.

## 7. Differences from the designs

- **Filled in by Claude** (the design shows the main colours only): Classic's and Earth's
  status colours (kept from Lagoon), disabled greys, the dark band's secondary shades, and
  `primary-soft`. All meet the contrast targets. Please review them in the token sheet.
- **The brand-colour override** (a bonus in the brief) isn't built.
- **Tour titles on cards** use the body font in Classic; only page headings use Georgia.

## 8. What's next

**Stage 12g-2:** the one-page site at `/irin-lagos-tours`: hero with a tagline, tours, about,
"Why book with us", questions, contact and footer, from new business details (with a staff
API), and the empty and missing-content states.
