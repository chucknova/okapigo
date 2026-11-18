/** The WhatsApp message builders keep every reply inside WhatsApp's own limits (session 13). */
import { describe, it, expect } from 'vitest';
import { buttons, list, text, fit, fitsWhatsApp, LIMITS } from '../src/whatsapp/messages.js';

describe('WhatsApp limits', () => {
  it('cuts long words with "…", never more than the limit', () => {
    expect(fit('Lagos Island Heritage Walk', 24)).toBe('Lagos Island Heritage W…');
    expect(fit('Lagos Island Heritage Walk', 24)).toHaveLength(24);
    expect(fit('short', 24)).toBe('short');
  });

  it('at most 3 buttons of 20 characters; at most 10 rows', () => {
    const b = buttons('Pick', [
      { id: 'a', title: 'A very long button title indeed' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
      { id: 'd', title: 'D' },
    ]);
    expect(b.buttons).toHaveLength(LIMITS.buttons);
    expect(b.buttons[0].title.length).toBeLessThanOrEqual(LIMITS.buttonTitle);
    expect(fitsWhatsApp(b)).toBe(true);

    const l = list(
      'Pick',
      'Choose a very long thing here',
      Array.from({ length: 14 }, (_, i) => ({
        id: `r${i}`,
        title: `Row ${i}`,
        description: 'x'.repeat(100),
      })),
    );
    expect(l.rows).toHaveLength(LIMITS.rows);
    expect(l.rows[0].description).toHaveLength(LIMITS.rowDescription);
    expect(fitsWhatsApp(l)).toBe(true);
    expect(fitsWhatsApp(text('x'.repeat(5000)))).toBe(true); // cut to 4,096
  });

  it('refuses what WhatsApp would refuse', () => {
    expect(fitsWhatsApp({ kind: 'buttons', text: 'x', buttons: [] })).toBe(false);
    expect(
      fitsWhatsApp({
        kind: 'buttons',
        text: 'x',
        buttons: [
          { id: 'a', title: 'Same' },
          { id: 'b', title: 'Same' },
        ],
      }),
    ).toBe(false); // titles must differ
    expect(fitsWhatsApp({ kind: 'list', text: 'x', button: 'Go', rows: [] })).toBe(false);
    expect(fitsWhatsApp({ kind: 'video' })).toBe(false);
    expect(fitsWhatsApp({ kind: 'text', text: '' })).toBe(false);
  });
});
