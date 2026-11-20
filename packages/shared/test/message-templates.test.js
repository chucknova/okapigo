/** The guest messages' templates (OPS-11, stage 14a): your wording, the placeholders, the checks. */
import { describe, it, expect } from 'vitest';
import {
  MESSAGES,
  MESSAGE_KINDS,
  PLACEHOLDERS,
  renderTemplate,
  checkTemplate,
} from '../src/message-templates.js';

describe('the defaults (design file 02)', () => {
  it('seven messages ("Date changed" since 16d-2); each default passes its own checks and uses only known placeholders', () => {
    expect(MESSAGE_KINDS).toEqual([
      'booking_confirmed',
      'deposit_received',
      'balance_reminder',
      'payment_link',
      'booking_cancelled',
      'refund_sent',
      'booking_moved',
    ]);
    for (const kind of MESSAGE_KINDS) {
      expect(checkTemplate(kind, MESSAGES[kind]), kind).toEqual([]);
      for (const p of MESSAGES[kind].placeholders) expect(PLACEHOLDERS[p], p).toBeTruthy();
    }
  });

  it('the confirmation reads as in your design', () => {
    const text = renderTemplate(MESSAGES.booking_confirmed.body, {
      first_name: 'Adaeze',
      tour: 'Lagos Island Heritage Walk',
      date: 'Sat 5 Dec',
      time: '09:00',
      meeting_point: 'Tinubu Square, Broad Street (by the fountain)',
      travellers: '3 travellers',
      reference: 'ILT-7K4Q2M',
      trip_url: 'http://localhost:4000/trip/x7Qp',
    });
    expect(text).toBe(
      'Hi Adaeze, your booking is confirmed!\n\nLagos Island Heritage Walk\nSat 5 Dec, 09:00\nMeet at Tinubu Square, Broad Street (by the fountain)\n3 travellers · Ref ILT-7K4Q2M\n\nYour ticket and map:\nhttp://localhost:4000/trip/x7Qp',
    );
    expect(
      renderTemplate(MESSAGES.booking_confirmed.subject, {
        tour_short: 'Heritage Walk',
        date: 'Sat 5 Dec',
        reference: 'ILT-7K4Q2M',
      }),
    ).toBe('Booking confirmed: Heritage Walk, Sat 5 Dec (ILT-7K4Q2M)');
  });
});

describe('renderTemplate', () => {
  it('a missing value becomes empty: a guest never sees "{date}"', () => {
    expect(renderTemplate('On {date} at {time}', { date: 'Sat 5 Dec' })).toBe('On Sat 5 Dec at ');
  });
});

describe('checkTemplate: what staff can’t save', () => {
  const ok = MESSAGES.balance_reminder;
  it.each([
    [{ ...ok, body: ok.body.replace('{pay_url}', '') }, 'The message must include {pay_url}.'],
    [{ ...ok, body: `${ok.body} {refund}` }, '{refund} can’t be used in this message.'],
    [{ ...ok, subject: 'Pay {nonsense}' }, '{nonsense} can’t be used in the subject.'],
    [
      { ...ok, body: `${ok.body} {date` },
      'The message has a { or } that isn’t part of a placeholder.',
    ],
    [{ ...ok, subject: 'Two\nlines' }, 'The subject must be one line.'],
    [{ ...ok, subject: ' ' }, 'The subject can’t be empty.'],
    [
      { ...ok, body: 'x'.repeat(1501) + '{balance}{due_date}{pay_url}' },
      'Keep the message under 1500 characters.',
    ],
  ])('%#', (t, problem) => {
    expect(checkTemplate('balance_reminder', t)).toContain(problem);
  });
});
