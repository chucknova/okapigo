/**
 * Settings › Staff and roles (O10), stage 16e-3: the rules in lib/settings.js, then the screen
 * against a fake server: the team in words, inviting (emailed, or words to copy), resending,
 * editing (making an owner asks first), removing (what was waiting, the departures left without
 * a guide, then those departures), and who sees the section at all.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '../src/App.jsx';
import { EngineContext } from '../src/lib/engine.jsx';
import { createSyncEngine } from '../src/lib/sync.js';
import { createMemoryStore } from '../src/lib/store.js';
import { request } from '../src/lib/api.js';
import { clearLive } from '../src/lib/live.js';
import {
  becomesOwner,
  firstName,
  inviteLine,
  removeWords,
  roleChoices,
  roleLine,
  staffBody,
  staffErrors,
  staffForm,
  staffTone,
  visibleSections,
} from '../src/lib/settings.js';

afterEach(() => {
  cleanup();
  clearLive();
  vi.unstubAllGlobals();
});

const ALL = {
  products: 'edit',
  bookings: 'edit',
  payments: 'edit',
  operations: 'edit',
  channels: 'edit',
  marketing: 'edit',
  reports: 'edit',
  settings: 'edit',
};
const OWNER = {
  user: { name: 'Bisola Adeyemi', role: { key: 'owner', name: 'Owner' } },
  operator: { name: 'Ìrìn Lagos Tours', timeZone: 'Africa/Lagos' },
  permissions: ALL,
  owner: { name: 'Bisola Adeyemi' },
};
const MANAGER = {
  ...OWNER,
  user: { name: 'Kunle Bello', role: { key: 'manager', name: 'Operations manager' } },
  permissions: { ...ALL, products: 'view', channels: 'view', marketing: 'view', settings: 'none' },
};
const GUIDE_ME = {
  ...OWNER,
  user: { name: 'Femi Ade', role: { key: 'guide', name: 'Guide' } },
  permissions: {
    ...Object.fromEntries(Object.keys(ALL).map((k) => [k, 'none'])),
    products: 'view',
    bookings: 'view',
    operations: 'edit',
  },
};

const ROLES = [
  { id: 'r-owner', key: 'owner', name: 'Owner', isPreset: true },
  { id: 'r-manager', key: 'manager', name: 'Operations manager', isPreset: true },
  { id: 'r-guide', key: 'guide', name: 'Guide', isPreset: true },
  { id: 'r-desk', key: 'front-desk', name: 'Front desk', isPreset: false },
];
const role = (/** @type {string} */ key) => {
  const r = /** @type {any} */ (ROLES.find((x) => x.key === key));
  return { id: r.id, key: r.key, name: r.name };
};
/** A row as GET /api/staff gives it. @param {any} o */
const person = (o) => ({
  isActive: true,
  status: 'active',
  statusText: 'Active',
  upcoming: [],
  waiting: null,
  email: null,
  phone: null,
  ...o,
});
const STAFF = [
  person({
    id: 'u-bisola',
    name: 'Bisola Adeyemi',
    contact: 'bisola@irinlagostours.example',
    role: role('owner'),
  }),
  person({
    id: 'u-dayo',
    name: 'Dayo Ogunleye',
    contact: '0809 777 8899',
    role: role('guide'),
    status: 'invited',
    statusText: 'Invited · hasn’t signed in',
  }),
  person({
    id: 'u-kunle',
    name: 'Kunle Bello',
    contact: 'kunle@irinlagostours.example',
    role: role('manager'),
  }),
  person({
    id: 'u-tolu',
    name: 'Tolu Bakare',
    contact: '0807 444 5566',
    role: role('guide'),
    statusText: 'Active · synced 07:31',
    waiting: '3 changes waiting on their phone at its last sync (07:31)',
    upcoming: [
      { id: 'd-1', text: 'Heritage Walk · Sat 5 Dec, 09:00 (today)' },
      { id: 'd-2', text: 'Street Food · Fri 11 Dec, 18:30' },
    ],
  }),
];

