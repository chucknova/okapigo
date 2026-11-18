// @ts-check
/**
 * embed-script.js — the booking widget's snippet script, served at /embed.js (BKG-01, 12h).
 *
 * An operator pastes this into their own website:
 *
 *   <div data-okapigo="irin-lagos-tours" data-tour="lagos-island-heritage-walk"></div>
 *   <script src="https://okapigo.app/embed.js" async></script>
 *
 * Leave out data-tour to show all their tours. Two ways to show it (designs: file 03):
 *
 *   inline (the default)     the widget sits in the page and grows to fit
 *   data-widget="button"     a "Book now" button that opens checkout in an overlay;
 *                            data-label="Book the Heritage Walk", data-colour="#0F4C5C"
 *
 * The script runs on SOMEONE ELSE'S page, so it is plain old JavaScript, small, and careful:
 *   - it only adds an <iframe> (and, for the button, the button and the overlay) inside or
 *     on top of the page: no global styles, no globals
 *   - checkout runs INSIDE the frame, on OkapiGo's own address: card details never touch the
 *     host page, and the host can't read the guest's details
 *   - it believes messages ONLY from our own frame, from our own address, and only of the
 *     shapes it expects
 *   - it asks whether this website is approved; if not, guests see nothing. (The real guard
 *     is the frame's Content-Security-Policy: an unapproved site's browser won't show it.)
 *   - the host page's UTM codes go into the frame's address, so they reach the booking
 *   - when a booking is made, the host page hears "okapigo:booking-completed" (a DOM event on
 *     the operator's <div>, which bubbles): the reference, tour and amount, nothing personal
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
  var SLUG = /^[a-z0-9-]{1,80}$/;
  var UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

  // The host page's campaign codes and name, passed on so they reach the booking.
  function passOn(extra) {
    var q = [];
    var here = new URLSearchParams(location.search);
    for (var i = 0; i < UTM.length; i++) {
      var v = here.get(UTM[i]);
      if (v) q.push(UTM[i] + '=' + encodeURIComponent(v.slice(0, 100)));
    }
    q.push('okg_host=' + encodeURIComponent(location.host));
    if (extra) q.push(extra);
    return '?' + q.join('&');
  }

  // "Is this website approved?" → { approved, buttonRadius }. Unknown counts as no.
  function check(operator, then) {
    if (!window.fetch) return then({ approved: true, buttonRadius: 12 }); // the frame still guards
    fetch(BASE + '/public/' + operator + '/embed-check', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : { approved: false }; })
      .then(function (r) { then(r && r.approved === true ? r : { approved: false }); })
      .catch(function () { then({ approved: true, buttonRadius: 12 }); }); // can't tell: the frame decides
  }

  // Messages from OUR frame: resize, close, booking-completed. Anything else is ignored.
  function listen(frame, handlers) {
    function onMessage(e) {
      if (e.origin !== BASE || e.source !== frame.contentWindow) return;
      var d = e.data;
      if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;
      var h = handlers[d.type];
      if (h) h(d);
    }
    window.addEventListener('message', onMessage);
    return function () { window.removeEventListener('message', onMessage); };
  }

  // "okapigo:booking-completed" on the operator's element: known fields only, never personal.
  function announce(el, d) {
    var b = d.booking || {};
    var detail = {
      reference: typeof b.reference === 'string' ? b.reference.slice(0, 40) : null,
      operator: typeof b.operator === 'string' ? b.operator.slice(0, 80) : null,
      tour: typeof b.tour === 'string' ? b.tour.slice(0, 80) : null,
      amountPaidKobo: typeof b.amountPaidKobo === 'number' ? b.amountPaidKobo : null,
      currency: typeof b.currency === 'string' ? b.currency.slice(0, 3) : null
    };
    if (!detail.reference) return;
    var ev;
    try {
      ev = new CustomEvent('okapigo:booking-completed', { bubbles: true, detail: detail });
    } catch (err) {
      ev = document.createEvent('CustomEvent');
      ev.initCustomEvent('okapigo:booking-completed', true, false, detail);
    }
    el.dispatchEvent(ev);
  }

  // --- Inline -------------------------------------------------------------------------------

  function mountInline(el, operator, tour) {
    var frame = document.createElement('iframe');
    frame.src = BASE + '/embed/' + operator + (tour ? '/' + tour : '') + passOn();
    frame.title = 'Book a tour';
    frame.style.cssText = 'display:block;width:100%;border:0;background:transparent;' +
      'height:' + (tour ? ${RESERVED_HEIGHT.tour} : ${RESERVED_HEIGHT.tours}) + 'px;';
    el.appendChild(frame);

    check(operator, function (r) {
      if (!r.approved) {
        frame.style.height = '0px';
        frame.style.display = 'none';
      }
    });
    listen(frame, {
      'okapigo:resize': function (d) {
        if (typeof d.height === 'number' && isFinite(d.height)) {
          frame.style.height = Math.max(0, Math.min(Math.ceil(d.height), MAX_HEIGHT)) + 'px';
        }
      },
      'okapigo:booking-completed': function (d) { announce(el, d); }
    });
  }

  // --- Button and overlay ---------------------------------------------------------------------

  // Dark or white text on the operator's colour, whichever passes WCAG contrast (4.5:1).
  function textOn(hex) {
    function lin(c) { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    var L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    var withWhite = 1.05 / (L + 0.05), withDark = (L + 0.05) / 0.0587; // #111511
    return withWhite >= withDark ? '#FFFFFF' : '#111511';
  }

  function mountButton(el, operator, tour) {
    var colour = el.getAttribute('data-colour') || '';
    if (!/^#[0-9a-fA-F]{6}$/.test(colour)) colour = '#9BD10F'; // Lagoon's primary
    var label = (el.getAttribute('data-label') || 'Book now').slice(0, 60);
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = 'display:none;align-items:center;justify-content:center;' +
      'height:48px;padding:0 24px;border:0;cursor:pointer;font-size:16px;font-weight:700;' +
      'font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;' +
      'background:' + colour + ';color:' + textOn(colour) + ';';
    el.appendChild(button);

    // Shown only on an approved website (otherwise guests see nothing at all).
    check(operator, function (r) {
      if (!r.approved) return;
      var radius = typeof r.buttonRadius === 'number' ? Math.min(r.buttonRadius, 999) : 12;
      button.style.borderRadius = radius + 'px';
      button.style.display = 'inline-flex';
    });

    button.addEventListener('click', function () { openOverlay(el, button, operator, tour); });
  }

  function openOverlay(el, button, operator, tour) {
    var phone = window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
    var backdrop = document.createElement('div');
    backdrop.setAttribute('data-okapigo-overlay', '');
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;' +
      'align-items:center;justify-content:center;background:rgba(17,21,17,0.55);';
    var box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Book a tour');
    box.style.cssText = phone
      ? 'width:100%;height:100%;background:transparent;'
      : 'width:min(520px,100% - 32px);height:min(760px,100% - 48px);border-radius:16px;' +
        'overflow:hidden;box-shadow:0 12px 32px rgba(17,21,17,0.3);background:transparent;';
    var frame = document.createElement('iframe');
    frame.src = BASE + '/embed/' + operator + (tour ? '/' + tour + '/book' : '') + passOn('overlay=1');
    frame.title = 'Book a tour';
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:transparent;';
    box.appendChild(frame);
    backdrop.appendChild(box);

    // While open, the rest of the page can't be reached (keyboard focus stays inside).
    var others = [];
    for (var i = 0; i < document.body.children.length; i++) {
      var c = document.body.children[i];
      if (!c.hasAttribute('inert')) { c.setAttribute('inert', ''); others.push(c); }
    }
    var scroll = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(backdrop);
    frame.addEventListener('load', function () { frame.focus(); });

    var stop;
    function close() {
      if (!backdrop.parentNode) return;
      backdrop.parentNode.removeChild(backdrop);
      for (var j = 0; j < others.length; j++) others[j].removeAttribute('inert');
      document.documentElement.style.overflow = scroll;
      document.removeEventListener('keydown', onKey);
      stop();
      button.focus(); // back where the guest was
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    stop = listen(frame, {
      'okapigo:close': close,
      'okapigo:booking-completed': function (d) { announce(el, d); }
    });
  }

  // --- Start ----------------------------------------------------------------------------------

  function mount(el) {
    if (el.getAttribute('data-okapigo-mounted')) return;
    el.setAttribute('data-okapigo-mounted', '1');
    var operator = el.getAttribute('data-okapigo') || '';
    var tour = el.getAttribute('data-tour') || '';
    if (!SLUG.test(operator) || (tour && !SLUG.test(tour))) return;
    if (el.getAttribute('data-widget') === 'button') mountButton(el, operator, tour);
    else mountInline(el, operator, tour);
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
