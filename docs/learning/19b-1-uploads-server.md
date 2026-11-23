# Stage 19b-1: uploads, the server side (photos, logo, 3 photos to go on sale)

| Part      | What                                                                   |
| --------- | ---------------------------------------------------------------------- |
| 19a       | The demo's history; the nightly reset                                  |
| **19b-1** | **Uploads, the server side: storage, the rules, the demo's photos**    |
| 19b-2     | The screens: Settings, a tour's Photos, New tour, guest pages, posters |
| 19c–19e   | Accessibility and polish; README and demo script; deploy (December)    |

**Designs:** U1–U8 on the session 18 canvas, page "19b · Photos and logo".

**Decided (2026-11-23):**

- **Photos come at the start:** New tour asks for them, and a tour needs **at least 3 photos to
  go on sale** (the first is the cover). A draft can be made with none.
- Tours **already on sale** with fewer keep selling, marked "needs 1 more photo".
- **Removing** a photo below 3 is allowed, after a warning.
- The demo's photos: **openly licensed, from Wikimedia Commons, each OK'd by you**: 18 of them,
  3 or 4 a tour. Ìrìn's logo is one I drew.

## 1. What happens to an upload

```
the file (straight off a phone)
  │  POST /api/uploads/photo   (or /logo)        the body is the file's bytes
  ▼
@okapigo/media  processImage
  1. what is it really? its first bytes ("magic numbers"), never its name or label
  2. JPEG, PNG or WebP; at most 10 MB; at most 60 megapixels; wide enough
  3. sharp: turned the right way up, resized, re-encoded: everything else dropped
  ▼
photo → 1600 px JPEG + 640 px          logo → 512 px PNG + 128 px (transparency kept)
  ▼
storeImage: named by a hash of the result → photos/3f5629c4c847e6cf.jpg (+ -640.jpg)
  ▼
local disk now (.data/media, served at /media)  ·  Cloudflare R2 at deploy
  ▼
201 { picture: { url, small, width, height } }
```

Then **saving** the tour (`PATCH /api/products/:id { photos }`) or the website
(`PATCH /api/website { site: { logo, hero } }`) puts those addresses in, like any other
setting.

**Why re-encode instead of keeping the file as sent?**

| Reason      | What it protects                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Privacy** | A phone photo carries hidden details (EXIF): the camera, the time, often the **GPS position**, maybe the owner's house. A test puts a Lagos position in a photo and checks it's gone. |
| **Safety**  | We only serve files we made. A "picture" hiding something else, or an SVG with a script in it, never reaches a guest's browser. That's also why logos can't be SVG.                   |
| **Speed**   | A 6 MB phone photo becomes about 250 KB, and cards get a 640 px copy (3G).                                                                                                            |

**The words people see** (the server's, so the screens in 19b-2 just show them):

| Sent                    | Said                                                                      |
| ----------------------- | ------------------------------------------------------------------------- |
| a 14 MB photo           | That photo is 14 MB. Use one under 10 MB.                                 |
| a PDF                   | That’s a PDF. Use a JPEG, PNG or WebP picture.                            |
| an iPhone HEIC          | That’s an iPhone HEIC photo. Use a JPEG, PNG or WebP picture.             |
| an SVG                  | SVG files can’t be used: they can carry scripts. Use a PNG or JPEG.       |
| a tiny photo            | That photo is only 64 pixels wide. Use one at least 600 wide.             |
| a file cut off part-way | That photo couldn’t be read: the file may be damaged. Try another copy.   |
| a "decompression bomb"  | That photo is too big in pixels (over 60 megapixels). Use a smaller copy. |

A **decompression bomb** is a small file that decodes into a huge picture: a 100 KB PNG of
8,000 × 8,000 black pixels would need hundreds of megabytes of memory. sharp refuses it before
decoding.

## 2. Only our own pictures

Tours and the website accept **only addresses this server made** (`storage.keyOf(url)`): our
own `/media/` address followed by a name of exactly our shape (`photos/` + 16 hex + `.jpg`).
Anything else is refused: "Upload the picture here: links to pictures on other sites can’t be
used." So a guest's page never loads a picture from somewhere we don't control (a tracking
pixel, a picture swapped later), and nothing can trick the server into reading
`../../.env`.

**Names from the content** (a hash of the finished picture):

- the same picture uploaded twice is stored once;
- the demo's nightly reset stores nothing new (same photos, same names);
- a name never changes what it points to, so browsers may keep a file for a year
  (`Cache-Control: immutable`).

## 3. Going on sale

`@okapigo/shared/ready-to-sell` holds the rule and its words, for the API now and the staff app
in 19b-2:

| Missing       | The API says                                                   |
| ------------- | -------------------------------------------------------------- |
| prices        | Add at least one price before putting it on sale. (as before)  |
| photos (none) | Add 3 photos before putting it on sale.                        |
| photos (2)    | Add 1 more photo before putting it on sale (it has 2 of 3).    |
| both          | Add at least one price and 3 photos before putting it on sale. |

