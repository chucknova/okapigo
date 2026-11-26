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
| `packages/ai`         | the AI companion's model: Claude Haiku, or a fake (18a)                  |
| `packages/media`      | photos and logos: checked, resized, stored (local disk; R2 at deploy)    |
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
| 3       | OTA booking via OCTO (Sojourna)        | `journey-3-ota.spec.js`                       |
| 4       | cancel yourself from the trip page     | `journey-4-cancel-yourself.spec.js`           |
| 5       | deposit, then the balance by link      | `journey-5-deposit-then-balance.spec.js`      |
| 6       | a guide checks in offline, then syncs  | `journey-6-guide-offline.spec.js`             |
| 7       | ask the AI companion; staff reply      | `journey-7-companion.spec.js`                 |
| 8       | a poster, then the dashboard           | `journey-8-poster-dashboard.spec.js`          |
| —       | the booking widget (4 cases)           | `widget-embed.spec.js`                        |

## 5. What's built, session by session

| Session / stage | What                                                                                                                                                                                                                                                                                                                                                   | Commit              | Note           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | -------------- |
| 1               | monorepo, Docker (Postgres, Redis), Express + `/health`, CI                                                                                                                                                                                                                                                                                            | `36aff2e`           | 01             |
| 2               | Prisma schema: operators, roles, staff; Ìrìn seed                                                                                                                                                                                                                                                                                                      | `f9a4d66`           | 02             |
| 3               | one-time-code sign-in, sessions (30 days), roles and permissions                                                                                                                                                                                                                                                                                       | `0e244ab`           | 03             |
| 4               | catalogue: products, price categories, add-ons                                                                                                                                                                                                                                                                                                         | `ef3724f`           | 04             |
| 5               | schedules → departures, time zones                                                                                                                                                                                                                                                                                                                     | `2e486e1`           | 05             |
| 6               | pricing pipeline (kobo integers, VAT 7.5% included)                                                                                                                                                                                                                                                                                                    | `7c37760`           | 06             |
| 7               | holds with row locks, BullMQ expiry, no double-selling                                                                                                                                                                                                                                                                                                 | `e6840e3`           | 07             |
| 8               | bookings: state machine, travellers, timeline                                                                                                                                                                                                                                                                                                          | `339c395`           | 08             |
| 9               | versioned cancellation policies, cancel, no-show, departure cancel                                                                                                                                                                                                                                                                                     | `eb25fb7`           | 09             |
| 10a–10e         | ledger (double-entry); payments + Paystack; webhooks; transfers + payment links; refunds + reconciliation                                                                                                                                                                                                                                              | `caf0bdb`…`e7e1899` | 10a–10e        |
| 11a–11e         | public catalogue; public checkout + guest links + rate limits; deposits; balance reminders + staff alerts; share pages                                                                                                                                                                                                                                 | `9dd7834`…`498eb92` | 11a–11e        |
| 12a–12h-2       | guest web from the designs: tokens; catalogue/tour page + share card; checkout; after paying; trip hub (+ cancel, ask); website styles; operator site; booking widget                                                                                                                                                                                  | `74cdb67`…`5033a5a` | 12a–12h2       |
| 13a–13c-3       | WhatsApp booking engine; paying + staff take-over; as designed; simulator app; real Cloud API                                                                                                                                                                                                                                                          | `bb6b05d`…`2c62364` | 13a–13c-3      |
| 14a–14c         | guest messages (templates, outbox); emails (Mailpit/Resend); WhatsApp templates                                                                                                                                                                                                                                                                        | `f9a9919`…`6cfde28` | 14a–14c        |
| brief 07        | the operator app's flow brief, with the user's decisions                                                                                                                                                                                                                                                                                               | `56e4f17`           | —              |
| 15a             | vans/boats, assigning guides (exclusion constraints), manifest + print, check-in, no-show                                                                                                                                                                                                                                                              | `2fc4d0f`           | 15a            |
| 15b             | sync API: offline package (ticket fingerprints), outbox once-only, conflicts, 72 h                                                                                                                                                                                                                                                                     | `565205e`           | 15b            |
| 15c-1           | operator app: PWA at /app/, sign-in, first run, strip, tabs, IndexedDB, outbox, Sync                                                                                                                                                                                                                                                                   | `b5224da`           | 15c-1          |
| 15c-2           | manifest (O3): states, names, two kinds of no-show, money owed, search, PDF                                                                                                                                                                                                                                                                            | `cc016eb`           | 15c-2          |
| 15c-3           | Scan (O4): camera (BarcodeDetector / jsQR), every result, search, Undo                                                                                                                                                                                                                                                                                 | `ae37bb7`           | 15c-3          |
| 15c-4           | money on the day (payment QR, cash reports), pickup stops, A4 printed manifest                                                                                                                                                                                                                                                                         | `862aa7f`           | 15c-4          |
| 15d             | journey 6 end to end, network off                                                                                                                                                                                                                                                                                                                      | `5bbb9ea`           | 15d            |
| —               | tests get their own databases and queues                                                                                                                                                                                                                                                                                                               | `21ad517`           | test-isolation |
| 16a             | manager's shell (tabs/sidebar by role), staff states, manager's Today                                                                                                                                                                                                                                                                                  | `07b04c9`           | 16a            |
| 16b             | schedule (O6), a departure (O7): assign guides and vans (tour transport, sales capped at the van), notes, cancel with refunds                                                                                                                                                                                                                          | `d293b30`           | 16b            |
| 16c-1           | bookings desk: search and filters, a booking's page in every status, notes (on the manifest too), release held seats, desk no-shows                                                                                                                                                                                                                    | `bf4d0d7`           | 16c-1          |
| 16c-2           | desk money: payment links (send or copy), cancel with the refund started, confirm a guide's cash (or not), retry or bank-transfer refunds; Cash and Bank accounts                                                                                                                                                                                      | `9c97f5a`           | 16c-2          |
| 16c-3           | desk: change travellers (− and +, the booked price, seats, extra → link, fewer → the policy's refund confirmed)                                                                                                                                                                                                                                        | `105242e`           | 16c-3          |
| 16d-1           | inbox chats: needs a person / with the bot, one person at a time, take over from a colleague, 24-hour rule + follow-up template, failed → retry or email                                                                                                                                                                                               | `a18ebab`           | 16d-1          |
| 16d-2           | requests: reply (WhatsApp + email, on the trip page), mark answered, Done; moving a booking's date; "Date changed" message                                                                                                                                                                                                                             | `1daa498`           | 16d-2          |
| 16d-3           | inbox alerts: worked out live (cash, refunds, balances, departures without a guide), clearing by themselves; Done this week; who assigned a guide                                                                                                                                                                                                      | `0506dbf`           | 16d-3          |
| 16e-1           | settings menu, save bar + leave guard + form errors, Website (style preview/apply, business details), Embed (snippet, approved sites, live preview)                                                                                                                                                                                                    | `72fadc7`           | 16e-1          |
| 16e-2           | settings: Messages (list, editor with details at the cursor, must-keep, real-booking preview, test send, back to default) and WhatsApp (state in words, ID, webhook, test, disconnect)                                                                                                                                                                 | `f60623f`           | 16e-2          |
| 16e-3           | settings: Staff and roles (the team in words, invite by email or words to copy, resend, edit, at least one owner, remove: signed out, departures freed, chats back)                                                                                                                                                                                    | `b9781ed`           | 16e-3          |
| 16e-4a          | settings › Tours: the list (schedule in words), New tour, Basics (transport, arrive by, text lists), the map pin pasted, on sale or not                                                                                                                                                                                                                | `4872ff2`           | 16e-4a         |
| 16e-4b          | Tours: Prices (all at once; "existing bookings keep their price"), Schedule and seats (booked departures it leaves, listed), one-offs; one save bar per tour                                                                                                                                                                                           | `9b6483e`           | 16e-4b         |
| 16e-4c          | Tours: Extras (all at once), pickup points, cancellation policy (one line each), deposit, holds line. **Settings done**                                                                                                                                                                                                                                | `8ee0e0f`           | 16e-4c         |
| 17a             | OCTO catalogue: supplier, products (units, cutoff), availability and calendar, prices with the OTA's net; channel keys (hashed); contract tests; brief 08                                                                                                                                                                                              | `035902a`           | 17a            |
| 17b             | OCTO bookings: reserve, confirm, cancel (policy until the start), extend, look up; the OTA's payment and sale in the ledger; no messages to OTA guests; no oversell across channels                                                                                                                                                                    | `87aa54a`           | 17b            |
| 17c             | channel manager, server side: the channels API in words (sales, owed, keys once), "via Mock OTA" on bookings, the 30-second signed push to OTA webhooks (fingerprints), SSRF guard                                                                                                                                                                     | `a52461d`           | 17c            |
| 17c-2           | Settings › Channels (O11) as designed: cards, tours one by one, latest bookings, money, commission, key (once, made, last used), switch off; OCTO notifications; payments from the OTA (oldest first); Sojourna                                                                                                                                        | `d6ba212`           | 17c-2          |
| 17c-3           | "via Sojourna" everywhere: desk tag, "Paid by Sojourna", channel filter; the OTA booking page (money, messages, buttons, a fixed cancel); OTA refunds settled on every cancel path; departure counts and Channel column; manifest tag; trip page "use Sojourna"; the Trip page link email                                                              | `ddd1303`           | 17c-3          |
| 17d-1           | Sojourna, the mock OTA (`apps/mock-ota`, :4400): its own server, OCTO client and store; M1 storefront, M2 tour (calendar, who, pickups, the hold), M3 checkout, M4 booked, their states; OCTO content and pickups capabilities, refundRules                                                                                                            | `5551a6b`           | 17d-1          |
| 17d-2           | Sojourna's back office (M5: live statuses, cancel with the business's own refund preview, too late), its OCTO notifications subscription ("last sync"), **journey 3 end to end**; OCTO refundIfCancelledNow and refundAmount; contacts accept null                                                                                                     | `5317f7e`           | 17d-2          |
| 18a-1           | The AI companion's server: `packages/ai` (Claude Haiku via Anthropic's SDK, a fake), its facts and rules, 20 a day, kept answers, the monthly spend cap, unsure → an inbox request (kind question); `GET/POST /public/bookings/:token/companion`                                                                                                       | `94a97db`           | 18a-1          |
| 18a-2           | The companion on the trip page (C1–C2: suggestions, answers with their source, passed to the team and the reply, limit, paused, no signal, closed; saved on the phone), the inbox's question (C3: "The assistant wasn't sure", Add to the FAQs), **journey 7**                                                                                         | `91ae5f2`           | 18a-2          |
| 18b             | Posters (P1–P2): four templates (New tour, Offer, Seats left, This weekend), square or story, drawn on the server (satori → PNG) with a QR to book; More › Posters and the desk menu (marketing access); kept a minute                                                                                                                                 | `30683a5`           | 18b            |
| 18c             | The dashboard (D1): today's departures, bookings, money in, check-ins; 30-day trend against the 30 before; channels; seats filled; money in read from the ledger by the Lagos day; **journey 8**; the poster preview's blob: image allowed (an 18b bug)                                                                                                | `a8ca993`           | 18c            |
| 19a-1           | The demo's history (`seed/history.js`): 60 days of guided departures, ~155 past bookings (all channels, check-ins, cancellations and refunds, two no-shows, a weather cancellation, Sojourna's payments), ~20 upcoming, and five loose ends; held to the live rules by tests                                                                           | `3e9e3e4`           | 19a-1          |
| 19a-2           | The nightly demo reset (workers, 04:00 Lagos, only with `DEMO_RESET=on`, never a non-demo business; `pnpm demo:reset` by hand); `is_demo` businesses never send for real (WhatsApp to the simulator, email kept)                                                                                                                                       | `02048eb`           | 19a-2          |
| 19b-1           | Uploads, server side: `packages/media` (checks a file by its bytes, 1600/640 px photos and 512/128 px logos, hidden details stripped, stored by content hash; local disk now, R2 at deploy); `POST /api/uploads/:kind`, `/media/…`; only our own pictures on tours and the website; credits; **3 photos to go on sale**; the demo's 18 photos and logo | `603a673`           | 19b-1          |
| 19b-2a          | Photos in the staff app: a tour's Photos section (cover, order, describe, credit, remove asks under 3 on sale), New tour with photos, a draft's "Before it goes on sale" checklist, the list's "needs 1 more photo", the logo and hero in Business details; uploads with progress (XHR)                                                                | `c08497c`           | 19b-2a         |
| 19b-2b          | Photos and the logo for guests: the logo in every header, the website's hero photo and card covers with a footer of credits, a tour page's swipeable photos with the shown photo's credit, the trip page's cover; posters (Seats left, Offer) and link previews with the cover and its credit                                                          | `d001a1b`           | 19b-2b         |
| 19c-1           | Accessibility: axe checks every guest page against WCAG 2.1 AA in the browser (3 styles × light/dark, phone and desk; checkout with errors; trip, payment link, widget, not found); fixed: the photo strip unreachable by keyboard, date buttons whose names didn't contain their visible words                                                        | `(this commit)`     | 19c-1          |

