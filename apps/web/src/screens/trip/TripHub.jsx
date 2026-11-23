// @ts-check
/**
 * /trip/:token — the trip hub (GST-04; designs: file 05, "Trip hub · upcoming", "trip day",
 * and the nine banners). One light page per booking: the QR ticket, where to meet, what to
 * bring, the route, travellers, payment, contact, and the cancellation terms.
 *
 * Built for the day itself, outdoors, on a weak signal:
 *   - it shows the copy saved on this phone AT ONCE, then swaps in fresh data if the network
 *     answers ("Saved on this phone · last updated 08:12"; offline: "You're offline")
 *   - the QR is part of that copy (an SVG path from the server), so the ticket works offline
 *   - text first: the only images are four small map tiles, and the page works without them
 *
 * WHICH state to show (upcoming · today · after · cancelled…, balance due or overdue, what
 * cancelling now would give back) comes from tripSituation() in @okapigo/shared/trip-hub, run
 * again every minute against the phone's clock. This file only turns it into words.
 *
 * "Change or cancel" opens TripChange.jsx (stage 12f-2); "Ask a question", the AI companion,
 * is AskCard.jsx (18a-2).
 */
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { formatNaira } from '@okapigo/shared/money';
import { formatDuration, formatLocalDay } from '@okapigo/shared/preview';
import { describePolicy, formatAt } from '@okapigo/shared/tour-facts';
import { localDate, localTime } from '@okapigo/shared/time';
import { tripSituation, requestNotice } from '@okapigo/shared/trip-hub';
import { useApi } from '../../lib/data.js';
import { ApiError } from '../../lib/api.js';
import { rememberTrip } from '../../lib/trips.js';
import { savedTrip, saveTrip, saveTicks, tickedItems } from '../../lib/trip-copy.js';
import {
  tilesAround,
  tileUrl,
  googleMapsUrl,
  appleMapsUrl,
  whatsappUrl,
  TILE,
} from '../../lib/map.js';
import { Shell } from '../../components/Shell.jsx';
import { StatusPanel } from '../../components/StatusPanel.jsx';
import { Bar } from '../../components/Skeleton.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { useLook } from '../../lib/look.js';
import { AskCard } from './AskCard.jsx';

const MINUTE_MS = 60_000;

/** The clock the page decides by, moved on every minute (upcoming → today at midnight). */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** "Ìrìn Lagos Tours" → "Ìrìn", as the designs say it ("Contact Ìrìn"). @param {string} name */
const shortName = (name) => name.split(/\s+/)[0] || name;

/** "Adult (13+)" → "Adult": the travellers list doesn't need the age range. @param {string} s */
const plainCategory = (s) => s.replace(/\s*\(.*\)\s*$/, '');

/** @param {number} ms @param {string} tz  "08:12" */
const clockTime = (ms, tz) => localTime(new Date(ms), tz);

