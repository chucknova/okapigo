// @ts-check
/**
 * "Funmi still owes ₦45,500" and what the guide can do (designs: O3's money dialog, O4's
 * "Good scan · money still owed", "Money owed on the day" 1–2). Used by the manifest and the
 * scanner; the rules are in lib/money.js.
 *
 *   ask    Show payment QR · They paid me cash · Check in, still owing · Not now
 *   qr     "Scan to pay ₦45,500": the balance link, drawn from the saved package (no signal
 *          needed: the guest pays on their own phone) → "They’ve paid · check them in"
 *   cash   "Record cash": up to what's owed → "Record ₦45,500 and check in"
 *
 * The words are neutral ("they"): the app doesn't know a guest's pronouns.
 */
import { useState } from 'react';
import { formatNaira } from '@okapigo/shared/money';
import { Icon } from './Icon.jsx';
import { cashAmount, nairaField, qrSquares } from '../lib/money.js';
import { firstName } from '../lib/manifest.js';

/**
 * @param {{
 *   b: any,                   // the booking (from the package, with the outbox on top)
 *   guide: string,            // "Femi": the cash is "reported by Femi"
 *   detail?: string | null,   // "Deposit of ₦19,500 paid. Balance was due Sat 28 Nov."
 *   onStillOwing: () => void,
 *   onPaidByLink: () => void,
 *   onCash: (amountKobo: number) => void,
 *   onClose: () => void,
 * }} props
 */
export function MoneyOwed({ b, guide, detail, onStillOwing, onPaidByLink, onCash, onClose }) {
  const [mode, setMode] = useState(/** @type {'ask' | 'qr' | 'cash'} */ ('ask'));
  const owed = b.money.owedKobo;
  const who = firstName(b.lead.name);
  const [typed, setTyped] = useState(() => nairaField(owed));
  const [error, setError] = useState(/** @type {string | null} */ (null));

  if (mode === 'qr' && b.payLink) {
    return (
      <div className="dialog center-text">
        <div className="sm muted strong">
          {b.lead.name} · {b.reference}
        </div>
        <h2 className="h-xl">Scan to pay {formatNaira(owed)}</h2>
        <Qr url={b.payLink} label={`Payment QR code for booking ${b.reference}`} />
        <p className="sm muted">
          They scan it with their phone camera and pay by card or transfer on Paystack, on their own
          data. It works even if your phone has no signal.
        </p>
        <p className="sm strong">When they’ve paid, ask to see their Paystack receipt.</p>
        <button type="button" className="btn btn--present" onClick={onPaidByLink}>
          They’ve paid · check them in
        </button>
        <button type="button" className="btn btn--outline" onClick={() => setMode('ask')}>
          Back
        </button>
      </div>
    );
  }

  if (mode === 'cash') {
    const parsed = cashAmount(typed, owed);
    return (
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!parsed.ok) return setError(parsed.error);
          onCash(parsed.kobo);
        }}
      >
        <div className="sm muted strong">
          {b.lead.name} · owes {formatNaira(owed)}
        </div>
        <h2 className="h-xl">Record cash</h2>
        <label className="field">
          Amount you received (₦)
          <input
            className="input input--money"
            type="text"
            inputMode="numeric"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
          />
          <span className="small muted plain">
            Up to {formatNaira(owed)}. Less is fine; the rest stays owing.
          </span>
        </label>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="info-box">
          <strong>What happens</strong>
          <span>
            This is saved as <strong>cash reported by {guide}</strong>. It isn’t a payment yet: the
            booking keeps showing as owing until the office confirms you handed the money in.
          </span>
        </div>
        <button type="submit" className="btn btn--present">
          {parsed.ok ? `Record ${formatNaira(parsed.kobo)} and check in` : 'Record and check in'}
        </button>
        <button type="button" className="btn btn--outline" onClick={() => setMode('ask')}>
          Back
        </button>
      </form>
    );
  }

  return (
    <div className="dialog">
      <h2 className="h-lg">
        {who} still owes {formatNaira(owed)}
      </h2>
      {detail && <p className="sm">{detail}</p>}
      <p className="muted">
        Ask them to pay now. If they can’t, you can still check them in and the office will follow
        up.
      </p>
      {b.payLink && (
        <button type="button" className="btn btn--dark" onClick={() => setMode('qr')}>
          <Icon name="qr" size={22} />
          Show payment QR
        </button>
      )}
      <button
        type="button"
        className="btn btn--outline btn--strong"
        onClick={() => setMode('cash')}
      >
        They paid me cash
      </button>
      <button type="button" className="btn btn--outline" onClick={onStillOwing}>
        Check in, still owing
      </button>
      <button type="button" className="text-link text-link--plain" onClick={onClose}>
        Not now
      </button>
    </div>
  );
}

/** A QR code, drawn as SVG squares (sharp at any size; nothing to download). @param {{ url: string, label: string }} props */
function Qr({ url, label }) {
  const squares = qrSquares(url);
  const n = squares.length;
  const path = squares
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : '')))
    .join('');
  return (
    <svg
      className="qr"
      viewBox={`0 0 ${n} ${n}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={n} height={n} fill="#FFFFFF" />
      <path d={path} fill="#111511" />
    </svg>
  );
}
