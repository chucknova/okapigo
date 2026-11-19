// @ts-check
/**
 * A WhatsApp list, opened: a sheet from the bottom of the phone with the rows (title and a
 * line under it). Tapping a row sends it; Close or Escape goes back to the chat.
 */
import { useEffect, useRef } from 'react';

/**
 * @param {{
 *   list: { button: string, rows: Array<{ id: string, title: string, description?: string }> },
 *   onChoose: (choice: { choice: string, title: string }) => void,
 *   onClose: () => void,
 * }} p
 */
export function ListSheet({ list, onChoose, onClose }) {
  const closeRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (/** @type {KeyboardEvent} */ e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="okg-chat-scrim" onClick={onClose}>
      <div
        className="okg-chat-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={list.button}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="okg-chat-sheet-head">
          <button
            ref={closeRef}
            type="button"
            className="okg-chat-sheet-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
          <h2>{list.button}</h2>
        </div>
        <ul className="okg-chat-sheet-rows">
          {list.rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onChoose({ choice: r.id, title: r.title });
                }}
              >
                <span className="okg-chat-row-title">{r.title}</span>
                {r.description && <span className="okg-chat-row-desc">{r.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
