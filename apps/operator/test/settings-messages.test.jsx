/**
 * Settings › Messages and › WhatsApp (O10), stage 16e-2: the rules in lib/settings.js, then the
 * screens against a fake server: the list, the editor (a detail inserted where the cursor is,
 * what it must keep, the preview with a real booking, a test, back to OkapiGo's wording, save),
 * and WhatsApp (how it stands, the Phone number ID, disconnect asked first, a test, look-only).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act as rtlAct } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '../src/App.jsx';
import { EngineContext } from '../src/lib/engine.jsx';
import { createSyncEngine } from '../src/lib/sync.js';
import { createMemoryStore } from '../src/lib/store.js';
import { request } from '../src/lib/api.js';
import { clearLive } from '../src/lib/live.js';
import {
  approvedText,
  detailLabel,
  exampleLine,
  insertDetail,
  messageChanges,
  messageForm,
  messageProblems,
  messageRows,
  mustKeep,
  phoneIdError,
  testSentLine,
  whatsappRule,
  whatsappTone,
} from '../src/lib/settings.js';
import { MESSAGES, PLACEHOLDERS } from '@okapigo/shared/message-templates';

afterEach(() => {
  cleanup();
  clearLive();
  vi.unstubAllGlobals();
});

const OWNER = {
  user: { name: 'Bisola Adeyemi', role: { key: 'owner', name: 'Owner' } },
  operator: { name: 'Ìrìn Lagos Tours', timeZone: 'Africa/Lagos' },
  permissions: {
    bookings: 'edit',
    operations: 'edit',
    marketing: 'edit',
    settings: 'edit',
    channels: 'edit',
  },
  owner: { name: 'Bisola Adeyemi' },
};
const MANAGER = {
  ...OWNER,
  user: { name: 'Tunde Bakare', role: { key: 'manager', name: 'Manager' } },
  permissions: {
    bookings: 'edit',
    operations: 'edit',
    marketing: 'view',
    settings: 'none',
    channels: 'view',
  },
};

/** GET /api/message-templates, as the server builds it. @param {string} kind */
const template = (kind, custom = null) => {
  const m = /** @type {any} */ (MESSAGES)[kind];
  return {
    kind,
    name: m.name,
    when: m.when,
    placeholders: m.placeholders.map((/** @type {string} */ name) => ({
      name,
      description: /** @type {any} */ (PLACEHOLDERS)[name],
      required: m.required.includes(name),
    })),
    default: { subject: m.subject, body: m.body },
    custom,
    approved:
      kind === 'balance_reminder'
        ? 'Hi {first_name}, a reminder: {balance} is due by {due_date}.\n\nPay here: {pay_url}'
        : null,
  };
};
const TEMPLATES = {
  templates: [
    template('booking_confirmed'),
    template(
      'balance_reminder',
      /** @type {any} */ ({
        subject: 'Reminder: {balance} due',
        body: 'Hi {first_name}: {balance} by {due_date}. {pay_url}',
        updatedAt: '2026-11-20T10:00:00Z',
      }),
    ),
  ],
  approvedOnly: [
    {
      key: 'chat_followup',
      name: 'Can we help you finish booking?',
      when: 'when staff send it from a chat, to a guest who last wrote over 24 hours ago',
      text: 'Hi {first_name}, it’s {operator} on WhatsApp. Can we help you finish booking?',
    },
  ],
};

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
      if (status === 204) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(json), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return sent;
}

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

/** The preview route: the words filled with a real booking. */
const PREVIEW = (/** @type {any} */ b) => [
  200,
  {
    preview: {
      subject: (b.subject ?? '').replace('{balance}', '₦45,500'),
      body: (b.body ?? '')
        .replace('{first_name}', 'Funmi')
        .replace('{balance}', '₦45,500')
        .replace('{due_date}', 'Sat 28 Nov')
        .replace('{pay_url}', 'https://okapigo.example/pay'),
    },
    example: 'Funmi Adeyemi, ILT-3MZ8RB',
    problems: [],
  },
];