/** @param {Record<string, (body: any) => [number, any]>} routes */
function fakeFetch(routes) {
  /** @type {{ method: string, path: string, body: any }[]} */
  const sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body) : undefined;
      sent.push({ method, path, body });
      const route = routes[`${method} ${path}`];
      if (!route)
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: path } }), {
          status: 404,
        });
      const [status, json] = route(body);
      return new Response(JSON.stringify(json), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return sent;
}

/** The team routes; more can be added. @param {Record<string, (body: any) => [number, any]>} [more] */
const team = (more = {}) =>
  fakeFetch({
    'GET /api/staff': () => [200, { staff: STAFF, you: 'u-bisola' }],
    'GET /api/roles': () => [200, { roles: ROLES }],
    ...more,
  });

/** @param {any} me @param {string} path */
async function show(me, path) {
  const engine = createSyncEngine({
    request,
    store: createMemoryStore({
      session: { token: 'tok', user: me.user, contact: 'x' },
      meta: { firstRunDone: true },
      me,
    }),
  });
  await engine.load();
  const { hook } = memoryLocation({ path });
  render(
    <EngineContext.Provider value={engine}>
      <Router hook={hook}>
        <App base="" />
      </Router>
    </EngineContext.Provider>,
  );
}

describe('settings.js: staff', () => {
  it('who sees which sections (managers and guides don’t see Staff)', () => {
    const keys = (/** @type {any} */ me) => visibleSections(me).map((x) => x.key);
    expect(keys(OWNER)).toEqual(['website', 'embed', 'messages', 'whatsapp', 'staff', 'tours']);
    expect(keys(MANAGER)).toEqual(['website', 'embed', 'whatsapp', 'tours']);
    expect(keys(GUIDE_ME)).toEqual(['tours']);
    expect(keys(null)).toEqual([]);
  });

  it('the roles in order, with what each may do', () => {
    expect(roleChoices([...ROLES].reverse()).map((r) => r.key)).toEqual([
      'guide',
      'manager',
      'owner',
      'front-desk',
    ]);
    expect(roleLine(role('owner'))).toBe('Everything, including prices, staff and settings.');
    expect(roleLine(role('manager'))).toMatch(/^Schedule, bookings, refunds and inbox\. Can’t/);
    expect(roleLine(role('front-desk'))).toBe(
      'A role your business made: it can do what its permissions say.',
    );
    expect(staffTone('active')).toBe('success');
    expect(staffTone('invited')).toBe('warning');
    expect(staffTone('removed')).toBe('muted');
    expect(firstName('  Dayo Ogunleye ')).toBe('Dayo');
  });

  it('the form’s checks; only what changed is sent; becoming an owner', () => {
    expect(staffErrors({ name: 'D', contact: '', roleId: '' })).toEqual({
      name: 'Enter their name.',
      contact: 'Enter the email or phone they’ll sign in with.',
      roleId: 'Choose a role.',
    });
    expect(staffErrors({ name: 'Dayo', contact: 'dayo@', roleId: 'r' }).contact).toBe(
      'Enter an email like dayo@example.com, or a phone like 0809 777 8899.',
    );
    expect(staffErrors({ name: 'x'.repeat(101), contact: '0809 777 8899', roleId: 'r' })).toEqual({
      name: 'Keep the name under 100 characters.',
    });
    expect(staffErrors({ name: 'Dayo', contact: '0809 777 8899', roleId: 'r' })).toEqual({});

    const saved = staffForm(STAFF[2]);
    expect(saved).toEqual({
      name: 'Kunle Bello',
      contact: 'kunle@irinlagostours.example',
      roleId: 'r-manager',
    });
    expect(staffBody({ ...saved, name: ' Kunle Bello ' }, saved)).toEqual({});
    expect(staffBody({ ...saved, name: 'Kunle B.', contact: '0806 111 2233 ' }, saved)).toEqual({
      name: 'Kunle B.',
      contact: '0806 111 2233',
    });
    expect(staffBody({ ...saved, roleId: 'r-owner' }, saved)).toEqual({ roleId: 'r-owner' });
    expect(becomesOwner(ROLES, { ...saved, roleId: 'r-owner' }, saved)).toBe(true);
    expect(becomesOwner(ROLES, { ...saved, roleId: 'r-guide' }, saved)).toBe(false);
    const owner = staffForm(STAFF[0]);
    expect(becomesOwner(ROLES, { ...owner, name: 'B' }, owner)).toBe(false);
  });

  it('removing, in words: signed out at once; what was waiting; the departures', () => {
    const tolu = removeWords(STAFF[3]);
    expect(tolu).toMatchObject({
      title: 'Remove Tolu’s access?',
      signOut: 'Tolu is signed out at once, on every phone. You can give access back later.',
      departures: '2 upcoming departures will have no guide:',
      yes: 'Remove and show me those departures',
      no: 'Keep Tolu',
    });
    expect(tolu.waiting).toBe(
      '3 changes waiting on their phone at its last sync (07:31). Those don’t arrive once Tolu is removed: ask Tolu to open OkapiGo with signal first, or someone redoes them on the departure.',
    );
    const one = removeWords({ ...STAFF[3], upcoming: [STAFF[3].upcoming[0]], waiting: null });
    expect(one).toMatchObject({
      departures: '1 upcoming departure will have no guide:',
      yes: 'Remove and show me it',
      waiting: null,
    });
    expect(removeWords(STAFF[2])).toMatchObject({ departures: null, yes: 'Remove Kunle' });
  });

  it('after an invitation, in a line', () => {
    expect(inviteLine({ how: 'email', to: 'dayo@example.com', problem: null })).toBe(
      'Invitation emailed to dayo@example.com.',
    );
    expect(inviteLine({ how: 'copy', to: '0809 777 8899', problem: null })).toBe(
      'Copy this and send it to 0809 777 8899 by WhatsApp or SMS:',
    );
    expect(inviteLine({ how: 'copy', to: 'x', problem: 'Email isn’t set up.' })).toBe(
      'Email isn’t set up.',
    );
  });
});