/** @param {{ params: { token: string } }} props */
export function TripHub({ params }) {
  const { token } = params;
  const live = useApi(`/public/bookings/${token}`);
  const [saved] = useState(() => savedTrip(token)); // read once: the copy from last time
  const now = useMinuteClock();

  const fresh = live.data?.booking ?? null;
  useEffect(() => {
    if (!fresh) return;
    saveTrip(token, fresh);
    rememberTrip(fresh.reference, token); // for the payment link page (stage 12e)
  }, [fresh, token]);

  const b = fresh ?? saved?.booking ?? null;
  useLook(b?.operator); // the saved copy has it too: the right style, even offline
  const unreachable =
    !fresh &&
    live.error instanceof ApiError &&
    ['offline', 'timeout', 'server'].includes(live.error.kind);

  if (!b) {
    if (live.error instanceof ApiError && live.error.status === 404) {
      return (
        <Shell operatorName="OkapiGo">
          <StatusPanel tone="danger" title="This trip link doesn’t work">
            Check you copied all of it, or ask the tour operator to send it again.
          </StatusPanel>
        </Shell>
      );
    }
    return (
      <Shell operatorName="">
        {live.error ? <ErrorState error={live.error} onRetry={live.retry} /> : <Bar height={28} />}
      </Shell>
    );
  }

  const tz = b.operator.timeZone;
  const s = tripSituation(b, new Date(now));
  const op = shortName(b.operator.name);
  const ended = s.phase === 'cancelled';
  const onTrip = s.phase === 'upcoming' || s.phase === 'today';
  const offline = Boolean(unreachable && saved);
  const savedAt = fresh ? now : (saved?.savedAt ?? now);

  return (
    <Shell operatorName={b.operator.name} aside="Your trip">
      <div className="okg-trip">
        {offline && (
          <Banner tone="neutral" title="You’re offline">
            Showing what this phone saved at {clockTime(savedAt, tz)}.
            {b.ticket ? ' Your ticket still works.' : ''}
          </Banner>
        )}
        {s.phase === 'today' ? (
          <TodayBand b={b} />
        ) : (
          <SituationBanner b={b} s={s} token={token} op={op} offline={offline} />
        )}
        {s.phase === 'today' && s.balance && (
          <BalanceBanner b={b} balance={s.balance} token={token} op={op} offline={offline} />
        )}
        {onTrip && requestNotice(b) && <RequestBanner b={b} op={op} />}

        <div className={`okg-trip__body${ended ? ' okg-trip__body--ended' : ''}`}>
          {s.phase !== 'today' && <TripHeading b={b} s={s} />}

          {onTrip && b.ticket && <Ticket b={b} today={s.phase === 'today'} />}

          {s.phase === 'today' ? (
            <>
              <MeetingPoint b={b} prominent />
              <Contact b={b} title="Running late or can’t find us?" today />
              {b.tour.whatToBring.length > 0 && (
                <section className="okg-card okg-trip__card okg-trip__bring-line">
                  <h2 className="okg-trip__h2">Bring</h2>
                  <p className="okg-muted">{b.tour.whatToBring.join(' · ')}</p>
                </section>
              )}
            </>
          ) : (
            <>
              {!ended && <MeetingPoint b={b} />}
              {onTrip && b.tour.whatToBring.length > 0 && <Checklist b={b} />}
            </>
          )}

          {b.tour.stops.length > 0 && (
            <section className="okg-card okg-trip__card">
              <h2 className="okg-trip__h2">The route</h2>
              <ol className="okg-trip__route">
                {b.tour.stops.map((/** @type {string} */ stop) => (
                  <li key={stop}>{stop}</li>
                ))}
              </ol>
            </section>
          )}

          <Travellers b={b} op={op} />
          <Payment b={b} s={s} token={token} offline={offline} />
          {/* The AI companion (18a-2): open while there's a trip and after it; closed once
              cancelled. */}
          {s.phase !== 'not_booked' && (
            <AskCard token={token} b={b} op={op} phase={s.phase} offline={offline} />
          )}
          {s.phase !== 'today' && <Contact b={b} title={`Contact ${op}`} />}
          {s.phase === 'upcoming' && (
            <ChangeOrCancel b={b} s={s} op={op} token={token} offline={offline} />
          )}
        </div>

        <p className="okg-trip__saved" role="status">
          <span aria-hidden="true">⤓</span> Saved on this phone · last updated{' '}
          {clockTime(savedAt, tz)}
        </p>
        <p className="okg-trip__footer">
          Keep this link private: anyone with it can see this booking. · Bookings by OkapiGo
        </p>
      </div>
    </Shell>
  );
}

// --- Banners -------------------------------------------------------------------------------

/**
 * @param {{ tone: 'good' | 'warning' | 'danger' | 'neutral' | 'success', title: string,
 *   children?: import('react').ReactNode, action?: import('react').ReactNode }} props
 */
function Banner({ tone, title, children, action }) {
  return (
    <div className={`okg-trip-banner okg-trip-banner--${tone}`} role="status">
      <p className="okg-trip-banner__title">{title}</p>
      {children && <p className="okg-trip-banner__text">{children}</p>}
      {action}
    </div>
  );
}

