// @ts-check
/**
 * messages.js — what the WhatsApp booking assistant says, and the shapes it says it in
 * (BKG-09, session 13; flow brief docs/flows/06-whatsapp-booking.md).
 *
 * ONLY WhatsApp's own building blocks, so the same conversation runs in the in-app simulator
 * and on the real WhatsApp Cloud API (13c):
 *
 *   text       { kind: 'text', text }
 *   buttons    { kind: 'buttons', text, buttons: [{ id, title }] }       at most 3, 20 chars
 *   list       { kind: 'list', text, button, rows: [{ id, title, description? }] }
 *              at most 10 rows; title 24 chars, description 72, the list's button 20
 *   image      { kind: 'image', url, caption }      the QR ticket (13b); caption 1024 chars
 *
 * The builders below ENFORCE those limits (cutting with "…"), so nothing the bot says can be
 * refused by WhatsApp. `fitsWhatsApp()` is what the tests check every reply against.
 *
 * The WORDING is a draft (the brief's), kept in this one file: your designs replace it here.
 */

export const LIMITS = {
  text: 4096,
  buttons: 3,
  buttonTitle: 20,
  rows: 10,
  rowTitle: 24,
  rowDescription: 72,
  listButton: 20,
  caption: 1024,
};

/** Cuts to `max` characters, ending in "…" when it had to. @param {string} s @param {number} max */
export const fit = (s, max) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/** @param {string} text */
export const text = (text) => ({ kind: 'text', text: fit(text, LIMITS.text) });

/**
 * @param {string} body
 * @param {Array<{ id: string, title: string }>} buttons
 */
export const buttons = (body, buttons) => ({
  kind: 'buttons',
  text: fit(body, LIMITS.text),
  buttons: buttons
    .slice(0, LIMITS.buttons)
    .map((b) => ({ id: b.id, title: fit(b.title, LIMITS.buttonTitle) })),
});

/**
 * @param {string} body
 * @param {string} button  the list's own button ("Choose a tour")
 * @param {Array<{ id: string, title: string, description?: string }>} rows
 */
export const list = (body, button, rows) => ({
  kind: 'list',
  text: fit(body, LIMITS.text),
  button: fit(button, LIMITS.listButton),
  rows: rows.slice(0, LIMITS.rows).map((r) => ({
    id: r.id,
    title: fit(r.title, LIMITS.rowTitle),
    ...(r.description ? { description: fit(r.description, LIMITS.rowDescription) } : {}),
  })),
});

/**
 * Does a message fit WhatsApp's limits? (For the tests: every reply must.)
 * @param {any} m
 */
export function fitsWhatsApp(m) {
  if (m.kind === 'text')
    return typeof m.text === 'string' && m.text.length > 0 && m.text.length <= LIMITS.text;
  if (m.kind === 'buttons') {
    return (
      m.buttons.length >= 1 &&
      m.buttons.length <= LIMITS.buttons &&
      m.buttons.every((/** @type {any} */ b) => b.id && b.title.length <= LIMITS.buttonTitle) &&
      new Set(m.buttons.map((/** @type {any} */ b) => b.title)).size === m.buttons.length
    );
  }
  if (m.kind === 'list') {
    return (
      m.rows.length >= 1 &&
      m.rows.length <= LIMITS.rows &&
      m.button.length <= LIMITS.listButton &&
      m.rows.every(
        (/** @type {any} */ r) =>
          r.id &&
          r.title.length <= LIMITS.rowTitle &&
          (r.description ?? '').length <= LIMITS.rowDescription,
      )
    );
  }
  if (m.kind === 'image')
    return /^https?:\/\//.test(m.url) && (m.caption ?? '').length <= LIMITS.caption;
  return false;
}

// --- The wording (draft) ---------------------------------------------------------------------

/** "Ìrìn Lagos Tours" → "Ìrìn". @param {string} name */
export const shortName = (name) => name.split(/\s+/)[0] || name;

