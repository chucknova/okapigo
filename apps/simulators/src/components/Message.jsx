// @ts-check
/**
 * One thing in the chat, as your designs draw it: the guest's bubble (right, green), the bot's
 * or a person's (left, white; a person's is pale green with their name), reply buttons under
 * it, a list's button, a picture with its caption, a link's preview card, and event lines.
 */
import { parseText, withoutPreviewedLink } from '../lib/format.js';

/** Text with *bold* and tappable links. @param {{ text: string }} p */
export function RichText({ text }) {
  return (
    <span className="okg-chat-text">
      {parseText(text).map((s, i) =>
        s.type === 'bold' ? (
          <strong key={i}>{s.value}</strong>
        ) : s.type === 'link' ? (
          <a key={i} href={s.value} target="_blank" rel="noopener noreferrer">
            {s.value}
          </a>
        ) : (
          <span key={i}>{s.value}</span>
        ),
      )}
    </span>
  );
}

/** @param {{ link: { url: string, title?: string, description?: string } }} p */
function Preview({ link }) {
  return (
    <a className="okg-chat-preview" href={link.url} target="_blank" rel="noopener noreferrer">
      {link.title && <span className="okg-chat-preview-title">{link.title}</span>}
      {link.description && <span className="okg-chat-preview-desc">{link.description}</span>}
      <span className="okg-chat-preview-url">{link.url.replace(/^https?:\/\//, '')}</span>
    </a>
  );
}

function ListIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

/**
 * @param {{
 *   item: import('../lib/format.js').Item,
 *   onChoose: (choice: { choice: string, title: string }) => void,
 *   onOpenList: (body: any) => void,
 *   onRetry: (localId: string) => void,
 * }} p
 */
export function Message({ item, onChoose, onOpenList, onRetry }) {
  if (item.kind === 'day' || item.kind === 'event') {
    return (
      <li className="okg-chat-event" data-kind={item.kind}>
        {item.text}
      </li>
    );
  }
  if (item.kind === 'mine') {
    return (
      <li className="okg-chat-row okg-chat-row-mine">
        <div className="okg-chat-bubble okg-chat-mine" data-status={item.status ?? 'sent'}>
          <RichText text={item.text} />
          <span className="okg-chat-time">
            {item.status === 'sending' ? 'Sending…' : item.time}
          </span>
        </div>
        {item.status === 'failed' && (
          <button
            type="button"
            className="okg-chat-failed"
            onClick={() => onRetry(/** @type {string} */ (item.localId))}
          >
            Not sent. Tap to try again.
          </button>
        )}
      </li>
    );
  }

  const b = item.body;
  if (b.kind === 'image') {
    return (
      <li className="okg-chat-row">
        <figure className="okg-chat-bubble okg-chat-theirs okg-chat-image">
          <img src={b.url} alt={b.caption || 'A picture'} />
          {b.caption && <figcaption>{b.caption}</figcaption>}
          <span className="okg-chat-time">{item.time}</span>
        </figure>
      </li>
    );
  }
  const text = withoutPreviewedLink(b.text ?? '', b.link);
  return (
    <li className="okg-chat-row">
      <div className={`okg-chat-bubble okg-chat-theirs${item.staff ? ' okg-chat-staff' : ''}`}>
        {item.staff && <span className="okg-chat-staff-name">{item.staff}</span>}
        {text && <RichText text={text} />}
        {b.link && <Preview link={b.link} />}
        <span className="okg-chat-time">{item.time}</span>
      </div>
      {b.kind === 'buttons' &&
        b.buttons.map((/** @type {{ id: string, title: string }} */ btn) => (
          <button
            key={btn.id}
            type="button"
            className="okg-chat-action"
            onClick={() => onChoose({ choice: btn.id, title: btn.title })}
          >
            {btn.title}
          </button>
        ))}
      {b.kind === 'list' && (
        <button type="button" className="okg-chat-action" onClick={() => onOpenList(b)}>
          <ListIcon />
          {b.button}
        </button>
      )}
    </li>
  );
}
