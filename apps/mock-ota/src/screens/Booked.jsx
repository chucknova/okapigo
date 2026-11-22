// @ts-check
/**
 * M4 · You're booked (designs: "Sojourna — You're booked"): Sojourna's reference and the
 * operator's; the ticket (the operator's own QR code, from OCTO's voucher: it scans like any of
 * theirs); where to meet (or the pickup); what to bring; who runs the trip; what was paid.
 * "Download ticket (PDF)" prints the page (the browser saves it as a PDF).
 */
import { Link } from 'wouter';
import { encode } from 'uqr';
import { useLoad } from '../lib/use-load.js';
import {
  countsOf,
  dateLabel,
  featuresOf,
  firstWord,
  meetingPointOf,
  naira,
  phoneWords,
  timeOf,
  whoWords,
} from '../lib/words.js';
import { StatePanel } from '../components/StatePanel.jsx';

/** @param {{ reference: string }} props */
export function Booked({ reference }) {
  const r = useLoad(`/api/bookings/${encodeURIComponent(reference)}`);
  if (r.error) {
    return (
      <main className="page">
        <StatePanel
          tone="bad"
          tag="NOT FOUND"
          title="We can’t find that booking"
          body={r.error.message}
        >
          <Link href="/" className="btn btn--line">
            Back to experiences
          </Link>
        </StatePanel>
      </main>
    );
  }
  if (!r.data) return <main className="page" aria-busy="true" />;
  const { stored, booking: b, experience: p, supplier } = r.data;
  const name = supplier.name;
  const short = firstWord(name);
  const first = firstWord(stored.lead.name);
  const start = b.availability.localDateTimeStart;
  const units = /** @type {any[]} */ (p?.options?.[0]?.units ?? []);
  const counts = countsOf(b.unitItems);
  const meet = meetingPointOf(p);
  const bring = featuresOf(p, 'PREARRIVAL_INFORMATION');
  const code = b.voucher?.deliveryOptions?.find(
    (/** @type {any} */ d) => d.deliveryFormat === 'QRCODE',
  )?.deliveryValue;
  const cancelled = b.status === 'CANCELLED';

  return (
    <main className="page stack-lg booked">
      <section className="booked-band">
        <div>
          <div className="row-wrap">
            <span aria-hidden="true" className="tick">
              ✓
            </span>
            <h1 className="h1 h1--white">
              {cancelled ? `Cancelled, ${first}` : `You’re booked, ${first}`}
            </h1>
          </div>
          <p className="booked-sub">
            {p?.title ?? 'Your experience'} · {dateLabel(start)}, {timeOf(start)} ·{' '}
            {whoWords(units, counts)}
          </p>
        </div>
        <div className="booked-refs">
          <div className="small">Sojourna booking</div>
          <div className="ref">{stored.ref}</div>
          <div className="small">{short}’s reference</div>
          <div className="ref ref--small">{b.supplierReference}</div>
        </div>
      </section>

      <div className="booked-grid">
        <section className="panel ticket" aria-label="Your ticket">
          <h2 className="h2">Your ticket</h2>
          {code && !cancelled ? (
            <>
              <Qr text={code} label={`QR ticket from ${name}`} />
              <div className="ref ref--ink">{b.supplierReference}</div>
              <div className="small muted">
                Show this to {short}’s guide at the start. Works on your phone or printed.
              </div>
              <button type="button" className="link-button" onClick={() => window.print()}>
                Download ticket (PDF)
              </button>
            </>
          ) : (
            <p className="muted">
              {cancelled ? 'This booking is cancelled.' : 'Your ticket is on its way.'}
            </p>
          )}
        </section>

        <div className="stack-md">
          {(b.pickupLocation || meet) && (
            <section className="panel stack-sm" aria-label="Where to meet">
              <h2 className="h2">{b.pickupLocation ? 'Where we collect you' : 'Where to meet'}</h2>
              {b.pickupLocation ? (
                <div>
                  <strong>{b.pickupLocation.title}</strong>
                  <br />
                  <span className="muted">
                    {b.pickupLocation.shortDescription}
                    {b.localPickupDateTimeStart
                      ? ` · be ready by ${timeOf(b.localPickupDateTimeStart)}`
                      : ''}
                  </span>
                </div>
              ) : (
                meet && (
                  <div>
                    <strong>{meet.name}</strong>
                    {meet.address && (
                      <>
                        <br />
                        <span className="muted">{meet.address}</span>
                      </>
                    )}
                  </div>
                )
              )}
              {!b.pickupLocation && meet?.map && (
                <a href={meet.map} target="_blank" rel="noreferrer" className="strong">
                  Open in Google Maps
                </a>
              )}
            </section>
          )}
          {bring.length > 0 && (
            <section className="panel" aria-label="What to bring">
              <h2 className="h2">What to bring</h2>
              <ul className="list">
                {bring.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </section>
          )}
          <section className="panel stack-sm" aria-label={`Run by ${name}`}>
            <h2 className="h2">Run by {name}</h2>
            <p className="ink-soft">
              {short} runs this trip. They’ll email you a trip page with the map and everything you
              need.
              {supplier.contact?.telephone
                ? ` Questions on the day: ${phoneWords(supplier.contact.telephone)} (WhatsApp).`
                : ''}
            </p>
            <p className="small muted">
              Paid {naira(b.pricing?.retail ?? 0)} to Sojourna. To cancel, go to My bookings:{' '}
              {short}’s policy applies.
            </p>
          </section>
          <div className="row-wrap">
            <Link href="/" className="btn btn--line">
              Back to experiences
            </Link>
            <Link href="/bookings" className="btn btn--blue">
              My bookings
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

/** The ticket's QR code, drawn as squares (works offline and in print). @param {{ text: string, label: string }} props */
function Qr({ text, label }) {
  const { data, size } = encode(text);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className="qr"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      {data.flatMap((row, y) =>
        row.map((on, x) =>
          on ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#1b2433" /> : null,
        ),
      )}
    </svg>
  );
}
