# Stage 15c-1: The operator app: shell, sign-in, the saved package and the outbox

The first screens of the operator app, from your designs (tokens v1 and the app shell; O1,
O2, O5, First run, Sync edge cases). What the guide does here works with no signal.

| Stage     | What                                                                             |
| --------- | -------------------------------------------------------------------------------- |
| **15c-1** | **the app (PWA at /app/), sign-in, first run, strip, tabs, saved package, Sync** |
| 15c-2     | Today in full, and the manifest (O3): search, traveller states, names, no-show   |
| 15c-3     | Scan (O4) and its problem states                                                 |
| 15c-4     | money on the day (QR, cash), pickup stops, the A4 printed manifest               |
| 15d       | journey 6 end to end with the network off                                        |

Your decisions with the designs are in the brief (`docs/flows/07-operator-app.md`, last
section): both money features, pickup times now, and this four-way split.

## 1. What we built

| Piece                                                         | Where                                    |
| ------------------------------------------------------------- | ---------------------------------------- |
| A new app, served by the API at `/app/`                       | `apps/operator/`, `apps/api/src/app.js`  |
| Your tokens v1 (17 px body, 56 px main action, 48 px minimum) | `packages/shared/src/operator-tokens.js` |
| Opening with no signal (service worker)                       | `apps/operator/public/sw.js`             |
| What the phone keeps (IndexedDB)                              | `src/lib/store.js`                       |
| The outbox, and the package shown with it on top              | `src/lib/outbox.js`                      |
| Keeping phone and server in step                              | `src/lib/sync.js`                        |
| The strip's words                                             | `src/lib/status.js`                      |
| Sign-in's rules                                               | `src/lib/sign-in.js`                     |
| Today's card facts                                            | `src/lib/today.js`                       |
| Screens: sign-in, first run, Today, Sync                      | `src/screens/`                           |
| Conflicts in O5's parts (title / you did / they had / so now) | `packages/db/src/sync.js` → `explain`    |

Run it: `pnpm --filter @okapigo/operator dev` → http://localhost:5175/app/ (the API on :4000
answers its requests). In production the API serves the build at `/app/`.

## 2. Two kinds of "offline"

The app is made of two things, and each is kept differently:

```
the APP itself (HTML, JavaScript, CSS, icons)   → the service worker's cache
  "the app opens with no signal at all"            saved when it installs (precache.json,
                                                   written by the build), updated next visit
the DATA (departures, changes, conflicts)       → IndexedDB, by the app itself
  "the manifest works, check-ins wait"             it decides what's stale (72 hours)
```

**A service worker** is a script the browser keeps between visits, sitting between the page
and the network. Ours answers the app's own files from its cache when the network fails,
and leaves the API alone: the data is the app's job, so it can say "saved 06:40" honestly.

**IndexedDB** is the browser's database. Unlike localStorage it holds megabytes and can be
asked to stay (`navigator.storage.persist()`); a write counts only once its transaction
**commits** (that's when it's really on disk), so a check-in survives the phone dying.

## 3. The outbox and the sync engine

A tap that changes something is **saved first, sent later**:

```
tap "Present"  → change { id, at, kind, …, seen } into the outbox (IndexedDB)
               → the screens show the package WITH the outbox on top ("Not sent yet")
               → sync(): send oldest first, in batches of 100 → each answered change leaves
                 → fetch conflicts → fetch the package (304 if unchanged)
```

- **Signal drops halfway**: the answers that arrived are kept; the rest go next time.
  Sending twice is safe (15b: each change carries its own id).
- **One run at a time**: a change made during a run makes it go round once more.
- **Why the attempt failed** is remembered, because the strip says something different for
  each: offline, "Can't reach OkapiGo" (hotel Wi-Fi asking for its login page, or no answer),
  "OkapiGo is having trouble" (our server), or the 30-day sign-in having run out. The last one
  never loses anything: changes wait, and after signing in again they go out as that person.
- **Everything outside is passed in** (the request function, the store, the clock, "am I
  online?", timers), so the tests drive it against a fake server that can drop the line.

## 4. Conflicts, as O5 shows them

15b's sentence became the four parts of your design, decided on the server (it knows what it
had):

```
Adaeze Okafor wasn’t checked in                                    title
YOU DID          Marked Adaeze Okafor present at 09:50 (offline).
THE OFFICE HAD   Cancelled the booking at 09:40.
SO NOW           Nothing changed. The booking stays cancelled. If they’re with you, call the office.
                 [ OK ]  [ Call the office ]
```

**Use mine** appears only when someone else's check-in won: it sends my change again,
now "seeing" theirs, so it goes in after it. The office phone ("Call the office") is now in
the offline package.

## 5. Sign-in (O1)

The server allows 5 guesses per code and only ever says "wrong or expired" (so strangers
learn nothing). "You have 2 tries left" is counted **on the phone**, per code: true for the
person, without the server revealing anything. The 10-minute wait after the 5th wrong try is
the app's own; the server's limits (a code every 30 s, 5 an hour) still apply beneath.

## 6. Where I followed the designs loosely (for your review)

- **Pronouns.** The designs say "Ask her to pay", "Hers stands". The app doesn't know a guest's
  pronouns, so its words are neutral ("Theirs stands"). (Money on the day is 15c-4.)
- **"Getting your trips ready"** lists two rows (departures, ticket codes), not one per
  departure: the package arrives in one request, so there's no per-trip progress to show.
- **"Install the app"** shows only where the browser offers it (Android Chrome). Elsewhere, the
  screen says how to install from the browser's menu (and the iPhone's Share steps).
- **"Open the Wi-Fi login page"** opens `http://neverssl.com`, a site that exists to make such
  login pages appear (they can't appear over https).
- **Scan and the manifest** are placeholders for 15c-3 and 15c-2.

## 7. Checked in a real browser

- Sign-in as Kemi (a seeded guide) on a phone-sized screen: wrong code → "You have 4 tries
  left", then the right one → First run → "You're ready for no signal" → Today.
- In Chrome with the network cut: the app opened from the service worker's cache; signed in,
  it showed Today and both departures from IndexedDB, "Offline · saved 20:56".
- The in-app browser pane can't run service workers ("unknown error fetching the script");
  that check used Chrome through Playwright instead.
- To have something to show, I assigned Kemi two of Ìrìn's departures tomorrow (Fri 20 Nov) in
  your dev database. It has **no vans** yet (it was seeded before 15a); `pnpm db:reset` adds them.

Found along the way: the code boxes kept a wrong digit when typed over (now each box selects
its digit on focus), and the sign-in form was double-indented.

## 8. Checks

1,198 tests, both full runs all passing (36 new in the app, 4 for serving it); all 8 browser
journeys pass. 18 mutation checks (answered-only leaving the outbox, saved-before-sent, the
304 refresh, signed-out waiting, the 72-hour line, the 5th try locking, the Wi-Fi login page,
"Use mine" and its `seen`, the office phone, the never-cached service worker…), all caught.

## 9. Concepts to study

- **Progressive web apps**: the manifest, installing, service worker lifecycle (install →
  activate → fetch), cache-first vs network-first
- **IndexedDB** and transactions; **storage persistence** and eviction
- **Optimistic UI**: showing a change before the server confirms it, and undoing on conflict
- **Captive portals** (hotel Wi-Fi), and why they can't intercept https