/**
 * Pay the balance: a link to /trip/:token/pay, or "Needs a connection" while offline.
 * @param {{ token: string, amountKobo: number, offline: boolean }} props
 */
function PayButton({ token, amountKobo, offline }) {
  if (offline) {
    return (
      <button type="button" className="okg-btn okg-btn--dark" disabled>
        Pay {formatNaira(amountKobo)} · Needs a connection
      </button>
    );
  }
  return (
    <Link className="okg-btn okg-btn--dark" href={`/trip/${token}/pay`}>
      Pay {formatNaira(amountKobo)}
    </Link>
  );
}

/** @param {{ b: any, balance: { amountKobo: number, dueDate: string, overdue: boolean }, token: string, op: string, offline: boolean }} props */
function BalanceBanner({ b, balance, token, op, offline }) {
  const pay = <PayButton token={token} amountKobo={balance.amountKobo} offline={offline} />;
  if (balance.overdue) {
    return (
      <Banner
        tone="danger"
        title={`Your balance of ${formatNaira(balance.amountKobo)} was due on ${formatLocalDay(balance.dueDate)}`}
        action={pay}
      >
        Your booking is still on. Please pay now or message {op}.
      </Banner>
    );
  }
  return (
    <Banner
      tone="warning"
      title={`Balance of ${formatNaira(balance.amountKobo)} due by ${formatLocalDay(balance.dueDate)}`}
      action={pay}
    >
      Deposit of {formatNaira(b.amountPaidKobo)} paid. Your seat is booked.
    </Banner>
  );
}

/** @param {{ b: any, s: ReturnType<typeof tripSituation>, token: string, op: string, offline: boolean }} props */
function SituationBanner({ b, s, token, op, offline }) {
  const day = formatLocalDay(b.departure.localDate);
  if (s.phase === 'upcoming') {
    // An open request has its own banner ("Your request was sent…"), shown instead.
    if (!s.balance && requestNotice(b)) return null;
    return s.balance ? (
      <BalanceBanner b={b} balance={s.balance} token={token} op={op} offline={offline} />
    ) : (
      <Banner tone="good" title={`See you on ${day}!`} />
    );
  }
  if (s.phase === 'after') {
    return (
      <Banner
        tone="good"
        title="Thanks for coming!"
        action={
          <Link className="okg-btn okg-btn--primary" href={`/${b.operator.slug}`}>
            See {op}’s other tours
          </Link>
        }
      >
        We hope you enjoyed the {b.tour.title}. Book another trip any time.
      </Banner>
    );
  }
  if (s.phase === 'no_show') {
    return (
      <Banner tone="neutral" title="This trip has ended">
        We missed you on {day}. If something went wrong, message {op}.
      </Banner>
    );
  }
  if (s.phase === 'not_booked') {
    return (
      <Banner
        tone="neutral"
        title="This booking isn’t paid yet"
        action={
          <Link className="okg-btn okg-btn--secondary" href={`/${b.operator.slug}/${b.tour.slug}`}>
            Book this tour
          </Link>
        }
      >
        The seats were held, but the payment didn’t finish, so nothing is booked.
      </Banner>
    );
  }
  // Cancelled (and maybe refunded).
  const c = /** @type {NonNullable<typeof s.cancelled>} */ (s.cancelled);
  if (c.refunded) {
    return (
      <Banner
        tone="success"
        title={`Refunded ${formatNaira(c.refunded.amountKobo)}${c.refunded.percent ? ` (${c.refunded.percent}%)` : ''} on ${formatLocalDay(c.refunded.on)}`}
      >
        It went back to the card or account you paid with.
      </Banner>
    );
  }
  if (c.by === 'operator') {
    return (
      <Banner
        tone="warning"
        title={`${op} had to cancel this trip`}
        action={
          b.operator.whatsapp ? (
            <a className="okg-btn okg-btn--dark" href={whatsappUrl(b.operator.whatsapp)}>
              Message {op} on WhatsApp
            </a>
          ) : null
        }
      >
        {c.reason ? `“${c.reason}” ` : ''}
        {c.refundKobo > 0 ? `You’ll get a full refund of ${formatNaira(c.refundKobo)}. ` : ''}
        Want another date instead? Message {op}.
      </Banner>
    );
  }
  return (
    <Banner
      tone="neutral"
      title={
        c.refundKobo > 0
          ? `Cancelled · ${formatNaira(c.refundKobo)} refund on its way`
          : 'Cancelled'
      }
    >
      {c.on ? `Cancelled on ${formatLocalDay(c.on)}. ` : ''}
      {c.refundKobo > 0
        ? 'Refunds can take 5–10 working days to appear.'
        : 'No refund was due under the cancellation policy.'}
    </Banner>
  );
}

