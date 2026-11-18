// @ts-check
/**
 * embed-script.js — the booking widget's snippet script, served at /embed.js (BKG-01, 12h).
 *
 * An operator pastes this into their own website:
 *
 *   <div data-okapigo="irin-lagos-tours" data-tour="lagos-island-heritage-walk"></div>
 *   <script src="https://okapigo.app/embed.js" async></script>
 *
 * (Leave out data-tour to show all their tours.) The script runs on SOMEONE ELSE'S page, so
 * it is plain old JavaScript, small, and careful:
 *   - it only adds an <iframe> inside the operator's <div>: no global styles, no globals
 *   - checkout runs INSIDE the frame, on OkapiGo's own address: card details never touch the
 *     host page, and the host can't read the guest's details
 *   - it RESERVES the frame's height before it loads, so the host page doesn't jump
 *   - the frame reports its height (postMessage); the script believes messages ONLY from our
 *     own frame, from our own address, and only a number
 *   - it asks whether this website is approved; if not, the widget collapses to nothing.
 *     (The real guard is the frame's Content-Security-Policy: an unapproved site's browser
 *     refuses to show the frame at all. Asking first just avoids an empty gap.)
 */

/** Heights reserved before the frame reports its own (designs: "Loading inside the host page"). */
export const RESERVED_HEIGHT = { tour: 240, tours: 460 };

/**
 * The script's text, with our address filled in.
 * @param {string} base  where OkapiGo's pages live, e.g. "https://okapigo.app"
 */
export function embedScript(base) {
  const origin = new URL(base).origin;
  return `/* OkapiGo booking widget. https://okapigo.app */
(function () {
  'use strict';
  var BASE = ${JSON.stringify(origin)};
  var MAX_HEIGHT = 20000;

  function mount(el) {
    if (el.getAttribute('data-okapigo-mounted')) return;
    el.setAttribute('data-okapigo-mounted', '1');
    var operator = el.getAttribute('data-okapigo') || '';
    var tour = el.getAttribute('data-tour') || '';
    if (!/^[a-z0-9-]{1,80}$/.test(operator) || (tour && !/^[a-z0-9-]{1,80}$/.test(tour))) return;

    var frame = document.createElement('iframe');
    frame.src = BASE + '/embed/' + operator + (tour ? '/' + tour : '');
    frame.title = 'Book a tour';
    frame.style.cssText = 'display:block;width:100%;border:0;background:transparent;' +
      'height:' + (tour ? ${RESERVED_HEIGHT.tour} : ${RESERVED_HEIGHT.tours}) + 'px;';
    el.appendChild(frame);

    function collapse() {
      frame.style.height = '0px';
      frame.style.display = 'none';
    }

    // Is this website one the operator approved? If not, show nothing (designs: "Guests see
    // nothing: the frame collapses to 0 px").
    if (window.fetch) {
      fetch(BASE + '/public/' + operator + '/embed-check', { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : { approved: false }; })
        .then(function (r) { if (!r || r.approved !== true) collapse(); })
        .catch(function () { /* can't tell: leave it to the frame's own guard */ });
    }

    window.addEventListener('message', function (e) {
      if (e.origin !== BASE || e.source !== frame.contentWindow) return;
      var d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'okapigo:resize' && typeof d.height === 'number' && isFinite(d.height)) {
        frame.style.height = Math.max(0, Math.min(Math.ceil(d.height), MAX_HEIGHT)) + 'px';
      }
    });
  }

  function mountAll() {
    var els = document.querySelectorAll('[data-okapigo]');
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();
})();
`;
}
