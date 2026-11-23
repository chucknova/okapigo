# Stage 19b-2a: photos and the logo in the staff app

| Part       | What                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| 19b-1      | Uploads, the server side; 3 photos to go on sale; the demo's photos         |
| **19b-2a** | **The staff app: a tour's Photos, New tour with photos, the logo and hero** |
| 19b-2b     | What guests see: the website, tour pages, the trip page, posters, previews  |

**Designs:** U1–U3 and U7–U8 on the session 18 canvas, page "19b · Photos and logo".

## 1. What you can do now

| Where                                     | What                                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **New tour**                              | Photos right after the name and summary (decided: "add photos at the start"). Make the draft with them, or with none: "It can't go on sale until it has 3." |
| **A tour's page › Photos**                | The cover first; describe each, credit if someone else took it; Make cover, Move up/down, Remove; Add photos (several at once, or dropped on the desk)      |
| **Removing on a tour on sale**            | Under 3 asks first: "… will have 2 photos, under the 3 a tour on sale should have. It stays on sale." (decided: allowed after a warning)                    |
| **A draft's page**                        | "Before it goes on sale:" Add its prices · Prices, Add 2 more photos (it has 1 of 3) · Photos; "Put on sale" waits                                          |
| **Settings › Tours**                      | Each tour says what it still needs: "needs prices and 3 photos", or for one on sale "needs 1 more photo"                                                    |
| **Settings › Website › Business details** | The logo (or your first letter) and the hero photo (or your style's pattern), with its description and credit; saved with the rest                          |

The tour's page is one long page of sections (approved in 16e-4), so Photos is a section after
Basics rather than the canvas's row of tabs.

## 2. How an upload works on the phone

```
pick (or drop) files
  │  too big? said at once, never sent ("That photo is 14 MB. Use one under 10 MB.")
  ▼
each file: POST /api/uploads/photo, its bytes as the body  ── XMLHttpRequest
  │  "Uploading beach.jpg… 40%"  ·  Cancel
  ▼
201 { picture: { url, small } }   →  ready: describe it
400 { error: { message } }        →  the server's words, Try again, Remove
no connection                     →  "The upload stopped (no connection)." Try again
  ▼
Save (the page's save bar)  →  PATCH the tour { photos } / the website { site: { logo, hero } }
```

- **Why XMLHttpRequest?** `fetch` can't report how much of an upload has gone; XHR's
  `upload.onprogress` can. On 3G, "40%" is the difference between waiting and giving up.
- **Two steps, like every setting:** a photo uploads as soon as it's picked, but the tour only
  changes when it's saved. Saving waits while anything is on its way ("Save when the upload
  ends.").
- **The same words everywhere:** the size limit and its sentence now live in
  `@okapigo/shared/uploads`, used by the server's check and the phone's.
- **Where it lives:**
  - `lib/photos.js`: the photo list's rules (add, order, cover, what to fix, what's saved, the
    count, when to ask)
  - `lib/pictures.js`: the logo and hero
  - `lib/uploads.js`: sending, and the hooks `usePhotoList` and `usePicture`
  - `components/PhotoList.jsx` and `PictureFields.jsx`: only draw them

## 3. Found along the way

- **Red before anyone tried.** The screenshot of New tour showed "Describe the photo: guests
  using screen readers need it." in red the moment a photo arrived. The other fields there wait
  until "Make the draft" is pressed, and so do photos now.
- **The tests' fake server didn't know a test had pressed "Make the draft"** while photos were
  uploading, so the errors were (rightly) on: my test was wrong, not the screen.
- **Prettier run inside `apps/operator` reformatted the generated `tokens.css`** (the root's
  ignore list applies only from the root). A test caught it; `pnpm --filter
@okapigo/operator tokens` made it again. Run Prettier from the repo root.
- **The white band in element screenshots** is the app's fixed status strip caught in the
  picture, not a layout fault (the phone shot shows it mid-page).

## 4. Checks

- `test/photos.test.js` (18): the photo list (from saved, adding with refusals, progress,
  failed and retried, order, cover, what to fix, what's saved, changed, the count, when to
  ask), the logo and hero, the first letter, and `sendPicture` against a fake connection (the
  sign-in, progress, the server's words, signed out, broken, Wi-Fi login pages, no connection,
  timeout, cancelled, too big and offline before sending).
- `test/settings-photos.test.jsx` (11): the screens against a fake server and fake uploads: a
  tour's photos (cover, order saved, the ask when removing, an upload from pick to save, a
  refusal with Try again and Cancel, too big never sent), a draft's checklist, the tours list,
  New tour (photos sent cover first, no red before trying, waiting for uploads, none), the logo
  and hero (letter and pattern, upload, description needed, saved; removed, a problem,
  Discard).
- Updated: `settings-tours.test.jsx` (the list's needs line, the checklist instead of one
  sentence); `ready-to-sell.test.js` (+1: the upload limits).
- **Mutation checks:** 31 changes. 27 caught at first; 2 survived and got tests (only the
  hero's description changed; saving while the logo uploads); 2 hadn't applied (Prettier had
  reflowed the lines) and were caught once re-pointed. The later "no red before trying" rule:
  caught too.
- **Full runs:** run 1 passed in full (1,893 tests). Run 2: the WhatsApp paying tests failed
  again (5, the known trap under load; they now fail in most full runs), and passed alone three
  times. After the last small fix, the staff app's tests ran again: 287 passed.
- **E2E:** all 12 journeys pass.
- **Screenshots of the built staff app:** headless Chrome, my API on :4300, the e2e database,
  a throwaway business with the demo's photos (deleted afterwards): the tours list, a tour's
  Photos on desk and phone, the remove question, New tour with two real photos uploaded (desk)
  and one (phone), a draft's checklist, the logo and the hero.

## 5. Concepts to study

- **Upload progress**: `XMLHttpRequest.upload.onprogress`, and why `fetch` can't do it (yet).
- **Optimistic vs. saved state**: uploads that happen now, a setting that changes on Save.
- **Accessible custom file inputs**: a real button that opens a hidden `<input type="file">`.
- **Drag and drop**: `dragover` (must `preventDefault()`) and `drop`'s `dataTransfer.files`.
