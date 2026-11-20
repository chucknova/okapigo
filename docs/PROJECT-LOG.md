# OkapiGo: project log

**The one place to catch up on this project.** Read it first in any new session (or after the
conversation's context is compressed); it says how we work, what's built, what was decided, and
what's next.

**Keep it current:** after every stage (before its commit), add the stage to §5, any decision to
§6, update §7 "Where we are", and add anything new to §8 "Known traps". One line each is enough;
the details live in that stage's learning note (`docs/learning/`).

_Last updated: 2026-11-20, after stage 16a._

---

## 1. What this is

OkapiGo: a booking, payments and operations platform for **Nigerian tour operators**, built as a
portfolio MVP from the PRD (`~/Downloads/OkapiGo MVP — Product Requirements Document (3).md`; 37
requirements). The demo business is **Ìrìn Lagos Tours** (fictional; slug `irin-lagos-tours`).
The original plan: `~/.claude/plans/users-machine-downloads-okapigo-mvp-pro-synthetic-ember.md`
(its roadmap numbering has since changed: see §5).

Repository: `github.com/chucknova/okapigo` (the user pushes; I commit).

## 2. How we work (the user's rules: always)

**Each stage:**

1. Restate the goal; small steps.
2. Learner-friendly comments: a header per file (what and why); "why" comments on anything
   non-obvious.
3. Tests alongside the code; **mutation checks**: break each rule on purpose and confirm a test
   fails; every survivor gets a test.
4. Lint, Prettier, **two full test runs**, the **browser journeys** (`pnpm --filter
@okapigo/web e2e`).
5. A **learning note** `docs/learning/<stage>-<topic>.md`: what we built, how and why, found along
   the way, checks (honestly, failures included), concepts to study.
6. **Commit** (message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
7. Wrap up asking **"Push, then start <next>?"**. The user pushes; never push myself.

**UI rule:** flows first (a brief in `docs/flows/`), **the user designs the screens**, I build
**their** designs. **Logic stays out of components** (in `packages/shared`, the API, or `lib/`
modules); styles only from **tokens**.

**Hard constraints:**

- **Paystack TEST keys only**, in `.env` (git-ignored); the app refuses `sk_live_`/`pk_live_`.
  **Never print or paste key values** in chat. WhatsApp/Resend tokens likewise only in `.env`.
- **Never run `prisma migrate reset`** (blocked for AI); the user runs `pnpm db:reset` themselves.
  New migrations: write the SQL by hand, `prisma migrate deploy`, then check `migrate diff` is empty.
- **Fictional data only.** The user's email is private: never send it to external services.
- Published test card numbers only on local dev hosts.
- **Don't kill the user's own `pnpm dev`** (API :4000, worker). For browser checks I run my own
  API on **:4300** (`API_PORT=4300 … node src/server.js`, `JOBS_PREFIX=okg-check`) and stop it after.
- Neutral pronouns in app wording ("they"): the app doesn't know a guest's pronouns.
- Ask before deleting anything in the dev database.

## 3. Stack and layout

Node 24 (ES modules, JSDoc `// @ts-check`), **Express 5**, **Zod 4**, **Prisma 7.10** (pg adapter),
**PostgreSQL 17** + **Redis** in Docker, **BullMQ** workers, **React 19 + Vite 8**, **wouter**,
**Vitest**, **Playwright** (local Chrome), **pnpm 11 + Turborepo**. Mailpit locally
(`127.0.0.1:8025`).

| Folder                | What                                                                     |
| --------------------- | ------------------------------------------------------------------------ |
| `apps/api`            | the API (Express); serves the built web apps too                         |
| `apps/workers`        | BullMQ jobs: hold expiry, schedules, webhooks, reconciliation, reminders |
| `apps/web`            | the guest web (catalogue, checkout, trip hub, website, widget) + e2e     |
| `apps/simulators`     | the WhatsApp chat simulator, served at `/simulator/whatsapp/`            |
| `apps/operator`       | the operator app (PWA) at `/app/`: guides offline, the office online     |
| `packages/db`         | Prisma schema, migrations, seed, domain logic (`src/*.js`)               |
| `packages/shared`     | rules shared by server and browsers: money, time, pricing, tokens…       |
| `packages/payments`   | Paystack adapter + simulator                                             |
| `packages/jobs`       | queue names and the job client                                           |
| `docs/flows`          | flow briefs (the user designs from these)                                |
| `docs/designs`        | the user's guest-web designs (v1)                                        |
| `docs/learning`       | one learning note per stage                                              |
| `docs/parking-lot.md` | ideas outside the MVP, and follow-ups                                    |

**Ports:** API 4000 (your dev) · web 5173 · simulator 5174 · operator 5175 · e2e API 4100 · e2e
host site 4200 · my check API 4300.

**Tests have their own databases** (since 2026-11-20): unit/integration tests use `okapigo_test`

- Redis db 1; browser tests `okapigo_e2e` + Redis db 2 (`packages/db/src/testing.js`). Your dev
  database `okapigo` is never touched by tests.

**The operator app's design files** (bundles the user sent) were unpacked to my scratchpad; the
session 16 boards are 23 pages (Manager's Today, O6–O10, states). If the scratchpad is gone, ask
the user for the "OkapiGo Operator App — Designs (Sessions 15–16)" HTML files again.

## 4. PRD journeys (end-to-end tests)

| Journey | What                                   | Test                                          |
| ------- | -------------------------------------- | --------------------------------------------- |
| 1       | book on the website and pay            | `apps/web/e2e/journey-1-book-and-pay.spec.js` |
| 2       | book on WhatsApp, pay the link, ticket | `journey-2-whatsapp.spec.js`                  |
| 3       | OTA booking via OCTO                   | not yet (OCTO session)                        |
| 4       | cancel yourself from the trip page     | `journey-4-cancel-yourself.spec.js`           |
| 5       | deposit, then the balance by link      | `journey-5-deposit-then-balance.spec.js`      |
| 6       | a guide checks in offline, then syncs  | `journey-6-guide-offline.spec.js`             |
| 7, 8    | AI companion; posters/dashboard        | not yet                                       |
| —       | the booking widget (4 cases)           | `widget-embed.spec.js`                        |

## 5. What's built, session by session

| Session / stage | What                                                                                                                                                                  | Commit              | Note           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------- |
| 1               | monorepo, Docker (Postgres, Redis), Express + `/health`, CI                                                                                                           | `36aff2e`           | 01             |
| 2               | Prisma schema: operators, roles, staff; Ìrìn seed                                                                                                                     | `f9a4d66`           | 02             |
| 3               | one-time-code sign-in, sessions (30 days), roles and permissions                                                                                                      | `0e244ab`           | 03             |
| 4               | catalogue: products, price categories, add-ons                                                                                                                        | `ef3724f`           | 04             |
| 5               | schedules → departures, time zones                                                                                                                                    | `2e486e1`           | 05             |
| 6               | pricing pipeline (kobo integers, VAT 7.5% included)                                                                                                                   | `7c37760`           | 06             |
| 7               | holds with row locks, BullMQ expiry, no double-selling                                                                                                                | `e6840e3`           | 07             |
| 8               | bookings: state machine, travellers, timeline                                                                                                                         | `339c395`           | 08             |
| 9               | versioned cancellation policies, cancel, no-show, departure cancel                                                                                                    | `eb25fb7`           | 09             |
| 10a–10e         | ledger (double-entry); payments + Paystack; webhooks; transfers + payment links; refunds + reconciliation                                                             | `caf0bdb`…`e7e1899` | 10a–10e        |
| 11a–11e         | public catalogue; public checkout + guest links + rate limits; deposits; balance reminders + staff alerts; share pages                                                | `9dd7834`…`498eb92` | 11a–11e        |
| 12a–12h-2       | guest web from the designs: tokens; catalogue/tour page + share card; checkout; after paying; trip hub (+ cancel, ask); website styles; operator site; booking widget | `74cdb67`…`5033a5a` | 12a–12h2       |
| 13a–13c-3       | WhatsApp booking engine; paying + staff take-over; as designed; simulator app; real Cloud API                                                                         | `bb6b05d`…`2c62364` | 13a–13c-3      |
| 14a–14c         | guest messages (templates, outbox); emails (Mailpit/Resend); WhatsApp templates                                                                                       | `f9a9919`…`6cfde28` | 14a–14c        |
| brief 07        | the operator app's flow brief, with the user's decisions                                                                                                              | `56e4f17`           | —              |
| 15a             | vans/boats, assigning guides (exclusion constraints), manifest + print, check-in, no-show                                                                             | `2fc4d0f`           | 15a            |
| 15b             | sync API: offline package (ticket fingerprints), outbox once-only, conflicts, 72 h                                                                                    | `565205e`           | 15b            |
| 15c-1           | operator app: PWA at /app/, sign-in, first run, strip, tabs, IndexedDB, outbox, Sync                                                                                  | `b5224da`           | 15c-1          |
| 15c-2           | manifest (O3): states, names, two kinds of no-show, money owed, search, PDF                                                                                           | `cc016eb`           | 15c-2          |
| 15c-3           | Scan (O4): camera (BarcodeDetector / jsQR), every result, search, Undo                                                                                                | `ae37bb7`           | 15c-3          |
| 15c-4           | money on the day (payment QR, cash reports), pickup stops, A4 printed manifest                                                                                        | `862aa7f`           | 15c-4          |
| 15d             | journey 6 end to end, network off                                                                                                                                     | `5bbb9ea`           | 15d            |
| —               | tests get their own databases and queues                                                                                                                              | `21ad517`           | test-isolation |
| 16a             | manager's shell (tabs/sidebar by role), staff states, manager's Today                                                                                                 | `07b04c9`           | 16a            |

**Still to come** (numbering after 16 to confirm with the user; the docs call AI "session 17" and
deploy "session 18"):

| Next    | What                                                                                           | PRD                       |
| ------- | ---------------------------------------------------------------------------------------------- | ------------------------- |
| **16b** | Schedule (O6) and a departure (O7): assign guides and vans, cancel for weather                 | OPS-01                    |
| 16c     | bookings desk (O8): every status, actions, refunds, payment links, **confirming guides' cash** | —                         |
| 16d     | inbox (O9): chats (take over), requests, alerts                                                | —                         |
| 16e     | settings (O10): website, embed, messages, WhatsApp, staff, tours                               | —                         |
| OCTO    | OCTO API + contract tests, channel manager, mock OTA (journey 3)                               | DST-01–03                 |
| AI etc. | AI companion, posters, dashboard (journeys 7, 8)                                               | GST-16, MKT-01/02, RPT-01 |
| Demo    | full seed, demo reset, uploads (photos, logo), a11y checks, README, deploy                     | step 10                   |

## 6. Decisions (dated)

**Setup (2026-11-16):** Docker Desktop for Postgres + Redis; learning notes in `docs/learning/`;
GitHub + Actions CI from session 1; path-based links (`/<operator>`, `/<operator>/<tour>`,
`/trip/<token>`), no subdomains.

**Guest side (2026-11-17/18)**, also in `docs/flows/README.md`:

- No children/infants without an adult; "adult" = the tour's adult price category (13+ at Ìrìn).
- Pickup point stored on bookings; required on tours that have them.
- Deposit balance due **7 days before** the trip; later bookings pay in full.
- Balance reminders **7, 3 and 1 days** before the due date; unpaid → staff alert, never
  auto-cancel.
- Guests can self-cancel from the trip hub, or ask the operator.
- WhatsApp: the lead's name + ages only for children/infants; seats held **30 min** (web 15);
  ticket = QR image + trip link; staff take-over screen designed with the operator app.
- Messages: 14a/14b/14c; **Resend** for email (Mailpit in dev); WhatsApp guests with an email get
  the email receipt too.

**Operator app (brief 07, 2026-11-19):**

- Resources = a name and seats (van, boat); **no drivers** in the MVP (a note: "Driver: Sola").
- The **guide marks no-shows**, after the start time, offline too.
- Money owed: shown, and check-in **asks first** ("Check in anyway?").
- Unnamed travellers: "Guest 2 of Adaeze Okafor's booking", optional name at check-in.
- **One app** for every role; the guide sees less.

**With the operator designs (2026-11-19):**

- **Money on the day: both** the payment QR (tour-day balance link) and **cash reports** (not a
  payment until the office confirms; a link payment meanwhile → possible double payment).
- **Pickup times now** (they already existed from 12c); the manifest groups pickup tours by stop.
- 15c in four stages (15c-1…4), then 15d.
- Two kinds of no-show: one traveller (no policy) vs the whole booking (the policy applies).
- Late and no-show only from the start time.

**2026-11-20:** tests isolated (own databases and Redis); **session 16 in five stages**
(16a–16e, see §5); the user had me delete 44 leftover test businesses from the dev database
(only Ìrìn remains).

## 7. Where we are

- **Last done:** 16a, committed `07b04c9`. The user has pushed everything up to the test
  isolation commit (`21ad517`); 16a's push not yet confirmed.
- **Next:** **16b**: Schedule (O6) and a departure (O7). Designs: "O6 Schedule — desktop/phone",
  "O7 Departure — desktop/phone and states" (picking a guide: busy ones say why; the van too
  small; cancelling for weather). API already there: assignment (15a), cancel departure (9),
  schedules (5). The manager's Today links to `/departures/:id` (placeholder for the office until 16b).
- **Kemi** (guide) is assigned to two of Ìrìn's departures on Fri 20 Nov (Heritage Walk 09:00,
  Street Food Crawl 18:30) in the dev database, from my 15c checks.
- Your dev database has **no vans** (seeded before 15a); `pnpm db:reset` adds them.

## 8. Known traps and how they're handled

- **Prettier vs my edits:** Prettier reformats long lines, so later exact-text edits miss. Run
  Prettier from the **repo root** (its `.prettierignore` lives there); after formatting the
  operator app, regenerate tokens: `node apps/operator/scripts/write-tokens.js`.
- **Generated token CSS** (`apps/*/src/styles/tokens.css`) is in `.prettierignore`; a test fails
  if stale.
- **Busy machine** (load 25–45 at times): screen tests in the operator app wait up to 10 s and
  run up to 60 s; the scanner's Undo note is lengthened in tests only (`SCAN_TIMING`).
- **The in-app browser pane can't run service workers**: check offline behaviour in Chrome via
  Playwright scripts instead (the e2e config's `channel: 'chrome'`).
- **Sign-in codes** in dev go to the API's log (`login code for … : 123456`); for my check API
  they're in my log file. Five codes an hour per address.
- **Playwright starts web servers before global set-up**: the e2e database is prepared by a
  separate step (`apps/web/e2e/prepare-database.js`).
- **Exclusion constraints** stop double-booking a guide or van (`btree_gist`); assignment
  foreign keys are `DEFERRABLE INITIALLY DEFERRED` (so deleting a business works).
- **Every tour has a departure every scheduled day**: "today" lists only departures with guests
  or a guide.
- Throwing inside a Prisma transaction rolls back everything in it: keep a record (e.g. a cash
  report) by committing first, then raising the conflict.

## 9. Changelog (newest first)

- 2026-11-20 · this log created.
- 2026-11-20 · 16a manager's shell and Today (`07b04c9`); 44 leftover test businesses deleted from dev.
- 2026-11-20 · tests isolated (`21ad517`).
- 2026-11-19 · 15a–15d (operator app, guide side; journey 6).
- 2026-11-19 · 14a–14c messages; operator app brief.
- 2026-11-18/19 · 12a–12h-2 guest web; 13a–13c-3 WhatsApp.
- 2026-11-17 · 10a–10e payments; 11a–11e public API; guest-web briefs and designs v1.
- 2026-11-16 · sessions 1–9.
