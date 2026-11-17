// @ts-check
/**
 * Small status pieces from the token sheet: chips, notices and the test-mode strip.
 */

/**
 * "Only 3 left" · "Sold out" · "12 seats" · "Paid"
 * @param {{ tone?: 'warning' | 'neutral' | 'primary' | 'success', children: import('react').ReactNode }} props
 */
export function Chip({ tone = 'neutral', children }) {
  return <span className={`okg-chip okg-chip--${tone}`}>{children}</span>;
}

/**
 * A message box. Danger notices are announced at once (role="alert"); warnings politely.
 *   <Notice tone="danger" title="Your payment didn't go through">No money was taken.</Notice>
 * @param {{ tone: 'warning' | 'danger', title?: string, children?: import('react').ReactNode }} props
 */
export function Notice({ tone, title, children }) {
  return (
    <div className={`okg-notice okg-notice--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {title && <p className="okg-notice__title">{title}</p>}
      {children && <p>{children}</p>}
    </div>
  );
}

/**
 * Shown on every checkout and pay screen while OkapiGo runs in Paystack TEST mode, which is
 * always in the MVP (PRD key safety: no real money moves).
 */
export function TestModeStrip() {
  return <p className="okg-test-strip">Test mode · no real money moves</p>;
}