/**
 * "Your request was sent on Tue 1 Dec" (stage 12f-2): the newest open "Ask Ìrìn" request.
 * @param {{ b: any, op: string }} props
 */
function RequestBanner({ b, op }) {
  const r = /** @type {NonNullable<ReturnType<typeof requestNotice>>} */ (requestNotice(b));
  const on = formatLocalDay(localDate(r.at, b.operator.timeZone));
  // The office replied (16d-2): their words, instead of "sent".
  if (r.kind === 'reply') {
    return (
      <Banner tone="good" title={`${op} replied on ${on}`}>
        {r.reply}
      </Banner>
    );
  }
  return (
    <Banner tone="good" title={`Your request was sent on ${on}`}>
      “{r.message}” {op} will reply by WhatsApp or email. Your booking stays as it is until then.
    </Banner>
  );
}

/** The dark band on the day: "TODAY · Starts at 09:00 · Meet at Tinubu Square". @param {{ b: any }} props */
function TodayBand({ b }) {
  const place = b.pickupPoint?.name ?? b.tour.meetingPoint.name;
  return (
    <section className="okg-trip-today" aria-label="Today">
      <p className="okg-trip-today__label">TODAY</p>
      <p className="okg-trip-today__title">
        Starts at {b.departure.localTime} · {b.pickupPoint ? 'Pickup' : 'Meet'} at {place}
      </p>
      <p className="okg-trip-today__sub">
        {b.tour.title} · {travellersWord(b.travellers.length)}
      </p>
    </section>
  );
}

// --- Sections -----------------------------------------------------------------------------

/** @param {number} n */
const travellersWord = (n) => (n === 1 ? '1 traveller' : `${n} travellers`);

/** @param {{ b: any, s: ReturnType<typeof tripSituation> }} props */
function TripHeading({ b, s }) {
  const when =
    s.phase === 'cancelled'
      ? 'Cancelled'
      : s.phase !== 'upcoming'
        ? formatLocalDay(b.departure.localDate)
        : s.daysToGo === 1
          ? 'Tomorrow'
          : `In ${s.daysToGo} days`;
  return (
    <section className="okg-trip__heading">
      <p className="okg-trip__when">{when}</p>
      <h1 className="okg-trip__title">{b.tour.title}</h1>
      <p className="okg-trip__date">
        {formatLocalDay(b.departure.localDate)}, {b.departure.localTime} ·{' '}
        {formatDuration(b.tour.durationMinutes)}
      </p>
    </section>
  );
}

