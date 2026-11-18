import { describe, it, expect } from 'vitest';
import {
  normalizeEmail,
  normalizePhone,
  parseContact,
  formatPhoneForDisplay,
} from '../src/contact.js';
import { OtpVerifySchema } from '../src/schemas/auth.js';
import { PermissionsSchema } from '../src/schemas/roles.js';
import { buildPermissions } from '../src/permissions.js';
import { slugify } from '../src/slug.js';

describe('normalizePhone', () => {
  it.each([
    ['0803 123 4567', '+2348031234567'], // Nigerian local format
    ['0803-123-4567', '+2348031234567'],
    ['2348031234567', '+2348031234567'], // country code without +
    ['+234 803 123 4567', '+2348031234567'],
    ['+44 20 7946 0958', '+442079460958'], // a UK number stays as-is
  ])('turns %s into %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['12345', '08031234', 'call me', '+0123456789'])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Kemi@Example.COM ')).toBe('kemi@example.com');
  });

  it('rejects things that are not emails', () => {
    expect(normalizeEmail('kemi@')).toBeNull();
    expect(normalizeEmail('kemi example@x.com')).toBeNull();
  });
});

describe('parseContact', () => {
  it('detects email vs phone', () => {
    expect(parseContact('Tunde@Irin.example')).toEqual({
      channel: 'email',
      destination: 'tunde@irin.example',
    });
    expect(parseContact('08030000002')).toEqual({
      channel: 'phone',
      destination: '+2348030000002',
    });
  });
});

describe('OtpVerifySchema', () => {
  it('keeps a leading zero in the code', () => {
    const parsed = OtpVerifySchema.parse({ contact: 'a@b.co', code: '042917' });
    expect(parsed.code).toBe('042917');
  });

  it('rejects a 5-digit code', () => {
    expect(OtpVerifySchema.safeParse({ contact: 'a@b.co', code: '12345' }).success).toBe(false);
  });
});

describe('PermissionsSchema', () => {
  it('accepts a complete permissions object', () => {
    expect(PermissionsSchema.safeParse(buildPermissions('view')).success).toBe(true);
  });

  it('rejects a missing module, an unknown module and an unknown level', () => {
    const { bookings: _omitted, ...missing } = buildPermissions('view');
    expect(PermissionsSchema.safeParse(missing).success).toBe(false);
    expect(
      PermissionsSchema.safeParse({ ...buildPermissions('view'), booking: 'view' }).success,
    ).toBe(false);
    expect(
      PermissionsSchema.safeParse({ ...buildPermissions('view'), bookings: 'admin' }).success,
    ).toBe(false);
  });
});

describe('slugify', () => {
  it.each([
    ['Ìrìn Lagos Tours', 'irin-lagos-tours'],
    ['Ọlá & Sons Travel', 'ola-sons-travel'],
    ['  Front Desk (Yaba) ', 'front-desk-yaba'],
  ])('turns %s into %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('formatPhoneForDisplay', () => {
  it('shows Nigerian numbers the local way, others as stored', () => {
    expect(formatPhoneForDisplay('+2348031234567')).toBe('0803 123 4567');
    expect(formatPhoneForDisplay('+447700900123')).toBe('+447700900123');
  });
});
