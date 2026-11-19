// @ts-check
/**
 * Long press (designs: "Long-press a state on the manifest to open this sheet; a tap just
 * moves to the next state"). Returns props for a button: a press held 500 ms calls
 * `onLong`; a shorter one calls `onTap`. Also a right-click / context menu (a mouse, or
 * Android's own long-press) opens the sheet.
 */
import { useRef } from 'react';

const HOLD_MS = 500;

/** @param {{ onTap: () => void, onLong: () => void }} handlers */
export function useLongPress({ onTap, onLong }) {
  const timer = useRef(/** @type {any} */ (null));
  const fired = useRef(false);
  const cancel = () => clearTimeout(timer.current);
  return {
    onPointerDown: () => {
      fired.current = false;
      timer.current = setTimeout(() => {
        fired.current = true;
        onLong();
      }, HOLD_MS);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    /** @param {import('react').MouseEvent} e */
    onContextMenu: (e) => {
      e.preventDefault();
      cancel();
      if (!fired.current) {
        fired.current = true;
        onLong();
      }
    },
    onClick: () => {
      if (fired.current) {
        fired.current = false;
        return;
      }
      onTap();
    },
  };
}