/** @param {{ b: any, today: boolean }} props */
function Ticket({ b, today }) {
  const { size, path } = b.ticket.qr;
  const quiet = 2; // white margin, in modules, so cameras find the edges
  return (
    <section
      className={`okg-card okg-trip__card okg-ticket${today ? ' okg-ticket--today' : ''}`}
      aria-labelledby="okg-ticket-title"
    >
      {!today && (
        <h2 className="okg-trip__h2 okg-ticket__heading" id="okg-ticket-title">
          Your ticket
        </h2>
      )}
      {today && (
        <h2 className="okg-visually-hidden" id="okg-ticket-title">
          Your ticket
        </h2>
      )}
      <svg
        className="okg-ticket__qr"
        viewBox={`${-quiet} ${-quiet} ${size + quiet * 2} ${size + quiet * 2}`}
        role="img"
        aria-label={`QR ticket for booking ${b.reference}`}
        shapeRendering="crispEdges"
      >
        <rect
          x={-quiet}
          y={-quiet}
          width={size + quiet * 2}
          height={size + quiet * 2}
          fill="#fff"
        />
        <path d={path} fill="#111511" />
      </svg>
      <p className="okg-ticket__ref">{b.reference}</p>
      <p className={today ? 'okg-ticket__who okg-strong' : 'okg-ticket__who okg-muted'}>
        {travellersWord(b.travellers.length)} · {today ? b.lead.name : 'show this to your guide'}
      </p>
      <p className="okg-muted okg-small okg-ticket__note">
        {today
          ? 'Turn your screen brightness up. Works without signal.'
          : 'No signal on the day? The guide can find you by name or by this reference.'}
      </p>
    </section>
  );
}

/** @param {{ b: any, prominent?: boolean }} props */
function MeetingPoint({ b, prominent = false }) {
  const mp = b.tour.meetingPoint;
  const tz = b.operator.timeZone;
  const arriveBy =
    b.tour.arriveMinutesEarly && !b.pickupPoint
      ? localTime(
          new Date(
            new Date(b.departure.startsAt).getTime() - b.tour.arriveMinutesEarly * MINUTE_MS,
          ),
          tz,
        )
      : null;
  // A pin the business hasn't set yet (only its city's, 16e-4) would send guests to the wrong
  // place: no map and no directions until it's the real one.
  const hasPin = Number.isFinite(mp.lat) && Number.isFinite(mp.lng) && !mp.approximate;
  const details = [mp.address, mp.note, arriveBy ? `Arrive by ${arriveBy}.` : null]
    .filter(Boolean)
    .map((t) => (/[.!?]$/.test(t) ? t : `${t}.`))
    .join(' ');

  return (
    <section
      className="okg-card okg-trip__card okg-trip-meeting"
      aria-labelledby="okg-trip-meeting-title"
    >
      {hasPin && !prominent && <SmallMap lat={mp.lat} lng={mp.lng} />}
      <div className="okg-trip-meeting__text">
        {!prominent && (
          <h2 className="okg-trip__h2" id="okg-trip-meeting-title">
            Meeting point
          </h2>
        )}
        <p
          className={
            prominent
              ? 'okg-trip-meeting__name okg-trip-meeting__name--big'
              : 'okg-trip-meeting__name'
          }
          id={prominent ? 'okg-trip-meeting-title' : undefined}
        >
          {mp.name}
        </p>
        <p className={prominent ? '' : 'okg-muted okg-small'}>{details}</p>
        {b.pickupPoint && (
          <p className="okg-trip-meeting__pickup">
            <span className="okg-strong">Your pickup:</span> {b.pickupPoint.name}
            {b.pickupPoint.time ? ` · ${b.pickupPoint.time}` : ''}
          </p>
        )}
        {hasPin &&
          (prominent ? (
            <div className="okg-trip-meeting__links okg-trip-meeting__links--stacked">
              <a className="okg-btn okg-btn--primary" href={googleMapsUrl(mp)}>
                Directions in Google Maps
              </a>
              <a className="okg-link okg-trip-meeting__apple" href={appleMapsUrl(mp)}>
                Apple Maps
              </a>
            </div>
          ) : (
            <div className="okg-trip-meeting__links">
              <a className="okg-btn okg-btn--secondary" href={googleMapsUrl(mp)}>
                Google Maps
              </a>
              <a className="okg-btn okg-btn--secondary" href={appleMapsUrl(mp)}>
                Apple Maps
              </a>
            </div>
          ))}
      </div>
    </section>
  );
}

/**
 * Four OpenStreetMap tiles with a pin. referrerPolicy "origin": OpenStreetMap asks for a
 * referrer, and "origin" sends only the site's address, never this page's secret path.
 * @param {{ lat: number, lng: number }} props
 */