describe('settings.js: messages', () => {
  const reminder = TEMPLATES.templates[1];

  it('the list: each message with Default or Edited', () => {
    expect(messageRows(TEMPLATES)).toEqual([
      expect.objectContaining({ kind: 'booking_confirmed', tag: 'Default' }),
      expect.objectContaining({ kind: 'balance_reminder', tag: 'Edited' }),
    ]);
    // The words in force: the business's own, or OkapiGo's.
    expect(messageForm(reminder).body).toBe('Hi {first_name}: {balance} by {due_date}. {pay_url}');
    expect(messageForm(TEMPLATES.templates[0]).body).toBe(MESSAGES.booking_confirmed.body);
  });

  it('a detail goes where the cursor is, replacing a selection; the cursor after it', () => {
    expect(insertDetail('Hi , welcome', { start: 3, end: 3 }, 'first_name')).toEqual({
      text: 'Hi {first_name}, welcome',
      caret: 15,
    });
    expect(insertDetail('Hi NAME!', { start: 3, end: 7 }, 'first_name')).toEqual({
      text: 'Hi {first_name}!',
      caret: 15,
    });
    // A cursor past the end (the text got shorter) lands at the end.
    expect(insertDetail('Hi', { start: 9, end: 12 }, 'date')).toEqual({
      text: 'Hi{date}',
      caret: 8,
    });
    // A backwards selection never deletes text before it.
    expect(insertDetail('abc', { start: 2, end: 1 }, 'date').text).toBe('ab{date}c');
    expect(insertDetail('abc', { start: -4, end: 0 }, 'date').text).toBe('{date}abc');
  });

  it('what it must keep, ticked; the problems are the server’s', () => {
    expect(mustKeep(reminder, 'Hi {balance} by {due_date}')).toEqual([
      { name: 'balance', label: 'Balance', kept: true },
      { name: 'due_date', label: 'Due date', kept: true },
      { name: 'pay_url', label: 'Pay link', kept: false },
    ]);
    expect(messageProblems('balance_reminder', { subject: 'x', body: 'Hi {date' })).toEqual(
      expect.arrayContaining([
        'The message has a { or } that isn’t part of a placeholder.',
        'The message must include {pay_url}.',
      ]),
    );
    expect(messageProblems('balance_reminder', messageForm(reminder))).toEqual([]);
  });

  it('what changed; the approved text labelled; the lines', () => {
    const saved = { subject: 'a', body: 'b' };
    expect(messageChanges(saved, saved)).toEqual([]);
    expect(messageChanges({ subject: 'A', body: 'b' }, saved)).toEqual(['Subject']);
    expect(messageChanges({ subject: 'A', body: 'B' }, saved)).toEqual(['Subject', 'Message']);
    expect(approvedText('Hi {first_name}, {balance} by {due_date}. {pay_url}')).toBe(
      'Hi [First name], [Balance] by [Due date]. [Pay link]',
    );
    expect(detailLabel('nope')).toBe('nope');
    expect(exampleLine('Funmi Adeyemi, ILT-3MZ8RB')).toBe(
      'With a real booking: Funmi Adeyemi, ILT-3MZ8RB',
    );
    expect(exampleLine(null)).toBe('With a made-up booking (yours will show once you have one)');
    expect(testSentLine('0809 244 0014')).toBe('Sent to 0809 244 0014. Check your WhatsApp.');
    expect(whatsappRule(reminder)).toMatch(/^On WhatsApp, a guest who messaged you in the last 24/);
    expect(whatsappRule(TEMPLATES.templates[0])).toMatch(/^On WhatsApp, only a guest who/);
  });

  it('WhatsApp: the dot; the Phone number ID’s check', () => {
    expect(whatsappTone('connected')).toBe('success');
    expect(whatsappTone('waiting')).toBe('warning');
    expect(whatsappTone('simulator')).toBe('muted');
    expect(phoneIdError(' 109876543210987 ')).toBeNull();
    expect(phoneIdError('12345')).toBeNull();
    expect(phoneIdError('1234')).toMatch(/^Paste the Phone number ID: digits only/);
    expect(phoneIdError('0809 000 0123')).toMatch(/digits only/);
    expect(phoneIdError('  ')).toBe('Paste the Phone number ID from Meta’s API Setup page.');
  });
});

