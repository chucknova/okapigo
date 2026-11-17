// @ts-check
/**
 * A − / count / + control: "Adult (13+) · ₦25,000 · − 2 +".
 *
 * It only reports the new count. Whether 3 more seats are allowed (seats left, add-on stock,
 * "children need an adult") is decided by the server's quote; the screen passes `max` in.
 * The buttons are 48 px circles (tap targets ≥ 44 px), each with a spoken label
 * ("Add one Adult (13+)"), and the count is announced when it changes.
 *
 * @param {{
 *   label: string,
 *   price?: string,          // already formatted: "₦25,000", "Free"
 *   value: number,
 *   onChange: (value: number) => void,
 *   min?: number,
 *   max?: number,
 * }} props
 */
export function Stepper({ label, price, value, onChange, min = 0, max = Infinity }) {
  return (
    <div className="okg-stepper">
      <div>
        <div className="okg-stepper__label">{label}</div>
        {price && <div className="okg-stepper__price okg-money">{price}</div>}
      </div>
      <div className="okg-stepper__controls">
        <button
          type="button"
          className="okg-stepper__button"
          onClick={() => onChange(value - 1)}
          disabled={value <= min}
          aria-label={`Remove one ${label}`}
        >
          −
        </button>
        <span className="okg-stepper__count" aria-live="polite" aria-label={`${value} ${label}`}>
          {value}
        </span>
        <button
          type="button"
          className="okg-stepper__button"
          onClick={() => onChange(value + 1)}
          disabled={value >= max}
          aria-label={`Add one ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}
