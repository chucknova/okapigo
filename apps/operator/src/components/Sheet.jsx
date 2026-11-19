// @ts-check
/**
 * A sheet from the bottom of the screen (designs: naming a guest, sign in again…), over a
 * dark scrim. A real <dialog>: the browser keeps focus inside it and Escape closes it.
 */
import { useEffect, useRef } from 'react';

/**
 * @param {{ title: string, onClose?: () => void, children: import('react').ReactNode, alert?: boolean }} props
 */
export function Sheet({ title, onClose, children, alert = false }) {
  const ref = useRef(/** @type {HTMLDialogElement | null} */ (null));
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
    return () => d?.close?.();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
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
