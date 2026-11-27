// @vitest-environment node
// @ts-check
/**
 * Stage 19c-2: the office's screens load from their own file (screens/office.js). Every
 * screen App.jsx asks it for must be there: a missing one would only show when someone
 * opened that screen.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('the office screens file', () => {
  it('has every screen App.jsx loads from it, and App.jsx no longer imports them directly', async () => {
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    const asked = [...app.matchAll(/officeScreen\('(\w+)'\)/g)].map((m) => m[1]);
    expect(asked.sort()).toEqual(
      [
        'Bookings',
        'Dashboard',
        'Departure',
        'Inbox',
        'ManagerToday',
        'More',
        'Posters',
        'Schedule',
        'Settings',
      ].sort(),
    );
    const office = await import('../src/screens/office.js');
    for (const name of asked) {
      expect(typeof (/** @type {any} */ (office)[name]), name).toBe('function');
    }
    // A direct import would pull the screen back into the main file.
    for (const name of asked) {
      expect(app).not.toMatch(new RegExp(`from './screens/${name}\\.jsx'`));
    }
  });
});