describe('Settings › Messages', () => {
  it('the list: Default and Edited; the approved-only message, read-only', async () => {
    fakeFetch({ 'GET /api/message-templates': () => [200, TEMPLATES] });
    await show(OWNER, '/settings/messages');
    const confirm = await screen.findByRole('link', { name: /Booking confirmation/ });
    expect(confirm.textContent).toContain('Default');
    expect(confirm.getAttribute('href')).toBe('/settings/messages/booking_confirmed');
    expect(screen.getByRole('link', { name: /Balance reminder/ }).textContent).toContain('Edited');
    expect(
      screen.getByText(
        'Hi [First name], it’s [Business name] on WhatsApp. Can we help you finish booking?',
      ),
    ).toBeTruthy();
    // Messages is built now: no "Coming next" beside it.
    expect(screen.getByRole('link', { name: 'Messages' }).textContent).not.toContain('Coming next');
  });

  it('the editor: a detail inserted at the cursor; what it must keep; save', async () => {
    const sent = fakeFetch({
      'GET /api/message-templates': () => [200, TEMPLATES],
      'POST /api/message-templates/balance_reminder/preview': PREVIEW,
      'PUT /api/message-templates/balance_reminder': (b) => [200, { template: b }],
    });
    await show(OWNER, '/settings/messages/balance_reminder');
    const box = /** @type {HTMLTextAreaElement} */ (
      await screen.findByRole('textbox', { name: /^Message/ })
    );
    expect(box.value).toBe('Hi {first_name}: {balance} by {due_date}. {pay_url}');
    // The preview, with one of the business's own bookings.
    expect(await screen.findByText('With a real booking: Funmi Adeyemi, ILT-3MZ8RB')).toBeTruthy();
    expect(
      await screen.findByText('Hi Funmi: ₦45,500 by Sat 28 Nov. https://okapigo.example/pay'),
    ).toBeTruthy();
    // The approved version, for a guest who hasn't written in 24 hours.
    expect(screen.getByText(/^Hi \[First name\], a reminder: \[Balance\]/)).toBeTruthy();

    // Drop the link: it's missing, and saving waits.
    fireEvent.change(box, { target: { value: 'Hi {first_name}: {balance} by {due_date}.' } });
    expect(screen.getByText('Pay link ✗')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('The message must include {pay_url}.');
    expect(
      /** @type {HTMLButtonElement} */ (screen.getByRole('button', { name: 'Save changes' }))
        .disabled,
    ).toBe(true);

    // Put it back with the chip, where the cursor is (after "Hi {first_name}: ").
    rtlAct(() => {
      box.focus();
      box.setSelectionRange(17, 17);
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Pay link' }));
    expect(box.value).toBe('Hi {first_name}: {pay_url}{balance} by {due_date}.');
    expect(screen.getByText('Pay link ✓')).toBeTruthy();
    expect(screen.getByText('Unsaved changes: Message')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/^Saved · \d\d:\d\d\.$/)).toBeTruthy();
    expect(sent.find((x) => x.method === 'PUT')?.body).toEqual({
      subject: 'Reminder: {balance} due',
      body: 'Hi {first_name}: {pay_url}{balance} by {due_date}.',
    });
    expect(screen.queryByText(/^Unsaved changes/)).toBeNull();
  });

  it('leaving with a wording that can’t be saved: “Save and leave” saves nothing', async () => {
    const sent = fakeFetch({
      'GET /api/message-templates': () => [200, TEMPLATES],
      'POST /api/message-templates/balance_reminder/preview': PREVIEW,
      'PUT /api/message-templates/balance_reminder': (b) => [200, { template: b }],
    });
    await show(OWNER, '/settings/messages/balance_reminder');
    const box = await screen.findByRole('textbox', { name: /^Message/ });
    fireEvent.change(box, { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('link', { name: '‹ Messages' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and leave' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.some((x) => x.method === 'PUT')).toBe(false);
    // Still here, the words still there.
    expect(
      /** @type {HTMLTextAreaElement} */ (screen.getByRole('textbox', { name: /^Message/ })).value,
    ).toBe('Hi');
  });

  it('the email tab: the subject, a detail into it; the email preview', async () => {
    fakeFetch({
      'GET /api/message-templates': () => [200, TEMPLATES],
      'POST /api/message-templates/balance_reminder/preview': PREVIEW,
    });
    await show(OWNER, '/settings/messages/balance_reminder');
    await screen.findByRole('textbox', { name: /^Message/ });
    expect(screen.queryByLabelText('Subject')).toBeNull();
    fireEvent.click(screen.getByLabelText('Email'));
    const subject = /** @type {HTMLInputElement} */ (screen.getByLabelText('Subject'));
    expect(await screen.findByText('Reminder: ₦45,500 due')).toBeTruthy();
    rtlAct(() => {
      subject.focus();
      subject.setSelectionRange(subject.value.length, subject.value.length);
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Date' }));
    expect(subject.value).toBe('Reminder: {balance} due{date}');
    expect(screen.getByText('Unsaved changes: Subject')).toBeTruthy();
  });

  it('a test to my WhatsApp: sent, or why not', async () => {
    let refuse = false;
    const sent = fakeFetch({
      'GET /api/message-templates': () => [200, TEMPLATES],
      'POST /api/message-templates/balance_reminder/preview': PREVIEW,
      'POST /api/message-templates/balance_reminder/test': () =>
        refuse
          ? [
              422,
              {
                error: {
                  code: 'TEST_NOT_SENT',
                  message: 'WhatsApp only lets a business write first to someone who messaged it.',
                  to: '0809 244 0014',
                },
              },
            ]
          : [201, { test: { to: '0809 244 0014' } }],
    });
    await show(OWNER, '/settings/messages/balance_reminder');
    fireEvent.click(await screen.findByRole('button', { name: 'Send a test to my WhatsApp' }));
    expect(await screen.findByText('Sent to 0809 244 0014. Check your WhatsApp.')).toBeTruthy();
    // The words on screen, even unsaved, are what's tested.
    expect(sent.find((x) => x.path.endsWith('/test'))?.body).toEqual({
      subject: 'Reminder: {balance} due',
      body: 'Hi {first_name}: {balance} by {due_date}. {pay_url}',
    });
    refuse = true;
    fireEvent.click(screen.getByRole('button', { name: 'Send a test to my WhatsApp' }));
    expect(
      await screen.findByText(
        'WhatsApp only lets a business write first to someone who messaged it.',
      ),
    ).toBeTruthy();
  });

  it('back to OkapiGo’s wording: asked first, then gone', async () => {
    const sent = fakeFetch({
      'GET /api/message-templates': () => [200, TEMPLATES],
      'POST /api/message-templates/balance_reminder/preview': PREVIEW,
      'DELETE /api/message-templates/balance_reminder': () => [204, null],
    });
    await show(OWNER, '/settings/messages/balance_reminder');
    fireEvent.click(await screen.findByRole('button', { name: 'Back to OkapiGo’s wording' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    expect(sent.some((x) => x.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Back to OkapiGo’s wording' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use OkapiGo’s wording' }));
    expect(await screen.findByText('Back to OkapiGo’s wording.')).toBeTruthy();
    expect(sent.some((x) => x.method === 'DELETE')).toBe(true);
    expect(
      /** @type {HTMLTextAreaElement} */ (screen.getByRole('textbox', { name: /^Message/ })).value,
    ).toBe(MESSAGES.balance_reminder.body);
    // OkapiGo's wording now: nothing to go back from.
    expect(screen.queryByRole('button', { name: 'Back to OkapiGo’s wording' })).toBeNull();
  });

  it('a default message has no way back (it is there); a manager can’t open Messages', async () => {
    fakeFetch({
      'GET /api/message-templates': () => [200, TEMPLATES],
      'POST /api/message-templates/booking_confirmed/preview': PREVIEW,
    });
    await show(OWNER, '/settings/messages/booking_confirmed');
    await screen.findByRole('textbox', { name: /^Message/ });
    expect(screen.queryByRole('button', { name: 'Back to OkapiGo’s wording' })).toBeNull();
    // No approved version shown for a message without one.
    expect(screen.queryByText('If they haven’t written in 24 hours')).toBeNull();
    cleanup();
    clearLive();
    fakeFetch({
      'GET /api/message-templates': () => [
        403,
        { error: { code: 'FORBIDDEN', message: 'Not allowed' } },
      ],
    });
    await show(MANAGER, '/settings/messages');
    expect(await screen.findByText('This page is for the owner')).toBeTruthy();
  });
});

const WHATSAPP = {
  phoneNumberId: '109876543210987',
  connected: true,
  state: 'connected',
  stateText: 'Connected · last message 10:51',
  why: null,
  businessNumber: '0809 000 0123',
  displayName: 'Ìrìn Lagos Tours',
  webhookUrl: 'https://api.okapigo.app/webhooks/whatsapp',
};

describe('Settings › WhatsApp', () => {
  it('how it stands; the number; the webhook to copy', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...globalThis.navigator, clipboard: { writeText }, onLine: true });
    fakeFetch({ 'GET /api/whatsapp': () => [200, { whatsapp: WHATSAPP }] });
    await show(OWNER, '/settings/whatsapp');
    expect(await screen.findByText('Connected · last message 10:51')).toBeTruthy();
    expect(screen.getByText('0809 000 0123')).toBeTruthy();
    expect(screen.getByText('https://api.okapigo.app/webhooks/whatsapp')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith('https://api.okapigo.app/webhooks/whatsapp');
    // No token anywhere on the page.
    expect(document.body.textContent).not.toMatch(/access token|verify token:/i);
  });

  it('not connected, and why; the Phone number ID checked, then saved', async () => {
    const sent = fakeFetch({
      'GET /api/whatsapp': () => [
        200,
        {
          whatsapp: {
            ...WHATSAPP,
            phoneNumberId: null,
            state: 'simulator',
            stateText: 'Not connected · using the simulator',
            why: 'Add your Phone number ID from Meta to connect your number.',
            businessNumber: null,
          },
        },
      ],
      'PATCH /api/whatsapp': (b) => [200, { whatsapp: { ...WHATSAPP, ...b } }],
    });
    await show(OWNER, '/settings/whatsapp');
    expect(await screen.findByText('Not connected · using the simulator')).toBeTruthy();
    expect(
      screen.getByText('Add your Phone number ID from Meta to connect your number.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'add it under Website' })).toBeTruthy();
    // Nothing to disconnect yet.
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    const id = screen.getByLabelText(/^Phone number ID/);
    fireEvent.change(id, { target: { value: '0809 000 0123' } });
    expect(
      screen.getByText('Paste the Phone number ID: digits only, from Meta’s API Setup page.'),
    ).toBeTruthy();
    const save = /** @type {HTMLButtonElement} */ (screen.getByRole('button', { name: 'Save' }));
    expect(save.disabled).toBe(true);
    fireEvent.change(id, { target: { value: ' 109876543210987 ' } });
    fireEvent.click(save);
    expect(await screen.findByText('Number saved.')).toBeTruthy();
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({
      phoneNumberId: '109876543210987',
    });
  });

  it('disconnect: asked first', async () => {
    const sent = fakeFetch({
      'GET /api/whatsapp': () => [200, { whatsapp: WHATSAPP }],
      'PATCH /api/whatsapp': () => [200, { whatsapp: WHATSAPP }],
    });
    await show(OWNER, '/settings/whatsapp');
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(screen.getByText(/stop reaching OkapiGo until you connect again/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it connected' }));
    expect(sent.some((x) => x.method === 'PATCH')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const group = screen.getByRole('group', { name: 'Disconnect WhatsApp?' });
    fireEvent.click(/** @type {HTMLElement} */ (group.querySelector('button.btn--danger')));
    expect(await screen.findByText('Disconnected.')).toBeTruthy();
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({ phoneNumberId: null });
  });

  it('a test: sent, or why not', async () => {
    let refuse = false;
    fakeFetch({
      'GET /api/whatsapp': () => [200, { whatsapp: WHATSAPP }],
      'POST /api/whatsapp/test': () =>
        refuse
          ? [
              409,
              {
                error: {
                  code: 'NO_PHONE',
                  message: 'Your account has no phone number to send a test to.',
                },
              },
            ]
          : [201, { test: { to: '0809 244 0014' } }],
    });
    await show(OWNER, '/settings/whatsapp');
    fireEvent.click(await screen.findByRole('button', { name: 'Send a test to my WhatsApp' }));
    expect(await screen.findByText('Sent to 0809 244 0014. Check your WhatsApp.')).toBeTruthy();
    refuse = true;
    fireEvent.click(screen.getByRole('button', { name: 'Send a test to my WhatsApp' }));
    expect(
      await screen.findByText('Your account has no phone number to send a test to.'),
    ).toBeTruthy();
  });

  it('a manager can look, not change', async () => {
    fakeFetch({ 'GET /api/whatsapp': () => [200, { whatsapp: WHATSAPP }] });
    await show(MANAGER, '/settings/whatsapp');
    expect(await screen.findByText('Only the owner can change this. You can look.')).toBeTruthy();
    expect(screen.getByLabelText(/^Phone number ID/).matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Send a test to my WhatsApp' })).toBeNull();
    // Copying the address is still fine.
    expect(
      /** @type {HTMLButtonElement} */ (screen.getByRole('button', { name: 'Copy' })).disabled,
    ).toBe(false);
  });
});
