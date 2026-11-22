// @ts-check
/**
 * One of the designs' states ("Sojourna — states"): a tag ("SUPPLIER OFFLINE"), a title, what
 * happened, and what to do next.
 * @param {{ tone: 'bad' | 'warn' | 'info', tag: string, title: string, body: string, children?: import('react').ReactNode }} props
 */
export function StatePanel({ tone, tag, title, body, children }) {
  return (
    <section className="state" aria-label={title}>
      <div role="status" className={`state-tag state-tag--${tone}`}>
        {tag}
      </div>
      <h2 className="state-title">{title}</h2>
      {body && <p className="state-body">{body}</p>}
      {children && <div className="state-actions">{children}</div>}
    </section>
  );
}