It's checked **only at the moment a tour goes on sale** (draft → published). The old price
check still runs when prices change on a tour that's on sale; photos aren't checked there,
because removing one is allowed. Sending the photos and "on sale" in one save counts the
photos being sent.

## 4. The rest

- **Credits:** a photo has an optional `credit` ("Sho photography, CC BY-SA 4.0"; empty means
  none) and its `small` copy. At most 8 a tour.
- **The website:** `site.logo { url, small }` and `site.hero` (a photo). The logo travels with
  the business's name on every guest page (`operator.logo`); the hero with the website
  (`site.hero`).
- **Who may upload:** whoever may change tours or the website. In the default roles that's the
  owner: managers only look. (The canvas note said "owner and managers": that was wrong.)
- **`media` is a reserved word**, so no business can have the address `/media`.
- **The demo's photos:** `packages/db/src/seed/photos/`, the files, `credits.js` (the source of
  truth) and `CREDITS.md` (the same, for people; a test checks they agree with the folder).
  `seedDemoPhotos()` runs in `pnpm db:seed` and the nightly reset, **through the same
  `storeImage`** as an upload. Not in the tests' quiet businesses: resizing takes seconds.
- **Settings:** `MEDIA_DIR` and `MEDIA_PUBLIC_URL` (both optional, in `.env.example`).
- **Not yet:** pictures uploaded but never saved stay on disk (small, and reused if uploaded
  again). Cleaning them up is a later job.

## 5. Found along the way

- **A cut-off JPEG got past the header check.** `metadata()` only reads the header; the
  damage showed when resizing, as a raw library error ("VipsJpeg: premature end of JPEG
  image") that would have reached the screen. Found by a test; both steps now give the
  person's words.
- **A check that could never fire.** Comparing the first bytes' type with sharp's was dead:
  sharp decides the type from the same bytes. Removed rather than kept as a comfort.
- **The guest site didn't get the logo and hero.** The live check (my API on :4300, the e2e
  database) showed `logo: null`: the public view copies named fields only. Added, with a test.
- **Pictures across addresses:** helmet's default `Cross-Origin-Resource-Policy: same-origin`
  would stop the guest web and staff app (other ports in development, and R2 later) from
  showing `/media` pictures. That route sends `cross-origin`; a test checks it.

## 6. Checks

- `packages/media/test/media.test.js` (23): sizes and shapes; no hidden details (GPS, camera);
  turned the right way; measured the right way up; a white background for see-through photos;
  logos inside a square; every refusal and its words; the 10 MB edge; the bomb; storage (two
  sizes, once only, `keyOf` refuses other sites and `../`, settings).
- `apps/api/test/uploads.test.js` (17): uploads and `/media` headers; refusals; who (owner, a
  website-only role, a tours-only role; not a manager, a guide or nobody); photos with credits;
  at New tour; only our own pictures; 8 at most; going on sale (every sentence, 3 photos,
  already on sale keeps selling, removing allowed, back on sale needs 3); the logo and hero, and
  guests seeing them.
- `packages/shared/test/ready-to-sell.test.js` (5); `packages/db/test/photos.test.js` (4: the
  folder, credits and CREDITS.md agree; 3–8 a tour; seeding; no hidden details; nothing new the
  second time); `reset.test.js`: the reset brings the photos and logo.
- Updated: the products and settings-tours tests (3 photos now), the catalogue test (`logo`).
- **Mutation checks:** 30 changes; **all 30 caught**. Before running them I added 3 tests for
  gaps I could see (a sideways photo's width, a tours-only role, `media` reserved) and removed
  the dead check.
- **Full runs:**
  - The first try stopped part-way at load 24: four tests timed out, the demo photo test among
    them (60 s). All passed alone; that test now has 180 s.
  - Run 1, every package to the end: passed except two WhatsApp paying tests (the known
    under-load trap), which passed alone three times.
  - Run 2: passed in full, **1,857 tests**.
  - After the last fix (the logo and hero for guests), the API's tests ran again: passed.
- **E2E:** all 12 journeys pass (twice: before and after that fix).
- **Live check:** my API on :4300, the e2e database, a throwaway business with the demo's
  photos:
  - the cathedral photo uploaded, its photographer's hidden note gone in the served copy
  - `/media` headers: `image/jpeg`, a year's cache, `cross-origin`, `nosniff`
  - a PDF and a tracker link refused in words
  - back on sale with 2 photos: "Add 1 more photo… (it has 2 of 3)"
  - the guest catalogue carries each cover's small copy and credit
  - the logo (a real 128 × 128 PNG) and the hero
  - then the business and the files deleted; nothing was written to the repo's `.data`

## 7. Concepts to study

- **Magic numbers**: identifying a file by its first bytes.
- **EXIF metadata** and why images are re-encoded on upload.
- **Decompression bombs** and pixel limits.
- **Content-addressed storage**: naming files by a hash of their content; `immutable` caching.
- **Cross-Origin-Resource-Policy** and why pictures served to other addresses need it.
- **Creative Commons licences**: BY and BY-SA, and what attribution asks for.
