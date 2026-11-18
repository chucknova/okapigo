/** lib/attribution.js: where a visit came from, carried into the booking (stage 12h-2). */
import { describe, it, expect, beforeEach } from 'vitest';
import { captureAttribution, currentAttribution } from '../src/lib/attribution.js';

beforeEach(() => sessionStorage.clear());

describe('attribution', () => {
  it('the website, with the campaign codes the guest arrived with', () => {
    captureAttribution(
      '?utm_source=instagram&utm_campaign=december&utm_medium=social&x=1',
      '/irin',
    );
    expect(currentAttribution()).toEqual({
      via: 'website',
      utm_source: 'instagram',
      utm_medium: 'social',
      utm_campaign: 'december',
    });
  });

  it('the widget, with its host site; the first page of the visit wins', () => {
    captureAttribution('?okg_host=irinlagostours.com&utm_source=newsletter', '/embed/irin/walk');
    captureAttribution('?utm_source=later', '/embed/irin/walk/book/who'); // later pages don't overwrite
    expect(currentAttribution()).toEqual({
      via: 'widget',
      host: 'irinlagostours.com',
      utm_source: 'newsletter',
    });
  });

  it('drops values that aren’t plain text, and a host outside the widget', () => {
    captureAttribution(
      '?utm_source=<script>&utm_campaign=' + 'x'.repeat(101) + '&okg_host=evil.example',
      '/irin',
    );
    expect(currentAttribution()).toEqual({ via: 'website' });
  });
});
