// @ts-check
/**
 * The phone: the operator's picture and name at the top ("Booking assistant", or "Ìrìn team
 * is replying" while a person answers), the chat, and the text box with Send (your designs).
 */
import { useEffect, useRef, useState } from 'react';
import { initial, shortName } from '../lib/format.js';
import { Message } from './Message.jsx';
import { ListSheet } from './ListSheet.jsx';

/**
 * @param {{ operatorName: string, chat: ReturnType<typeof import('../lib/use-chat.js').useChat> }} p
 */
export function Phone({ operatorName, chat }) {
  const [draft, setDraft] = useState('');
  const [list, setList] = useState(/** @type {any} */ (null));
  const end = useRef(/** @type {HTMLDivElement | null} */ (null));

  // Keep the newest message in view, like a phone does.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [chat.items.length, chat.typing]);

  const submit = (/** @type {React.FormEvent} */ e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    chat.send({ text });
  };

  return (
    <section className="okg-phone" aria-label={`Chat with ${operatorName}`}>
      <header className="okg-phone-head">
        <span className="okg-phone-avatar" aria-hidden="true">
          {initial(operatorName)}
        </span>
        <div>
          <h1 className="okg-phone-name">{operatorName}</h1>
          <p className="okg-phone-sub">
            {chat.staffReplying
              ? `${shortName(operatorName)} team is replying`
              : 'Booking assistant'}
          </p>
        </div>
      </header>

      <div className="okg-phone-chat">
        {chat.empty && (
          <p className="okg-chat-event okg-chat-hint">
            Say “Hi” to start chatting with {operatorName}’ booking assistant.
          </p>
        )}
        <ol className="okg-chat-list" aria-live="polite">
          {chat.items.map((item) => (
            <Message
              key={item.key}
              item={item}
              onChoose={chat.send}
              onOpenList={setList}
              onRetry={chat.retry}
            />
          ))}
          {chat.typing && (
            <li className="okg-chat-row">
              <div className="okg-chat-bubble okg-chat-theirs okg-chat-typing">typing…</div>
            </li>
          )}
        </ol>
        <div ref={end} />
      </div>

      <form className="okg-phone-bar" onSubmit={submit}>
        <input
          className="okg-phone-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message"
          aria-label="Message"
          maxLength={4096}
        />
        <button type="submit" className="okg-phone-send" aria-label="Send">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>

      {list && <ListSheet list={list} onChoose={chat.send} onClose={() => setList(null)} />}
    </section>
  );
}
