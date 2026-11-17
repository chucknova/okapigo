// @ts-check
import { useId } from 'react';

/**
 * A labelled input. The label is always VISIBLE (never only a placeholder), and an error is
 * said in words, linked to the input so screen readers announce it (aria-describedby).
 *
 *   <TextField label="Phone" value={phone} onChange={setPhone} inputMode="tel"
 *              error="Enter an 11-digit number like 0803 123 4567, or start with +234." />
 *
 * @param {{
 *   label: string,
 *   value: string,
 *   onChange: (value: string) => void,
 *   hint?: string,
 *   error?: string | null,
 *   type?: string,
 *   inputMode?: 'text' | 'tel' | 'email' | 'numeric',
 *   autoComplete?: string,
 *   optional?: boolean,
 * }} props
 */
export function TextField({
  label,
  value,
  onChange,
  hint,
  error,
  type = 'text',
  inputMode,
  autoComplete,
  optional = false,
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`okg-field${error ? ' okg-field--error' : ''}`}>
      <label className="okg-field__label" htmlFor={id}>
        {label}
        {optional && <span className="okg-field__hint"> (optional)</span>}
      </label>
      {hint && (
        <p className="okg-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      <input
        id={id}
        className="okg-field__input"
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {error && (
        <p className="okg-field__error" id={errorId}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.5v4.2M8 10.8v.7" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}
