// @ts-check
/**
 * A status page's middle: a round icon, a title, a sentence, a small "what this is about"
 * box, and the actions (designs: file 02, "Confirming · states" and "Payment link · states").
 *
 *   ✓ success (primary) · ! warning (soft amber) · × danger (soft red) · … pending
 *
 * @param {{
 *   tone: 'success' | 'warning' | 'danger' | 'pending',
 *   title: string,
 *   children?: import('react').ReactNode,      // the sentence(s)
 *   context?: string,                           // "Badagry Heritage Day Trip · Sat 5 Dec · ILT-3MZ8RB"
 *   actions?: import('react').ReactNode,
 * }} props
 */
export function StatusPanel({ tone, title, children, context, actions }) {
  const icon = { success: '✓', warning: '!', danger: '×', pending: '' }[tone];
  return (
    <div className="okg-status" role={tone === 'danger' ? 'alert' : 'status'}>
      <span className={`okg-status__icon okg-status__icon--${tone}`} aria-hidden="true">
        {icon}
      </span>
      <h1 className="okg-status__title">{title}</h1>
      {children && <div className="okg-status__body">{children}</div>}
      {context && <p className="okg-status__context">{context}</p>}
      {actions && <div className="okg-status__actions">{actions}</div>}
    </div>
  );
}
