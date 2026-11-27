# Stage 19d: the README and the demo script

| Part    | What                                                           |
| ------- | -------------------------------------------------------------- |
| 19c     | Accessibility checks, the staff app's split, landmarks (done)  |
| **19d** | **The README rewritten, screenshots, a 15-minute demo script** |
| 19e     | Deploy (December 2026)                                         |

The README still said "session 10 complete". It's the first page anyone opens: a recruiter, a
tour operator, or you in six months. This stage makes it say what OkapiGo is now, and adds a
script for showing it.

## 1. The README

- **What it is in three sentences**, then **screenshots of the real app** with the demo data:
  four guest screens (website, tour page, checkout, trip page) and three for the office
  (Today, Schedule, Dashboard).
- **What it does**, for guests, for staff, and underneath (no double-selling, the ledger,
  OCTO, accessibility). Every claim was checked against the code. For example, demo businesses
  keep their emails without sending them, so Mailpit shows nothing for Ìrìn, and the README
  says so.
- **Run it locally**: five commands, a table of what to open on which port, the staff to sign
  in as (names checked against the seed), payments, and the AI companion.
- **How it's built**, **Testing** (the eight journeys in words) and **honest limits**: not
  deployed, test money only, codes in the log, WhatsApp needs Meta's approval, Sojourna is a
  mock, photos on local disk, one country, fictional data, and the late-day reset.

## 2. The screenshots

- Taken by a script against **a throwaway copy of the demo business** in the e2e database,
  served by my own API on :4300, never your dev data. It was deleted afterwards.
- **The first try had an empty Today.** The reset ran at 20:48, so "today" started at 20:48 and
  the day's earlier departures were never made. The script was reset again as if at 04:00
  Lagos time (when the nightly reset runs), and Today filled up. This is the same late-day
  limit that's in the README.
- **Two left out:** the inbox (no chats in a fresh reset) and posters (the poster showed the
  throwaway business's address).
- **Made small:** PNG → JPEG at quality 72 (macOS `sips`). The phone shots were scaled to 520 px
  wide. 870 kB for all seven.

## 3. The demo script (`docs/demo-script.md`)

Eight parts in about 15 minutes, each with what to click and one line to say. Then **I walked
it once** on a fresh copy of the demo (API, worker and Sojourna on my own ports) and fixed what
the script got wrong:

| The script said                | The app does                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| Details: a name and an email   | also each traveller's name and age ("I'm travelling too" for the person booking)    |
| Pay                            | step 4 is "Review and pay", then the simulator's page                               |
| Bookings: search for the guest | the list starts on **today's** bookings: choose **Upcoming** first                  |
| The bot sends a link           | it sums up, holds the seats for 30 minutes, and sends the link when you tap **Pay** |

Walked: the website booking, the trip page and the companion (an answer from the notes, and a
question passed to the team), WhatsApp with a payment link, Today's three "Needs you" cards,
replying to the question (the reply appeared on the trip page), the desk, Sojourna's tours,
posters, and the dashboard (the walk's two bookings counted in "money in today"). **Not
walked:** the guide offline (the browser pane has no service workers; journey 6 covers it).

## 4. Found on the walk, not fixed here

These are small wording bugs, kept apart from a docs stage:

1. **Checkout says "Free cancellation until Fri 27 Nov, 09:00" after that time has passed**
   (a Sunday booking made on Friday evening). The trip page gets it right ("50% back").
2. **The staff app's first run:** "You have no departures today or tomorrow. good until …"
   has a lowercase "good" after a full stop.
3. **The inbox's answered line** says "replied by WhatsApp and email" even when the guest gave
   only an email.

## 5. Checks

- Every link in the README and the script points to a file that exists. Lint and Prettier
  pass.
- **No code changed**, so the tests weren't re-run: the last full runs and all 15 e2e tests
  passed at 19c-3 (`4944a55`).

## 6. Concepts to study

- **A README as a product page**: what it is, a picture, how to run it, its limits.
- **Demo data that tells a story**, and why the time it's made matters.
- **Image compression**: PNG for drawings, JPEG for photos and screenshots, and pixel density
  (a 2× screenshot shown at half its width).
