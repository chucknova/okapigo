// @ts-check
/**
 * Button: primary (one per screen, the main action), secondary, or a text link.
 *
 * Disabled buttons show WHY in words underneath (token sheet: "plus a reason in words
 * nearby"). Greyed-out alone doesn't tell anyone what to do next.
 *
 *   <Button onClick={pay}>Pay ₦62,500</Button>
 *   <Button disabled disabledReason="Add an adult to continue">Continue</Button>
 *   <Button variant="link" href="#faqs">See all FAQs</Button>
 *
 * @param {{
 *   variant?: 'primary' | 'secondary' | 'link',
 *   disabled?: boolean,
 *   disabledReason?: string,
 *   href?: string,
 *   type?: 'button' | 'submit',
 *   onClick?: (event: import('react').MouseEvent) => void,
 *   children: import('react').ReactNode,
 * }} props
 */
export function Button({
  variant = 'primary',
  disabled = false,
  disabledReason,
  href,
  type = 'button',
  onClick,
  children,
}) {
  const className = variant === 'link' ? 'okg-link' : `okg-btn okg-btn--${variant}`;
  if (href && !disabled) {
    return (
      <a className={className} href={href} onClick={onClick}>
        {children}
      </a>
    );
  }
  const button = (
    <button type={type} className={className} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
  if (!disabled || !disabledReason) return button;
  return (
    <div className="okg-field">
      {button}
      <p className="okg-field__hint" style={{ textAlign: 'center' }}>
        {disabledReason}
      </p>
    </div>
  );
}