**Still to come** (numbering decided 2026-11-21: OCTO is session 17, AI 18, the demo 19):

| Next    | What                                                                                                                                                                                             | PRD                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| ~~16b~~ | Schedule (O6) and a departure (O7): assign guides and vans, cancel for weather                                                                                                                   | OPS-01                    |
| ~~16c~~ | bookings desk (O8) in three parts: ~~16c-1~~ find and read; ~~16c-2~~ money; ~~16c-3~~ change travellers                                                                                         | —                         |
| ~~16d~~ | inbox (O9): chats (take over), requests, alerts                                                                                                                                                  | —                         |
| ~~16e~~ | settings (O10): website, embed, messages, WhatsApp, staff, tours                                                                                                                                 | —                         |
| **17**  | OCTO: ~~17a~~ catalogue; ~~17b~~ bookings; ~~17c~~ ~~17c-2~~ channel manager; ~~17c-3~~ via Sojourna everywhere; ~~17d-1~~ Sojourna's guest side; ~~17d-2~~ its back office, journey 3. **Done** | DST-01–03                 |
| ~~18~~  | AI companion, posters, dashboard (journeys 7, 8): **Done**. 18a the companion (journey 7); 18b posters; 18c the dashboard, journey 8. Brief: `docs/flows/09-…`                                   | GST-16, MKT-01/02, RPT-01 |
| 19      | full seed, demo reset, uploads (photos, logo), a11y checks, README, deploy                                                                                                                       | step 10                   |

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

