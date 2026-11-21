/**
 * Settings (O10), stage 16e-1: the rules in lib/settings.js, then the screens against a fake
 * server: the style, the business details (errors, the save bar, leaving with unsaved
 * changes), look-only for a manager, and Embed (the snippet, approved websites).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from '../src/App.jsx';
import { EngineContext } from '../src/lib/engine.jsx';
import { createSyncEngine } from '../src/lib/sync.js';
import { createMemoryStore } from '../src/lib/store.js';
import { request } from '../src/lib/api.js';
import { clearLive } from '../src/lib/live.js';
import {
  applyLabel,
  changedFields,
  countLine,
  detailsBody,
  detailsErrors,
  detailsForm,
  embedSnippet,
  embedWarning,
  fixLine,
  instagramUrl,
  mayEdit,
  readableOn,
  stylePreview,
  styleStatus,
} from '../src/lib/settings.js';

afterEach(() => {
  cleanup();
  clearLive();
  vi.unstubAllGlobals();
});

const OWNER = {
  user: { name: 'Bisola Adeyemi', role: { key: 'owner', name: 'Owner' } },
  operator: { name: 'Ìrìn Lagos Tours', timeZone: 'Africa/Lagos' },
  permissions: { bookings: 'edit', operations: 'edit', marketing: 'edit', settings: 'edit' },
  owner: { name: 'Bisola Adeyemi' },
};
const MANAGER = {
  ...OWNER,
  user: { name: 'Tunde Bakare', role: { key: 'manager', name: 'Manager' } },
  permissions: { bookings: 'edit', operations: 'edit', marketing: 'view', settings: 'none' },
};

const WEBSITE = {
  slug: 'irin-lagos-tours',
  siteUrl: 'https://okapigo.app/irin-lagos-tours',
  embedScriptUrl: 'https://okapigo.app/embed.js',
  style: 'lagoon',
  mode: 'light',
  phone: '+2348030000001',
  whatsapp: '+2348090000123',
  site: {
    tagline: 'Walk Lagos with people who love it',
    about: 'Ìrìn means “walk” in Yoruba.',
    email: 'hello@irinlagostours.com',
    address: 'Yaba, Lagos',
    socials: [{ network: 'instagram', url: 'https://instagram.com/irinlagostours' }],
  },
  embedDomains: ['irinlagostours.com'],
  styles: ['lagoon', 'classic', 'earth'],
  modes: ['auto', 'light', 'dark'],
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

describe('settings.js: the business details', () => {
  const saved = detailsForm(WEBSITE);

  it('the form from the server: phones as written, Instagram as a handle', () => {
    expect(saved).toEqual({
      tagline: 'Walk Lagos with people who love it',
      whatsapp: '0809 000 0123',
      about: 'Ìrìn means “walk” in Yoruba.',
      phone: '0803 000 0001',
      email: 'hello@irinlagostours.com',
      address: 'Yaba, Lagos',
      instagram: '@irinlagostours',
    });
    expect(detailsForm({ site: {} })).toMatchObject({ tagline: '', phone: '', instagram: '' });
  });

  it('Instagram: a handle, with or without @, or a link', () => {
    expect(instagramUrl('@irin.tours')).toBe('https://instagram.com/irin.tours');
    expect(instagramUrl('irin.tours')).toBe('https://instagram.com/irin.tours');
    expect(instagramUrl('https://www.instagram.com/irin_tours/')).toBe(
      'https://instagram.com/irin_tours',
    );
    expect(instagramUrl('not a handle')).toBeNull();
    expect(instagramUrl('  ')).toBeNull();
  });

  it('what to fix, in the designs’ words', () => {
    expect(detailsErrors(saved)).toEqual({});
    const bad = {
      ...saved,
      tagline: 'x'.repeat(86),
      email: 'hello@irinlagostours',
      phone: '12345',
      instagram: 'not a handle',
    };
    expect(detailsErrors(bad)).toEqual({
      tagline: 'Too long: 86 of 80 characters. It’s the big title on your site.',
      email: 'This email is missing its ending, like .com.',
      phone: 'Enter 11 digits like 0803 123 4567, or start with +234.',
      instagram: 'Enter your handle, like @irinlagostours.',
    });
    expect(detailsErrors({ ...saved, email: 'hello' }).email).toBe(
      'Enter an email like hello@example.com.',
    );
    expect(detailsErrors({ ...saved, tagline: 'x'.repeat(80) }).tagline).toBeUndefined();
    expect(detailsErrors({ ...saved, tagline: 'x'.repeat(81) }).tagline).toMatch(
      /^Too long: 81 of 80/,
    );
    expect(detailsErrors({ ...saved, about: 'x'.repeat(1501) }).about).toBe(
      'Too long: 1501 of 1500 characters.',
    );
    expect(detailsErrors({ ...saved, email: '', phone: '' })).toEqual({});
    expect(fixLine(1)).toBe('1 thing to fix before saving');
    expect(fixLine(2)).toBe('2 things to fix before saving');
  });

  it('what changed; what’s sent (only that; emptied clears; Instagram as a link)', () => {
    const f = { ...saved, tagline: 'Walk Lagos with us', instagram: '@irin.new', phone: '' };
    expect(changedFields(f, saved)).toEqual(['Tagline', 'Phone', 'Instagram']);
    expect(changedFields({ ...saved, tagline: `${saved.tagline}  ` }, saved)).toEqual([]);
    expect(detailsBody(f, saved)).toEqual({
      site: {
        tagline: 'Walk Lagos with us',
        socials: [{ network: 'instagram', url: 'https://instagram.com/irin.new' }],
      },
      phone: '',
    });
    expect(detailsBody({ ...saved, instagram: '' }, saved)).toEqual({ site: { socials: [] } });
    expect(detailsBody(saved, saved)).toEqual({});
    expect(countLine('Walk Lagos ', 80, 'the hero title')).toBe(
      '10 of 80 characters · the hero title',
    );
  });
});

describe('settings.js: style and embed', () => {
  it('a style card’s colours come from the website’s tokens', () => {
    const light = stylePreview('lagoon', false);
    expect(light).toMatchObject({ bg: '#F4F6F3', button: '#9BD10F', onButton: '#111511' });
    expect(stylePreview('lagoon', true).button).toBe('#B5E64A');
    expect(stylePreview('classic', false).font).toMatch(/serif/i);
  });

  it('previewing vs live', () => {
    const live = { style: 'lagoon', mode: 'light' };
    expect(styleStatus(live, live)).toBe('This is your live style.');
    expect(applyLabel(live, live)).toBe('Applied');
    const shown = { style: 'classic', mode: 'dark' };
    expect(styleStatus(shown, live)).toBe(
      'Previewing Classic, dark. Your checkout pages change too.',
    );
    expect(applyLabel(shown, live)).toBe('Apply Classic dark');
  });

  it('the snippet: all tours, one tour, a pop-up button (made safe)', () => {
    const base = {
      slug: 'irin-lagos-tours',
      label: 'Book now',
      colour: '#0F4C5C',
      scriptUrl: 'https://okapigo.app/embed.js',
    };
    expect(embedSnippet({ ...base, tour: null, widget: 'inline' })).toBe(
      '<div data-okapigo="irin-lagos-tours"></div>\n<script src="https://okapigo.app/embed.js" async></script>',
    );
    expect(
      embedSnippet({ ...base, tour: 'lagos-island-heritage-walk', widget: 'inline' }),
    ).toContain('data-tour="lagos-island-heritage-walk"></div>');
    expect(
      embedSnippet({ ...base, tour: null, widget: 'button', label: ' Book the "Walk" <now> ' }),
    ).toBe(
      '<div data-okapigo="irin-lagos-tours" data-widget="button" data-label="Book the &quot;Walk&quot; &lt;now&gt;" data-colour="#0F4C5C"></div>\n<script src="https://okapigo.app/embed.js" async></script>',
    );
    // An empty label: the script's own "Book now".
    expect(embedSnippet({ ...base, tour: null, widget: 'button', label: ' ' })).not.toContain(
      'data-label',
    );
  });

  it('readable text on a colour (embed.js’s rule); a warning with no website; who may edit', () => {
    expect(readableOn('#0F4C5C')).toBe('#FFFFFF');
    expect(readableOn('#9BD10F')).toBe('#111511');
    expect(readableOn('#000000')).toBe('#FFFFFF');
    expect(readableOn('#FFFFFF')).toBe('#111511');
    expect(readableOn('green')).toBe('#111511');
    expect(embedWarning([])).toBe('Add your website first, or the widget won’t show.');
    expect(embedWarning(['irin.com'])).toBeNull();
    expect(mayEdit(OWNER, 'marketing')).toBe(true);
    expect(mayEdit(MANAGER, 'marketing')).toBe(false);
    expect(mayEdit(null, 'marketing')).toBe(false);
  });
});

describe('Settings › Website', () => {
  it('the style: previewed, then applied', async () => {
    const sent = fakeFetch({
      'GET /api/website': () => [200, { website: WEBSITE }],
      'PATCH /api/website': () => [200, { website: { ...WEBSITE, style: 'classic' } }],
    });
    await show(OWNER, '/settings/website');
    expect(await screen.findByText('This is your live style.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Applied' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('radio', { name: /Classic/ }));
    expect(
      screen.getByText('Previewing Classic, light. Your checkout pages change too.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply Classic light' }));
    await vi.waitFor(() =>
      expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({
        style: 'classic',
        mode: 'light',
      }),
    );
  });

  it('business details: errors to fix; the save bar; saved', async () => {
    const sent = fakeFetch({
      'GET /api/website': () => [200, { website: WEBSITE }],
      'PATCH /api/website': () => [200, { website: WEBSITE }],
    });
    await show(OWNER, '/settings/website');
    const tagline = await screen.findByRole('textbox', { name: /^Tagline/ });
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();
    fireEvent.change(tagline, { target: { value: 'x'.repeat(86) } });
    expect(screen.getByText('1 thing to fix before saving')).toBeTruthy();
    expect(
      screen.getByText('Too long: 86 of 80 characters. It’s the big title on your site.'),
    ).toBeTruthy();
    expect(screen.getByText('Unsaved changes: Tagline')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true);

    fireEvent.change(tagline, { target: { value: 'Walk Lagos with us' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/^Saved · \d\d:\d\d\.$/);
    expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({
      site: { tagline: 'Walk Lagos with us' },
    });
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();
  });

  it('discard; and leaving with unsaved changes asks first', async () => {
    fakeFetch({ 'GET /api/website': () => [200, { website: WEBSITE }] });
    await show(OWNER, '/settings/website');
    const email = await screen.findByRole('textbox', { name: 'Email' });
    fireEvent.change(email, { target: { value: 'new@irinlagostours.com' } });
    fireEvent.click(screen.getByRole('link', { name: /Embed on your site/ }));
    expect(screen.getByRole('heading', { name: 'Leave without saving?' })).toBeTruthy();
    expect(screen.getByText('Your change to email won’t be kept.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveProperty(
      'value',
      'new@irinlagostours.com',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveProperty(
      'value',
      'hello@irinlagostours.com',
    );
  });

  it('no connection: the changes stay, try again', async () => {
    fakeFetch({ 'GET /api/website': () => [200, { website: WEBSITE }] });
    await show(OWNER, '/settings/website');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Address' }), {
      target: { value: 'Surulere, Lagos' },
    });
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByText(/^Didn’t save/)).textContent).toMatch(
      /^Didn’t save: no connection\. Your changes are still here\./,
    );
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveProperty(
      'value',
      'Surulere, Lagos',
    );
  });

  it('a manager can look, not change', async () => {
    fakeFetch({ 'GET /api/website': () => [200, { website: WEBSITE }] });
    await show(MANAGER, '/settings/website');
    expect(await screen.findByText('Only the owner can change this. You can look.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /^Tagline/ }).closest('fieldset')).toHaveProperty(
      'disabled',
      true,
    );
  });
});

describe('Settings › Embed', () => {
  it('the snippet follows the choices; a website added; copied', async () => {
    const sent = fakeFetch({
      'GET /api/website': () => [200, { website: WEBSITE }],
      'GET /api/products': () => [
        200,
        {
          products: [
            {
              slug: 'lagos-island-heritage-walk',
              title: 'Lagos Island Heritage Walk',
              status: 'published',
            },
            { slug: 'epe-market', title: 'Epe Fish Market', status: 'draft' },
          ],
        },
      ],
      'PATCH /api/website': (body) => [
        200,
        { website: { ...WEBSITE, embedDomains: body.embedDomains } },
      ],
    });
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await show(OWNER, '/settings/embed');
    const snippet = await screen.findByText(/^<div data-okapigo="irin-lagos-tours"><\/div>/);
    expect(snippet).toBeTruthy();
    // Only tours on sale can be chosen.
    expect(screen.queryByRole('option', { name: 'Epe Fish Market' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Tour' }), {
      target: { value: 'lagos-island-heritage-walk' },
    });
    fireEvent.click(screen.getByRole('radio', { name: /Pop-up button/ }));
    expect(
      screen.getByText(
        /data-tour="lagos-island-heritage-walk" data-widget="button" data-label="Book now" data-colour="#9bd10f"/i,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('data-widget="button"'));

    fireEvent.change(screen.getByRole('textbox', { name: 'Website to add' }), {
      target: { value: 'tours.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await vi.waitFor(() =>
      expect(sent.find((x) => x.method === 'PATCH')?.body).toEqual({
        embedDomains: ['irinlagostours.com', 'tours.example'],
      }),
    );
  });

  it('no approved website: the warning', async () => {
    fakeFetch({
      'GET /api/website': () => [200, { website: { ...WEBSITE, embedDomains: [] } }],
      'GET /api/products': () => [200, { products: [] }],
    });
    await show(OWNER, '/settings/embed');
    expect(
      await screen.findByText('Add your website first, or the widget won’t show.'),
    ).toBeTruthy();
  });
});
