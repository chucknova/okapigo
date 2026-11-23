// @ts-check
/**
 * "Ask a question": the AI companion on the trip page (GST-16; designs C1–C2, stage 18a-2).
 *
 *   C1   nothing asked yet: the tour's own FAQs to tap, and the question field
 *   C2   the conversation: answers with where they came from, "Looking in Ìrìn's notes…",
 *        "Passed to Ìrìn's team" and, later, the team's reply
 *        states: the day's questions used · not available · no signal · closed
 *
 * Which state, and every word, come from lib/ask.js. The conversation is saved on this phone
 * (savedAsk), so it shows with no signal, like the rest of the page.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/data.js';
import { whatsappUrl } from '../../lib/map.js';
import {
  askField,
  askFailure,
  askItems,
  askMode,
  askNotice,
  leftWords,
  savedAsk,
  saveAsk,
} from '../../lib/ask.js';

/**
 * @param {{ token: string, b: any, op: string, phase: string, offline: boolean }} props
 */
export function AskCard({ token, b, op, phase, offline }) {
  const live = useApi(offline ? null : `/public/bookings/${token}/companion`);
  const [saved] = useState(() => savedAsk(token)); // read once: the copy from last time
  /** Questions asked on this page since it loaded, newest last. */
  const [asked, setAsked] = useState(/** @type {import('../../lib/ask.js').AskMessage[]} */ ([]));
  const [left, setLeft] = useState(/** @type {number | null} */ (null));
  const [pending, setPending] = useState(/** @type {string | null} */ (null));
  const [text, setText] = useState('');
  const [refused, setRefused] = useState(
    /** @type {import('../../lib/ask.js').AskMode | null} */ (null),
  );
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));

  const fresh = /** @type {import('../../lib/ask.js').AskState | null} */ (live.data);
  useEffect(() => {
    if (fresh) saveAsk(token, fresh);
  }, [fresh, token]);

  const base = fresh ?? saved;
  const known = new Set((base?.messages ?? []).map((m) => m.id));
  const messages = [...(base?.messages ?? []), ...asked.filter((m) => !known.has(m.id))];
  const leftNow = left ?? base?.left ?? 20;
  const noSignal = offline || (!base && askFailure(live.error) === 'offline');
  const mode = askMode({ state: base, offline: noSignal || refused === 'offline', phase, refused });
  const field = askField(mode, refused);
  const notice = askNotice(mode, op, phase);
  const items = askItems(messages, op, b.operator.timeZone);
  const { whatsapp, phone } = b.operator;
  const reach = whatsapp
    ? { href: whatsappUrl(whatsapp), label: `Message ${op} on WhatsApp` }
    : phone
      ? { href: `tel:${phone}`, label: `Call ${op}` }
      : null;

  /** @param {string} words */
  const ask = async (words) => {
    const question = words.trim();
    if (!question || pending) return;
    setPending(question);
    setProblem(null);
    setRefused(null);
    setText('');
    try {
      const r = await api(`/public/bookings/${token}/companion`, {
        method: 'POST',
        body: { question },
      });
      const all = [...messages, r.message];
      setAsked((xs) => [...xs, r.message]);
      setLeft(r.left);
      saveAsk(token, {
        ...(base ?? { available: true, reason: null, suggestions: [] }),
        left: r.left,
        messages: all,
      });
    } catch (err) {
      const why = askFailure(err);
      setRefused(why);
      // Their words stay in the field when it's still there to send again.
      if (why === 'offline' || why === null) setText(question);
      if (why === null) setProblem(/** @type {Error} */ (err).message);
    } finally {
      setPending(null);
    }
  };

  if (mode === 'closed' && notice) {
    return (
      <section className="okg-card okg-trip__card" aria-labelledby="okg-ask-h">
        <h2 className="okg-trip__h2" id="okg-ask-h">
          {notice.title}
        </h2>
        <p className="okg-muted">{notice.body}</p>
      </section>
    );
  }

  const suggestions =
    items.length === 0 && !pending && mode === 'open' ? (base?.suggestions ?? []) : [];
  const leftLine = mode === 'open' ? leftWords(leftNow) : null;

  return (
    <section className="okg-card okg-trip__card okg-ask" aria-labelledby="okg-ask-h">
      <div className="okg-ask__head">
        <span className="okg-ask__icon" aria-hidden="true">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
          </svg>
        </span>
        <h2 className="okg-trip__h2" id="okg-ask-h">
          Ask a question
        </h2>
      </div>
      {items.length === 0 && !pending && (
        <p className="okg-muted">
          Answers come from {op}’s own notes on your tour. If it isn’t sure, it passes your question
          to the team.
        </p>
      )}

      {(items.length > 0 || pending) && (
        <ol
          className="okg-ask__list"
          aria-label="Your questions and the answers"
          aria-live="polite"
        >
          {items.map((it) => (
            <AskBubble key={it.key} item={it} />
          ))}
          {pending && (
            <>
              <li className="okg-ask__q">{pending}</li>
              <li className="okg-ask__a okg-ask__thinking">
                <span className="okg-ask__dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                Looking in {op}’s notes…
              </li>
            </>
          )}
        </ol>
      )}

      {suggestions.length > 0 && (
        <div className="okg-ask__try">
          <span className="okg-small okg-muted okg-strong">Try one</span>
          <div className="okg-ask__chips">
            {suggestions.map((s) => (
              <button key={s} type="button" className="okg-ask__chip" onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {notice && (
        <div className={`okg-ask__notice okg-ask__notice--${notice.tone}`} role="status">
          <p className="okg-strong">{notice.title}</p>
          <p>{notice.body}</p>
        </div>
      )}
      {(mode === 'limit' || mode === 'paused') && reach && (
        <a className="okg-btn okg-btn--secondary" href={reach.href}>
          {reach.label}
        </a>
      )}

      {field !== 'hidden' && (
        <form
          className="okg-trip__ask"
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <span className="okg-ask__label-row">
            <label htmlFor="okg-ask-q" className="okg-strong okg-small">
              Your question
            </label>
            {leftLine && <span className="okg-small okg-muted">{leftLine}</span>}
          </span>
          <span className="okg-trip__ask-row">
            <input
              id="okg-ask-q"
              className="okg-field__input"
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
              disabled={field === 'disabled'}
              placeholder={
                field === 'disabled'
                  ? 'Not available right now'
                  : items.length
                    ? 'Ask another question'
                    : 'Ask about what to wear, where to meet…'
              }
            />
            <button
              type="submit"
              className="okg-btn okg-btn--primary okg-trip__ask-send"
              disabled={field === 'disabled' || Boolean(pending) || !text.trim()}
              aria-label="Send"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14" />
                <path d="M13 6l6 6-6 6" />
              </svg>
            </button>
          </span>
          {problem && (
            <p role="alert" className="okg-ask__problem">
              {problem}
            </p>
          )}
        </form>
      )}

      {mode !== 'offline' && (
        <p className="okg-small okg-muted okg-ask__foot">
          Automated answers. {op}’s team answers anything it isn’t sure of, by WhatsApp or email.
        </p>
      )}
    </section>
  );
}

/** One line of the conversation. @param {{ item: import('../../lib/ask.js').AskItem }} props */
function AskBubble({ item }) {
  switch (item.type) {
    case 'question':
      return <li className="okg-ask__q">{item.text}</li>;
    case 'answer':
      return (
        <li className="okg-ask__answer">
          <span className="okg-ask__a">{item.text}</span>
          {item.source && (
            <span className="okg-small okg-muted okg-ask__source">{item.source}</span>
          )}
        </li>
      );
    case 'reply':
      return (
        <li className="okg-ask__reply">
          <span className="okg-small okg-muted">
            <span className="okg-strong">{item.title}</span> · {item.meta}
          </span>
          <span>{item.text}</span>
        </li>
      );
    default:
      // "Passed to the team", or "not sure, and not sent".
      return (
        <li className={`okg-ask__team okg-ask__team--${item.type}`}>
          <span className="okg-strong">{item.title}</span>
          <span>{item.text}</span>
        </li>
      );
  }
}
