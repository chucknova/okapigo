/** The simulator's message formatting (stage 13c-2). */
import { describe, it, expect } from 'vitest';
import {
  parseText,
  withoutPreviewedLink,
  chatItems,
  initial,
  shortName,
} from '../src/lib/format.js';

describe('parseText', () => {
  it('*bold* and links, the rest as text', () => {
    expect(parseText('*Your booking*\nPay here: https://x.example/pay/abc now')).toEqual([
      { type: 'bold', value: 'Your booking' },
      { type: 'text', value: '\nPay here: ' },
      { type: 'link', value: 'https://x.example/pay/abc' },
      { type: 'text', value: ' now' },
    ]);
    expect(parseText('2 × 3 * 4')).toEqual([{ type: 'text', value: '2 × 3 * 4' }]);
  });
});

describe('withoutPreviewedLink', () => {
  it('the preview card shows the link, so its own line goes', () => {
    const url = 'http://localhost:4000/pay/abc';
    expect(withoutPreviewedLink(`Here’s your link.\n${url}\n\nThe link works…`, { url })).toBe(
      'Here’s your link.\n\nThe link works…',
    );
    expect(withoutPreviewedLink(`Pay at ${url}`, undefined)).toBe(`Pay at ${url}`);
  });
});

describe('chatItems', () => {
  const at = (h) => `2026-11-17T${String(h).padStart(2, '0')}:00:00Z`;
  it('day lines, mine and theirs, events, staff names, then what is still sending', () => {
    const items = chatItems(
      [
        { id: '1', author: 'guest', body: { kind: 'text', text: 'Hi' }, createdAt: at(9) },
        {
          id: '2',
          author: 'bot',
          body: { kind: 'buttons', text: 'Hello', buttons: [] },
          createdAt: at(9),
        },
        {
          id: '3',
          author: 'guest',
          body: { kind: 'reply', id: 'tours', title: 'See tours' },
          createdAt: at(9),
        },
        {
          id: '4',
          author: 'bot',
          body: { kind: 'notice', text: 'Tolu from Ìrìn joined' },
          createdAt: at(10),
        },
        {
          id: '5',
          author: 'staff',
          authorName: 'Tolu',
          body: { kind: 'text', text: 'Hi!' },
          createdAt: at(10),
        },
      ],
      [{ localId: 'l1', text: 'Thanks', status: 'failed', at: at(11) }],
      'Ìrìn Lagos Tours',
    );
    expect(items.map((i) => i.kind)).toEqual([
      'day',
      'mine',
      'theirs',
      'mine',
      'event',
      'theirs',
      'mine',
    ]);
    expect(items[3]).toMatchObject({ text: 'See tours' }); // a tap shows what was tapped
    expect(items[5]).toMatchObject({ staff: 'Tolu · Ìrìn team' });
    expect(items[6]).toMatchObject({ text: 'Thanks', status: 'failed', localId: 'l1' });
  });
});

describe('the header', () => {
  it('the first letter, accents kept; the short name', () => {
    expect(initial('Ìrìn Lagos Tours')).toBe('Ì');
    expect(shortName('Ìrìn Lagos Tours')).toBe('Ìrìn');
  });
});