function SmallMap({ lat, lng }) {
  const { zoom, tiles, pinLeft, pinTop } = tilesAround(lat, lng);
  const [failed, setFailed] = useState(false);
  return (
    <div className="okg-map" aria-hidden="true">
      {!failed && (
        <div
          className="okg-map__tiles"
          style={{
            width: TILE * 2,
            height: TILE * 2,
            left: `calc(50% - ${pinLeft}px)`,
            top: `calc(50% - ${pinTop}px)`,
          }}
        >
          {tiles.map((t) => (
            <img
              key={`${t.x}-${t.y}`}
              src={tileUrl(zoom, t.x, t.y)}
              alt=""
              width={TILE}
              height={TILE}
              loading="lazy"
              referrerPolicy="origin"
              style={{ left: t.left, top: t.top }}
              onError={() => setFailed(true)}
            />
          ))}
        </div>
      )}
      <span className="okg-map__pin" />
      <span className="okg-map__credit">© OpenStreetMap</span>
    </div>
  );
}

/** "What to bring", ticked on this phone only. @param {{ b: any }} props */
function Checklist({ b }) {
  const [ticked, setTicked] = useState(() => tickedItems(b.reference));
  /** @param {string} item */
  const toggle = (item) => {
    const next = ticked.includes(item) ? ticked.filter((t) => t !== item) : [...ticked, item];
    setTicked(next);
    saveTicks(b.reference, next);
  };
  return (
    <section className="okg-card okg-trip__card">
      <h2 className="okg-trip__h2">What to bring</h2>
      <ul className="okg-trip__checklist">
        {b.tour.whatToBring.map((/** @type {string} */ item) => (
          <li key={item}>
            <label className="okg-trip__tick">
              <input
                type="checkbox"
                checked={ticked.includes(item)}
                onChange={() => toggle(item)}
              />
              {item}
            </label>
          </li>
        ))}
      </ul>
      <p className="okg-muted okg-small">Ticks are saved on this phone only.</p>
    </section>
  );
}

/** @param {{ b: any, op: string }} props */
function Travellers({ b, op }) {
  const labels = new Map(
    (b.quote?.lines ?? [])
      .filter((/** @type {any} */ l) => l.type === 'ticket')
      .map((/** @type {any} */ l) => [l.categoryKey, plainCategory(l.label)]),
  );
  return (
    <section className="okg-card okg-trip__card">
      <h2 className="okg-trip__h2">Travellers</h2>
      <ul className="okg-plain-list okg-trip__travellers">
        {b.travellers.map((/** @type {any} */ t, /** @type {number} */ i) => (
          <li key={i}>
            {t.name}{' '}
            <span className="okg-muted">
              · {labels.get(t.categoryKey) ?? t.categoryKey}
              {t.dietaryNeeds ? ` · ${t.dietaryNeeds}` : ''}
            </span>
          </li>
        ))}
      </ul>
      <p className="okg-muted okg-small">Something wrong? Message {op} below.</p>
    </section>
  );
}

/** @param {{ b: any, s: ReturnType<typeof tripSituation>, token: string, offline: boolean }} props */
function Payment({ b, s, token, offline }) {
  const paidOn = b.payments
    .filter((/** @type {any} */ p) => p.status === 'succeeded' && p.paidAt)
    .map((/** @type {any} */ p) => p.paidAt)
    .sort()
    .at(-1);
  const paidDay = paidOn ? formatLocalDay(localDate(new Date(paidOn), b.operator.timeZone)) : null;
  return (
    <section className="okg-card okg-trip__card okg-trip__payment">
      <div className="okg-trip__payment-row">
        <div>
          <h2 className="okg-trip__h2">Payment</h2>
          <p>
            {formatNaira(b.amountPaidKobo)}
            {paidDay ? ` · paid on ${paidDay}` : ''}
          </p>
        </div>
        {b.balanceKobo === 0 && b.amountPaidKobo > 0 && (
          <span className="okg-chip okg-chip--success">Paid in full</span>
        )}
      </div>
      {s.balance && (
        <>
          <p
            className={s.balance.overdue ? 'okg-trip__owed okg-trip__owed--late' : 'okg-trip__owed'}
          >
            Balance {formatNaira(s.balance.amountKobo)}{' '}
            {s.balance.overdue ? 'was due on' : 'due by'} {formatLocalDay(s.balance.dueDate)}
          </p>
          <PayButton token={token} amountKobo={s.balance.amountKobo} offline={offline} />
        </>
      )}
    </section>
  );
}

