// @ts-check
/**
 * format.js — turning stored chat messages into what the phone shows (stage 13c-2). No React
 * here: the screens only draw what these functions return, and the tests check them alone.
 */

/**
 * The guests you can be (fictional, like all demo data). "Someone else" types their own.
 * @type {Array<{ name: string, phone: string }>}
 */
export const GUESTS = [
  { name: 'Adaeze Okafor', phone: '0803 123 4567' },
  { name: 'Tunde Bakare', phone: '0802 555 0101' },
  { name: 'Ngozi Eze', phone: '0809 444 2020' },
];

/** "Ìrìn Lagos Tours" → "Ìrìn". @param {string} name */
export const shortName = (name) => name.trim().split(/\s+/)[0] || name;

/** "Ìrìn Lagos Tours" → "Ì": the header's picture. @param {string} name */
export const initial = (name) => [...name.trim()][0]?.toUpperCase() ?? '?';

/**
 * WhatsApp's own text formatting: *bold*, and links people can tap. Newlines are kept by the
 * bubble's CSS (white-space: pre-line).
 * @param {string} text
 * @returns {Array<{ type: 'text' | 'bold' | 'link', value: string }>}
 */
export function parseText(text) {
  /** @type {Array<{ type: 'text' | 'bold' | 'link', value: string }>} */
  const out = [];
  const pattern = /(\*[^*\n]+\*)|(https?:\/\/[^\s]+)/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = /** @type {number} */ (m.index);
    if (at > last) out.push({ type: 'text', value: text.slice(last, at) });
    if (m[1]) out.push({ type: 'bold', value: m[1].slice(1, -1) });
    else out.push({ type: 'link', value: m[2] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/**
 * A text with a link preview: the preview card shows the link (your design), so its own line
 * is taken out of the text. (Real WhatsApp shows both; its preview comes from the page.)
 * @param {string} text @param {{ url: string } | undefined} link
 */
export function withoutPreviewedLink(text, link) {
  if (!link) return text;
  return text
    .split('\n')
    .filter((line) => line.trim() !== link.url)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** "10:41" in the phone's own time zone. @param {string | Date} at */
export const timeOf = (at) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(at),
  );

/** "Tue 17 Nov". @param {string | Date} at */
export const dayOf = (at) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(at))
    .replace(',', '');

/**
 * @typedef {{ id: string, author: 'guest' | 'bot' | 'staff', authorName?: string | null, body: any, createdAt: string }} Stored
 * @typedef {{ key: string, kind: 'day', text: string }
 *   | { key: string, kind: 'event', text: string }
 *   | { key: string, kind: 'mine', text: string, time: string, status?: 'sending' | 'failed', localId?: string }
 *   | { key: string, kind: 'theirs', body: any, time: string, staff: string | null }} Item
 */

/**
 * The chat as the phone draws it: a day line whenever the day changes, the guest's messages
 * on one side, the bot's and staff's on the other, events in the middle; then anything still
 * sending (or that failed) at the end.
 * @param {Stored[]} messages
 * @param {Array<{ localId: string, text: string, status: 'sending' | 'failed', at: string }>} outbox
 * @param {string} operatorName
 * @returns {Item[]}
 */
export function chatItems(messages, outbox, operatorName) {
  /** @type {Item[]} */
  const items = [];
  let day = '';
  const dayLine = (/** @type {string} */ at) => {
    const d = dayOf(at);
    if (d !== day) {
      day = d;
      items.push({ key: `day:${d}`, kind: 'day', text: d });
    }
  };
  for (const m of messages) {
    dayLine(m.createdAt);
    const time = timeOf(m.createdAt);
    if (m.body.kind === 'notice') {
      items.push({ key: m.id, kind: 'event', text: m.body.text });
    } else if (m.author === 'guest') {
      items.push({
        key: m.id,
        kind: 'mine',
        text: m.body.kind === 'reply' ? m.body.title : m.body.text,
        time,
      });
    } else {
      items.push({
        key: m.id,
        kind: 'theirs',
        body: m.body,
        time,
        // "Tolu · Ìrìn team" (your design).
        staff:
          m.author === 'staff'
            ? `${m.authorName ?? 'Staff'} · ${shortName(operatorName)} team`
            : null,
      });
    }
  }
  for (const o of outbox) {
    dayLine(o.at);
    items.push({
      key: o.localId,
      kind: 'mine',
      text: o.text,
      time: timeOf(o.at),
      status: o.status,
      localId: o.localId,
    });
  }
  return items;
}

/**
 * Remembered per browser: which guest you are, and each guest's chat (its private token).
 * Storage can be missing or refuse (private windows): then nothing is remembered.
 */
export const memory = {
  /** @param {string} key */
  get(key) {
    try {
      return JSON.parse(globalThis.localStorage?.getItem(`okg-sim:${key}`) ?? 'null');
    } catch {
      return null;
    }
  },
  /** @param {string} key @param {unknown} value */
  set(key, value) {
    try {
      globalThis.localStorage?.setItem(`okg-sim:${key}`, JSON.stringify(value));
    } catch {
      // not remembered; the chat still works
    }
  },
};
