# Stage 16a: The manager's shell and Today

Session 16 builds the office's side of the operator app from your designs, in five stages
(decided 2026-11-20, in the brief):

| Stage   | What                                                                               |
| ------- | ---------------------------------------------------------------------------------- |
| **16a** | **the manager's shell, the staff screen states, the manager's Today**              |
| 16b     | Schedule (O6) and a departure (O7): assigning guides and vans, cancelling          |
| 16c     | the bookings desk (O8): statuses, actions, refunds, links, confirming guides' cash |
| 16d     | the inbox (O9): chats, requests, alerts                                            |
| 16e     | settings (O10): website, embed, messages, WhatsApp, staff, tours                   |

## 1. What we built

| Piece                                                                   | Where                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| Which screens by role                                                   | `apps/operator/src/lib/roles.js`                             |
| Tabs on a phone, the menu down the side on a wide screen                | `src/components/TabBar.jsx` (`SideNav`)                      |
| Live data and the staff states (loading, offline, stale, error, denied) | `src/lib/live.js`, `src/components/LiveFrame.jsx`            |
| The manager's Today                                                     | `src/screens/ManagerToday.jsx`                               |
| More (the fifth tab)                                                    | `src/screens/More.jsx`                                       |
| Worked out on the server                                                | `packages/db/src/today.js`, `GET /api/today`                 |
| Each phone's last sync and its waiting changes                          | `users.last_synced_at`, `outbox_waiting`; `X-Outbox-Waiting` |
| The owner's name (to ask for access)                                    | `GET /api/me` → `owner`                                      |

## 2. One app, by role

Brief 07 decided one app for everyone: "what you see depends on your role; the guide just
sees less".

| Who                            | Phone tabs                                 | Wide screen (≥ 1024 px)     |
| ------------------------------ | ------------------------------------------ | --------------------------- |
| the office (can edit bookings) | Today · Schedule · Bookings · Inbox · More | the dark menu down the side |
| a guide                        | Today · Scan · Sync                        | the same, as a menu         |

The role comes from `/api/me`'s permissions, saved on the phone so it holds offline (before
the first sync after signing in, from the role in the sign-in answer). A guide opening an
office link gets **"This page is for managers. You’re signed in as Femi (guide). Ask Bisola if
you need access."**; the server refuses too (403), so it isn't just hidden.

## 3. The manager's Today

**Needs you**, most urgent first (red, then amber, then blue):

| What                                          | Example                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| a departure soon (36 h) with guests, no guide | IN 2 H 20 · Tarkwa Bay has no guide · 10:00 · 8 booked · **Amaka is free** · Assign |
| chats waiting for a person                    | WAITING 3 MIN · 1 chat needs a person · Yemi Ojo: “Is the lunch halal?” · Reply     |
| a refund that failed, or needs a look         | REFUND · Refund failed: ₦62,500 · Adaeze Okafor · card expired                      |
| a deposit's balance due today, or overdue     | DUE TODAY · Balance ₦45,500 due · Yemi Ojo · Badagry Sat 12 Dec · Send link         |
| cash with a guide (15c-4)                     | CASH · ₦45,500 cash with Femi · Confirm when it’s handed in (or PAID TWICE?, red)   |

"Is free": the first guide by name with nothing overlapping that departure's time.

**Departures today**: the ones that run (guests booked, or a guide on it: every tour has a
departure every scheduled day, and an empty one isn't the manager's concern). Time, tour,
guide and van ("on foot" without one), "11 of 12 checked in" (or "3 of 9 picked up"), and
where it's at: Under way · synced 07:31, Picking up · Ikoyi next, Starts in 1 h 20, This
evening, Needs a guide.

**Guides’ phones** (wide screens; on a phone, the line under each departure): each phone now
says, every time it syncs, how many changes are still waiting (`X-Outbox-Waiting`); the
server keeps when and how many. Synced in the last 15 minutes: green; over an hour ago:
**flagged** ("Not seen since Fri 21:10").

## 4. Live data, and the staff states

The guide's screens work from the saved package. The office's don't: **"Bookings need a
connection, so you never act on old information."** `useLive(path)` reads fresh, refreshes
every minute and when the signal returns, and one fetch per path is shared (the menu's badges
and Today read the same `/api/today`). Each screen is in one state:

| State   | Shows                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| loading | skeletons; after 10 s "Still loading… slow connection" · Try again                                                                                     |
| offline | "You’re offline" (nothing loaded yet)                                                                                                                  |
| stale   | loaded before, now offline: still shown, greyed, can't be touched (`inert`), "Offline · shown as of 11:02"                                             |
| error   | "Today didn’t load" · Try again · "quote **5F2A-07:41**": the start of the server's request id (`X-Request-Id`) and the time, so its logs can be found |
| denied  | "This page is for managers"                                                                                                                            |

## 5. Checked

Chrome with the real API and your dev data, signed in as Tunde (manager), at desktop and phone
size: the dark menu, two departures tomorrow needing a guide ("Chinedu is free"), Kemi's two
departures today ("Under way", "This evening"), Kemi's phone "Not seen yet". A layout bug
fixed along the way: base styles placed after the wide-screen ones overrode them.

## 6. Checks

Both full runs all green, and all 9 browser journeys, **with your `pnpm dev` running**: the
first time in a while (the tests' own database at work). 13 tests new in the app, 4 on the
server. 13 mutation checks; three survived at first (the free guide, urgent first, a balance
not yet due) and got their tests.

## 7. Concepts to study

- **Role-based access**: hiding a screen vs refusing it (both, here)
- **Responsive layout**: one page, two arrangements (`@media (min-width: …)`), and the
  cascade (a later rule of equal weight wins)
- **Stale-while-offline**: showing old data honestly