export const say = {
  /** @param {string} operatorName */
  hello: (operatorName) =>
    buttons(
      `Hi! I'm ${operatorName}' booking assistant. I can show you our tours and book one for you.`,
      [
        { id: 'tours', title: 'See tours' },
        { id: 'person', title: 'Talk to a person' },
      ],
    ),
  /** @param {Array<{ id: string, title: string, description?: string }>} rows @param {string | null} pricesInclude */
  tours: (rows, pricesInclude) =>
    list(
      `Here are our tours. Prices are per adult${pricesInclude ? ` and include ${pricesInclude}` : ''}.`,
      'Choose a tour',
      rows,
    ),
  noTours: () => text('There are no tours on sale right now. Type "person" to talk to the team.'),
  /** @param {string} details @param {Array<{ id: string, title: string, description?: string }>} rows */
  dates: (details, rows) => list(details, 'Choose a date', rows),
  noDates: () =>
    buttons('This tour has no dates with seats in the next 3 months.', [
      { id: 'tours', title: 'Other tours' },
      { id: 'person', title: 'Talk to a person' },
    ]),
  /** @param {string} categoryName "Adults (13+)" @param {boolean} first */
  howMany: (categoryName, first) =>
    first
      ? buttons(`How many ${categoryName}?`, [
          { id: 'n:1', title: '1' },
          { id: 'n:2', title: '2' },
          { id: 'more', title: '3 or more' },
        ])
      : buttons(`Any ${categoryName}?`, [
          { id: 'n:0', title: 'None' },
          { id: 'n:1', title: '1' },
          { id: 'more', title: '2 or more' },
        ]),
  /** @param {string} categoryName */
  typeCount: (categoryName) => text(`Type the number of ${categoryName}.`),
  /** @param {string} who "child" @param {number} n @param {string} range "3–12" */
  age: (who, n, range) => text(`How old is ${who} ${n}? (ages ${range})`),
  /** @param {string} message */
  problem: (message) => text(message),
  /** @param {string} name @param {string} price "₦5,000" @param {number} travellers */
  addOn: (name, price, travellers) =>
    buttons(`Would you like ${name} (${price} each)?`, [
      { id: 'n:0', title: 'No thanks' },
      { id: 'n:1', title: '1' },
      ...(travellers > 1 ? [{ id: `n:${travellers}`, title: `${travellers}, one each` }] : []),
    ]),
  /** @param {Array<{ id: string, title: string, description?: string }>} rows */
  pickup: (rows) => list('Where should we pick you up?', 'Choose a pickup', rows),
  name: () => text('What name should the booking be under?'),
  email: () =>
    buttons('An email for your receipt? (optional) Type it, or skip.', [
      { id: 'skip', title: 'Skip' },
    ]),
  holding: () => text('One moment, holding your seats…'),
  /** @param {string[]} lines @param {string} payLabel "Pay ₦70,000" @param {string} termsUrl */
  summary: (lines, payLabel, termsUrl) =>
    buttons([...lines, '', `By tapping Pay you accept the booking terms: ${termsUrl}`].join('\n'), [
      { id: 'pay', title: payLabel },
      { id: 'change', title: 'Change something' },
      { id: 'cancel', title: 'Cancel' },
    ]),
  /** @param {string} full "₦70,000" @param {string} deposit "₦21,000" @param {string} balanceDue "Sat 12 Dec" */
  payChoice: (full, deposit, balanceDue) =>
    buttons(`Pay it all now, or pay a deposit now and the rest by ${balanceDue}?`, [
      { id: 'pay_full', title: `Pay ${full}` },
      { id: 'pay_deposit', title: `Deposit ${deposit}` },
      { id: 'cancel', title: 'Cancel' },
    ]),
  /** @param {string} amount "₦70,000" @param {string} url @param {string} until "14:35" */
  payLink: (amount, url, until) =>
    text(
      `Pay ${amount} here: ${url}\n\nYour seats are held until ${until}. Your ticket arrives here as soon as the payment goes through.`,
    ),
  /** Sent by itself when the hold runs out (notices.js). */
  holdExpired: () =>
    buttons('Your 30 minutes are up, so the seats were given back. Want me to hold them again?', [
      { id: 'hold_again', title: 'Hold them again' },
      { id: 'tours', title: 'See tours' },
    ]),
  /** @param {string[]} lines the booking, line by line */
  ticket: (lines) => text(lines.join('\n')),
  /** @param {string} url @param {string} reference */
  ticketImage: (url, reference) => ({
    kind: 'image',
    url,
    caption: `Your ticket · ${reference}. Show this QR code at check-in.`,
  }),
  /** @param {string} tripUrl */
  tripLink: (tripUrl) =>
    text(
      `Your trip page (ticket, map, changes): ${tripUrl}\n\nType "person" any time to reach the team.`,
    ),
  holdOver: () =>
    buttons('Sorry, the 30 minutes to pay are up and the seats were given back.', [
      { id: 'tours', title: 'See tours' },
      { id: 'person', title: 'Talk to a person' },
    ]),
  cancelled: () =>
    buttons('Cancelled. Nothing was charged.', [{ id: 'tours', title: 'See tours' }]),
  /** @param {string} operatorName */
  person: (operatorName) =>
    text(
      `I've asked the ${shortName(operatorName)} team to join. They usually reply within a few minutes. (Until they do, you can still type "menu".)`,
    ),
  /** A staff member took over (take-over API). @param {string} staffName @param {string} operatorName */
  staffJoined: (staffName, operatorName) =>
    text(
      `${staffName.split(/\s+/)[0]} from the ${shortName(operatorName)} team has joined the chat.`,
    ),
  /** Staff handed the chat back to the bot. */
  handBack: () =>
    buttons("Thanks for chatting with the team. I'm here if you need anything else.", [
      { id: 'tours', title: 'See tours' },
    ]),
  /** @param {string} again what to choose ("Choose from the list") */
  didntGet: (again) => text(`Sorry, I didn't get that. ${again}, or type "menu" to start again.`),
};
