// @ts-check
/**
 * Photos — a tour's photos on its page (stage 19b-2b; designs: U5).
 *
 *   one photo     the photo, its credit under it
 *   several       a strip that swipes (scroll snapping: the browser does the swiping, so it
 *                 feels native and works without JavaScript), "1 of 3", and Previous / Next
 *                 buttons for a mouse or a keyboard; the credit is the shown photo's
 *   none          the style's pattern band (desktop), as before
 *
 * Each picture has its description as alt text. The 640 px copy goes to phones (srcset).
 * The words and sums are in lib/photos.js.
 */
import { useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { counterLine, creditLine, shownIndex, srcSet } from '../lib/photos.js';

/** @param {{ photos: import('../lib/photos.js').Photo[] }} props */
export function TourPhotos({ photos }) {
  const strip = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [index, setIndex] = useState(0);
  const count = photos.length;
  const credit = creditLine(photos[index]);

  /** @param {number} to */
  const go = (to) => {
    const el = strip.current;
    if (!el) return;
    el.scrollTo({ left: to * el.clientWidth, behavior: 'smooth' });
    setIndex(to);
  };

  return (
    <figure
      className="okg-photos"
      aria-label={count > 1 ? `Photos, ${counterLine(index, count)}` : 'Photo'}
    >
      <div className="okg-photos__frame">
        <div
          ref={strip}
          className="okg-photos__strip"
          onScroll={(e) => {
            const el = e.currentTarget;
            setIndex(shownIndex(el.scrollLeft, el.clientWidth, count));
          }}
        >
          {photos.map((p, i) => (
            <img
              key={p.url}
              className="okg-photos__img"
              src={p.url}
              srcSet={srcSet(p)}
              sizes="(min-width: 960px) 700px, 100vw"
              alt={p.alt}
              // The first is seen at once; the others load when swiped to.
              loading={i === 0 ? 'eager' : 'lazy'}
            />
          ))}
        </div>
        {count > 1 && (
          <>
            <span className="okg-photos__count" aria-hidden="true">
              {counterLine(index, count)}
            </span>
            {index > 0 && (
              <button
                type="button"
                className="okg-photos__nav okg-photos__nav--prev"
                aria-label="Previous photo"
                onClick={() => go(index - 1)}
              >
                <Icon name="back" size={20} />
              </button>
            )}
            {index < count - 1 && (
              <button
                type="button"
                className="okg-photos__nav okg-photos__nav--next"
                aria-label="Next photo"
                onClick={() => go(index + 1)}
              >
                <Icon name="next" size={20} />
              </button>
            )}
          </>
        )}
      </div>
      {credit && <figcaption className="okg-photos__credit">{credit}</figcaption>}
    </figure>
  );
}
