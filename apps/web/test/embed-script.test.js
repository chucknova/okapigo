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
    expect(frame.src).toBe(`${BASE}/embed/irin-lagos-tours/lagos-island-heritage-walk`);
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
