# Stage 15d: Journey 6, the guide offline, end to end

PRD journey 6: _"a guide signs in, checks in a full departure while offline, marks a
no-show, then reconnects and everything syncs."_ Now a browser test of the whole system: the
built operator app, served by the real API, in Chrome set up as a Pixel 7, with the network
cut. This closes session 15.

| Stage   | What                                                                  |
| ------- | --------------------------------------------------------------------- |
| 15a–15b | the server: resources, manifest, check-in; the sync API               |
| 15c-1…4 | the operator app: shell and Sync; manifest; Scan; money, stops, print |
| **15d** | **journey 6, end to end with the network off**                        |

## 1. The journey

`apps/web/e2e/journey-6-guide-offline.spec.js`. First the day is set up as the office and
guests would have it: the Heritage Walk, started 10 minutes ago, with Femi as its guide.

| Booking              | Set up as                   | On the day (offline)                                    |
| -------------------- | --------------------------- | ------------------------------------------------------- |
| A · Adaeze, 2 guests | booked and paid on the site | **scanned**: a fake camera plays their ticket's real QR |
| B · Emeka, 3 guests  | paid; guest 2 has no name   | **named** "Obinna Nwosu" at check-in; the others tapped |
| C · Funmi, 1 guest   | booked by the office, owes  | **"They paid me cash"**                                 |
| D · Tola, 1 guest    | paid                        | doesn't come: **"Mark no-show?"**, with the policy      |

Then, in order:

1. **Sign in** through the real screens (email → code). The test plays Femi's inbox: it puts
   in a code it knows, made the way the server makes them.
2. **First run**: "Not now" to installing; "You’re ready for no signal"; the service worker
   has saved the app.
3. **The signal goes.** All four bookings as above. "6 of 7 checked in", "Offline · saved
   …· 8 changes waiting", rows "Not sent yet · 07:08".
4. **The app is opened again, with no network at all**: it opens (the service worker),
   everything's still there (IndexedDB), Sync lists the 8 waiting ("Guest 2 → Obinna Nwosu").
   The server has received nothing.
5. **Signal back**: the outbox sends itself; "Everything is sent", "Online · up to date".
6. **On the server**: 8 changes, each applied once, each at the time it was made; every
   traveller as the guide left them, checked in by Femi; Tola's booking a no-show (with the
   policy); Funmi's cash reported, **not** paid.

## 2. Does the journey really test "offline"?

Two deliberate breakages, each run through the journey:

- the service worker not answering from its saved copy → the journey fails at step 4 (the app
  doesn't open offline)
- the outbox not saved to the phone → the journey fails at step 4 (the changes are gone after
  reopening)

Both caught. Journey 6 passed 5 of 5 runs on its own, and in the full browser run.

## 3. Set-up for the browser tests

- `pnpm --filter @okapigo/web e2e` now builds the operator app too; the e2e API serves it at
  `/app/` as in production.
- The fake camera: Chrome plays a video file instead of a real camera
  (`--use-file-for-fake-video-capture`). The test writes that video: the ticket's QR (drawn
  with `uqr`, now a test-only dependency of the web package) on a grey background.

## 4. Found along the way: tests on a busy machine

The full test runs got slow (the machine's load average went to 25–45: Docker's database,
your editor, Chrome and the suites themselves). Different screen tests ran out of time on
different runs. For the operator app:

- screen tests wait up to 10 s for something to appear (was 4 s) and a test may take a minute
  (was 20 s); the scan test was seen running past 20 s while correct
- the scanner's 6-second Undo note can be lengthened **by tests only** (`SCAN_TIMING`), and the
  test taps Undo as soon as the note appears

The app itself didn't change.

## 5. Checks

Journey 6: 5 of 5 alone; the full browser run 8 of 9, journey 2 failing as before (your
`pnpm dev` API answers its ticket from the shared database, 15c-4).

Full runs: **not two clean ones.** Seven runs this stage, at load 11–45. After the time-limit
changes, the operator app's tests passed in both runs; the two runs still each had one
failure, in the simulator's and the guest web's screen tests (unchanged code, each passing
alone). Earlier runs also hit the workers' queue test (your dev worker shares Redis) and a
guest-web timer test. Nothing in this stage touches those.

What would fix it for good: the tests with their own database and queues (the follow-up from
14c), and perhaps not running every package's tests at once on this machine.

## 6. Session 15 is done

The operator app's guide side, from your designs: sign-in, first run, Today, the manifest,
Scan, money on the day, pickup stops, the printed manifest, Sync and conflicts, all working
with no signal for 72 hours. Next, session 16: the manager's screens (schedule, bookings
desk with cash confirmation, inboxes, settings: O6–O10).

## 7. Concepts to study

- **End-to-end tests** that cut the network (`context.setOffline`), and fake devices
- **Testing the test**: breaking the thing on purpose to check a test notices
- **Flaky tests**: timing, shared state, load; telling them apart from real failures
