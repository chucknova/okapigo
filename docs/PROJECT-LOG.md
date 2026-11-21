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
| 3       | OTA booking via OCTO                   | not yet (17d)                                 |
| 4       | cancel yourself from the trip page     | `journey-4-cancel-yourself.spec.js`           |
| 5       | deposit, then the balance by link      | `journey-5-deposit-then-balance.spec.js`      |
| 6       | a guide checks in offline, then syncs  | `journey-6-guide-offline.spec.js`             |
| 7, 8    | AI companion; posters/dashboard        | not yet                                       |
| —       | the booking widget (4 cases)           | `widget-embed.spec.js`                        |

## 5. What's built, session by session

| Session / stage | What                                                                                                                                                                                   | Commit              | Note           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------- |
| 1               | monorepo, Docker (Postgres, Redis), Express + `/health`, CI                                                                                                                            | `36aff2e`           | 01             |
| 2               | Prisma schema: operators, roles, staff; Ìrìn seed                                                                                                                                      | `f9a4d66`           | 02             |
| 3               | one-time-code sign-in, sessions (30 days), roles and permissions                                                                                                                       | `0e244ab`           | 03             |
| 4               | catalogue: products, price categories, add-ons                                                                                                                                         | `ef3724f`           | 04             |
| 5               | schedules → departures, time zones                                                                                                                                                     | `2e486e1`           | 05             |
| 6               | pricing pipeline (kobo integers, VAT 7.5% included)                                                                                                                                    | `7c37760`           | 06             |
| 7               | holds with row locks, BullMQ expiry, no double-selling                                                                                                                                 | `e6840e3`           | 07             |
| 8               | bookings: state machine, travellers, timeline                                                                                                                                          | `339c395`           | 08             |
| 9               | versioned cancellation policies, cancel, no-show, departure cancel                                                                                                                     | `eb25fb7`           | 09             |
| 10a–10e         | ledger (double-entry); payments + Paystack; webhooks; transfers + payment links; refunds + reconciliation                                                                              | `caf0bdb`…`e7e1899` | 10a–10e        |
| 11a–11e         | public catalogue; public checkout + guest links + rate limits; deposits; balance reminders + staff alerts; share pages                                                                 | `9dd7834`…`498eb92` | 11a–11e        |
| 12a–12h-2       | guest web from the designs: tokens; catalogue/tour page + share card; checkout; after paying; trip hub (+ cancel, ask); website styles; operator site; booking widget                  | `74cdb67`…`5033a5a` | 12a–12h2       |
| 13a–13c-3       | WhatsApp booking engine; paying + staff take-over; as designed; simulator app; real Cloud API                                                                                          | `bb6b05d`…`2c62364` | 13a–13c-3      |
| 14a–14c         | guest messages (templates, outbox); emails (Mailpit/Resend); WhatsApp templates                                                                                                        | `f9a9919`…`6cfde28` | 14a–14c        |
| brief 07        | the operator app's flow brief, with the user's decisions                                                                                                                               | `56e4f17`           | —              |
| 15a             | vans/boats, assigning guides (exclusion constraints), manifest + print, check-in, no-show                                                                                              | `2fc4d0f`           | 15a            |
| 15b             | sync API: offline package (ticket fingerprints), outbox once-only, conflicts, 72 h                                                                                                     | `565205e`           | 15b            |
| 15c-1           | operator app: PWA at /app/, sign-in, first run, strip, tabs, IndexedDB, outbox, Sync                                                                                                   | `b5224da`           | 15c-1          |
| 15c-2           | manifest (O3): states, names, two kinds of no-show, money owed, search, PDF                                                                                                            | `cc016eb`           | 15c-2          |
| 15c-3           | Scan (O4): camera (BarcodeDetector / jsQR), every result, search, Undo                                                                                                                 | `ae37bb7`           | 15c-3          |
| 15c-4           | money on the day (payment QR, cash reports), pickup stops, A4 printed manifest                                                                                                         | `862aa7f`           | 15c-4          |
| 15d             | journey 6 end to end, network off                                                                                                                                                      | `5bbb9ea`           | 15d            |
| —               | tests get their own databases and queues                                                                                                                                               | `21ad517`           | test-isolation |
| 16a             | manager's shell (tabs/sidebar by role), staff states, manager's Today                                                                                                                  | `07b04c9`           | 16a            |
| 16b             | schedule (O6), a departure (O7): assign guides and vans (tour transport, sales capped at the van), notes, cancel with refunds                                                          | `d293b30`           | 16b            |
| 16c-1           | bookings desk: search and filters, a booking's page in every status, notes (on the manifest too), release held seats, desk no-shows                                                    | `bf4d0d7`           | 16c-1          |
| 16c-2           | desk money: payment links (send or copy), cancel with the refund started, confirm a guide's cash (or not), retry or bank-transfer refunds; Cash and Bank accounts                      | `9c97f5a`           | 16c-2          |
| 16c-3           | desk: change travellers (− and +, the booked price, seats, extra → link, fewer → the policy's refund confirmed)                                                                        | `105242e`           | 16c-3          |
| 16d-1           | inbox chats: needs a person / with the bot, one person at a time, take over from a colleague, 24-hour rule + follow-up template, failed → retry or email                               | `a18ebab`           | 16d-1          |
| 16d-2           | requests: reply (WhatsApp + email, on the trip page), mark answered, Done; moving a booking's date; "Date changed" message                                                             | `1daa498`           | 16d-2          |
| 16d-3           | inbox alerts: worked out live (cash, refunds, balances, departures without a guide), clearing by themselves; Done this week; who assigned a guide                                      | `0506dbf`           | 16d-3          |
| 16e-1           | settings menu, save bar + leave guard + form errors, Website (style preview/apply, business details), Embed (snippet, approved sites, live preview)                                    | `72fadc7`           | 16e-1          |
| 16e-2           | settings: Messages (list, editor with details at the cursor, must-keep, real-booking preview, test send, back to default) and WhatsApp (state in words, ID, webhook, test, disconnect) | `f60623f`           | 16e-2          |
| 16e-3           | settings: Staff and roles (the team in words, invite by email or words to copy, resend, edit, at least one owner, remove: signed out, departures freed, chats back)                    | `b9781ed`           | 16e-3          |
| 16e-4a          | settings › Tours: the list (schedule in words), New tour, Basics (transport, arrive by, text lists), the map pin pasted, on sale or not                                                | `4872ff2`           | 16e-4a         |
| 16e-4b          | Tours: Prices (all at once; "existing bookings keep their price"), Schedule and seats (booked departures it leaves, listed), one-offs; one save bar per tour                           | `9b6483e`           | 16e-4b         |
| 16e-4c          | Tours: Extras (all at once), pickup points, cancellation policy (one line each), deposit, holds line. **Settings done**                                                                | `8ee0e0f`           | 16e-4c         |
| 17a             | OCTO catalogue: supplier, products (units, cutoff), availability and calendar, prices with the OTA's net; channel keys (hashed); contract tests; brief 08                              | `035902a`           | 17a            |
| 17b             | OCTO bookings: reserve, confirm, cancel (policy until the start), extend, look up; the OTA's payment and sale in the ledger; no messages to OTA guests; no oversell across channels    | (this commit)       | 17b            |

**Still to come** (numbering decided 2026-11-21: OCTO is session 17, AI 18, the demo 19):

| Next    | What                                                                                                     | PRD                       |
| ------- | -------------------------------------------------------------------------------------------------------- | ------------------------- |
| ~~16b~~ | Schedule (O6) and a departure (O7): assign guides and vans, cancel for weather                           | OPS-01                    |
| ~~16c~~ | bookings desk (O8) in three parts: ~~16c-1~~ find and read; ~~16c-2~~ money; ~~16c-3~~ change travellers | —                         |
| ~~16d~~ | inbox (O9): chats (take over), requests, alerts                                                          | —                         |
| ~~16e~~ | settings (O10): website, embed, messages, WhatsApp, staff, tours                                         | —                         |
| **17**  | OCTO in four parts: ~~17a~~ catalogue; ~~17b~~ bookings; 17c channel manager; 17d mock OTA (journey 3)   | DST-01–03                 |
| 18      | AI companion, posters, dashboard (journeys 7, 8)                                                         | GST-16, MKT-01/02, RPT-01 |
| 19      | full seed, demo reset, uploads (photos, logo), a11y checks, README, deploy                               | step 10                   |

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

## 7. Where we are

- **Last done:** 17b, OCTO bookings. 17a pushed.
- **Next:** **17c**, the channel manager: Settings › Channels (your design, brief 08: connect a
  channel and see its key once, tours on it, commission, its sales and what it owes, a new key,
  switch off), "via Mock OTA" on bookings, and the 60-second webhook that tells connected OTAs
  when seats or prices change. Waiting on you: the designs for brief 08 (O11 and M1–M5) and
  the mock OTA's name.
- **Your dev database** has no OTA channel until you run `pnpm db:reset` (the seed adds the
  Mock OTA with all five tours).
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
- **Order ties are random**: rows with the same `sortOrder` and the same `createdAt` (seeded in
  one go) come back in id order, which is random. A full run caught archived prices tying with
  active ones (16e-4b); they now sort after them. Give every sorted row its own place.
- Throwing inside a Prisma transaction rolls back everything in it: keep a record (e.g. a cash
  report) by committing first, then raising the conflict.

## 9. Changelog (newest first)

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
