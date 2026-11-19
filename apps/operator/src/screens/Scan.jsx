// @ts-check
/**
 * O4 · Scan (designs: O4 Scan, O4 Scan — problem states, Search and check-in).
 *
 *   the camera     dark, a frame to aim at; the trip and "8 of 12 checked in"; the torch
 *   a good scan    "Ticket OK": everyone still to come ticked (untick anyone missing);
 *                  money owed asks first; Check in 3 · Mark 3 late
 *   a problem      not this trip · cancelled · already in · not ours · …
 *   back on it     "2 checked in · Okafor · Kamsi not yet" · Undo (until the next scan)
 *   search         by name, phone or reference, instead of scanning
 *   no camera      how to allow it; search instead
 *
 * Works offline: the ticket is matched on the phone (lib/scan.js), the check-in goes into the
 * outbox. What a scan means is decided in lib/scan.js; this screen shows it.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { Icon } from '../components/Icon.jsx';
import { Sheet } from '../components/Sheet.jsx';
import { useEngine, useNow, useSync } from '../lib/engine.jsx';
import { withChanges } from '../lib/outbox.js';
import { formatAt } from '@okapigo/shared/tour-facts';
import { openCamera, createReader, buzz } from '../lib/camera.js';
import {
  fingerprint,
  classify,
  problemOf,
  goodScan,
  scanCheckIn,
  undoOf,
  afterNote,
  currentDeparture,
  searchTravellers,
} from '../lib/scan.js';

/** How long the note after a check-in stays (designs: 6 seconds). */
const NOTE_MS = 6_000;

export function Scan() {
  const { id } = useParams();
  const s = useSync();
  const engine = useEngine();
  const now = useNow(30_000);
  const [, go] = useLocation();
  const [view, setView] = useState(/** @type {'camera' | 'search'} */ ('camera'));
  const [result, setResult] = useState(/** @type {any} */ (null));
  const shown = useRef(0);
  const [note, setNote] = useState(/** @type {{ text: string, change: any } | null} */ (null));

  const pkg = withChanges(s.pkg, s.outbox);
  const tz = pkg?.operator?.timeZone ?? 'Africa/Lagos';
  const m = id
    ? pkg?.departures.find((/** @type {any} */ d) => d.departure.id === id)
    : currentDeparture(pkg, now);
  const back = id ? `/departures/${id}` : '/';

  // The note after a check-in goes after 6 seconds.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(t);
  }, [note]);

  if (!m) {
    return (
      <main className="page">
        <h1 className="h-xl">Nothing to scan for</h1>
        <p className="muted">You have no departures saved for today or tomorrow.</p>
        <Link href="/" className="btn btn--outline">
          Back to Today
        </Link>
      </main>
    );
  }
  const business = pkg.operator.name;
  const phone = pkg.operator.phone;
  const title = `${m.tour.shortTitle || m.tour.title} · ${m.departure.localTime}`;
  const count = `${m.counts.present + m.counts.late} of ${m.counts.travellers} checked in`;
  const raw = (/** @type {string} */ bookingId) =>
    m.bookings.find((/** @type {any} */ b) => b.id === bookingId);

  /** Shows a result in a fresh sheet (each scan its own: `n`, the sheet's key). @param {any} r */
  const show = (r) => setResult({ ...r, n: (shown.current += 1) });

  /** A code was read: what is it? @param {string} code */
  async function scanned(code) {
    setNote(null); // Undo works until the next scan
    const r = classify({
      code,
      fp: await fingerprint(code.trim()),
      pkg,
      departureId: m.departure.id,
    });
    buzz(r.kind === 'ok' ? 'ok' : 'problem');
    show(r);
  }
  /** @param {any} b @param {string[]} ids @param {'present' | 'late'} status @param {boolean} confirmOwed */
  async function checkIn(b, ids, status, confirmOwed) {
    const change = await engine.record(scanCheckIn(m, b, ids, status, { confirmOwed }));
    setResult(null);
    setNote({ text: afterNote(b, ids, status), change });
    setView('camera');
  }

  const sheet =
    result?.kind === 'ok' ? (
      <GoodScanSheet
        key={result.n}
        m={m}
        b={raw(result.b.id)}
        now={now}
        tz={tz}
        onClose={() => setResult(null)}
        onCheckIn={checkIn}
      />
    ) : result ? (
      <ProblemSheet
        key={result.n}
        p={problemOf(result, { current: m, business, now, tz })}
        phone={phone}
        onNext={() => setResult(null)}
        onSearch={() => {
          setResult(null);
          setView('search');
        }}
      />
    ) : null;

  if (view === 'search') {
    return (
      <>
        <SearchView
          m={m}
          tz={tz}
          phone={phone}
          onBack={() => setView('camera')}
          onPick={(b) =>
            show(classify({ code: '', fp: b.ticketFingerprint, pkg, departureId: m.departure.id }))
          }
        />
        {sheet}
      </>
    );
  }
  return (
    <>
      <Camera
        title={title}
        count={count}
        note={note}
        paused={Boolean(result)}
        onClose={() => go(back)}
        onCode={scanned}
        onSearch={() => setView('search')}
        onUndo={async () => {
          if (!note) return;
          await engine.record(undoOf(note.change));
          setNote(null);
        }}
      />
      {sheet}
    </>
  );
}

