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
  return useApi(
    `/public/${encodeURIComponent(operatorSlug)}/tours/${encodeURIComponent(tourSlug)}`,
    initial?.view ?? null,
  );
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
  children,
}) {
  return (
    <div className="okg-checkout">
      <header className="okg-checkout__header">
        <div className="okg-checkout__bar okg-phone-only">
          <Link className="okg-icon-btn okg-icon-btn--plain" href={backHref} aria-label="Back">
            <Icon name="back" size={22} />
          </Link>
          <div>
            <p className="okg-checkout__title">{title}</p>
            <p className="okg-label">{subtitle}</p>
          </div>
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
