// @ts-check
/**
 * uploads.js — sending a photo or a logo (stage 19b-2a), and the two hooks the screens use.
 *
 *   sendPicture({ file, kind, token })   POST /api/uploads/photo|logo with the file's bytes;
 *                                        reports progress; can be cancelled
 *   usePhotoList(photos)                 a tour's photos while editing (lib/photos.js rules)
 *   usePicture(picture, kind)            one picture: the logo, or the hero photo
 *
 * Why XMLHttpRequest and not fetch? Only XHR reports how much of an UPLOAD has gone
 * (`xhr.upload.onprogress`), and a 4 MB photo on 3G takes long enough that "Uploading… 35%"
 * matters (designs: U1, U2, U8).
 *
 * The words for what went wrong are the server's own ("That's a PDF…"), or ours for the
 * connection. The size is checked before sending (@okapigo/shared/uploads), so a phone doesn't
 * spend its data on a file that will be refused.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { tooBigLine } from '@okapigo/shared/uploads';
import { useEngine } from './engine.jsx';
import {
  addFiles,
  photoItems,
  progressed,
  uploaded,
  uploadFailed,
  retrying,
  removed,
  moved,
  madeCover,
  setText,
} from './photos.js';

/** A big photo on a slow line: give it two minutes. */
export const UPLOAD_TIMEOUT_MS = 120_000;
export const NO_CONNECTION = 'The upload stopped (no connection).';

/**
 * @typedef {{ ok: true, picture: { url: string, small: string, width: number, height: number } }
 *   | { ok: false, cancelled: boolean, message: string }} SendResult
 */

/**
 * Sends one file. `cancel()` stops it (the result is then { ok: false, cancelled: true }).
 * @param {{
 *   file: Blob, kind: 'photo' | 'logo', token: string | null,
 *   onProgress?: (percent: number) => void,
 *   makeXhr?: () => XMLHttpRequest,   // tests pass a fake
 *   online?: () => boolean,
 * }} o
 * @returns {{ done: Promise<SendResult>, cancel: () => void }}
 */