/**
 * The camera, reading codes until `paused` (a result is showing).
 * @param {{ title: string, count: string, note: { text: string } | null, paused: boolean,
 *   onClose: () => void, onCode: (code: string) => void, onSearch: () => void, onUndo: () => void }} props
 */
function Camera({ title, count, note, paused, onClose, onCode, onSearch, onUndo }) {
  const video = useRef(/** @type {HTMLVideoElement | null} */ (null));
  const [problem, setProblem] = useState(/** @type {string | null} */ (null));
  const [torch, setTorch] = useState(
    /** @type {{ set: (on: boolean) => Promise<void>, on: boolean } | null} */ (null),
  );
  const [attempt, setAttempt] = useState(0);
  const pausedRef = useRef(paused);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    pausedRef.current = paused;
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    let stopped = false;
    /** @type {(() => void) | null} */
    let stop = null;
    /** @type {any} */
    let timer = null;
    let last = { code: '', at: 0 };
    (async () => {
      const el = video.current;
      if (!el) return;
      const cam = await openCamera(el);
      if (stopped) return cam.ok ? cam.stop() : undefined;
      if (!cam.ok) return setProblem(cam.problem);
      stop = cam.stop;
      if (cam.torch) setTorch({ set: cam.torch, on: false });
      const reader = await createReader();
      const tick = async () => {
        if (stopped) return;
        if (!pausedRef.current) {
          const code = await reader.read(el).catch(() => null);
          // The same ticket still in view after closing its sheet: not read again for 3 s.
          if (code && !(code === last.code && Date.now() - last.at < 3_000)) {
            last = { code, at: Date.now() };
            onCodeRef.current(code);
          } else if (code) last.at = Date.now();
        }
        timer = setTimeout(tick, 250);
      };
      void tick();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stop?.();
    };
  }, [attempt]);

  if (problem) {
    return (
      <NoCamera
        denied={problem === 'denied'}
        onRetry={() => {
          setProblem(null);
          setAttempt((n) => n + 1);
        }}
        onSearch={onSearch}
      />
    );
  }
  return (
    <div className="scanner">
      <video ref={video} className="scanner-video" muted playsInline aria-hidden="true" />
      <div className="scanner-top">
        <button
          type="button"
          className="icon-btn icon-btn--light"
          aria-label="Close scanner"
          onClick={onClose}
        >
          <Icon name="close" size={26} />
        </button>
        <div className="grow">
          <div className="strong-heavy">{title}</div>
          <div className="small scanner-muted">{count}</div>
        </div>
        {torch && (
          <button
            type="button"
            className="torch-btn"
            aria-label={torch.on ? 'Torch off' : 'Torch'}
            aria-pressed={torch.on}
            onClick={async () => {
              await torch.set(!torch.on).catch(() => {});
              setTorch({ ...torch, on: !torch.on });
            }}
          >
            <Icon name="torch" size={22} />
          </button>
        )}
      </div>
      {note && (
        <div role="status" className="scan-note">
          <Icon name="check" size={22} width={3} />
          <span className="grow sm">
            <strong>{note.text.split(' · ')[0]}</strong>
            {note.text.includes(' · ') ? ` · ${note.text.split(' · ').slice(1).join(' · ')}` : ''}
          </span>
          <button type="button" className="undo-btn" onClick={onUndo}>
            Undo
          </button>
        </div>
      )}
      <div className="scan-frame" aria-hidden="true">
        <span className="corner corner--tl" />
        <span className="corner corner--tr" />
        <span className="corner corner--bl" />
        <span className="corner corner--br" />
      </div>
      <div className="scan-hint">
        {note ? 'Next ticket' : 'Point at the QR code on the guest’s phone or printout'}
      </div>
      <div className="scanner-bottom">
        <button type="button" className="btn btn--ghost-light" onClick={onSearch}>
          Search by name or reference
        </button>
        <div className="tiny center scanner-muted">
          Works without signal: tickets are checked on this phone.
        </div>
      </div>
    </div>
  );
}