describe('Settings › Staff and roles', () => {
  it('the team in words; Resend only for someone invited; a manager doesn’t see it', async () => {
    team();
    await show(OWNER, '/settings/staff');
    const list = await screen.findByRole('list', { name: 'Staff' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('Bisola Adeyemi (you)');
    expect(rows[3].textContent).toContain('Active · synced 07:31');
    expect(rows[1].textContent).toContain('Invited · hasn’t signed in');
    expect(screen.getAllByRole('button', { name: /^Resend/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Resend Dayo Ogunleye’s invitation' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(4);
    cleanup();
    clearLive();

    team();
    await show(MANAGER, '/settings');
    await screen.findByRole('link', { name: /Website/ });
    expect(screen.queryByRole('link', { name: /Staff and roles/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Messages/ })).toBeNull();
  });

  it('invite: checked first; by phone, the words to copy', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...globalThis.navigator, clipboard: { writeText }, onLine: true });
    const words =
      'Hi Segun, Bisola has added you to Ìrìn Lagos Tours on OkapiGo as a guide.\n\nOpen http://localhost:4000/app/ on your phone and sign in with 0806 111 2233. We’ll send you a code.';
    const sent = team({
      'POST /api/staff': (b) => [
        201,
        {
          user: person({ id: 'u-segun', name: b.name, contact: b.contact, role: role('guide') }),
          invite: { how: 'copy', to: '0806 111 2233', words, problem: null },
        },
      ],
    });
    await show(OWNER, '/settings/staff');
    const form = await screen.findByRole('region', { name: 'Invite someone' });
    // The role menu starts on Guide, with what a guide may do.
    expect(/** @type {HTMLSelectElement} */ (within(form).getByLabelText(/^Role/)).value).toBe(
      'r-guide',
    );
    expect(within(form).getByText('Their own departures, manifests and check-in.')).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Invite' }));
    expect(within(form).getByText('Enter their name.')).toBeTruthy();
    expect(sent.some((x) => x.method === 'POST')).toBe(false);

    fireEvent.change(within(form).getByLabelText(/^Name/), { target: { value: ' Segun Ade ' } });
    fireEvent.change(within(form).getByLabelText(/^Email or phone/), {
      target: { value: '0806 111 2233' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Invite' }));
    expect(
      await within(form).findByText('Copy this and send it to 0806 111 2233 by WhatsApp or SMS:'),
    ).toBeTruthy();
    expect(sent.find((x) => x.method === 'POST')?.body).toEqual({
      name: 'Segun Ade',
      contact: '0806 111 2233',
      roleId: 'r-guide',
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Copy the words' }));
    expect(await within(form).findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(words);
    // The form is empty again, for the next person.
    expect(/** @type {HTMLInputElement} */ (within(form).getByLabelText(/^Name/)).value).toBe('');
  });

  it('invite by email; resend; refused (someone already uses it)', async () => {
    let taken = false;
    team({
      'POST /api/staff': () =>
        taken
          ? [
              409,
              {
                error: {
                  code: 'CONTACT_IN_USE',
                  message: 'Someone already uses that email or phone.',
                },
              },
            ]
          : [
              201,
              {
                user: person({
                  id: 'u-amaka',
                  name: 'Amaka',
                  contact: 'a@x.com',
                  role: role('guide'),
                }),
                invite: { how: 'email', to: 'amaka@example.com', words: 'w', problem: null },
              },
            ],
      'POST /api/staff/u-dayo/invite': () => [
        200,
        { invite: { how: 'copy', to: '0809 777 8899', words: 'Hi Dayo…', problem: null } },
      ],
    });
    await show(OWNER, '/settings/staff');
    const form = await screen.findByRole('region', { name: 'Invite someone' });
    fireEvent.change(within(form).getByLabelText(/^Name/), { target: { value: 'Amaka Obi' } });
    fireEvent.change(within(form).getByLabelText(/^Email or phone/), {
      target: { value: 'amaka@example.com' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Invite' }));
    expect(await within(form).findByText('Invitation emailed to amaka@example.com.')).toBeTruthy();
    expect(within(form).queryByRole('button', { name: 'Copy the words' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Resend Dayo Ogunleye’s invitation' }));
    expect(
      await within(form).findByText('Copy this and send it to 0809 777 8899 by WhatsApp or SMS:'),
    ).toBeTruthy();

    taken = true;
    fireEvent.change(within(form).getByLabelText(/^Name/), { target: { value: 'Amaka Obi' } });
    fireEvent.change(within(form).getByLabelText(/^Email or phone/), {
      target: { value: 'amaka@example.com' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Invite' }));
    expect(await within(form).findByText('Someone already uses that email or phone.')).toBeTruthy();
    // What was typed stays, to fix.
    expect(
      /** @type {HTMLInputElement} */ (within(form).getByLabelText(/^Email or phone/)).value,
    ).toBe('amaka@example.com');
  });

  it('edit: only what changed; making someone an owner asks first', async () => {
    const sent = team({
      'PATCH /api/staff/u-kunle': (b) => [200, { user: { ...STAFF[2], ...b }, unguided: [] }],
    });
    await show(OWNER, '/settings/staff');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Kunle Bello' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit Kunle Bello' });
    const save = /** @type {HTMLButtonElement} */ (
      within(sheet).getByRole('button', { name: 'Save' })
    );
    expect(save.disabled).toBe(true); // nothing changed yet
    fireEvent.change(within(sheet).getByLabelText(/^Role/), { target: { value: 'r-owner' } });
    expect(
      within(sheet).getByText('Everything, including prices, staff and settings.'),
    ).toBeTruthy();
    fireEvent.click(save);
    // Asked first.
    expect(within(sheet).getByText('Owners can change prices, staff and payouts.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(sent.some((x) => x.method === 'PATCH')).toBe(false);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make Kunle an owner' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({ roleId: 'r-owner' });
  });

  it('edit: a name with no owner question; the server’s refusal shown', async () => {
    let refuse = true;
    const sent = team({
      'PATCH /api/staff/u-kunle': (b) =>
        refuse
          ? [
              409,
              {
                error: { code: 'LAST_OWNER', message: 'There must always be at least one owner.' },
              },
            ]
          : [200, { user: { ...STAFF[2], ...b }, unguided: [] }],
    });
    await show(OWNER, '/settings/staff');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Kunle Bello' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit Kunle Bello' });
    fireEvent.change(within(sheet).getByLabelText(/^Name/), { target: { value: 'K' } });
    expect(within(sheet).getByText('Enter their name.')).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText(/^Name/), { target: { value: 'Kunle B.' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('There must always be at least one owner.')).toBeTruthy();
    refuse = false;
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent.filter((x) => x.method === 'PATCH').map((x) => x.body)).toEqual([
      { name: 'Kunle B.' },
      { name: 'Kunle B.' },
    ]);
  });

  it('yourself: your name, not your role or access', async () => {
    team();
    await show(OWNER, '/settings/staff');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Bisola Adeyemi' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit Bisola Adeyemi' });
    expect(within(sheet).getByLabelText(/^Role/).matches(':disabled')).toBe(true);
    expect(within(sheet).getByText('You can’t change your own role.')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Remove access' })).toBeNull();
  });

  it('remove: asked, with what was waiting and the departures; then those departures', async () => {
    const sent = team({
      'PATCH /api/staff/u-tolu': () => [
        200,
        {
          user: { ...STAFF[3], isActive: false, status: 'removed', statusText: 'No access' },
          unguided: STAFF[3].upcoming,
        },
      ],
    });
    await show(OWNER, '/settings/staff');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tolu Bakare' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit Tolu Bakare' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove access' }));
    const ask = within(sheet).getByRole('group', { name: 'Remove Tolu’s access?' });
    expect(
      within(ask).getByText(/^3 changes waiting on their phone at its last sync/),
    ).toBeTruthy();
    expect(within(ask).getByText('2 upcoming departures will have no guide:')).toBeTruthy();
    expect(within(ask).getByText('Heritage Walk · Sat 5 Dec, 09:00 (today)')).toBeTruthy();
    // Keep Tolu: back to the form, nothing sent.
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep Tolu' }));
    expect(sent.some((x) => x.method === 'PATCH')).toBe(false);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove access' }));
    fireEvent.click(
      within(sheet).getByRole('button', { name: 'Remove and show me those departures' }),
    );
    const done = await screen.findByRole('status', { name: 'Removed' });
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({ isActive: false });
    expect(done.textContent).toContain('Tolu’s access is removed.');
    expect(
      within(done)
        .getByRole('link', { name: 'Street Food · Fri 11 Dec, 18:30 ›' })
        .getAttribute('href'),
    ).toBe('/departures/d-2');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('someone removed: give access back', async () => {
    const gone = person({
      id: 'u-amaka',
      name: 'Amaka Obi',
      contact: 'amaka@example.com',
      role: role('guide'),
      isActive: false,
      status: 'removed',
      statusText: 'No access',
    });
    const sent = fakeFetch({
      'GET /api/staff': () => [200, { staff: [STAFF[0], gone], you: 'u-bisola' }],
      'GET /api/roles': () => [200, { roles: ROLES }],
      'PATCH /api/staff/u-amaka': () => [200, { user: { ...gone, isActive: true }, unguided: [] }],
    });
    await show(OWNER, '/settings/staff');
    expect(await screen.findByText('No access')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Amaka Obi' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit Amaka Obi' });
    expect(within(sheet).queryByRole('button', { name: 'Remove access' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Give access back' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({ isActive: true });
  });
});
