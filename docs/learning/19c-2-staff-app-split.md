# Stage 19c-2: the staff app's script, split

| Part      | What                                                          |
| --------- | ------------------------------------------------------------- |
| 19c-1     | Accessibility checks on every guest page                      |
| **19c-2** | **Polish: the staff app's script, over 500 kB, split in two** |
| 19d, 19e  | README and demo script; deploy (December)                     |

Since 16e-4c, every build warned: _"Some chunks are larger than 500 kB after minification."_

## 1. What was in it

The one script was 552 kB (158 kB compressed: what a phone actually downloads). Measured from
the build's source map: React's DOM part was the largest piece, then the screens. A **guide**
uses sign-in, Today, a departure's manifest, Scan and Sync. The **office's** screens (the
manager's Today, schedule, a departure's page, bookings desk, inbox, dashboard, posters,
settings, More) were most of the rest, loaded by every phone.

## 2. The split

```
before   index.js   552 kB (158 kB compressed)   everything
after    index.js   334 kB (105 kB compressed)   the shell, sign-in, a guide's screens
         office.js  219 kB  (55 kB compressed)   the office's screens, when first opened
         jsQR.js    130 kB  (48 kB compressed)   the QR reader, when Scan opens (since 15)
```

- **`screens/office.js`** re-exports the office's screens; `App.jsx` loads it with
  `React.lazy(() => import('./screens/office.js'))`. One file for all of them: the first office
  screen fetches it once, the others are then already there.
- **A guide's phone starts a third less code** (158 → 105 kB compressed). An office user's
  home screen is in `office.js`, so for them it's one more file at the start: no slower in
  practice.
- **`<Suspense>`** shows "Loading…" while the file arrives (online: a moment; installed: from
  the phone itself).
- **Offline still works.** The build lists every file it makes in `precache.json`
  (`vite.config.js`), `office.js` included, and the service worker (`public/sw.js`) saves them
  all when the app is installed. A manager opening Settings with no signal gets it from the
  phone.
- No warning at build any more.

## 3. Checks

- `apps/operator/test/office-split.test.js` (1): every screen `App.jsx` loads from `office.js`
  is there, and none is imported directly (which would pull it back into the main file).
  Broken on purpose (Settings removed from `office.js`): caught.
- The staff app's 289 tests pass with the screens loading lazily; the built app's own journeys
  (3, 6, 7, 8: the desk, a guide offline, the inbox, posters and the dashboard) pass.
- **Full runs:** the first two each had one failure, the dashboard's "today" test, the same in
  both, not load: at 08:00 on a Friday the seeded business's own trips today were counted with
  the three the test places around noon (2 to come, 2 ended, not 1 and 1). The test now calls
  the seed's other trips today off first, and checks the total is exactly 3. A third full run
  passed in full: **1,910 tests**.
- **E2E:** the accessibility journey failed at 08:00 too: it booked the first date (today's
  09:00 walk), and **on the trip's own day the trip page had no main heading** (the "Today"
  band replaces the heading with the tour's name). The band's line ("Starts at 09:00 · Meet at
  Tinubu Square") is now the page's heading (a test checks it). Then all **15 journeys pass**.
- **Also seen, not fixed here:** axe's "best practice" rules (beyond the WCAG AA the PRD asks
  for) find no `<main>` landmark on the tour page and the widget, some content outside any
  landmark, and no main heading on checkout's phone steps (it's desk-only) or in the widget.
  Left for you to decide on.

## 4. Found along the way

- **Two tests depended on the clock**, both seen at 08:00 on a Friday: the dashboard's "today"
  (the seed's own trips today) and the accessibility journey (a booking for today, and the
  trip day's page). Running checks at odd hours finds these.
- **The staff app's tests run in a pretend browser** (jsdom), where `import.meta.url` isn't a
  file address: the split's test reads files, so it runs in plain Node
  (`// @vitest-environment node`).

## 5. Concepts to study

- **Code splitting**: dynamic `import()`, `React.lazy` and `Suspense`.
- **Bundle analysis**: reading a build's source map to see what takes the space.
- **Service worker precaching**: why split files must be in the precache list for offline use.
- **Compressed vs. raw size**: what the network carries (gzip) vs. what the phone parses.
