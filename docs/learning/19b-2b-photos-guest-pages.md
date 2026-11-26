# Stage 19b-2b: photos and the logo where guests see them

| Part       | What                                                                           |
| ---------- | ------------------------------------------------------------------------------ |
| 19b-1      | Uploads, the server side; 3 photos to go on sale; the demo's photos            |
| 19b-2a     | The staff app: a tour's Photos, New tour with photos, the logo and hero        |
| **19b-2b** | **What guests see: the website, tour pages, the trip page, posters, previews** |

**Designs:** U4 (the website), U5 (a tour page, the trip page), U6 (a poster, the link preview)
on the session 18 canvas, page "19b · Photos and logo".

## 1. Where photos now show

| Where                           | What                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Every guest header**          | The logo (its 128 px copy) beside the name; no logo: the first letter, as before. One `Mark` component for all of them (website, tour page, checkout, trip, payment link) |
| **The website**                 | The hero photo under the words on a phone, beside them on a desk, its credit under it; each tour card with its cover (the 640 px copy, loaded as it scrolls into view)    |
| **The website's footer**        | "Photo credits: …": everyone whose photo is on the page, each once (the cards carry no credit of their own)                                                               |
| **A tour page**                 | Its photos swipe, on phones too; "1 of 3", Previous / Next; the shown photo's credit under it. None: the pattern band (desk), as before                                   |
| **The trip page**               | The tour's cover, short, above "Your trip", with its credit                                                                                                               |
| **Posters**                     | The logo for the letter on all four; the cover in Seats left's panel and Offer's circle, "Photo: …" small at the foot                                                     |
| **Link previews** (WhatsApp, X) | The logo; a tour's cover (or the website's hero) filling the right 500 px, its credit on it                                                                               |

**Decided while building** (my call, said here for you to check): New tour and This weekend
posters keep their panels. Those panels carry the route and the weekend's departures, which a
photo would push out.

## 2. How

- **The swipe is the browser's own.** The strip is a row of photos in a box that scrolls
  sideways, with CSS scroll snapping (`scroll-snap-type: x mandatory`): it stops on each photo,
  feels native on a phone, and needs no swipe code. The buttons scroll it for a mouse or a
  keyboard; scrolling updates "2 of 3" (`shownIndex` in `lib/photos.js`).
- **The right size for the screen:** `srcset="…-640.jpg 640w, ….jpg 1600w"` with `sizes` lets
  the browser fetch the 640 px copy on a phone (3G) and the 1600 px one on a big screen. Cards
  and the trip page use the 640 px copy; photos after the first load lazily.
- **Drawn pictures (posters, previews) need bytes, not addresses.** satori draws on the server,
  so `pictureReader` (`apps/api/src/lib/pictures.js`) reads the picture from our storage and
  hands it over as data. **Only our own addresses** (`media.keyOf`): anything else is nothing,
  so a drawing never makes the server fetch something a user typed.
- **Caches stay right.** The card's address and the poster's cache key include the pictures'
  addresses, which are named by their content: a new cover means a new address, and chat apps
  fetch the new preview.
- **The words** ("Photo: …", the footer's list, "1 of 3") are in `apps/web/src/lib/photos.js`;
  the views now carry `operator.logo` (trip page, payment link) and `tour.photo` (trip page).

## 3. Found along the way

- **A dark logo vanished on the dark preview card.** Ìrìn's logo is a dark square; on the
  card's dark background only its dots showed. It now has a thin ring there.
- **satori decodes the pictures it draws**: a test that gave it made-up picture data failed
  ("not correctly encoded"); the tests draw with real small pictures.
- **A photo is drawn cover-cropped**: in the card's SVG, a square test picture is 630 wide and
  centred in the 500 px slot (the clip hides the rest). The test checks its centre.
- **A busy machine** (load 24–29 while another session ran its full test runs): the poster
  route test (two full posters) took over 20 s and now has 60 s.
- **A grid stretches its items**: the hero's button filled the whole column on a desk once
  the hero became two columns (found by screenshot).
- **Rebuilding the guest web under a running API** left the API pointing at the old build's
  file names, so pages fell back to their no-JavaScript version. Restart the API after a build.
- **Prettier from the root looked into another session's working copy** (`.claude/worktrees/`
  inside the repo). It's now in `.prettierignore`.

## 4. Checks

- `apps/api/test/guest-photos.test.js` (11):
  - `pictureReader`: our own pictures as data (JPEG and PNG); another site, a missing file,
    nothing
  - the trip page (the logo and the cover with its credit), a payment link (the logo), no
    logo (null)
  - posters: Seats left (the logo, the cover, its credit; full width when tall), Offer (the
    circle; no credit when the photo has none), New tour and This weekend unchanged, nothing
    without pictures; the route draws them from storage and the maker learns which tours
    have a photo
  - the link card: the photo cover-cropped into the right 500 px and the logo; without them,
    as before; a new cover or hero gives the card a new address
- `apps/web/test/photos.test.jsx` (7): the words (credits, the footer's list once each, "1 of
  3", srcset, which photo is showing); the website (logo, hero and credit, card covers lazy at
  640 px, the footer's credits; none of them); a tour page (swipe, Next/Previous, the shown
  photo's credit, scrolling moves the count; one photo; none).
- `apps/web/test/trip-hub.test.jsx` (+2): the cover and its credit, the logo; none.
- `apps/operator/test/photos.test.js` (+1): the poster maker's photo line.
- **Mutation checks:** 31 changes; 30 caught. The survivor was `pictureReader`'s own "not our
  address" check: storage's `get` already refuses anything that isn't one of our keys, so no
  test could tell them apart. Simplified to one check, per the rule.
- **Full runs** (a busy machine: Chrome, WPS Office and Docker, load 21–32):
  - Run 1 (two packages at a time): everything passed except the API package, where 16 tests
    in 9 files timed out (20–68 s each). Those 9 files passed alone: 116 tests.
  - Run 2 (one package at a time): passed except one refunds test, which timed out at load 28
    and passed alone (12 of 12). **1,906 tests.**
- **E2E:** 11 of 12 in the full run; the widget's "Book now" journey timed out at 90 s and
  passed alone in 7.6 s.
- **Screenshots of the built guest pages** (headless Chrome, my API on :4300, the e2e
  database, a throwaway business with the demo's photos, deleted afterwards): the website on
  desk and phone, its footer's credits, a tour page on desk and phone (and its second photo),
  the link card, the trip page on a phone. They caught one thing: on a desk, "See tours and
  dates" stretched across the column once the hero became a grid; it keeps its own width now.

## 5. Concepts to study

- **CSS scroll snapping**: swipeable galleries without JavaScript.
- **Responsive images**: `srcset` with `w` descriptors and `sizes`.
- **Lazy loading**: `loading="lazy"` and what loads first.
- **Image attribution**: where Creative Commons credits must appear, and a page-level credits list.
