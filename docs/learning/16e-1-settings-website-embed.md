# Stage 16e-1: Settings: the menu, Website and Embed

Settings (O10), in four parts (decided 2026-11-21):

| Part      | What                                                                                    |
| --------- | --------------------------------------------------------------------------------------- |
| **16e-1** | **the settings menu, the save bar and form errors, Website, Embed on your site**        |
| 16e-2     | Messages (the editor, details to insert, preview, a test) and WhatsApp                  |
| 16e-3     | Staff and roles (invite, edit, remove); invitations emailed, words to copy for phones   |
| 16e-4     | Tours (basics, prices, schedule, extras, pickups, policy, deposit, transport, new tour) |

## 1. What we built

| Piece                                                         | Where                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| The rules: the details form, its errors, the snippet, colours | `apps/operator/src/lib/settings.js`                      |
| The save bar, and "Leave without saving?"                     | `apps/operator/src/components/SaveBar.jsx`               |
| The screen                                                    | `apps/operator/src/screens/Settings.jsx`                 |
| The live site's and the snippet's addresses                   | `GET /api/website` → `slug`, `siteUrl`, `embedScriptUrl` |
| OkapiGo's own pages may frame the widget (the preview)        | `frameAncestors()`: `'self'` first                       |

The server already had the rest: `GET`/`PATCH /api/website` (style, mode, the business details,
the approved websites: 12g, 12h).

## 2. The menu

Wide screen: the six sections down the left, the open one on the right. Phone: More ›
Settings lists them; tap one, "‹ Settings" to go back. Messages, WhatsApp, Staff and Tours say
"Coming next" until their part.

## 3. Website

- **Style**: Lagoon, Classic or Earth, light, dark or following the phone. Each card previews
  the look with **the website's own tokens** (the same colours the site uses), and nothing
  changes until **Apply Classic dark**. "LIVE NOW" marks the one guests see.
- **Business details**: tagline (with a count: "34 of 80 characters · the hero title"),
  WhatsApp number, about, phone, email, address, Instagram (a handle or a link). Logo and hero
  photo: "uploads come later" (as designed).

## 4. Forms that look after you (the pattern for every settings page)

- **Checked as you type**, in plain words: "Too long: 86 of 80 characters. It's the big title on
  your site." · "This email is missing its ending, like .com." Above them, "2 things to fix
  before saving", and Save waits.
- **The save bar** stays at the bottom while something's unsaved: "Unsaved changes: Tagline,
  Email" · Discard · Save changes.
- **Leaving with unsaved changes** asks first ("Save and leave", "Leave without saving", "Stay
  here"): for any link in the app, and the browser's own question for closing the tab.
- **Saved · 23:45.**, or "Didn't save: no connection. Your changes are still here." with Try
  again.
- Only what changed is sent; an emptied field clears it on the site.

The tagline's limit is **80** (the server's), not the design's 60: the stored site is read back
through the same rules, so lowering it would silently drop any existing tagline of 61–80
characters.

## 5. Embed on your site

1. **What to show**: one tour (on sale) or all.
2. **How**: an inline calendar, or a pop-up button with its words and colour; the text colour is
   picked to stay readable, by the same rule `embed.js` uses.
3. **Approved websites**: add, remove; with none, "Add your website first, or the widget won't
   show."

A **live preview** frames the real widget, which needed one change: the widget may now be
framed by OkapiGo's own pages as well as the approved websites (`frame-ancestors 'self' …`).
Any other website still can't show it. Then **the snippet**, with Copy.

## 6. Who can change it

Website and Embed need marketing: edit: the owner. A manager sees them with "Only the owner can
change this. You can look." and the controls switched off.

## 7. Tests

- `apps/operator/test/settings.test.jsx` (15): the details form, its errors and what's sent; the
  style previews; the snippet (made safe); readable text; the style applied; errors, the save
  bar, saved; leaving asks; no connection; a manager looks only; Embed (the snippet, a website
  added, copied; none approved).
- `apps/api/test/website.test.js`: the new addresses. `embed.test.js`, `website-schema.test.js`:
  the frame rule with `'self'`.
- Mutation checks: 13 changes; 1 survived at first (the tagline's exact limit) and got a test.