**With 16b (2026-11-20):** a guide assigned sees it on their phone (no message yet: parking
lot); a van or boat **too small is refused**, and once assigned **sales stop at its seats**
(`seatsOf` = the smaller of the tour's capacity and the van's seats); **each tour has a
transport** (on foot, van, boat) and only that kind can be assigned; cancelling a departure
**starts every paid booking's refund** and keeps the reason.

**With 16c (2026-11-20):** the bookings desk in **three parts** (16c-1 find and read; 16c-2 the
money; 16c-3 change travellers); an **added traveller pays the price from when it was booked**;
a booking cancelled with money owed back and no refund started shows **Refund to send** (red).

**With 16c-2 (2026-11-21):** confirmed cash is a real payment (provider `cash`) in a new
**Cash** account; refunds sent by bank transfer come from a new **Bank** account; "Not
received" alerts the owner (Today); the desk's cancel **starts the refund at once**
(`startRefund`); a payment link can be **copied** instead of sent. The design's "For: Deposit"
option isn't offered: only Balance or Other (a deposit link only makes sense before anything is
paid, and the desk sends links for what's owed).

**With 16c-3 (2026-11-21):** an added traveller pays the booked price; a kind the booking never
had pays today's ("(today's price)" on the sheet). A booking with a promo or a fee can't be
repriced (refused). Fewer travellers: the policy's refund on the overpaid part, confirmed by
saving; more: paid → **amended**, and a link for the extra is sent. The lead always stays.

