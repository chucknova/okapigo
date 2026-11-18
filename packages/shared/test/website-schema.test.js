/** Approved websites for the booking widget (stage 12h): cleaning up what people paste. */
import { describe, it, expect } from 'vitest';
import {
  normalizeEmbedDomain,
  EmbedDomainsSchema,
  frameAncestors,
  originApproved,
} from '../src/schemas/website.js';

describe('normalizeEmbedDomain', () => {
  it.each([
    ['irinlagostours.com', 'irinlagostours.com'],
    ['https://www.IrinLagosTours.com/tours/?x=1', 'www.irinlagostours.com'],
    ['  hotel-lagos.com.ng  ', 'hotel-lagos.com.ng'],
    ['http://localhost:4200/page', 'localhost:4200'],
  ])('%s → %s', (input, out) => expect(normalizeEmbedDomain(input)).toBe(out));

  it.each([
    'not a site',
    'hello@irin.com',
    '192.168.0.1',
    'irin',
    'irin.com:8443',
    '',
    'javascript:alert(1)',
  ])('refuses %s', (input) => expect(normalizeEmbedDomain(input)).toBeNull());
});

describe('EmbedDomainsSchema', () => {
  it('cleans each one, drops repeats, says which one is wrong', () => {
    expect(EmbedDomainsSchema.parse(['https://irin.com/', 'IRIN.com', 'www.irin.com'])).toEqual([
      'irin.com',
      'www.irin.com',
    ]);
    const bad = EmbedDomainsSchema.safeParse(['irin.com', 'oops']);
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].message).toBe('“oops” isn’t a website address.');
    expect(
      EmbedDomainsSchema.safeParse(Array.from({ length: 11 }, (_, i) => `s${i}.com`)).success,
    ).toBe(false);
  });
});

describe('frameAncestors and originApproved', () => {
  it('only the listed sites, https (http for localhost); none listed → none allowed', () => {
    expect(frameAncestors([])).toBe("frame-ancestors 'none'");
    expect(frameAncestors(['irin.com', 'localhost:4200'])).toBe(
      'frame-ancestors https://irin.com http://localhost:4200',
    );
  });
  it('checks an Origin the same way', () => {
    const list = ['irin.com', 'localhost:4200'];
    expect(originApproved(list, 'https://irin.com')).toBe(true);
    expect(originApproved(list, 'http://irin.com')).toBe(false); // not over http
    expect(originApproved(list, 'https://www.irin.com')).toBe(false); // www is another site
    expect(originApproved(list, 'http://localhost:4200')).toBe(true);
    expect(originApproved(list, 'http://127.0.0.1:4200')).toBe(false);
    expect(originApproved(list, undefined)).toBe(false);
    expect(originApproved(list, 'null')).toBe(false);
  });
});