/** @param {{ b: any, title: string, today?: boolean }} props */
function Contact({ b, title, today = false }) {
  const { phone, whatsapp } = b.operator;
  if (!phone && !whatsapp) return null;
  const wa = whatsapp && (
    <a
      className={`okg-btn ${today ? 'okg-btn--secondary' : 'okg-btn--dark'}`}
      href={whatsappUrl(whatsapp)}
    >
      WhatsApp
    </a>
  );
  const call = phone && (
    <a
      className={`okg-btn ${today ? 'okg-btn--dark' : 'okg-btn--secondary'}`}
      href={`tel:${phone}`}
    >
      Call
    </a>
  );
  return (
    <section className="okg-card okg-trip__card" aria-label={title}>
      <h2 className="okg-trip__h2">{title}</h2>
      <div className="okg-two-buttons">
        {/* On the day, calling comes first (you're late, you're lost). */}
        {today ? (
          <>
            {call}
            {wa}
          </>
        ) : (
          <>
            {wa}
            {call}
          </>
        )}
      </div>
    </section>
  );
}

/** @param {{ b: any, s: ReturnType<typeof tripSituation>, op: string, token: string, offline: boolean }} props */
function ChangeOrCancel({ b, s, op, token, offline }) {
  const tz = b.operator.timeZone;
  const c = s.cancelNow;
  const policy = b.cancellationPolicy ? describePolicy(b.cancellationPolicy, op) : null;
  const until = c?.until ? formatAt(Date.parse(c.until), tz) : null;
  const terms = !c
    ? null
    : c.basisPoints >= 10_000
      ? until
        ? `full refund until ${until}`
        : 'full refund'
      : c.refundKobo > 0
        ? `${c.basisPoints / 100}% back${until ? ` until ${until}` : ''}`
        : null;
  // Booked through a travel website (17c-3): it took the money, so changes go through it.
  if (b.bookedThrough) {
    return (
      <section className="okg-card okg-trip__card okg-trip__cancel">
        <h2 className="okg-trip__h2">Change or cancel</h2>
        <p>
          You booked through {b.bookedThrough}. To change or cancel, use your {b.bookedThrough}{' '}
          booking: {op}’s cancellation policy applies.
        </p>
        {policy && (
          <details className="okg-trip__policy">
            <summary>Cancellation policy</summary>
            <ul>
              {policy.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
    );
  }
  return (
    <section className="okg-card okg-trip__card okg-trip__cancel">
      <h2 className="okg-trip__h2">Change or cancel</h2>
      {c && (
        <p>
          {c.refundKobo > 0 ? (
            <>
              If you cancel now you’ll get <strong>{formatNaira(c.refundKobo)}</strong> back
              {terms ? ` (${terms})` : ''}.
            </>
          ) : (
            <>If you cancel now, nothing is refunded under the policy.</>
          )}
          {c.keptDepositKobo > 0 &&
            ` The ${formatNaira(c.keptDepositKobo)} deposit isn’t refundable.`}
        </p>
      )}
      {offline ? (
        <button type="button" className="okg-btn okg-btn--secondary" disabled>
          Change or cancel · Needs a connection
        </button>
      ) : (
        <Link className="okg-btn okg-btn--secondary" href={`/trip/${token}/change`}>
          Change or cancel this booking
        </Link>
      )}
      {policy && (
        <details className="okg-trip__policy">
          <summary>Cancellation policy</summary>
          <ul>
            {policy.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
