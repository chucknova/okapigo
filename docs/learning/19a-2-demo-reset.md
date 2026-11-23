# Stage 19a-2: the nightly demo reset, and demo businesses that never send

| Part      | What                                                          |
| --------- | ------------------------------------------------------------- |
| 19a-1     | The demo's history                                            |
| **19a-2** | **The nightly reset; a demo business's messages never leave** |
| 19b–19d   | Uploads; accessibility and polish; README and demo script     |
| 19e       | Deploy (December)                                             |

PRD, "Hosting and demo operations": _"A scheduled job wipes the demo operator and reseeds it,
moving all schedules forward so dates are always current."_

**Decided (2026-11-23):**

- **"Try it" visitor copies are left out for now.** For when they come back: a visitor gets
  the owner's side and the guest side, and their copy has a "Reset my copy" button. The public
  demo itself resets only at night, so no visitor can wipe it for others.
- **Demo businesses never send for real.**
- **Deploy waits until December**, so the reset is built and checked locally.

## 1. The reset

`resetDemo(prisma, { slug, now })` (`packages/db/src/seed/reset.js`):

1. **Deletes** the business with that slug. Everything under it goes too: bookings, ledger,
   chats, sessions (the schema's cascades).
2. **Makes it again** with `seedDemoOperator({ demo: true })`: the tours, staff, schedules from
   today, and the Sojourna key.
3. **Writes its history** (19a-1), dated from `now`: the calendar moves forward every night.

About 4 seconds.

**Who runs it:**

| How               | When                                                          | Safety                                                            |
| ----------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| the workers app   | every night at **04:00 Lagos**, **only with `DEMO_RESET=on`** | **never touches a business that isn't a demo one** (`onlyIfDemo`) |
| `pnpm demo:reset` | when **you** run it                                           | it wipes that business: yours to run                              |

- **Off by default.** Without `DEMO_RESET=on` the workers don't schedule it, and they **remove**
  any old timetable entry, so turning it off really stops it.
- **Never a real business.** Even switched on, the job leaves alone any business with the
  demo's slug that isn't marked demo. Only `pnpm demo:reset`, run by a person, turns a business
  into the demo. That's how the deployed demo starts in December.
- **`DEMO_SLUG`** picks the business (default `irin-lagos-tours`).

## 2. A demo business never sends for real

A new flag on businesses, **`is_demo`** (a migration; false for everything else, your dev seed
included). For a demo business, `sendGuestMessages` (`apps/api/src/messages/send.js`):

- **WhatsApp:** always the **simulator**. That holds even when the server and the business
  are connected to real WhatsApp, and even for a guest who once wrote on real WhatsApp.
  Made-up numbers can never reach a real person.
- **Email:** **kept, never sent**. The message is marked sent and its data says "kept, not
  sent: a demo business". Its guests are made up, and the `.example` addresses go nowhere
  anyway.

**Your own businesses send exactly as before** (your dev seed isn't a demo one).

## 3. Checks

- `packages/db/test/reset.test.js` (5):
  - the first time: a demo business with its history
  - the next night: the old copy and everything under it gone, a new one dated from the new day
  - the job never touches a business that isn't a demo one; by hand it may
  - the job resets a demo business, and makes one where there was none
  - your own seed is never a demo one
- `apps/api/test/whatsapp-templates.test.js` (+1): a demo business never writes on real
  WhatsApp, even connected, even after the guest wrote there; the simulator only.
- `apps/api/test/guest-emails.test.js` (+1): a demo business's emails are kept, not sent.
- **Mutation checks:** 8 changes (the guard's three parts, the email skip, the job's safety,
  the delete, the demo mark, the seed's flag); all caught.
- **Live check of the workers** (the e2e database, private queue names, a throwaway slug):
  - with `DEMO_RESET=on`: `reset-demo` on the timetable for 04:00 Lagos, next run
    2026-11-24 03:00 UTC
  - added once by hand: "demo reset: wiped and made again", 155 past and 21 upcoming
    bookings, 3.8 s, the business marked demo
  - restarted without the switch: the timetable entry gone
  - (its first try failed: the e2e database hadn't been migrated yet; it is at each e2e run)
- **Full runs:** run 1 passed in full (1,808 tests). The first run 2 had the ledger's race
  test fail, only with every package running at once; it passed alone three times and in its
  package twice. Run 2 again passed in full.
- **E2E:** all 12 journeys pass.

## 4. For deploy (December)

- Set `DEMO_RESET=on` on the workers service, then run `pnpm demo:reset` once to make the demo.
- **Sojourna keeps its own list of bookings** (a file). After a reset, its back office still
  lists the old ones, which OkapiGo no longer has. It should be cleared with each reset too:
  to do at deploy, when Sojourna gets its own service.

## 5. Concepts to study

- **Scheduled jobs**: cron patterns with a time zone, and why "upsert or remove" on start.
- **Fail-safe defaults**: destructive jobs off unless switched on, and a second check inside.
- **Sandboxing outbound side effects**: a flag that routes messages to a simulator.
