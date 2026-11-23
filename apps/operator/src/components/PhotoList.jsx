// @ts-check
/**
 * PhotoList — a tour's photos while editing (stage 19b-2a; designs: U2, U3 a tour's Photos,
 * U7, U8 New tour). Drawn from usePhotoList (lib/uploads.js); every rule is in lib/photos.js.
 *
 *   the count        "2 of 3 needed · 1 uploading", "4 of 8 ✓"
 *   each photo       its picture (the first marked Cover), its description, its credit (on the
 *                    tour page; New tour leaves credits for later), Make cover, Move up/down,
 *                    Remove (asking first when it takes a tour on sale under 3)
 *   uploading        the file's name, how far, Cancel
 *   failed           why (the server's words), Try again, Remove
 *   Add photos       pick several, or drop them here (desk)
 */
import { useRef, useState } from 'react';
import { ACCEPTED_PICTURES } from '@okapigo/shared/uploads';
import {
  photoErrors,
  photosCountLine,
  photosShortNow,
  removeAsk,
  photoName,
  saveWait,
} from '../lib/photos.js';

/**
 * @param {{
 *   list: ReturnType<typeof import('../lib/uploads.js').usePhotoList>,
 *   product?: { title: string, status: string },  // for "Remove this photo?" (on sale)
 *   credits?: boolean,                            // the credit field (not in New tour)
 *   showErrors?: boolean,                         // New tour: only once "Make the draft" was pressed
 * }} props
 */
export function PhotoList({ list, product, credits = true, showErrors = true }) {
  const input = useRef(/** @type {HTMLInputElement | null} */ (null));
  const [asking, setAsking] = useState(/** @type {{ key: string, text: string } | null} */ (null));
  const [dragging, setDragging] = useState(false);
  const errors = showErrors ? photoErrors(list.items) : {};
  const wait = saveWait(list.items);
  const last = list.items.length - 1;

  /** @param {string} key */
  const askOrRemove = (key) => {
    const text = product ? removeAsk(product, list.items, key) : null;
    if (text) setAsking({ key, text });
    else list.remove(key);
  };

  return (
    <div className="stack-sm">
      <p className={`small strong${photosShortNow(list.items) ? ' warning-text' : ''}`}>
        {photosCountLine(list.items)}
      </p>
      {list.notes.length > 0 && (
        <div role="alert" className="stack-xs">
          {list.notes.map((n) => (
            <p key={n} className="field-error">
              {n}
            </p>
          ))}
        </div>
      )}

      {list.items.length > 0 && (
        <ol className="plain-list photo-list" aria-label="Photos">
          {list.items.map((item, i) => {
            const name = photoName(i);
            const e = errors[item.key] ?? {};
            return (
              <li key={item.key} className="photo-item">
                <div className="photo-item__pic">
                  {item.status === 'ready' ? (
                    <img src={item.small ?? item.url ?? ''} alt={item.alt.trim() || name} />
                  ) : (
                    <span className="photo-item__placeholder">{item.name}</span>
                  )}
                  {i === 0 && item.status === 'ready' && <span className="cover-badge">Cover</span>}
                </div>

                <div className="stack-xs photo-item__fields">
                  {item.status === 'uploading' && (
                    <div className="stack-xs">
                      <span>
                        Uploading {item.name}… {item.progress}%
                      </span>
                      <span
                        className="progress upload-progress"
                        role="progressbar"
                        aria-label={`Uploading ${item.name}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={item.progress}
                      >
                        <span
                          className="progress-bar progress-bar--ink"
                          style={{ width: `${item.progress}%` }}
                        />
                      </span>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => list.cancel(item.key)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {item.status === 'failed' && (
                    <div className="stack-xs">
                      <p role="alert" className="field-error">
                        {item.name}: {item.error}
                      </p>
                      <div className="row-wrap">
                        <button
                          type="button"
                          className="btn btn--outline btn--compact"
                          onClick={() => list.retry(item.key)}
                        >
                          Try again
                        </button>
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => list.remove(item.key)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                  {item.status !== 'failed' && (
                    <>
                      <label className="field">
                        Describe the photo
                        <input
                          className="input"
                          type="text"
                          value={item.alt}
                          placeholder="What’s in the photo?"
                          onChange={(ev) => list.setText(item.key, 'alt', ev.target.value)}
                          aria-invalid={Boolean(e.alt)}
                        />
                        {e.alt && <span className="field-error plain">{e.alt}</span>}
                      </label>
                      {credits && (
                        <label className="field">
                          Credit (optional)
                          <input
                            className="input"
                            type="text"
                            value={item.credit}
                            onChange={(ev) => list.setText(item.key, 'credit', ev.target.value)}
                            aria-invalid={Boolean(e.credit)}
                          />
                          <span className="small muted plain">
                            If someone else took it. Shown small under the photo.
                          </span>
                          {e.credit && <span className="field-error plain">{e.credit}</span>}
                        </label>
                      )}
                    </>
                  )}
                </div>

                {item.status === 'ready' && (
                  <div className="photo-item__actions">
                    {i > 0 && (
                      <button
                        type="button"
                        className="btn btn--outline btn--compact"
                        aria-label={`Make ${name} the cover`}
                        onClick={() => list.cover(item.key)}
                      >
                        Make cover
                      </button>
                    )}
                    {i > 0 && (
                      <button
                        type="button"
                        className="btn btn--outline btn--compact"
                        aria-label={`Move ${name} up`}
                        onClick={() => list.move(item.key, -1)}
                      >
                        Move up
                      </button>
                    )}
                    {i < last && (
                      <button
                        type="button"
                        className="btn btn--outline btn--compact"
                        aria-label={`Move ${name} down`}
                        onClick={() => list.move(item.key, 1)}
                      >
                        Move down
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-link"
                      aria-label={`Remove ${name}`}
                      onClick={() => askOrRemove(item.key)}
                    >
                      Remove
                    </button>
                  </div>
                )}

                {asking?.key === item.key && (
                  <div
                    className="stack-xs photo-item__ask"
                    role="group"
                    aria-label="Remove this photo?"
                  >
                    <strong>Remove this photo?</strong>
                    <p className="small">{asking.text}</p>
                    <div className="row-wrap">
                      <button
                        type="button"
                        className="btn btn--dark btn--compact"
                        onClick={() => {
                          list.remove(item.key);
                          setAsking(null);
                        }}
                      >
                        Remove it
                      </button>
                      <button
                        type="button"
                        className="btn btn--outline btn--compact"
                        onClick={() => setAsking(null)}
                      >
                        Keep it
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <div
        className={`drop-zone${dragging ? ' drop-zone--over' : ''}`}
        onDragOver={(ev) => {
          ev.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(ev) => {
          ev.preventDefault();
          setDragging(false);
          list.add([...ev.dataTransfer.files]);
        }}
      >
        <button type="button" className="drop-zone__button" onClick={() => input.current?.click()}>
          <strong>Add photos</strong>
          <span className="small muted">
            Pick several at once, or drop them here · JPEG, PNG or WebP, up to 10 MB each
          </span>
        </button>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          accept={ACCEPTED_PICTURES}
          multiple
          tabIndex={-1}
          aria-hidden="true"
          onChange={(ev) => {
            list.add([...(ev.target.files ?? [])]);
            ev.target.value = ''; // the same file can be picked again
          }}
        />
      </div>
      {wait && <p className="small muted">{wait}</p>}
    </div>
  );
}
