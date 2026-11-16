import { describe, it, expect } from 'vitest';
import { MODULES, PRESET_ROLES, buildPermissions, hasAccess } from '../src/permissions.js';

describe('hasAccess', () => {
  it('treats edit as including view, and view as including none', () => {
    expect(hasAccess('edit', 'view')).toBe(true);
    expect(hasAccess('view', 'view')).toBe(true);
    expect(hasAccess('view', 'none')).toBe(true);
  });

  it('denies a lower level than required', () => {
    expect(hasAccess('view', 'edit')).toBe(false);
    expect(hasAccess('none', 'view')).toBe(false);
  });
});

describe('buildPermissions', () => {
  it('always includes every module', () => {
    expect(Object.keys(buildPermissions('none')).sort()).toEqual([...MODULES].sort());
  });

  it('applies overrides on top of the fallback', () => {
    const p = buildPermissions('none', { bookings: 'edit' });
    expect(p.bookings).toBe('edit');
    expect(p.payments).toBe('none');
  });
});

describe('PRESET_ROLES', () => {
  const byKey = Object.fromEntries(PRESET_ROLES.map((r) => [r.key, r.permissions]));

  it('defines exactly owner, manager and guide', () => {
    expect(PRESET_ROLES.map((r) => r.key)).toEqual(['owner', 'manager', 'guide']);
  });

  it('gives the owner edit access to everything', () => {
    expect(Object.values(byKey.owner).every((level) => level === 'edit')).toBe(true);
  });

  it('lets a guide check guests in but not see payments or settings', () => {
    expect(byKey.guide.operations).toBe('edit');
    expect(byKey.guide.payments).toBe('none');
    expect(byKey.guide.settings).toBe('none');
  });

  it('lets a manager handle refunds but not manage staff', () => {
    expect(byKey.manager.payments).toBe('edit');
    expect(byKey.manager.settings).toBe('none');
  });
});
