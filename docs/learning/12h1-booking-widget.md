# Stage 12h-1: The booking widget, inline

From your designs (file 03, "Inline widget on light and dark host sites" and the widget states)
and PRD BKG-01. An operator pastes a snippet into their **own** website, and guests book
there, in a frame served by OkapiGo. **12h-2** adds the pop-up button, coming back from
Paystack into the frame, the booking-completed event and UTM codes.

## 1. What we built

| Piece                                      | Where                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| The snippet's script                       | `/embed.js`, from `apps/api/src/lib/embed-script.js`                                      |
| The frames (all tours, one tour, checkout) | `/embed/…`: server in `share-pages.js`, screens in `apps/web/src/screens/embed/Embed.jsx` |
| Approved websites                          | `operators.embed_domains`; rules in `packages/shared/src/schemas/website.js`              |
| "May this site show it?"                   | `GET /public/:operator/embed-check`                                                       |
| Saving the list (owner)                    | `PATCH /api/website { embedDomains }`                                                     |
| Pay inside a frame                         | `Review.jsx`: Paystack in a new tab                                                       |
| The frame's look                           | `apps/web/src/styles/embed.css`                                                           |
| A second website for the tests             | `apps/web/e2e/host/`, `e2e/host-server.js` (:4200)                                        |

## 2. How it works

### The snippet

```html
<div data-okapigo="irin-lagos-tours" data-tour="lagos-island-heritage-walk"></div>
<script src="https://okapigo.app/embed.js" async></script>
```

Leave out `data-tour` for all tours. `embed.js` puts an `<iframe>` in that `<div>` and nothing
else: no styles on the host page, no globals.

```
host page (irinlagostours.com)              OkapiGo (okapigo.app)
  embed.js ─ adds <iframe height 240px> ──► /embed/irin-lagos-tours/lagos-island-heritage-walk
           ─ asks /embed-check ───────────► "is https://irinlagostours.com approved?" → yes
  resizes the iframe  ◄── postMessage ───── the frame: { type: 'okapigo:resize', height: 174 }
```

- **Reserved height:** the frame starts at 240 px (460 for all tours), so the host page doesn't
  jump while it loads. Then it reports its real height, every time its content changes.
- **Only our own messages:** `embed.js` believes a message only if it comes from OkapiGo's
  address **and** from its own frame, and only a number (capped at 20,000 px). A test runs the
  real script on a pretend page and sends it fake messages.
- **Checkout inside the frame:** the same checkout screens, mounted under `/embed` with wouter's
  `nest`. Inside a nest every link is relative, so `/irin/walk/book/who` stays in the frame.
  Not one checkout screen changed for this.

### Only approved websites

Two layers:

1. **The real guard: the browser.** Each frame page sends
   `Content-Security-Policy: frame-ancestors https://irinlagostours.com …`. Any other site's
   browser refuses to show it; the page's own code doesn't even run. No approved sites means
   `frame-ancestors 'none'`. The rest of helmet's policy is kept; only that rule changes.
   `X-Frame-Options` is removed (it can only say "same site" or "nobody").
2. **No empty gap:** `embed.js` asks `/embed-check`. The browser sends the host page's
   `Origin`, which scripts can't fake. If the answer is no, the frame collapses to 0 px at once
   (designs: "Guests see nothing").

The list is cleaned as it's saved: `https://www.IrinLagosTours.com/tours/` becomes
`www.irinlagostours.com`. Real sites must be https; `localhost:port` is allowed for testing.

### Paying from a frame

Paystack's page won't run inside another site's frame. In the widget, **Pay opens Paystack in
a new tab**. The tab is opened at the moment of the tap, before asking the server: browsers
allow a tab opened by a tap, not one opened seconds later. If the browser blocks it anyway,
the whole window goes to Paystack. The guest pays in the tab and sees "Booking confirmed" there.
The frame says "Paystack is open in a new tab" with a link to open it again.

## 3. Found along the way

- **helmet blocked our own script on other sites:** every response says
  `Cross-Origin-Resource-Policy: same-origin`. `/embed.js` is for other websites, so it alone
  says `cross-origin`.
- **The "unexplained" test failure from 12e, explained:** the tests' payment simulator really
  sent its webhook to `http://localhost:4000`, the dev API. When that API was restarting (or
  off), the simulator's Pay crashed with a 500. Two fixes:
  - the simulator now sends the guest back even if its webhook fails, as Paystack does (the
    check and reconcile settle the payment); tested
  - the tests' simulator sends nothing anywhere: it records what it would have sent
- **A stylesheet clash from 12f-1:** the trip hub reused the class name `okg-meeting`, which
  removed the padding from the tour page's meeting-point card. The trip hub's are now
  `okg-trip-meeting`. No other class is defined twice in the styles.
- **`min-height: 100vh` inside a self-sizing frame** is a trap: the frame's height is the
  viewport, so the frame could never shrink. The widget sets it to 0.
- **Square corners in development:** the dev server's page lacked the "this is a widget" mark,
  so the page background filled the card's corners. The widget now sets the mark itself.
- **Busy machine, again:** two old tests take 1.5 s alone and 20+ s at load 13 (every test seeds
  a demo business, and Postgres runs in Docker's VM). The first full run passed; the second had
  those two time-outs.

## 4. Why we chose what we chose

| Choice                         | Alternative                          | Why                                                                   |
| ------------------------------ | ------------------------------------ | --------------------------------------------------------------------- |
| An iframe served by OkapiGo    | a script that draws on their page    | card details never touch their site; their CSS can't break ours       |
| `frame-ancestors` as the guard | check `document.referrer` in the app | the browser enforces it before our code runs; referrers can be hidden |
| Also ask `/embed-check`        | wait for the frame to time out       | no 10-second empty gap on unapproved sites                            |
| Checkout in a `nest`           | separate widget screens              | one set of checkout screens, tested once                              |
| Paystack in a new tab          | the whole window                     | the guest keeps their place on the operator's site                    |

## 5. Concepts to study

- **iframes and `postMessage`**: checking `origin` and `source`
- **Content-Security-Policy `frame-ancestors`** and `X-Frame-Options`; clickjacking
- **`Origin`** and why scripts can't forge it; CORS for public answers
- **Cross-Origin-Resource-Policy**
- **Pop-up blockers and user activation** (why the tab opens at the tap)

## 6. Try it yourself

Your dev database now approves `localhost:4200` for Ìrìn. Then:

```bash
node apps/web/e2e/host-server.js
```

```text
http://localhost:4200/?op=irin-lagos-tours&tour=lagos-island-heritage-walk&base=http://localhost:4000
http://localhost:4200/?op=irin-lagos-tours&base=http://localhost:4000&dark=1
http://127.0.0.1:4200/?op=irin-lagos-tours&base=http://localhost:4000    (not approved: nothing)
```

And `pnpm --filter @okapigo/web e2e` runs it all from a real second website.

## 7. Differences from the designs

- **In dark mode the widget is dark** when Ìrìn's mode is "auto" and the guest's phone is dark:
  it follows the operator's choice (designs: "not the host's"). Choosing light makes it always
  light.
- **After paying, the frame doesn't change yet:** "Booking confirmed" shows in the new tab.
  Coming back into the frame is 12h-2.
- **The Embed page** (snippet, preview, approved sites) is an operator screen, designed later.
  The API is ready: `PATCH /api/website { embedDomains }`.

## 8. What's next

**Stage 12h-2:** the "Book now" button and its overlay (close with ×, Escape, or a click
outside; full screen on phones), the frame following the payment in the other tab and showing
the confirmation, the `booking-completed` event to the host page, and UTM codes carried into
the booking.
