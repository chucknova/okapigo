// @ts-check
/**
 * The frame around every checkout step (designs: file 01, screens 1–4 and "Checkout on
 * desktop").
 *
 *   phone    back arrow · step title · "Tour · Sat 5 Dec · Step 2 of 4" · 4-part progress bar
 *            test-mode strip (full width) · content · bottom bar (total + Continue)
 *   desktop  letter mark · business name · "1 Date ✓  2 Who and extras  3 Details  4 Review"
 *            test-mode strip · two columns: content | summary card
 */
import { Link } from 'wouter';
import { firstLetter } from '../../components/Shell.jsx';
import { Icon } from '../../components/Icon.jsx';
import { takeEmbedded, useApi } from '../../lib/data.js';
import { useLook } from '../../lib/look.js';
import { useOverlayClose } from '../../lib/embedded.js';

export const STEPS = ['Date', 'Who and extras', 'Details', 'Review and pay'];

/**
 * The tour being booked: embedded in the page on first load (the API serves /book pages
 * with the tour's data), else fetched.
 * @param {string} operatorSlug
 * @param {string} tourSlug
 */
export function useTourForCheckout(operatorSlug, tourSlug) {
  const initial = takeEmbedded(
    (d) => d.kind === 'tour' && d.operatorSlug === operatorSlug && d.tourSlug === tourSlug,
  );
  const res = useApi(
    `/public/${encodeURIComponent(operatorSlug)}/tours/${encodeURIComponent(tourSlug)}`,
    initial?.view ?? null,
  );
  useLook(res.data?.operator); // the operator's website style (stage 12g)
  return res;
}

/**
 * @param {{
 *   step: 1 | 2 | 3 | 4,
 *   title: string,                 // "Choose a date", "Who's coming?"
 *   subtitle: string,              // "Lagos Island Heritage Walk · Step 1 of 4"
 *   operatorName: string,
 *   backHref: string,
 *   aside?: import('react').ReactNode,       // desktop summary card
 *   bottomBar?: import('react').ReactNode,   // phone: total + Continue
 *   headerExtra?: import('react').ReactNode, // e.g. the "Seats held 14:32" chip
 *   children: import('react').ReactNode,
 * }} props
 */
export function CheckoutFrame({
  step,
  title,
  subtitle,
  operatorName,
  backHref,
  aside,
  bottomBar,
  headerExtra,
  children,
}) {
  // In the widget's overlay (stage 12h-2), a Close sits where Back usually is; from step 2
  // on, Back appears beside it (designs: file 03, "Overlay on a phone").
  const close = useOverlayClose();
  return (
    <div className="okg-checkout">
      <header className="okg-checkout__header">
        <div className="okg-checkout__bar okg-phone-only">
          {close && (
            <button
              type="button"
              className="okg-icon-btn okg-icon-btn--plain"
              onClick={close}
              aria-label="Close"
            >
              <Icon name="close" size={22} />
            </button>
          )}
          {!(close && step === 1) && (
            <Link className="okg-icon-btn okg-icon-btn--plain" href={backHref} aria-label="Back">
              <Icon name="back" size={22} />
            </Link>
          )}
          <div className="okg-checkout__titles">
            <p className="okg-checkout__title">{title}</p>
            <p className="okg-label">{subtitle}</p>
          </div>
          {headerExtra}
        </div>
        <div
          className="okg-progress okg-phone-only"
          role="progressbar"
          aria-label="Checkout progress"
          aria-valuemin={1}
          aria-valuemax={4}
          aria-valuenow={step}
          aria-valuetext={`Step ${step} of 4: ${STEPS[step - 1]}`}
        >
          {STEPS.map((s, i) => (
            <span key={s} className={i < step ? 'okg-progress__done' : ''} />
          ))}
        </div>
        <div className="okg-checkout__desktop-head okg-desktop-only">
          <span className="okg-mark" aria-hidden="true">
            {firstLetter(operatorName)}
          </span>
          <span className="okg-header__name">{operatorName}</span>
          {headerExtra}
          <ol className="okg-steps">
            {STEPS.map((s, i) => (
              <li
                key={s}
                className={
                  i + 1 < step ? 'okg-steps__done' : i + 1 === step ? 'okg-steps__current' : ''
                }
                aria-current={i + 1 === step ? 'step' : undefined}
              >
                {i + 1} {s}
                {i + 1 < step && ' ✓'}
              </li>
            ))}
          </ol>
        </div>
      </header>
      <p className="okg-test-bar">Test mode · no real money moves</p>
      <div className="okg-checkout__layout">
        <main className="okg-checkout__main">
          <h1 className="okg-checkout__h1 okg-desktop-only">{title}</h1>
          {children}
        </main>
        {aside && <aside className="okg-checkout__aside okg-desktop-only">{aside}</aside>}
      </div>
      {bottomBar && <div className="okg-sticky-bar okg-phone-only">{bottomBar}</div>}
    </div>
  );
}
