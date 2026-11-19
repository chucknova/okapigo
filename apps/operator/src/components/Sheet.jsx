// @ts-check
/**
 * A sheet from the bottom of the screen (designs: naming a guest, sign in again…), over a
 * dark scrim. A real <dialog>: the browser keeps focus inside it and Escape closes it.
 */
import { useLayoutEffect, useRef } from 'react';

/**
 * `center`: a dialog in the middle of the screen (a question to answer: "Mark no-show?"),
 * instead of a sheet from the bottom.
 * @param {{ title: string, onClose?: () => void, children: import('react').ReactNode, alert?: boolean, center?: boolean }} props
 */
export function Sheet({ title, onClose, children, alert = false, center = false }) {
  const ref = useRef(/** @type {HTMLDialogElement | null} */ (null));
  // A layout effect: opened in the same step it's drawn, never seen (or found) closed.
  useLayoutEffect(() => {
    const d = ref.current;
    // showModal(): the browser keeps focus inside and dims the rest. (Without it, as in
    // the test environment, it still opens, just not modal.)
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    return () => d?.close?.();
  }, []);
  return (
    <dialog
      ref={ref}
      className={center ? 'sheet sheet--center' : 'sheet'}
      role={alert ? 'alertdialog' : 'dialog'}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
    >
      {children}
    </dialog>
  );
}
