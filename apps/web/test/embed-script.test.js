/**
 * embed.js (stage 12h-1) running on a pretend host page: it adds the frame with a reserved
 * height, and resizes it ONLY for messages from our own frame, from our own address.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { embedScript } from '../../api/src/lib/embed-script.js';

const BASE = 'https://okapigo.example';

function run() {
  new Function(embedScript(BASE))();
  return /** @type {HTMLIFrameElement} */ (document.querySelector('#slot iframe'));
}
const say = (data, { origin = BASE, source } = {}) =>
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));

beforeEach(() => {
  document.body.innerHTML =
    '<div id="slot" data-okapigo="irin-lagos-tours" data-tour="lagos-island-heritage-walk"></div>';
  // The approval check: approved, so nothing collapses here.
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ approved: true })));
});
afterEach(() => vi.unstubAllGlobals());

describe('embed.js', () => {
  it('adds one frame for the tour, with its height reserved, and no border', () => {
    const frame = run();
    expect(frame.src).toBe(
      `${BASE}/embed/irin-lagos-tours/lagos-island-heritage-walk?okg_host=localhost%3A3000`,
    );
    expect(frame.style.height).toBe('240px');
    expect(frame.style.border).toContain('0');
    run(); // a second copy of the script on the page doesn't add a second frame
    expect(document.querySelectorAll('#slot iframe')).toHaveLength(1);
  });

  it('resizes for our own frame only: not another address, not another window, not junk', () => {
    const frame = run();
    const ours = /** @type {Window} */ (frame.contentWindow);
    say({ type: 'okapigo:resize', height: 900 }, { origin: 'https://evil.example', source: ours });
    say({ type: 'okapigo:resize', height: 900 }, { source: window }); // right address, wrong window
    say({ type: 'okapigo:resize', height: '900' }, { source: ours }); // not a number
    expect(frame.style.height).toBe('240px');

    say({ type: 'okapigo:resize', height: 512.4 }, { source: ours });
    expect(frame.style.height).toBe('513px');
    say({ type: 'okapigo:resize', height: 10_000_000 }, { source: ours }); // capped
    expect(frame.style.height).toBe('20000px');
  });

  it('collapses when the site isn’t approved', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ approved: false })));
    const frame = run();
    await vi.waitFor(() => expect(frame.style.height).toBe('0px'));
    expect(frame.style.display).toBe('none');
  });

  it('ignores a slot whose names aren’t ours to put in an address', () => {
    document.body.innerHTML = '<div id="slot" data-okapigo="../../evil"></div>';
    run();
    expect(document.querySelector('#slot iframe')).toBeNull();
  });
});

describe('embed.js, stage 12h-2', () => {
  it('passes the host page’s UTM codes on to the frame', () => {
    window.history.replaceState({}, '', '/?utm_source=instagram&utm_campaign=december&x=1');
    const frame = run();
    const q = new URL(frame.src).searchParams;
    expect(q.get('utm_source')).toBe('instagram');
    expect(q.get('utm_campaign')).toBe('december');
    expect(q.get('x')).toBeNull(); // only UTM codes
    window.history.replaceState({}, '', '/');
  });

  it('tells the host page about a booking, with known fields only', () => {
    const frame = run();
    const heard = [];
    document.addEventListener('okapigo:booking-completed', (e) => heard.push(e.detail));
    say(
      {
        type: 'okapigo:booking-completed',
        booking: {
          reference: 'ILT-7K4Q2M',
          tour: 'walk',
          amountPaidKobo: 2_500_000,
          currency: 'NGN',
          email: 'x@y.z',
        },
      },
      { source: frame.contentWindow },
    );
    say(
      { type: 'okapigo:booking-completed', booking: { reference: 'FAKE' } },
      { origin: 'https://evil.example', source: frame.contentWindow },
    );
    expect(heard).toEqual([
      {
        reference: 'ILT-7K4Q2M',
        operator: null,
        tour: 'walk',
        amountPaidKobo: 2_500_000,
        currency: 'NGN',
      },
    ]);
  });

  describe('the "Book now" button and its overlay', () => {
    const buttonSlot = (attrs = '') => {
      document.body.innerHTML = `<p id="host">Host content <a href="#x">a link</a></p>
        <div id="slot" data-okapigo="irin-lagos-tours" data-tour="lagos-island-heritage-walk" data-widget="button" ${attrs}></div>`;
    };
    const approvedWith = (radius) =>
      vi.stubGlobal(
        'fetch',
        async () => new Response(JSON.stringify({ approved: true, buttonRadius: radius })),
      );

    it('appears only once the site is approved, with the style’s corners and readable text', async () => {
      buttonSlot('data-colour="#0F4C5C" data-label="Book the Heritage Walk"');
      approvedWith(4);
      run();
      const button = /** @type {HTMLButtonElement} */ (document.querySelector('#slot button'));
      expect(button.textContent).toBe('Book the Heritage Walk');
      await vi.waitFor(() => expect(button.style.display).toBe('inline-flex'));
      expect(button.style.borderRadius).toBe('4px');
      expect(button.style.color).toBe('rgb(255, 255, 255)'); // white on dark teal
    });

    it('dark text on a light colour; not approved → no button at all', async () => {
      buttonSlot('data-colour="#F2C48D"');
      approvedWith(999);
      run();
      const button = /** @type {HTMLButtonElement} */ (document.querySelector('#slot button'));
      await vi.waitFor(() => expect(button.style.display).toBe('inline-flex'));
      expect(button.style.color).toBe('rgb(17, 21, 17)');

      buttonSlot();
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ approved: false })));
      run();
      await new Promise((r) => setTimeout(r, 20));
      expect(
        /** @type {HTMLElement} */ (document.querySelector('#slot button')).style.display,
      ).toBe('none');
    });

    it('opens checkout in an overlay; the page behind can’t be reached; it closes every way', async () => {
      buttonSlot();
      approvedWith(12);
      run();
      const button = /** @type {HTMLButtonElement} */ (document.querySelector('#slot button'));
      await vi.waitFor(() => expect(button.style.display).toBe('inline-flex')); // approved
      const open = () => {
        button.click();
        return /** @type {HTMLIFrameElement} */ (
          document.querySelector('[data-okapigo-overlay] iframe')
        );
      };

      let frame = open();
      expect(frame.src).toContain('/embed/irin-lagos-tours/lagos-island-heritage-walk/book?');
      expect(new URL(frame.src).searchParams.get('overlay')).toBe('1');
      expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
      expect(document.getElementById('host')?.hasAttribute('inert')).toBe(true);
      expect(document.documentElement.style.overflow).toBe('hidden');

      // 1. The frame's own Close (×), and focus goes back to the button.
      say({ type: 'okapigo:close' }, { source: frame.contentWindow });
      expect(document.querySelector('[data-okapigo-overlay]')).toBeNull();
      expect(document.getElementById('host')?.hasAttribute('inert')).toBe(false);
      expect(document.activeElement).toBe(button);

      // 2. Escape.
      open();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(document.querySelector('[data-okapigo-overlay]')).toBeNull();

      // 3. A click on the dimmed page (not inside the box).
      open();
      /** @type {HTMLElement} */ (document.querySelector('[data-okapigo-overlay]')).click();
      expect(document.querySelector('[data-okapigo-overlay]')).toBeNull();

      // A "close" from somewhere else is ignored.
      frame = open();
      say(
        { type: 'okapigo:close' },
        { origin: 'https://evil.example', source: frame.contentWindow },
      );
      expect(document.querySelector('[data-okapigo-overlay]')).not.toBeNull();
    });
  });
});