/** @param {{ denied: boolean, onRetry: () => void, onSearch: () => void }} props */
function NoCamera({ denied, onRetry, onSearch }) {
  return (
    <main className="page page--plain">
      <Icon name="camera-off" size={48} width={1.8} />
      <h1 className="h-xl">The app can’t use the camera</h1>
      {denied ? (
        <>
          <p className="muted">To scan tickets, allow the camera:</p>
          <ol className="steps">
            <li>
              Tap the lock or ⓘ next to the address bar (or open your phone’s Settings › OkapiGo).
            </li>
            <li>
              Set <strong>Camera</strong> to <strong>Allow</strong>.
            </li>
            <li>Come back here and tap Try again.</li>
          </ol>
        </>
      ) : (
        <p className="muted">
          This phone or browser doesn’t give the app a camera. You can still check guests in by
          name.
        </p>
      )}
      <button type="button" className="btn btn--main" onClick={onRetry}>
        Try again
      </button>
      <button type="button" className="btn btn--outline" onClick={onSearch}>
        Search by name instead
      </button>
    </main>
  );
}

/**
 * "Ticket OK": tick who's here, then check them in (or mark them late).
 * @param {{ m: any, b: any, now: Date, tz: string, onClose: () => void,
 *   onCheckIn: (b: any, ids: string[], status: 'present' | 'late', confirmOwed: boolean) => void }} props
 */
