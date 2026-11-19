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
 *   notice     { kind: 'notice', text }   an event, not a message: "Tolu from Ìrìn joined".
 *              The simulator shows it as a centred line; WhatsApp (13c-3) as italic text.
 *
 * A text can carry `link: { url, title, description }`: the preview the simulator draws under
 * it (real WhatsApp draws its own, from the page).
 *
 * The WORDING is your message catalogue (docs/designs/06-whatsapp/4-message-catalogue.html),
 * each message under its catalogue id. Lines marked "not in the designs" are mine: please check.
 */

export const LIMITS = {
  text: 4096,
  // The body of a message WITH buttons or a list is shorter than a plain text's.
  interactiveBody: 1024,
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

/**
 * @param {string} text
 * @param {{ url: string, title: string, description?: string }} [link] the preview to draw
 */
export const text = (text, link) => ({
  kind: 'text',
  text: fit(text, LIMITS.text),
  ...(link && { link }),
});

/** An event in the chat, not a message from anyone. @param {string} text */
export const notice = (text) => ({ kind: 'notice', text: fit(text, LIMITS.text) });

/**
 * @param {string} body
 * @param {Array<{ id: string, title: string }>} buttons
 */
export const buttons = (body, buttons) => ({
  kind: 'buttons',
  text: fit(body, LIMITS.interactiveBody),
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
  text: fit(body, LIMITS.interactiveBody),
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
  if (m.kind === 'text' || m.kind === 'notice')
    return typeof m.text === 'string' && m.text.length > 0 && m.text.length <= LIMITS.text;
  if (m.kind === 'buttons') {
    return (
      m.text.length <= LIMITS.interactiveBody &&
      m.buttons.length >= 1 &&
      m.buttons.length <= LIMITS.buttons &&
      m.buttons.every((/** @type {any} */ b) => b.id && b.title.length <= LIMITS.buttonTitle) &&
      new Set(m.buttons.map((/** @type {any} */ b) => b.title)).size === m.buttons.length
    );
  }
  if (m.kind === 'list') {
    return (
      m.text.length <= LIMITS.interactiveBody &&
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

// --- The wording: your message catalogue -----------------------------------------------------

/** "Ìrìn Lagos Tours" → "Ìrìn". @param {string} name */
export const shortName = (name) => name.split(/\s+/)[0] || name;
/** "Adaeze Okafor" → "Adaeze". @param {string} name */
export const firstName = (name) => name.trim().split(/\s+/)[0] || name;

/** @typedef {Array<{ id: string, title: string, description?: string }>} Rows */

const SEE_TOURS = { id: 'tours', title: 'See tours' };
const PERSON = { id: 'person', title: 'Talk to a person' };
const ONE_TWO_MORE = [
  { id: 'n:1', title: '1' },
  { id: 'n:2', title: '2' },
  { id: 'more', title: '3 or more' },
];
const ORDINALS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
];
/** 1 → "seat", 2 → "seats". @param {number} n @param {string} one @param {string} [many] */
export const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

export const say = {
  // hello
  /** @param {string} operatorName */
  hello: (operatorName) =>
    buttons(
      `Hi! I’m ${operatorName}’ booking assistant. I can show you our tours and book one for you here in the chat.`,
      [SEE_TOURS, PERSON],
    ),
  // tours
  /** @param {Rows} rows @param {string | null} pricesInclude "VAT" */
  tours: (rows, pricesInclude) =>
    list(
      `Here are our ${rows.length} ${plural(rows.length, 'tour')}. Prices are per adult${pricesInclude ? ` and include ${pricesInclude}` : ''}.`,
      'Choose a tour',
      rows,
    ),
  /** Not in the designs. */
  noTours: () => buttons('There are no tours on sale right now.', [PERSON]),
  // tour
  /** @param {string} body the tour, its summary, price, cancellation, link @param {Rows} rows */
  tour: (body, rows) => list(body, 'Choose a date', rows),
  // sold_out_pick
  /** @param {string} date "Fri 4 Dec" @param {Rows} rows */
  soldOutPick: (date, rows) =>
    list(`Sorry, ${date} is sold out. Please choose another date.`, 'Choose a date', rows),
  // no_dates
  /** @param {string} tour */
  noDates: (tour) =>
    buttons(`There are no dates for the ${tour} in the next 3 months.`, [
      { id: 'tours', title: 'See other tours' },
      PERSON,
    ]),
  // adults
  /** @param {string} when "Sat 5 Dec at 18:30" @param {number} seats @param {number} adultFrom 13 @param {string} [echo] */
  adults: (when, seats, adultFrom, echo = '') =>
    buttons(
      `${echo}${when}. ${seats} ${plural(seats, 'seat')} left.\n\nHow many adults (${adultFrom} or over)?`,
      ONE_TWO_MORE,
    ),
  // type_number
  typeNumber: () => text('Please type a number, like 4.'),
  // group_limit
  /** @param {number} max */
  groupLimit: (max) =>
    buttons(`For groups over ${max} the team plans it with you directly.`, [
      PERSON,
      { id: 'recount', title: 'Change the number' },
    ]),
  // under13
  /** @param {number} adultFrom @param {string} [echo] "4 adults. " */
  under: (adultFrom, echo = '') =>
    buttons(`${echo}Anyone under ${adultFrom} coming too?`, [
      { id: 'no', title: 'No' },
      { id: 'yes', title: 'Yes' },
    ]),
  // under13_count
  /** @param {number} adultFrom */
  underCount: (adultFrom) =>
    buttons(`How many under ${adultFrom}? Children must travel with an adult.`, ONE_TWO_MORE),
  // child_age
  /** @param {number} i 0 = the first child */
  childAge: (i) =>
    text(
      i === 0
        ? 'How old is the first child? Type the age in years, 0 for a baby.'
        : `And the ${ORDINALS[i] ?? `next (${i + 1})`} child?`,
    ),
  /** Not in the designs. @param {number} adultFrom */
  childAgeAgain: (adultFrom) =>
    text(
      `Please type an age under ${adultFrom}, like 8. (${adultFrom} or over counts as an adult.)`,
    ),
  // travellers_ok
  /** @param {string[]} lines "1 child (8) · ₦20,000" */
  travellersOk: (lines) => text(['Got it:', ...lines].join('\n')),
  // no_adult
  /** @param {number} adultFrom */
  noAdult: (adultFrom) =>
    buttons(
      `Children must travel with an adult. How many adults (${adultFrom} or over)?`,
      ONE_TWO_MORE,
    ),
  /** The website's own words for a rule (e.g. "Infants can't join this tour"). @param {string} message */
  problem: (message) => text(message),
  // extras
  /** @param {Rows} rows @param {boolean} again */
  extras: (rows, again) =>
    list(again ? 'Which extra?' : 'Would you like an extra?', 'See extras', [
      ...rows,
      { id: 'noextras', title: 'No extras', description: 'Continue without extras' },
    ]),
  // extra_qty
  /** @param {string} name "palm wine sampler" @param {string} price @param {number | null} left */
  extraQty: (name, price, left) =>
    buttons(
      `How many ${name.toLowerCase()}s? ${price} each${left !== null ? `, ${left} left` : ''}.`,
      ONE_TWO_MORE,
    ),
  /** Not in the designs. @param {number} left */
  extraTooMany: (left) => text(`Sorry, only ${left} left. Please type a smaller number.`),
  // extra_more
  extraMore: () =>
    buttons('Added. Anything else?', [
      { id: 'more_extras', title: 'Add another extra' },
      { id: 'done', title: 'No, that’s all' },
    ]),
  // pickup
  /** @param {Rows} rows */
  pickup: (rows) =>
    list('Where should the van pick you up? Pickup is included.', 'Choose pickup point', rows),
  /** After choosing: "Pickup: Ikoyi, Falomo roundabout at 07:30. Please be there…" @param {string} where @param {string} then */
  pickupChosen: (where, then) =>
    text(`Pickup: ${where}. Please be there 5 minutes early.\n\n${then}`),
  // name
  nameText: 'What name should the booking be under?',
  name: () => text('What name should the booking be under?'),
  // email
  /** @param {string} first */
  email: (first) =>
    buttons(`Thanks, ${first}. An email for your receipt? Type it, or tap Skip.`, [
      { id: 'skip', title: 'Skip' },
    ]),
  /** Not in the designs. */
  emailAgain: () =>
    buttons('That doesn’t look like an email address. Type it again, or tap Skip.', [
      { id: 'skip', title: 'Skip' },
    ]),
  // seats_short
  /** @param {number} left @param {string} date @param {number} asked @param {boolean} canShrink */
  seatsShort: (left, date, asked, canShrink) =>
    buttons(
      left === 0
        ? `Sorry, someone booked while we were chatting. ${date} is now full.` // not in the designs
        : `Sorry, someone booked while we were chatting. Only ${left} ${plural(left, 'seat')} ${left === 1 ? 'is' : 'are'} left on ${date} now, and you asked for ${asked}.`,
      [
        ...(canShrink && left > 0
          ? [{ id: 'shrink', title: `Book ${left} ${plural(left, 'seat')}` }]
          : []),
        { id: 'other_date', title: 'Choose another date' },
        PERSON,
      ],
    ),
  // "Choose another date" (seats ran out, hold expired)
  /** @param {Rows} rows */
  keepAnswers: (rows) => list('No problem, I’ll keep your other answers.', 'Choose a date', rows),
  // summary / summary_deposit
  /**
   * @param {string} body
   * @param {{ full: string, deposit?: { pct: number, amount: string } }} pay
   */
  summary: (body, pay) =>
    buttons(
      body,
      pay.deposit
        ? [
            { id: 'pay_full', title: `Pay in full ${pay.full}` },
            { id: 'pay_deposit', title: `Pay ${pay.deposit.pct}% · ${pay.deposit.amount}` },
            { id: 'change', title: 'Change something' },
          ]
        : [
            { id: 'pay', title: `Pay ${pay.full}` },
            { id: 'change', title: 'Change something' },
            { id: 'cancel', title: 'Cancel' },
          ],
    ),
  // change
  /** @param {Rows} rows */
  change: (rows) => list('What would you like to change?', 'Choose what', rows),
  // pay_link
  /** @param {string} url @param {string} until "11:15" @param {{ title: string, description: string }} preview */
  payLink: (url, until, preview) =>
    text(
      `Here’s your secure payment link. Pay by card or bank transfer.\n${url}\n\nThe link works while your seats are held, until ${until}. I’ll message you here as soon as the payment arrives.`,
      { url, ...preview },
    ),
  /** Branches design. @param {string} amount @param {string} due "Sat 28 Nov" @param {string} url @param {{ title: string, description: string }} preview */
  depositLink: (amount, due, url, preview) =>
    text(
      `Here’s your link for the ${amount} deposit. I’ll remind you about the balance before ${due}.\n${url}`,
      { url, ...preview },
    ),
  // declined
  /** @param {string} until */
  declined: (until) =>
    buttons(
      `Your payment didn’t go through, so no money was taken. Your seats are still held until ${until}.`,
      [{ id: 'retry', title: 'Try again' }, PERSON],
    ),
  /** Branches design ("Try again"). @param {string} url @param {{ title: string, description: string }} preview */
  newLink: (url, preview) =>
    text(`Here’s a new link. You can choose bank transfer instead of a card.\n${url}`, {
      url,
      ...preview,
    }),
  /** Not in the designs: "Pay" after the 30 minutes ran out. */
  holdOver: () =>
    buttons('Sorry, the 30 minutes to pay are up, so the seats were released.', [
      { id: 'hold_again', title: 'Hold them again' },
      { id: 'other_date', title: 'Choose another date' },
      { id: 'cancel', title: 'Cancel' },
    ]),
  // hold_expired
  /** @param {boolean} stillFree */
  holdExpired: (stillFree) =>
    stillFree
      ? buttons(
          'Your 30 minutes are up, so the seats were released. They’re still free, and I can hold them again with the same details.',
          [
            { id: 'hold_again', title: 'Hold them again' },
            { id: 'other_date', title: 'Choose another date' },
            { id: 'cancel', title: 'Cancel' },
          ],
        )
      : buttons(
          // Not in the designs (the note: "Hold them again" is replaced by "Choose another date").
          'Your 30 minutes are up, so the seats were released, and that date doesn’t have enough seats any more.',
          [
            { id: 'other_date', title: 'Choose another date' },
            { id: 'cancel', title: 'Cancel' },
          ],
        ),
  // held_again
  /** @param {number} n @param {string} until @param {string} amount @param {string} url @param {{ title: string, description: string }} preview */
  heldAgain: (n, until, amount, url, preview) =>
    text(
      `Done. Your ${n} ${plural(n, 'seat')} ${n === 1 ? 'is' : 'are'} held until ${until}. Here’s a fresh link for ${amount}.\n${url}`,
      { url, ...preview },
    ),
  // confirmed
  /** @param {string[]} lines */
  confirmed: (lines) => text(['*✓ Booking confirmed*', ...lines].join('\n')),
  // ticket
  /** @param {string} url */
  ticketImage: (url) => ({
    kind: 'image',
    url,
    caption: 'Your ticket. Show it to the guide at the start.',
  }),
  // trip_link
  /** @param {string} url @param {{ title: string, description: string }} preview */
  tripLink: (url, preview) =>
    text(`Your trip page has the map, what to bring and this ticket:\n${url}`, { url, ...preview }),
  // after
  after: () =>
    buttons('Tell us about allergies any time by replying here. Enjoy the trip!', [
      { id: 'tours', title: 'Book another tour' },
      PERSON,
    ]),
  /** Not in the designs: a message after booking, passed to the team (decided 2026-11-19). @param {string} operatorName */
  passedOn: (operatorName) =>
    text(`Thanks, I’ve passed that on to the ${shortName(operatorName)} team. They’ll reply here.`),
  // help
  help: () =>
    buttons(
      'I can show you our tours and book one for you here. Tap a button, or type:\n• menu  • start again  • cancel  • person',
      [SEE_TOURS, PERSON],
    ),
  // not_understood
  /** @param {string} operatorName */
  notUnderstood: (operatorName) =>
    buttons(
      `Sorry, I didn’t catch that. I work best with the buttons. For advice, the ${shortName(operatorName)} team can help.`,
      [SEE_TOURS, PERSON],
    ),
  /** The first sentence of not_understood, before asking the step's question again. */
  didntCatch: () => text('Sorry, I didn’t catch that.'),
  // start_again
  startAgain: () => buttons('Starting again. Nothing was booked.', [SEE_TOURS, PERSON]),
  // cancel_confirm
  /** @param {boolean} seatsHeld */
  cancelConfirm: (seatsHeld) =>
    buttons(
      seatsHeld ? 'Stop this booking? Your held seats will be released.' : 'Stop this booking?',
      [
        { id: 'stop', title: 'Yes, stop' },
        { id: 'carry_on', title: 'No, carry on' },
      ],
    ),
  // cancelled_chat
  cancelled: () => text('Stopped. Nothing was booked or paid. Type menu any time to start again.'),
  // handover
  /** @param {string} operatorName @param {string | null} hours "08:00–20:00" @param {string | null} heldUntil */
  handover: (operatorName, hours, heldUntil) =>
    text(
      `I’ve asked the ${shortName(operatorName)} team to join. They usually reply within a few minutes${hours ? `, ${hours}` : ''}.${heldUntil ? ` Your seats stay held until ${heldUntil}.` : ''} Until they reply, you can still type menu.`,
    ),
  // team_away
  /** @param {string} opens "08:00" @param {string | null} heldUntil */
  teamAway: (opens, heldUntil) =>
    text(
      `The team is away now and back at ${opens}. I’ve passed on your message.${heldUntil ? ` Your seats stay held until ${heldUntil}; after that I can hold them again.` : ''}`,
    ),
  // staff joined / handed back (events, shown as a line)
  /** @param {string} staff "Tolu" @param {string} operatorName */
  staffJoined: (staff, operatorName) =>
    notice(`${firstName(staff)} from ${shortName(operatorName)} joined · the assistant is paused`),
  /** @param {string} staff */
  staffLeft: (staff) => notice(`${firstName(staff)} handed back to the assistant`),
  // handback
  /** @param {string} first @param {string} where "2 seats on Sat 5 Dec held until 11:15, total ₦74,000." @param {any} summaryButtons the summary's buttons message */
  welcomeBack: (first, where, summaryButtons) =>
    buttons(`Welcome back, ${first}. Here’s where we were: ${where}`, summaryButtons.buttons),
  /** Not in the designs: handed back with nothing in progress. @param {string} first */
  welcomeBackFresh: (first) =>
    buttons(`Welcome back${first ? `, ${first}` : ''}. Anything else I can help with?`, [
      SEE_TOURS,
      PERSON,
    ]),
};