**With 16d (2026-11-21):** the inbox in **three parts** (16d-1 chats; 16d-2 requests + **moving
a booking's date**, built now; 16d-3 alerts). The 24-hour rule gets a new approved WhatsApp
message, **"Can we help you finish booking?"** (`okapigo_chat_followup`; for real WhatsApp,
submit it in Meta once). Only whoever took a chat over replies; a colleague takes over on
purpose. A failed chat message can be retried or emailed (kind `staff_message`).

**With 16d-2 (2026-11-21):** moving a booking keeps the booked price, needs the seats on the
new date (both departures locked in id order), resets check-ins, and tells the guest with a
**seventh guest message, "Date changed"** (`booking_moved`, editable; WhatsApp template
`okapigo_booking_moved`). A request's reply is kept and shown on the trip page.

**With 16d-3 (2026-11-21):** alerts are worked out from how things are (no stored rows, no
dismiss for money); the Inbox badge counts chats waiting + open requests + alerts; departures
record who assigned the guide.

**With 16e (2026-11-21):** settings in **four parts** (16e-1 menu, Website, Embed; 16e-2 Messages,
WhatsApp; 16e-3 Staff; 16e-4 Tours). **Invitations are emailed**; for staff with only a phone, the
owner gets the words to copy and send. The widget may be framed by **OkapiGo's own pages**
(`'self'`) for the Embed preview. The tagline stays at **80** characters (the design said 60:
lowering it would drop longer stored taglines). Website/Embed need marketing: edit (owner);
others see them look-only.

**With 16e-2 (2026-11-21):** the WhatsApp page shows **no tokens**: the access token and the
verify token stay in the server's `.env` (the design's "verify token to copy" dropped). The
editor says the **24-hour rule accurately** (the design's "Meta approves your edit" isn't how
WhatsApp works): a guest who wrote in the last 24 hours gets your wording, anyone else Meta's
approved version, email always yours. Test sends go to **the signed-in person's own phone**,
marked `[Test]`; a refused one is **422 TEST_NOT_SENT** with the reason (a 5xx would read as
"OkapiGo is having trouble"). The preview uses **the business's latest paid or confirmed
booking**. Each message has its own address (`/settings/messages/:kind`). Messages need
settings: edit (managers can't open it); WhatsApp needs channels: edit (managers look).

**With 16e-3 (2026-11-21):** **removal is instant** and nothing from a removed person's phone
is accepted after it (the design said their waiting changes "still arrive": that would let
someone who's left write records for a while). The screen **says it accurately**: what their
phone had waiting at its last sync, and that asking them to sync first is suggested, not
required. Removing someone takes them off their **coming** departures (listed, with links to
reassign) and hands their chats back to "Needs a person". **At least one active owner**, always.
Invitations have **no secret link**: the person signs in by code with the email or phone they
were added with; email when there's an address and a mailer, else the words to copy. The invite
form adds a **name** (the design had none). The settings menu lists only what a role may open
(managers and guides don't see Staff, or Messages). You can edit your own name and contact,
never your own role or access.

**With 16e-4 (2026-11-21):** Tours in **three parts** (16e-4a list, New tour, Basics; 16e-4b
Prices and Schedule; 16e-4c Extras, pickups, cancellation, deposit). The meeting point's pin is
**pasted** (a Google Maps link or coordinates, read by `readMapPin()`, no map service called;
short links are refused with how to get the full one). Without one, the server stores the
**city's pin marked `approximate`**, and guest pages show **no map or directions** (the
confirmation's "Open in Maps" searches the address) until the real pin. Putting a tour on sale
still needs only a price (dates aren't required). The text lists are written one per line
(stops with a dash, FAQs question/answer with a blank line between).

**With 16e-4b (2026-11-21):** a tour's page has **one save bar** for all its sections
(`useSaveParts`); Save saves each changed section in page order and stops at the first
refusal. A tour's prices are saved **as a whole** (`PUT …/price-categories`, one transaction;
left out = archived, new keys from names). "Existing bookings" = confirmed or paid, still to
travel (holds don't count). A category with no upper age counts as an adult (no new field).
The schedule shown is the first switched-on one; booked departures a change leaves are listed
with links (`sync.attention`), never removed. One-off departures are added straight away, not
through the save bar.

**With 16e-4c (2026-11-21):** a tour's extras are saved as a whole like its prices (`PUT
…/add-ons`). Pickup points are area, place and time (stored as name, address, time).
Policies are **chosen**, not written, in Settings (the design only chooses; writing them stays
with the API). "None" means staff set each refund (guests can't self-cancel without a policy).
The deposit is a whole percentage, 1–99; the balance's 7 days and the hold times (website: the
business's setting; WhatsApp: 30 minutes) are business-wide and only shown.

**With 17 (2026-11-21):** OCTO is **session 17** in four parts (17a catalogue, 17b bookings, 17c
channel manager, 17d mock OTA); AI is 18, the demo 19. **The OTA takes the guest's money** and
owes the business the price minus its commission (per channel; the mock OTA 20%). The mock
OTA's storefront and Settings › Channels are **the user's to design** (brief
`docs/flows/08-octo-and-channels.md`, three questions in it). On our side a tour is one OCTO
product with one option ("DEFAULT"); a price category is a unit; a departure is an
availability. Channel keys are `octo_` + 32 random bytes, **stored as SHA-256 only**. Where
the OCTO docs contradict themselves: 400 for request errors, 401 without a key, 403 for a bad
one; both `pricing` and `octo/pricing` accepted. The seed's mock OTA key is `octo_dev_<slug>`
(or `MOCK_OTA_API_KEY`).

**With 17b (2026-11-21):** **OTA guests get no automatic messages** from Ìrìn (the OTA tells
them; OCTO gives it the QR ticket and the trip page link). **An OTA's cancellation follows the
business's policy until the start**; OCTO's cutoff now says "until the start" with the policy
in words. An OCTO booking is one of our bookings plus a `channel_bookings` row (the OTA's uuid,
reference, unit items, **commission frozen at the sale**); its OCTO status is worked out, never
stored. Confirming records a payment from the OTA (provider `ota`) and an `ota_sale` (Dr Owed by
OTAs 1300 net + Dr OTA commission 5200 / Cr Tour sales); a cancellation's refund is settled with
the OTA at once (Dr Refunds payable / Cr Owed by OTAs + Cr OTA commission). An OTA hold may have
no contact yet (the lead-contact check allows it only for held or cancelled OTA bookings). OTA
holds last up to 30 minutes. Pickups: the reserve's `pickupPointId` (the point's name, URL-safe);
the rest of OCTO's pickups capability isn't built.

**With 17c (2026-11-21):** the channel manager's **server side is built before its screen**
(Settings › Channels waits for your design; brief 08). The API answers in words (tours, this
month's sales, what the OTA owes at each sale's frozen share, the push's state); keys and the
webhook signing secret are **shown once** (the secret is derived from `AUTH_SECRET` and the
channel id, so nothing new is stored). **The push compares fingerprints every 30 seconds**
(`channel_sync_states`) instead of hooking every place seats change: what differs is POSTed to
the OTA's webhook (`availability_update`, `product_update`), remembered only once accepted; a
failure is kept in words and retried next run. Signed `Octo-Webhook-Signature: t=…,v1=…`
(HMAC-SHA256 of "t.body"). In production a webhook must be public https (no localhost, private
ranges, 169.254, .internal, IPv6 literals); redirects are never followed; 5 seconds at most.
Off sale or taken off the channel: departures told CLOSED, then forgotten. "via Mock OTA",
"Paid by Mock OTA" and "Mock OTA owes you" show on the desk, the booking and the departure.

**With 17c-2 (2026-11-21, your designs for brief 08):** the mock OTA is **Sojourna**. The rest
of session 17 goes in three: **17c-2** Settings › Channels, **17c-3** "via Sojourna" everywhere
else (bookings filter, booking page, manifest, schedule), **17d** the Sojourna app and journey 3.
**OTA guests get the trip page link and the reminders from the business** (the confirmation,
receipts and refunds stay the OTA's: "Not sent: Sojourna sends its own"); this replaces 17b's
"nothing automatic" and lands in 17c-3. The design has no webhook field, so **17c's own webhook
is replaced by OCTO's notifications capability**: the OTA subscribes its own address
(`/octo/notifications/subscriptions`, also the spec's "subcriptions"), with the types it wants
and headers it asks for; messages are OCTO's small ones (PRODUCT_UPDATE {productId},
AVAILABILITY_UPDATE {productId, optionId, localDateStart, localDateEnd}, BOOKING_UPDATE {uuid});
fingerprints per subscription (`notification_states`). **Payments from an OTA** are recorded
(amount, day, bank reference) and pay off its **oldest bookings first**; ledger `ota_payment`
(Dr Bank / Cr Owed by OTAs). A booking refunded after the OTA paid for it is owed back. Only
published tours can be on a channel; connecting switches every published tour on. The key
shows its last 4, when it was made and when it was last used (updated at most once a minute).
Payments: owners only (channels: edit). Key format stays `octo_…` and the address `/octo` (the
designs' `okg_live_…` and `/octo/v1` were illustrative).

**With 17c-3 (2026-11-21):** an OTA booking's money is with the OTA, and changes go through it:
no payment link, and "Change travellers" and "Move" aren't offered. **Whoever cancels an OTA
booking** (the OTA, the office, a departure called off, a no-show), its refund is **settled with
the OTA in `cancelBookingInTx`**, never a "Refund to send" or a card refund. The office cancelling
one gives **everything back** (it's the business calling it off): one line, nothing to choose.
OTA guests get a new **Trip page link** message (`trip_link`, the eighth), **by email only** (no
new Meta template; OCTO always gives an email), with `{booked_through}`; the confirmation,
receipts and refunds stay the OTA's ("Not sent: Sojourna sends its own"). OkapiGo has **no trip
reminder yet**: when one is built, add it to `FOR_OTA_GUESTS`. The guest's trip page says "You
booked through Sojourna" and offers no self-cancel (the server refuses one: BOOKED_ELSEWHERE).
The bookings list filters by channel (web, WhatsApp, staff, or one OTA).

**With 17d-1 (2026-11-21):** session 17d goes in two: **17d-1** Sojourna's guest side (M1–M4
and their states), **17d-2** its back office (M5), its notifications, journey 3. Sojourna is
`apps/mock-ota`: **its own server** (it holds the API key; the pages never see it), talking
**only OCTO over HTTP**, keeping only its own references in a JSON file (the status and ticket
are asked of the supplier each time). Port 4400; `pnpm dev` starts it (Vite in middleware mode).
Our OCTO API gained the standard **`content`** (features, START location, categoryLabels,
media) and **`pickups`** (pickupLocations; `pickupLocationId` when reserving; the booking's
pickup and its time) capabilities, by bare or `octo/` name; options also carry **`refundRules`**,
not in the spec (OCTO's cutoff is words only), for "Full refund until …". Holds from Sojourna
last 15 minutes. Its pages say "a trip page with the map and everything you need" (no trip
reminders exist yet).

**With 17d-2 (2026-11-22):** Sojourna's back office asks the business for every booking's
status each time it opens (so a weather cancel shows by itself); it tells its own cancellations
from the business's by noting when it cancelled. Before cancelling it shows the business's
own preview of that booking (`refundIfCancelledNow`, ours: by the policy it was sold under);
cancelled bookings carry `refundAmount` (ours; OCTO says only FULL/PARTIAL/NONE). Sojourna
subscribes to OCTO notifications at start (old ones to the same address removed, a fresh key in
`X-Sojourna-Key`, retried every 30 s) and notes "last sync". **Journey 3** runs Sojourna from the
e2e set-up on :4500 (its key is the run's business's). OCTO contacts now accept null fields.
**Session 17 is done.**

**Session 18's plan (2026-11-22):** flow brief `docs/flows/09-companion-posters-dashboard.md`.
The companion runs on **Claude Haiku** behind one adapter (a fake in tests and e2e; your key in
`.env` as `ANTHROPIC_API_KEY`), with a monthly spend cap, about 20 questions per booking per
day, and cached answers for common questions. When it isn't sure, the question becomes an
**inbox request** (kind _question_) at once. Posters have a **photo slot** (uploads in 19).
Three parts: **18a** the companion (journey 7), **18b** posters, **18c** the dashboard and
journey 8. You design C1–C3, P1–P2, D1.

**With 18a-1 (2026-11-22):** built while you design: the companion's server side. One
interface (`packages/ai`): Claude Haiku (`claude-haiku-5-5`, effort low, structured JSON
output) or a fake (matching words to the FAQs; the default, and always in tests and e2e). The
SDK is pinned to 1.6.0 (the newest was 2 days old). It answers **only from the business's own
content**, given as tagged facts; the guest's words are escaped and never instructions. Refused,
cut off or unreadable replies count as **unsure**, so they go to the team. Answers are kept per
tour (key: the question's words + a hash of the tour's facts and rules) unless they used the
booking's own details. 20 questions per booking per Lagos day; `AI_MONTHLY_CAP_USD` (default
$10) across all businesses; costs in millionths of a dollar. Guests can ask until the trip is
over (completed included); not once cancelled. Unsure becomes a GuestRequest of kind
**question** ("Asked the assistant" in the inbox). **18a-2** builds the card from your designs.

**With 18a-2 (2026-11-23):** you asked me to draw session 18's screens (a design canvas,
approved: C1–C3, P1–P2, D1); 18a-2 builds C1–C3. The card's states and words live in
`apps/web/src/lib/ask.js`; it's saved on the phone like the trip page. It stays after the
trip and closes once cancelled; "questions left" only from 5 down. A handed-over question
carries the team's reply (first name) and no longer shows in the trip page's request banner.
In the inbox, a question has no Move or Cancel buttons and links to the tour's FAQs. Journey 7
signs the owner in (journey 3 uses the manager's one code a minute).

**With 18b (2026-11-23):** posters are drawn on the SERVER like the link-preview cards
(satori → resvg, our Inter fonts): the preview is the real PNG, prices and seats read when
drawn, kept 60 s. Four templates × square/story; each complete without a photo (a panel
where it'll go). The QR opens the tour's booking page (This weekend: the website). Who:
marketing "view" or more (owner, managers); More › Posters on a phone, the side menu on the
desk. Seats left: departures with seats in 14 days; This weekend: the coming Sat/Sun. No
discount engine: an Offer shows the owner's words and the real price.

**With 18c (2026-11-23):** the dashboard reads MONEY IN from the ledger's money accounts (Cash,
Paystack clearing, Bank) by the Lagos day: in = payments, cash, OTA payments; out = refunds
sent; Paystack's fee left out; reversals net out. A booking MADE = its hold converted (a
lapsed hold's "cancelled" booking isn't one). Departures and check-ins today; 30 days vs the
30 before (no % from nothing); channels (OTA by name, money it paid); seats filled (a smaller
van counts as its seats). For reports "view" (owner, managers): More › Dashboard, the desk
menu. Journey 8 signs in its own new manager (one code a minute per address). The API's CSP
now allows `blob:` images: 18b's poster preview never showed in the real app (found by a
screenshot). **Session 18 is done; all eight PRD journeys have e2e tests.**

**Session 19's plan (2026-11-23):** five parts: **19a** the full demo history (about 150 past
and 20 upcoming bookings, a few via Sojourna, **a few loose ends** a manager would sort out:
decided), the nightly reset and "Try it" visitor copies; **19b** uploads (photos, logo):
**openly licensed photos** of the real places (Wikimedia Commons, credits kept; each file OK'd
by you before download) and a drawn SVG logo; **19c** accessibility checks and polish; **19d**
the README and the demo script; **19e** deploy: **Render, one web service + one worker** (the
API already serves the guest web and staff app), Neon, Upstash, Cloudflare R2; you create the
accounts and paste the keys.

**With 19a-1 (2026-11-23):** `seedDemoHistory()` runs after `seedDemoOperator()` in `pnpm db:seed`
/ `db:reset` only (never in tests or e2e: they keep a quiet business). It writes rows directly
(the engine refuses past trips) but reuses the real pricer, postings, refund rule and
reference makers, and a test holds it to the live rules (books balance, seats add up, timeline,
money). Deterministic (seed 19). A growing business; loose ends: no guide tomorrow, a failed
refund, cash with a guide, one overdue Badagry balance (when due), a change of date, a
companion question. Extra test businesses use a smaller story (40/6).

**With 19a-2 (2026-11-23):** "Try it" visitor copies are **left out for now** (for later: owner +
guest sides; "Reset my copy" in a visitor's copy; the public demo resets only at night). The
nightly reset: `resetDemo()` deletes the demo slug's business and makes it again as a demo
(`is_demo`) with its history; the workers schedule it at 04:00 Lagos **only with
`DEMO_RESET=on`** and never touch a non-demo business; `pnpm demo:reset` by hand. Demo
businesses never send for real (WhatsApp to the simulator, email kept, not sent); your own
businesses send as before. Deploy (19e) in December.

**With 19b (2026-11-23):** the designs: U1–U8 on the session 18 canvas, page "19b · Photos and
logo" (approved: "Yes, build 19b"). **Photos come at the start: New tour asks for them**, and a
tour needs **at least 3 photos (the first is the cover) to go on sale**; a draft can be made
with none. Tours already on sale with fewer **keep selling**, marked "needs 1 more photo";
removing a photo below 3 is **allowed after a warning**. Up to 8 a tour. Each photo needs a
description; a credit is optional (shown under it; the website's footer lists them). The demo:
**18 openly licensed photos from Wikimedia Commons, each OK'd by you** (3–4 a tour; two you
turned down: boli with fish, the Mobee museum), and a logo I drew. Built in two parts: **19b-1**
the server, **19b-2** the screens.

**With 19b-1 (2026-11-23):** uploads go through `@okapigo/media`: the file's type from its
bytes (JPEG, PNG, WebP; never SVG, PDF, GIF, HEIC), at most 10 MB and 60 megapixels, re-encoded
(the GPS and camera details gone), named by a hash of the result, stored on the local disk
(`.data/media`, git-ignored; served at `/media`), Cloudflare R2 at deploy. Tours and the website
accept **only this server's own picture addresses**. Who may upload: whoever may change tours
or the website (the owner, in the default roles; managers only look, so the canvas note
"owner and managers" was wrong). The logo travels with the business's name on every guest page;
the hero with the website. The demo's photos are seeded by `pnpm db:seed` and the nightly reset,
not in the tests' quiet businesses.

**With 19b-2a (2026-11-23):** New tour asks for photos right after the summary; missing
descriptions show only once "Make the draft" is pressed. A tour's page keeps its one long page
of sections (16e-4), so Photos is a section after Basics, not the canvas's tabs. Uploads happen
when picked, the change on Save (which waits for uploads). The size limit and its words are
shared (`@okapigo/shared/uploads`). Next, 19b-2b: what guests see.

**With 19b-2b (2026-11-26):** the cover photo goes in Seats left's panel and Offer's circle;
New tour and This weekend keep their panels (the route, the weekend's trips), which a photo
would push out (my call: tell me if you'd rather). Cards show no credit; the website's footer
lists every credit on the page. Drawn pictures (posters, previews) read only our own stored
pictures. **Session 19b is done.**

**With 19c-1 (2026-11-26):** `apps/web/e2e/a11y.spec.js` runs with the journeys (`pnpm e2e`),
so every stage is checked for WCAG 2.1 AA problems a tool can find. A date button's name is
its own text now (no `aria-label`): the parts not shown are visually hidden between the shown
ones. axe-core is pinned to 4.14.0 (its 4.14.1 was under two weeks old).

## 7. Where we are

- **Last done:** 19c-1, the accessibility checks, committed `(this commit)`.
- **Next:** **19c-2**, polish: the staff app's script over 500 kB (split it so a guide's phone
  loads less).
- **The flaky WhatsApp paying tests are fixed on a branch**, `claude/reverent-snyder-a98e81`
  (`cc9f1c8`, from its own session), not merged here. It also found two more flaky tests:
  `octo-bookings` (a sort tie) and the ledger's race test.
- **Run `pnpm db:reset`** to get the demo's photos and logo in your dev data (and its history).
- **Deploy (19e) waits until December 2026** (decided 2026-11-23): 19a-2 to 19d are built
  and checked locally first; the nightly reset runs in the local workers until then.
- **Designs for session 18:** https://claude.ai/artifact/UtCPPn8bor271AVpWMZTpD (private).
- **To use Claude:** add `AI_PROVIDER=anthropic` and your `ANTHROPIC_API_KEY` to `.env` (see
  `.env.example`); until then the companion runs on the fake.
- **To try Sojourna:** `pnpm dev`, then http://localhost:4400 (after `pnpm db:reset`, so the
  demo business has its Sojourna channel and key).
- **Your dev database** needs `pnpm db:reset` for the Sojourna channel (none, or the old "Mock
  OTA", until then).
- **The operator app's script is over 500 kB** since 16e-4c (Vite warns at build). Not urgent
  for staff phones on a good connection; splitting Settings into its own chunk would fix it.
- **Your dev data:** a real alert, **Refund to send: ₦100,000, Akinbote Temiloluwa
  (ILT-HP97TV)**.
- **For real WhatsApp:** submit `okapigo_chat_followup` and `okapigo_booking_moved` in Meta.
- A payment link for ₦45,500 was sent to Funmi Adeyemi (dev data) as Tunde at 21:27 on 20 Nov,
  to the simulator only; it may have come from my 16c-3 browser check (unconfirmed).
- **E2E stays local**: `pnpm e2e` every stage; re-run a timed-out test alone before calling it
  a failure.
- Your dev database has **no vans or boats** and no short tour names; `pnpm db:reset` adds them.

## 8. Known traps and how they're handled

- **Prettier vs my edits:** Prettier reformats long lines, so later exact-text edits miss. Run
  Prettier from the **repo root** (its `.prettierignore` lives there); after formatting the
  operator app, regenerate tokens: `node apps/operator/scripts/write-tokens.js`.
- **Generated token CSS** (`apps/*/src/styles/tokens.css`) is in `.prettierignore`; a test fails
  if stale.
  Running `npx prettier --write src` **inside** `apps/operator` skips the root ignore file and
  lowercases it (happened in 16e-2): fix with `pnpm --filter @okapigo/operator tokens`.
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
- **`.wide-only` / `.narrow-only` vs a screen's own `display`:** a later `display: flex` beat
  `display: none`. The helpers now have the last word (`!important`, end of `app.css`).
- **What a departure can sell** is `seatsOf(d)` (tour capacity or the van's seats, whichever is
  smaller), never `capacity` alone: include the `resource` when reading departures.
- **`validate({ query })`** now really checks query strings (it ignored them before 16c) and
  hands the route the checked values; Express 5's `req.query` is a getter, so it's replaced
  with `Object.defineProperty`.
- **A booking's money owed back** is `refundDueKobo`; what's not on its way is that minus every
  refund that hasn't failed (`notStartedKobo` in desk.js). The office's cancel doesn't start
  the refund by itself (until 16c-2 joins them).
- **Database CHECK rules** list allowed values (payment providers and methods, ledger
  transaction types, notification kinds, cash report statuses). A new value needs a migration
  that drops and re-adds the rule. **Never edit an applied migration**: add another.
- **Cash payments** have no Paystack transaction: `requestBookingRefund` skips them (it only
  refunds payments with a `providerTransactionId`). Cash goes back by bank transfer.
- **Tests that read the clock**: "2 h 20 min from now" is tomorrow after 21:40 in Lagos. The
  Today test assumed the same day and failed late in the evening (fixed 16c-3: it checks
  Lagos's date); so did the desk's "filters and search" (fixed 16d-1: the departure is pinned
  to noon today in Lagos). Write such tests so either day passes.
- **`vi.waitFor` gives up after 1 s**; Testing Library's `waitFor` and `findBy…` wait 10 s
  (`apps/operator/test/setup.js`). Under a full run's load, use Testing Library's (16e-4b's
  "one save bar" test flaked on `vi.waitFor`). Older tests (inbox, board) still use `vi.waitFor`.
- **A `<fieldset>` is never narrower than its widest child** (browsers give it
  `min-width: min-content`): one long menu option pushed a whole settings page sideways
  (16e-4c). `.plain-fieldset` now has `min-width: 0`.
- **Journey 6 sometimes fails in a full e2e run, quickly** (about 5 s, not a timeout: 16e-2 and
  17a). It passes alone and on the next full run. Cause not found yet; worth a look if it
  becomes frequent (the guide's offline sync after the other journeys' bookings).
  17d-1: it failed in a full run **and once alone** (a `toBeVisible`), then passed on the next
  try. Also: **the Mac sleeping mid-run** fails whatever is running ("11.4h" for one journey);
  re-run awake before reading anything into it.
- **Order ties are random**: rows with the same `sortOrder` and the same `createdAt` (seeded in
  one go) come back in id order, which is random. A full run caught archived prices tying with
  active ones (16e-4b); they now sort after them. Give every sorted row its own place.
- **A browser check that needs data your dev database lacks** (17c-2: no Sojourna before
  `pnpm db:reset`): point the check API at the **e2e** database (rebuilt by every e2e run) rather
  than adding to your dev data.
- **The channel push (17c) runs in the workers app**, not the API: my check API on :4300
  doesn't push. A test that seeds a whole business and pushes 60 days of departures needs the
  60-second test timeout under load (the workers' default 20 s timed out in a full run).
- **Journey 3 stuck at the desk** (17d-2, again in 18a-1): the office tab reopened in first
  run, so "All" never appeared. "Go to Today" saves "first run done" and only THEN shows Today;
  the test opened another page (a reload) straight after the click, before the save. It now
  waits for Today's heading first. In 17d-2 I took it for a slow machine and gave the journey
  3 minutes; that was wrong (removed). Any e2e that signs a new phone in: wait for Today.
- **Prettier writes `\u` escapes inside a regular expression as the characters themselves**
  (18a-1: `/[\u0300-\u036f]/`, the accent marks, became invisible). Use a Unicode property
  instead (`/\p{M}/gu`), which also says what it means.
- **The AI companion in tests:** the API's tests get the fake by default (`buildApp`), and the
  e2e API is forced to `AI_PROVIDER: 'fake'` in `playwright.config.js`, so a key in `.env` never
  makes a test run call Claude or spend. Keep it that way for any new test runner.
- **One sign-in code per address per minute** (18a-2): two e2e journeys signing the same
  person in within a minute fail ("Too many codes asked for"). Journey 3 uses the manager,
  journey 7 the owner; a new journey that signs in needs its own person.
- **`playwright test` alone uses whatever is built.** `pnpm e2e` rebuilds the web, staff and
  Sojourna apps; running one journey directly after changing the staff app needs
  `pnpm --filter @okapigo/operator build` first (18a-2: the new inbox box "wasn't there").
- **"The next departures" differ by day.** On Wednesdays the Lekki half-day (08:00, 5 h) and the
  Heritage Walk (09:00) overlap, and one guide can't be on both (a database rule). A test that
  assigns one guide to "the next two" failed on Mon 23 Nov; pick one tour's departures.
- **Satori puts padding OUTSIDE a box's size** (18b): a poster of `height: 100%` with padding
  was cut off at the bottom. Give such boxes `boxSizing: 'border-box'`. Draw every template
  and look at them together after any layout change.
- **The API's Content-Security-Policy applies only in the real app** (18c): unit tests fake the
  server, so an image the policy blocks still "works" there, and Playwright's `toBeVisible`
  passes for a broken image. 18b's poster preview (a `blob:` image) never showed in the built
  staff app. Check images' `naturalWidth` in e2e, and screenshot new screens in the real build.
- **Screenshots without touching your browser pane** (18c): a headless Chrome (`channel:
'chrome'`) via Playwright from `apps/web`, against my :4300 API and the e2e database, signing
  in a throwaway user with a code (as journey 8 does).
- **A seed that depends on the day** (19a-1): what runs and what's full changes with the date,
  so the history test also seeds a Wednesday and a late Saturday. A crash only on the real
  date was how this showed.
- **Heavy seeding in tests slows the shared database**: four full histories at once made race
  tests time out. Seed the full story once; use smaller ones elsewhere.
- **A busy machine** (load 24+, once 190: Docker's VM, iCloud syncing, Wi-Fi daemons, Chrome,
  Figma): timing-sensitive UI tests time out at random. Re-run alone; run the suite one package
  at a time (`pnpm exec turbo run test --concurrency=1`), or wait for the load to fall.
- **"Can't reach database server at localhost:5432"** in every database test: the Docker
  services stopped (19a-1). `docker ps -a`, then `pnpm services:up`.
- **The e2e database is migrated only when the e2e journeys start** (19a-2): a check against
  it after adding a migration needs `prisma migrate deploy` with the e2e database first
  ("column … does not exist").
- **Reading a picture's header isn't decoding it** (19b-1): a JPEG cut off part-way passes
  sharp's `metadata()` and fails only when resized. Both steps turn errors into the user's words.
- **Pictures in tests go to the system's temp folder** (`okapigo-test-media`), never the repo's
  `.data/media`: pass `media` to `buildApp`/`resetDemo`. Resizing is slow under load: the demo
  photo test has 180 s.
- **helmet sets `Cross-Origin-Resource-Policy: same-origin`**: the guest web and staff app on
  other ports (and R2 later) couldn't show `/media` pictures; that route sets `cross-origin`.
- **Run Prettier from the repo root** (19b-2a): from inside `apps/operator` it reformatted the
  generated `tokens.css` (the root's `.prettierignore` didn't apply); a test caught it, and
  `pnpm --filter @okapigo/operator tokens` makes it again.
- **The WhatsApp paying tests (`whatsapp-paying.test.js`) fail in most full runs now** (under
  load), and pass alone every time. Worth finding the race (19b-2a).
- **Rebuild the guest web, then restart any API serving it** (19b-2b): the running API keeps
  the old build's file names and pages fall back to their no-JavaScript version.
- **Other sessions' working copies live in `.claude/worktrees/`** inside the repo: Prettier
  ignores them now (`.prettierignore`); don't format or lint them.
- **Tests that pick "the 4th date"** break near a month's end, when a month's tab holds fewer
  (19c-1: the widget's "Book now" journey). Pick the first or the last.
- **An accessible name trims each part's edges, and Chrome spaces flex items**: put spaces
  outside visually hidden text, and punctuation inside the item it follows (19c-1).
- Throwing inside a Prisma transaction rolls back everything in it: keep a record (e.g. a cash
  report) by committing first, then raising the conflict.

## 9. Changelog (newest first)

- 2026-11-26 · 19c-1 Accessibility checks on every guest page (WCAG 2.1 AA, axe).
- 2026-11-26 · 19b-2b Photos and the logo where guests see them (19b done).
- 2026-11-23 · 19b-2a Photos and the logo in the staff app.
- 2026-11-23 · 19b-1 Uploads, the server side: photos and logo, 3 photos to go on sale, the demo's photos.
- 2026-11-23 · 19a-2 The nightly demo reset; demo businesses never send.
- 2026-11-23 · 19a-1 The demo's history.
- 2026-11-23 · 18c The dashboard; journey 8 (session 18 done).
- 2026-11-23 · 18b Posters.
- 2026-11-23 · 18a-2 The companion on the trip page and in the inbox; journey 7.
- 2026-11-22 · 18a-1 The AI companion's server side.
- 2026-11-22 · 17d-2 Sojourna's back office; journey 3 (session 17 done).
- 2026-11-21 · 17d-1 Sojourna, the guest side (OCTO content and pickups).
- 2026-11-21 · 17c-3 "via Sojourna" everywhere; the Trip page link.
- 2026-11-21 · 17c-2 Settings › Channels (designs arrive; Sojourna).
- 2026-11-21 · 17c channel manager (server side).
- 2026-11-21 · 17b OCTO bookings.
- 2026-11-21 · 17a OCTO catalogue (session 17 begins).
- 2026-11-21 · 16e-4c Tours: Extras, pickups, cancellation and deposit (Settings done).
- 2026-11-21 · 16e-4b Tours: Prices, Schedule and seats.
- 2026-11-21 · 16e-4a Settings › Tours: list, New tour, Basics.
- 2026-11-21 · 16e-3 settings: Staff and roles.
- 2026-11-21 · 16e-2 settings: Messages and WhatsApp.
- 2026-11-21 · 16e-1 settings menu, Website, Embed.
- 2026-11-21 · 16d-3 inbox alerts (inbox done).
- 2026-11-21 · 16d-2 requests and moving dates.
- 2026-11-21 · 16d-1 inbox chats.
- 2026-11-21 · 16c-3 change travellers (bookings desk done).
- 2026-11-21 · 16c-2 desk money: links, cancel + refund, cash confirm, bank-transfer refunds.
- 2026-11-20 · 16c-1 bookings desk: find, a booking's page, notes, holds, desk no-shows.
- 2026-11-20 · 16b schedule (O6) and a departure (O7): transport, sales capped at the van, cancel with refunds.
- 2026-11-20 · this log created.
- 2026-11-20 · 16a manager's shell and Today (`07b04c9`); 44 leftover test businesses deleted from dev.
- 2026-11-20 · tests isolated (`21ad517`).
- 2026-11-19 · 15a–15d (operator app, guide side; journey 6).
- 2026-11-19 · 14a–14c messages; operator app brief.
- 2026-11-18/19 · 12a–12h-2 guest web; 13a–13c-3 WhatsApp.
- 2026-11-17 · 10a–10e payments; 11a–11e public API; guest-web briefs and designs v1.
- 2026-11-16 · sessions 1–9.
