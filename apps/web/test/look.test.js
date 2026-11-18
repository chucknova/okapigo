/**
 * lib/look.js: the operator's style and mode on <html>, and the ?style= / ?mode= preview.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyLook, startPreview } from '../src/lib/look.js';

const html = () => document.documentElement;

beforeEach(() => {
  sessionStorage.clear();
  delete html().dataset.style;
  delete html().dataset.mode;
});

describe('applyLook', () => {
  it('sets the style and mode; Lagoon and auto are the defaults, so no attribute', () => {
    applyLook({ style: 'earth', mode: 'dark' });
    expect(html().dataset).toMatchObject({ style: 'earth', mode: 'dark' });
    applyLook({ style: 'lagoon', mode: 'auto' });
    expect(html().dataset.style).toBeUndefined();
    expect(html().dataset.mode).toBeUndefined();
  });

  it('ignores values it doesn’t know (falls back to the defaults)', () => {
    applyLook({ style: 'neon', mode: 'sepia' });
    expect(html().dataset.style).toBeUndefined();
    expect(html().dataset.mode).toBeUndefined();
  });
});

describe('preview (?style=, ?mode=)', () => {
  it('wins over the operator’s choice, and lasts for the visit', () => {
    startPreview('?style=classic&mode=light');
    expect(html().dataset).toMatchObject({ style: 'classic', mode: 'light' });
    // Later, a page loads the operator's own look (Earth, dark): the preview still shows.
    applyLook({ style: 'earth', mode: 'dark' });
    expect(html().dataset).toMatchObject({ style: 'classic', mode: 'light' });
  });

  it('a preview of only the mode keeps the operator’s style', () => {
    startPreview('?mode=dark');
    applyLook({ style: 'earth', mode: 'light' });
    expect(html().dataset).toMatchObject({ style: 'earth', mode: 'dark' });
  });

  it('?preview=off ends it: the operator’s own look shows again', () => {
    startPreview('?style=classic');
    startPreview('?preview=off');
    applyLook({ style: 'earth', mode: 'auto' });
    expect(html().dataset.style).toBe('earth');
  });

  it('nonsense in the address changes nothing', () => {
    startPreview('?style=<script>&mode=1');
    applyLook({ style: 'earth', mode: 'auto' });
    expect(html().dataset.style).toBe('earth');
    expect(sessionStorage.getItem('okg-look-preview')).toBeNull();
  });
});