export function sendPicture({
  file,
  kind,
  token,
  onProgress,
  makeXhr = () => new XMLHttpRequest(),
  online = () => globalThis.navigator?.onLine ?? true,
}) {
  const big = tooBigLine(kind, file.size);
  if (big)
    return { done: Promise.resolve({ ok: false, cancelled: false, message: big }), cancel() {} };
  if (!online()) {
    return {
      done: Promise.resolve({
        ok: false,
        cancelled: false,
        message: `No connection: the ${kind} wasn’t sent.`,
      }),
      cancel() {},
    };
  }
  const xhr = makeXhr();
  const done = new Promise((resolve) => {
    xhr.open('POST', `/api/uploads/${kind}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      /** @type {any} */
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not ours (a Wi-Fi login page): handled below
      }
      if (xhr.status === 201 && body?.picture) return resolve({ ok: true, picture: body.picture });
      if (xhr.status === 401) {
        return resolve({ ok: false, cancelled: false, message: 'Sign in again, then try again.' });
      }
      if (xhr.status < 500 && body?.error?.message) {
        return resolve({ ok: false, cancelled: false, message: body.error.message });
      }
      resolve({ ok: false, cancelled: false, message: 'The upload didn’t work. Try again.' });
    };
    xhr.onerror = () => resolve({ ok: false, cancelled: false, message: NO_CONNECTION });
    xhr.ontimeout = () => resolve({ ok: false, cancelled: false, message: NO_CONNECTION });
    xhr.onabort = () => resolve({ ok: false, cancelled: true, message: '' });
    xhr.send(file);
  });
  return { done: /** @type {Promise<SendResult>} */ (done), cancel: () => xhr.abort() };
}

/** The signed-in person's token, read when needed. */
function useToken() {
  const engine = useEngine();
  return useCallback(() => engine.getState().session?.token ?? null, [engine]);
}

let counter = 0;
const makeKey = () => `new-${Date.now()}-${++counter}`;

/**
 * A tour's photos while editing. `reset(photos)` starts again from saved photos (after a save,
 * or Discard). Uploads in flight when the screen closes are cancelled.
 * @param {any[]} photos the tour's saved photos
 * @param {{ send?: typeof sendPicture }} [o] tests pass a fake `send`
 */
export function usePhotoList(photos, { send = sendPicture } = {}) {
  const token = useToken();
  const [items, setItems] = useState(() => photoItems(photos));
  const [notes, setNotes] = useState(/** @type {string[]} */ ([]));
  /** The files (for "Try again") and the cancel of each upload in flight, by key. */
  const files = useRef(/** @type {Map<string, Blob>} */ (new Map()));
  const cancels = useRef(/** @type {Map<string, () => void>} */ (new Map()));

  useEffect(() => {
    const inFlight = cancels.current;
    return () => {
      for (const cancel of inFlight.values()) cancel();
    };
  }, []);

  /** @param {string} key @param {Blob} file */
  const start = (key, file) => {
    const { done, cancel } = send({
      file,
      kind: 'photo',
      token: token(),
      onProgress: (p) => setItems((all) => progressed(all, key, p)),
    });
    cancels.current.set(key, cancel);
    done.then((r) => {
      cancels.current.delete(key);
      if (r.ok) {
        files.current.delete(key);
        setItems((all) => uploaded(all, key, r.picture));
      } else if (r.cancelled) {
        files.current.delete(key);
        setItems((all) => removed(all, key));
      } else {
        setItems((all) => uploadFailed(all, key, r.message));
      }
    });
  };

  return {
    items,
    notes,
    /** Picked or dropped files. @param {File[]} picked */
    add(picked) {
      const r = addFiles(items, picked, makeKey);
      setItems(r.items);
      setNotes(r.refused);
      for (const { key, index } of r.added) {
        files.current.set(key, picked[index]);
        start(key, picked[index]);
      }
    },
    /** @param {string} key */
    cancel: (key) => cancels.current.get(key)?.(),
    /** @param {string} key */
    retry(key) {
      const file = files.current.get(key);
      if (!file) return;
      setItems((all) => retrying(all, key));
      start(key, file);
    },
    /** @param {string} key */
    remove(key) {
      cancels.current.get(key)?.();
      files.current.delete(key);
      setItems((all) => removed(all, key));
    },
    /** @param {string} key @param {-1 | 1} by */
    move: (key, by) => setItems((all) => moved(all, key, by)),
    /** @param {string} key */
    cover: (key) => setItems((all) => madeCover(all, key)),
    /** @param {string} key @param {'alt' | 'credit'} field @param {string} value */
    setText: (key, field, value) => setItems((all) => setText(all, key, field, value)),
    /** @param {any[]} saved */
    reset(saved) {
      for (const cancel of cancels.current.values()) cancel();
      setItems(photoItems(saved));
      setNotes([]);
    },
  };
}

/**
 * One picture (the logo, the hero photo): pick a file, it uploads; remove it; start again.
 * @param {{ url: string, small: string } | null} picture the saved one
 * @param {'photo' | 'logo'} kind
 * @param {{ send?: typeof sendPicture }} [o]
 */
export function usePicture(picture, kind, { send = sendPicture } = {}) {
  const token = useToken();
  const [current, setCurrent] = useState(picture);
  const [upload, setUpload] = useState(
    /** @type {{ name: string, progress: number } | null} */ (null),
  );
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const cancelRef = useRef(/** @type {(() => void) | null} */ (null));
  useEffect(() => () => cancelRef.current?.(), []);

  return {
    picture: current,
    upload,
    error,
    /** @param {File} file */
    pick(file) {
      cancelRef.current?.();
      setError(null);
      setUpload({ name: file.name, progress: 0 });
      const { done, cancel } = send({
        file,
        kind,
        token: token(),
        onProgress: (p) => setUpload({ name: file.name, progress: Math.round(p) }),
      });
      cancelRef.current = cancel;
      done.then((r) => {
        if (cancelRef.current === cancel) cancelRef.current = null;
        setUpload(null);
        if (r.ok) setCurrent({ url: r.picture.url, small: r.picture.small });
        else if (!r.cancelled) setError(r.message);
      });
    },
    cancel: () => cancelRef.current?.(),
    remove() {
      cancelRef.current?.();
      setCurrent(null);
      setError(null);
    },
    /** @param {{ url: string, small: string } | null} saved */
    reset(saved) {
      cancelRef.current?.();
      setCurrent(saved);
      setUpload(null);
      setError(null);
    },
  };
}