function GoodScanSheet({ m, b, now, tz, onClose, onCheckIn }) {
  const v = goodScan(m, b, { now, tz });
  const [ticked, setTicked] = useState(
    () => new Set(v.people.filter((p) => p.waiting).map((p) => p.id)),
  );
  const [owingOk, setOwingOk] = useState(v.owesAsked);
  const ids = v.people.filter((p) => ticked.has(p.id)).map((p) => p.id);
  const waiting = v.people.filter((p) => p.waiting).length;
  const howMany = ids.length === waiting ? `${ids.length}` : `${ids.length} of ${waiting}`;
  const asking = v.owes && !owingOk;
  return (
    <Sheet title="Ticket OK" onClose={onClose}>
      <div className="result-head result-head--ok">
        <Icon name="check" size={28} width={3} />
        <div>
          <div className="result-title">Ticket OK</div>
          <div className="small">{v.ref} · this departure</div>
        </div>
      </div>
      <div className="dialog">
        <div className="row-between row-baseline">
          <span className="h-sm">{v.lead}</span>
          {!v.owes && <span className={`chip chip--${v.pay.tone}`}>{v.pay.text}</span>}
        </div>
        {asking && v.owes ? (
          <>
            <div role="alert" className="owes-box">
              <strong className="owes-title">{v.owes.title}</strong>
              <span className="sm">{v.owes.detail}</span>
            </div>
            <button
              type="button"
              className="btn btn--outline btn--strong"
              onClick={() => setOwingOk(true)}
            >
              Check in, still owing
            </button>
            <button type="button" className="text-link text-link--plain" onClick={onClose}>
              Not now
            </button>
          </>
        ) : (
          <>
            <fieldset className="who">
              <legend className="small muted strong">Who’s here? Untick anyone missing.</legend>
              {v.people.map((p) => (
                <label
                  key={p.id}
                  className={`who-row${p.waiting && !ticked.has(p.id) ? ' who-row--missing' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={p.waiting ? ticked.has(p.id) : true}
                    disabled={!p.waiting}
                    onChange={(e) => {
                      const next = new Set(ticked);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      setTicked(next);
                    }}
                  />
                  <span className="grow">
                    <span className="block strong">{p.name}</span>
                    {p.diet && <span className="small warning strong">{p.diet}</span>}
                    {p.waiting && !ticked.has(p.id) && (
                      <span className="small muted">stays “Not yet”</span>
                    )}
                    {p.note && <span className="small muted">{p.note}</span>}
                  </span>
                  <span className="small muted">{p.meta}</span>
                </label>
              ))}
            </fieldset>
            {v.extras && <div className="sm muted">{v.extras}</div>}
            <button
              type="button"
              className="btn btn--present btn--big"
              disabled={ids.length === 0}
              onClick={() => onCheckIn(b, ids, 'present', Boolean(v.owes))}
            >
              Check in {howMany}
            </button>
            {v.started && ids.length > 0 && (
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => onCheckIn(b, ids, 'late', Boolean(v.owes))}
              >
                Mark {ids.length} late ({v.lateAt})
              </button>
            )}
            {waiting > ids.length && ids.length > 0 && (
              <p className="small muted">
                Scan the same ticket again when the others arrive: only they will be ticked.
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

/** @param {{ p: ReturnType<typeof problemOf>, phone: string | null, onNext: () => void, onSearch: () => void }} props */
function ProblemSheet({ p, phone, onNext, onSearch }) {
  return (
    <Sheet title={p.title} alert onClose={onNext}>
      <div className={`result-head result-head--${p.tone}`}>
        <span className="result-icon" aria-hidden="true">
          {p.icon}
        </span>
        <div>
          <div className="result-title">{p.title}</div>
          <div className="small">{p.sub}</div>
        </div>
      </div>
      <div className="dialog">
        <p className="base">{p.body}</p>
        {p.search && (
          <button type="button" className="btn btn--dark" onClick={onSearch}>
            Search by name or reference
          </button>
        )}
        {p.call && phone && (
          <a className="btn btn--dark" href={`tel:${phone}`}>
            Call the office
          </a>
        )}
        <button type="button" className="btn btn--outline" onClick={onNext}>
          {p.search && !p.call ? 'Try scanning again' : 'Scan the next ticket'}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Search by name instead of scanning (designs: Search and check-in).
 * @param {{ m: any, tz: string, phone: string | null, onBack: () => void, onPick: (b: any) => void }} props
 */
function SearchView({ m, tz, phone, onBack, onPick }) {
  const [q, setQ] = useState('');
  const hits = searchTravellers(m, q);
  // "Badagry Heritage Day Trip · Sat 5 Dec"
  const day = `${m.tour.shortTitle || m.tour.title} · ${formatAt(Date.parse(m.departure.startsAt), tz).split(',')[0]}`;
  return (
    <>
      <div className="search-head">
        <div className="manifest-bar">
          <button
            type="button"
            className="icon-btn icon-btn--edge"
            aria-label="Back to the scanner"
            onClick={onBack}
          >
            <Icon name="back" size={24} />
          </button>
          <span className="grow sm muted strong-ish">Search instead of scanning</span>
        </div>
        <label className="field field--tight">
          Name, phone or reference
          <input
            type="search"
            className="input input--search input--strong"
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        {q.trim() && (
          <div className="tiny muted" role="status">
            {day} · {hits.length} {hits.length === 1 ? 'match' : 'matches'}
          </div>
        )}
      </div>
      <main className="page">
        {hits.map((h) => (
          <button
            key={h.traveller.id}
            type="button"
            className="hit"
            onClick={() => onPick(h.booking)}
          >
            <span className="grow">
              <span className="block md">
                {h.pre}
                {h.match && <strong className="hit-match">{h.match}</strong>}
                {h.post}
              </span>
              <span className="small muted">{h.meta}</span>
            </span>
            <span className={`hit-state hit-state--${h.state}`}>
              {
                { pending: 'Not yet', present: 'Present', late: 'Late', no_show: 'No-show' }[
                  /** @type {string} */ (h.state)
                ]
              }
            </span>
          </button>
        ))}
        {q.trim() && hits.length === 0 && (
          <div className="center-stack center-stack--tight">
            <h2 className="h-lg">No one called “{q.trim()}” on this trip</h2>
            <p className="muted">Try:</p>
            <ul className="tips">
              <li>another spelling, or just the first name</li>
              <li>the last 4 digits of their phone</li>
              <li>the reference on their ticket (ILT-…)</li>
            </ul>
            <p className="sm muted">They may be booked on another tour or date.</p>
            {phone && (
              <a className="btn btn--outline" href={`tel:${phone}`}>
                Call the office
              </a>
            )}
          </div>
        )}
        {q.trim() && hits.length > 0 && (
          <p className="small muted">
            Tapping a name opens that booking with everyone ticked, same as a scan.
          </p>
        )}
      </main>
    </>
  );
}
