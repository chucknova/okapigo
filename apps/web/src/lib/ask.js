// @ts-check
/**
 * ask.js — the trip page's "Ask a question" card (the AI companion, GST-16; designs C1–C2,
 * stage 18a-2): which state it's in, and its words. The card (screens/trip/AskCard.jsx) only
 * draws what these say.
 *
 *   askMode(…)        open · limit · paused · offline · closed
 *   askNotice(…)      the box for limit, paused, offline and closed
 *   askItems(…)       the conversation: questions, answers (with their source), "passed to
 *                     the team", and the team's reply
 *   leftWords(4)      "4 questions left today" (only from 5 left down: it doesn't nag)
 *   askFailure(err)   what a refused question means for the card
 *   savedAsk / saveAsk  the conversation saved on this phone (it's opened with no signal)
 */
import { formatAt } from '@okapigo/shared/tour-facts';
import { ApiError } from './api.js';

/** @typedef {'open' | 'limit' | 'paused' | 'offline' | 'closed'} AskMode */

/**
 * @typedef {{
 *   id: string, question: string, answer: string | null,
 *   outcome: 'answered' | 'handed_over' | 'unsure', source: string | null,
 *   createdAt: string, reply: { text: string, at: string, by: string | null } | null,
 * }} AskMessage
 * @typedef {{
 *   available: boolean, reason: 'closed' | 'limit' | 'paused' | null, left: number,
 *   suggestions: string[], messages: AskMessage[],
 * }} AskState
 */

/**
 * Which state the card is in. A booking that's over (cancelled, no-show) is closed whatever
 * the last answer said; no signal comes next (the saved answers still show); then what the
 * server said, or what the last question was refused for.
 * @param {{ state: AskState | null, offline: boolean, phase: string, refused?: AskMode | null }} p
 * @returns {AskMode}
 */
export function askMode({ state, offline, phase, refused = null }) {
  if (phase === 'cancelled' || phase === 'no_show' || state?.reason === 'closed') return 'closed';
  if (refused === 'closed') return 'closed';
  if (offline) return 'offline';
  if (refused === 'limit' || state?.reason === 'limit') return 'limit';
  if (refused === 'paused' || state?.reason === 'paused') return 'paused';
  return 'open';
}

/**
 * The box shown instead of (or above) the field, in each state but "open".
 * @param {AskMode} mode
 * @param {string} op  the business's short name ("Ìrìn")
 * @param {string} phase
 * @returns {null | { tone: 'neutral' | 'warning' | 'dark' | 'plain', title: string, body: string }}
 */
export function askNotice(mode, op, phase) {
  switch (mode) {
    case 'limit':
      return {
        tone: 'neutral',
        title: 'That’s all the questions for today',
        body: `You can ask again tomorrow. For anything now, message ${op}.`,
      };
    case 'paused':
      return {
        tone: 'warning',
        title: 'The assistant isn’t available right now',
        body: `Message ${op} instead: they’ll answer you directly.`,
      };
    case 'offline':
      return {
        tone: 'dark',
        title: 'No signal',
        body: 'Your earlier answers are saved here; asking a new question needs a signal.',
      };
    case 'closed':
      return {
        tone: 'plain',
        title: 'Questions',
        body:
          phase === 'cancelled'
            ? `This booking is cancelled, so the assistant is closed. For anything about your refund, message ${op}.`
            : `Questions are closed for this booking. For anything else, message ${op}.`,
      };
    default:
      return null;
  }
}

/**
 * "4 questions left today", from 5 down; nothing above that.
 * @param {number} left
 */
export function leftWords(left) {
  if (left > 5) return null;
  return `${left} ${left === 1 ? 'question' : 'questions'} left today`;
}

/**
 * @typedef {(
 *   | { key: string, type: 'question', text: string }
 *   | { key: string, type: 'answer', text: string, source: string | null }
 *   | { key: string, type: 'handed', title: string, text: string }
 *   | { key: string, type: 'unsure', title: string, text: string }
 *   | { key: string, type: 'reply', title: string, meta: string, text: string }
 * )} AskItem
 */

/**
 * The conversation, oldest first, as the designs draw it.
 * @param {AskMessage[]} messages
 * @param {string} op
 * @param {string} timeZone
 * @returns {AskItem[]}
 */
export function askItems(messages, op, timeZone) {
  /** @type {AskItem[]} */
  const items = [];
  for (const m of messages) {
    items.push({ key: `${m.id}:q`, type: 'question', text: m.question });
    if (m.outcome === 'answered') {
      items.push({
        key: `${m.id}:a`,
        type: 'answer',
        text: m.answer ?? '',
        source: m.source ? `From ${op}’s notes: “${m.source}”` : null,
      });
    } else if (m.outcome === 'handed_over') {
      items.push({
        key: `${m.id}:h`,
        type: 'handed',
        title: `Passed to ${op}’s team`,
        text: 'I’m not sure about that, so I’ve sent your question to the team. They’ll reply by WhatsApp or email, and here.',
      });
    } else {
      items.push({
        key: `${m.id}:u`,
        type: 'unsure',
        title: 'I’m not sure about that',
        text: `You already have questions waiting for ${op}’s team, so this one wasn’t sent. Message ${op} instead.`,
      });
    }
    if (m.reply) {
      const when = formatAt(Date.parse(m.reply.at), timeZone);
      items.push({
        key: `${m.id}:r`,
        type: 'reply',
        title: `Reply from ${op}`,
        meta: m.reply.by ? `${m.reply.by} · ${when}` : when,
        text: m.reply.text,
      });
    }
  }
  return items;
}

/**
 * What a refused question means for the card: the day's limit, the assistant paused (the
 * spend cap, or the AI service down: 503), the booking closed, no signal; else null (show
 * the server's own words).
 * @param {unknown} err
 * @returns {AskMode | null}
 */
export function askFailure(err) {
  if (!(err instanceof ApiError)) return null;
  if (err.kind === 'offline' || err.kind === 'timeout') return 'offline';
  if (err.code === 'COMPANION_LIMIT') return 'limit';
  if (err.code === 'COMPANION_CLOSED') return 'closed';
  if (err.status === 503) return 'paused';
  return null;
}

// --- Saved on this phone ----------------------------------------------------------------

/** Kept beside the trip's own copy (trip-copy.js), and cleared with it. */
export const ASK_COPY = 'okg-ask:';

/** @param {string} token @returns {AskState | null} */
export function savedAsk(token) {
  try {
    const raw = localStorage.getItem(ASK_COPY + token);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** @param {string} token @param {AskState} state */
export function saveAsk(token, state) {
  try {
    localStorage.setItem(ASK_COPY + token, JSON.stringify(state));
  } catch {
    // Full or blocked: the card works, just without a saved copy.
  }
}

/**
 * The question field in each state: shown; greyed out while the assistant is paused; gone
 * once the day's questions are used, the booking is closed, or the page opened with no
 * signal. A question that failed for lack of signal keeps the field (and its words), so the
 * guest can send it again.
 * @param {AskMode} mode
 * @param {AskMode | null} refused
 * @returns {'show' | 'disabled' | 'hidden'}
 */
export function askField(mode, refused) {
  if (mode === 'open' || (mode === 'offline' && refused === 'offline')) return 'show';
  if (mode === 'paused') return 'disabled';
  return 'hidden';
}
