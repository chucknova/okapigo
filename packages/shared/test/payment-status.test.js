import { describe, it, expect } from 'vitest';
import { canTransitionPayment, generatePaymentReference } from '../src/payment-status.js';

describe('payment lifecycle', () => {
  it.each([
    ['initiated', 'succeeded', true],
    ['initiated', 'failed', true],
    ['initiated', 'abandoned', true],
    ['abandoned', 'succeeded', true], // a late completion after the guest closed the page
    ['succeeded', 'failed', false], // a success is final
    ['failed', 'succeeded', false], // a failed attempt stays failed; the guest tries again
    ['succeeded', 'succeeded', false],
  ])('%s → %s allowed: %s', (from, to, allowed) => {
    expect(canTransitionPayment(from, to)).toBe(allowed);
  });

  it('references look like OKG-XXXXXXXXXXXXXXXXXXXX and are unique', () => {
    const refs = new Set(Array.from({ length: 1000 }, generatePaymentReference));
    expect(refs.size).toBe(1000);
    for (const r of refs) expect(r).toMatch(/^OKG-[0-9A-HJKMNP-TV-Z]{20}$/);
  });
});
