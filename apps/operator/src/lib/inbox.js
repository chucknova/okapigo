// @ts-check
/**
 * inbox.js — what the inbox (O9) shows around the server's words (apps/api/src/routes/inbox.js):
 * which buttons a chat offers, the delivery tick, the take-over question. Stage 16d-1.
 */

/** How often an open chat looks for new messages (the list: every 15 s). */
export const CHAT_EVERY_MS = 5_000;
export const LIST_EVERY_MS = 15_000;

/**
 * What a chat lets you do now (designs: chats; phone and states; gaps).
 * @param {any} chat
 * @returns {{ takeOver: boolean, takeOverFrom: string | null, handBack: boolean, reply: boolean, followUp: boolean }}
 */
export function chatActions(chat) {
  const mine = chat.mode === 'mine';
  return {
    takeOver: chat.mode === 'bot',
    takeOverFrom: chat.mode === 'theirs' ? firstName(chat.holder ?? 'them') : null,
    handBack: mine,
    // The reply box: only yours, and only inside WhatsApp's 24 hours.
    reply: mine && chat.window.open,
    // Outside them: the approved "Can we help you finish booking?" (yours, or the bot's chat).
    followUp: !chat.window.open && chat.mode !== 'theirs',
  };
}

/** "Ngozi" @param {string} name */
export const firstName = (name) => name.trim().split(/\s+/)[0] ?? name;

/** The tick after a message of ours: "read", "delivered" (sent says nothing). @param {string | null} d */
export const deliveryWord = (d) => (d === 'read' ? 'read' : d === 'delivered' ? 'delivered' : '');

/** "Take over from Ngozi? She…": neutral (designs: "Ngozi will be told"). @param {string} holder */
export const takeOverQuestion = (holder) =>
  `Take over from ${firstName(holder)}? They’ll see you have the chat, and only you can reply.`;

/** The tab's label: "Chats · 2". @param {number} n */
export const chatsTab = (n) => (n > 0 ? `Chats · ${n}` : 'Chats');

/**
 * WhatsApp's *bold*, as parts to draw: "*Street Food Crawl* tonight" →
 * [{ bold: true, text: 'Street Food Crawl' }, { bold: false, text: ' tonight' }].
 * @param {string} text
 */
export function boldParts(text) {
  /** @type {Array<{ bold: boolean, text: string }>} */
  const parts = [];
  let at = 0;
  for (const m of text.matchAll(/\*([^*\n]+)\*/g)) {
    if (m.index > at) parts.push({ bold: false, text: text.slice(at, m.index) });
    parts.push({ bold: true, text: m[1] });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ bold: false, text: text.slice(at) });
  return parts;
}

// --- Requests (16d-2) ----------------------------------------------------------------------

/** The tab's label: "Requests · 1". @param {number} n */
export const requestsTab = (n) => (n > 0 ? `Requests · ${n}` : 'Requests');

/** What the reply box says, after moving (designs: "Done! You're now booked for…"). @param {string} to */
export const movedReply = (to) =>
  `Done! You’re now booked for ${to}, same meeting point. Your trip page has the new date.`;

/** The send button: "Send and mark answered" / "Send reply". @param {boolean} markAnswered */
export const replyLabel = (markAnswered) =>
  markAnswered ? 'Send and mark answered' : 'Send reply';

/**
 * A question the AI companion wasn't sure of (kind "question", 18a-2; designs: C3): what it
 * did, and the nudge to add the answer to the tour's FAQs. Null for other kinds.
 * @param {{ kind: string, lead: string, booking: { tour: string } }} r
 * @returns {null | { title: string, body: string, faqs: string }}
 */
export function assistantNote(r) {
  if (r.kind !== 'question') return null;
  return {
    title: 'The assistant wasn’t sure',
    body: `Nothing in the ${r.booking.tour}’s notes covers this, so it told ${firstName(r.lead)} the team would reply. It said nothing else.`,
    faqs: 'Guests may ask this again. Add it to the tour’s FAQs and the assistant answers it next time.',
  };
}

// --- Alerts (16d-3) ------------------------------------------------------------------------

/** The tab's label: "Alerts · 4". @param {number} n */
export const alertsTab = (n) => (n > 0 ? `Alerts · ${n}` : 'Alerts');

/** Above the list: "4 to deal with". @param {number} n */
export const alertsHeading = (n) => `${n} to deal with`;
