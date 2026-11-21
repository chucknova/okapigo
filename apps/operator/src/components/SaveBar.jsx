// @ts-check
/**
 * The save bar (designs: "The save bar stays at the bottom of every settings page while
 * something is unsaved"), and the question when leaving with unsaved changes ("Leave without
 * saving?"). Settings pages use both (16e).
 */
import { useEffect, useState } from 'react';
import { Sheet } from './Sheet.jsx';

/**
 * @param {{ changed: string[], saving: boolean, blocked?: boolean, onSave: () => void, onDiscard: () => void }} props
 *   changed: what's unsaved ("Tagline", "Email"); blocked: errors to fix first
 */
export function SaveBar({ changed, saving, blocked = false, onSave, onDiscard }) {
  if (changed.length === 0) return null;
  return (
    <div className="save-bar" role="region" aria-label="Unsaved changes">
      <span className="grow">Unsaved changes: {changed.join(', ')}</span>
      <button
        type="button"
        className="btn btn--outline btn--compact"
        onClick={onDiscard}
        disabled={saving}
      >
        Discard
      </button>
      <button
        type="button"
        className="btn btn--dark btn--compact"
        onClick={onSave}
        disabled={saving || blocked}
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

/**
 * While something is unsaved: closing the tab asks the browser's own question, and a click on
 * any link in the app asks ours ("Save and leave" · "Leave without saving" · "Stay here").
 * @param {{ changed: string[], what: string, onSave: () => Promise<boolean> }} props
 *   what: "Your change to the tagline" (the question's line)
 */
export function LeaveGuard({ changed, what, onSave }) {
  const dirty = changed.length > 0;
  const [to, setTo] = useState(/** @type {HTMLAnchorElement | null} */ (null));
  useEffect(() => {
    if (!dirty) return;
    /** @param {BeforeUnloadEvent} e */
    const unload = (e) => {
      e.preventDefault();
    };
    /** @param {MouseEvent} e */
    const click = (e) => {
      const a = /** @type {HTMLElement} */ (e.target).closest?.('a[href]');
      if (!a || a.getAttribute('target') === '_blank' || a.hasAttribute('data-leave-ok')) return;
      e.preventDefault();
      e.stopPropagation();
      setTo(/** @type {HTMLAnchorElement} */ (a));
    };
    addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty]);
  if (!to) return null;
  /** Follow the link the user clicked, now that leaving is decided. */
  const go = () => {
    const a = to;
    setTo(null);
    a.setAttribute('data-leave-ok', '');
    a.click();
    a.removeAttribute('data-leave-ok');
  };
  return (
    <Sheet title="Leave without saving?" alert center onClose={() => setTo(null)}>
      <div className="dialog">
        <h2 className="h-lg">Leave without saving?</h2>
        <p className="muted">{what} won’t be kept.</p>
        <button
          type="button"
          className="btn btn--dark"
          onClick={async () => {
            if (await onSave()) go();
            else setTo(null);
          }}
        >
          Save and leave
        </button>
        <button type="button" className="btn btn--outline" onClick={go}>
          Leave without saving
        </button>
        <button type="button" className="text-link" onClick={() => setTo(null)}>
          Stay here
        </button>
      </div>
    </Sheet>
  );
}
