# Stage 15c-3: Scan (O4)

Checking guests in by their ticket's QR code, with or without signal, from your designs
(O4 Scan, O4 Scan — problem states, Search and check-in).

| Stage     | What                                                                |
| --------- | ------------------------------------------------------------------- |
| 15c-1     | the app, sign-in, first run, strip, tabs, saved package, Sync       |
| 15c-2     | the manifest: states, names, no-shows, money owed, search, PDF      |
| **15c-3** | **Scan: the camera, every result, search instead, no camera, Undo** |
| 15c-4     | money on the day (QR, cash), pickup stops, the A4 printed manifest  |

## 1. What we built

| Piece                                                   | Where                                |
| ------------------------------------------------------- | ------------------------------------ |
| The screen (camera, sheets, search, no camera)          | `apps/operator/src/screens/Scan.jsx` |
| What a ticket means, the words for each problem, search | `src/lib/scan.js`                    |
| The camera, reading QR codes, the torch, the buzz       | `src/lib/camera.js`                  |
| A QR reader for iPhones                                 | `jsqr` 1.4.0 (new dependency)        |

Open it from the Scan tab (today's departure under way, else the next) or from a manifest's
**Scan a ticket** (that departure).

## 2. Checking a ticket with no signal

The QR holds a signed code (12f). The phone can't check the signature (that needs the
server's secret, which a phone must never hold), and it doesn't hold the codes either: the
package has each ticket's **fingerprint** (15b). So:

```
camera → "OKG1…" → SHA-256 (the browser's own crypto) → look it up in the saved package
```

A fingerprint that's in the package was made by the server, so the ticket is real. The
lookup decides everything, in the designs' words:

| Found                                   | Says                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------ |
| this trip, someone still to come        | **Ticket OK**: everyone still to come ticked                             |
| this trip, everyone in                  | **Already checked in** at 06:52: names. Nothing changed.                 |
| another saved trip                      | **Not this trip**: the Heritage Walk, Sat 5 Dec, 09:00, at Tinubu Square |
| cancelled (or refunded)                 | **Cancelled: don’t check in** · Call the office                          |
| a whole-booking no-show / not confirmed | ask the office                                                           |
| looks like ours, not saved here         | **Not on your saved trips** (another day, or another guide’s)            |
| not ours at all                         | **Not an Ìrìn Lagos Tours ticket** · Search by name                      |

"Looks like ours" is the code's **shape** (`OKG1` and 38 characters), which needs no secret.

## 3. Reading the QR code

Chrome on Android has a QR reader built in (`BarcodeDetector`); iPhones don't. There the app
draws each camera frame onto a hidden canvas, shrunk to 640 px wide, and reads it with
**jsQR**. jsQR is a separate 47 KB file, **loaded only when needed**, and it's in the
service worker's list (15c-1), so iPhones scan offline too.

Four reads a second. The same ticket still in view isn't read again (it would pop up the
sheet over and over); once it's gone for 3 seconds, it can be.

**The torch** shows only where the phone offers one (Android Chrome). **The buzz**: once
on a good scan, twice on a problem.

## 4. After a check-in

"Check in 3" (or "Check in 2 of 3" with someone unticked) records **one change** in the
outbox, like the manifest's taps. Back on the camera:

> ✓ **2 checked in** · Okafor · Kamsi not yet [Undo]

**Undo** records the opposite change (the same people back to "Not yet"). It works until the
next scan, and the note goes after 6 seconds. Scanning the same ticket again when Kamsi
arrives ticks only Kamsi.

## 5. Search instead, and no camera

**Search by name or reference**: every traveller it matches, with the matched letters marked
(accents ignored: "irin" marks "Ìrìn"); a reference or the last digits of a phone finds the
lead. Tapping a name opens the same "Ticket OK" sheet. "nwos" also finds "Guest 2 of Emeka
Nwosu’s booking": they're in his party.

**No camera permission**: how to allow it (the lock or ⓘ by the address bar, or the phone's
Settings), Try again, or Search by name instead.

## 6. Where I followed the designs loosely

- **Neutral words** again: "They still owe ₦45,500" (the design: "She"). The QR and cash
  buttons come in 15c-4; for now, "Check in, still owing" or "Not now".
- **"Not on your saved trips"** is new: a real ticket for a trip this phone doesn't have
  (tomorrow's colleague's tour, say). Offline the phone can't say more.
- **"Checked in at 06:52 on this phone"**: the phone doesn't know which phone did it, so it
  says "Checked in at 06:52".

## 7. Checked in a real browser

Chrome at phone size, with a **fake camera** playing a video of a real ticket's QR (one of
Kemi's Street Food Crawl bookings, made with the app's own code and secret), **offline**: the
built-in reader read it, the phone matched it: "Ticket OK · ILT-MAD0KA · this departure";
"Check in 2"; "2 checked in · …" with Undo. The browser closed while still offline, so nothing
reached your dev database. (iPhones' jsQR path is covered by the build and the tests, not
by a real iPhone yet: worth a try on yours.)

Fixed along the way: a scan's sheet could be found before it had opened (it now opens in the
same step it's drawn, and each result gets a fresh sheet); the bottom of the scanner got a
dark fade, so its words read over the camera picture.

## 8. Checks

69 tests in the app (17 new: the scan logic and screen with a fake camera). 12 mutation
checks (another trip, refunded, already in, the ticket's shape, "was due", Undo's `seen`, the
note's "not yet", today's next departure, search by reference and without cancelled bookings,
Undo until the next scan, money asked first), all caught; one survived at first (Undo ending
at the next scan) and got its test.

Full runs: three; the second and third all green. The first failed one WhatsApp test, the
known clash with your `pnpm dev` API (it sent the test's "payment didn't go through" notice
first; no API code changed in this stage).

Browser journeys: the first run failed 5 of 8, three of them stopped at the 1.5-minute limit
(5.5 minutes in all); journey 1 alone then passed, and the next full run passed all 8. These
journeys don't touch the operator app; nothing they use changed in this stage. The likely
cause is the same machine-wide slowness (the full test runs had just finished alongside your
`pnpm dev`), but I didn't capture the run's details, so that's a guess.

## 9. Concepts to study

- **Camera access in the browser**: `getUserMedia`, permissions, `facingMode`
- **Feature detection and fallbacks**: `BarcodeDetector` vs a JavaScript decoder
- **Code splitting**: loading a library only when needed (`import()`)
- **Hashing to look things up** without holding the secret (or the codes)
