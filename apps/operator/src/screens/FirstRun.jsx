// @ts-check
/**
 * First run (designs: First run 1–3), right after the first sign-in on this phone:
 *   1 · install     "Put OkapiGo on your home screen" (skipped if it already is)
 *   2 · saving      "Getting your trips ready": today's and tomorrow's departures, and the
 *                   ticket check codes, saved for no signal
 *   3 · ready       "You're ready for no signal", good until Tue 8 Dec, 06:40
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Icon } from '../components/Icon.jsx';
import { useEngine, useSync } from '../lib/engine.jsx';
import { canInstall, install, isInstalled, isIphone, onInstallable } from '../lib/install.js';
import { askToKeepData } from '../lib/store.js';
import { goodUntil } from '../lib/status.js';

export function FirstRun() {
  const [step, setStep] = useState(() => (isInstalled() ? 'saving' : 'install'));
  if (step === 'install') return <Install onDone={() => setStep('saving')} />;
  return <Saving />;
}

/** @param {{ onDone: () => void }} props */
function Install({ onDone }) {
  const installable = useSyncExternalStore(onInstallable, canInstall);
  const iphone = isIphone();
  return (
    <div className="frame">
      <main className="stack stack--first">
        <span className="mark mark--lg" aria-hidden="true">
          O
        </span>
        <h1 className="h-2xl">Put OkapiGo on your home screen</h1>
        <p className="muted">
          Then it opens like an app and keeps working on tour, even with no signal.
        </p>
        <ul className="ticks">
          <li>Today’s manifests saved on your phone</li>
          <li>Scan tickets without signal</li>
          <li>Changes send themselves later</li>
        </ul>
        {installable && (
          <button
            type="button"
            className="btn btn--main"
            onClick={async () => {
              if (await install()) onDone();
            }}
          >
            Install the app
          </button>
        )}
        {(iphone || !installable) && (
          <div className="note">
            {iphone ? (
              <>
                <strong>On an iPhone:</strong> tap Share (the square with an arrow), then “Add to
                Home Screen”.
              </>
            ) : (
              <>
                <strong>To install:</strong> open your browser’s menu (⋮), then “Install app” or
                “Add to Home screen”.
              </>
            )}
          </div>
        )}
        <button type="button" className="text-link text-link--plain" onClick={onDone}>
          Not now
        </button>
        <p className="tiny muted">
          “Not now” still works in the browser, but the phone may clear saved manifests. We ask
          again next time.
        </p>
      </main>
    </div>
  );
}

function Saving() {
  const engine = useEngine();
  const s = useSync();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void askToKeepData();
    engine.sync().then(() => setFailed(!engine.getState().savedAt));
  }, [engine]);

  const pkg = s.pkg;
  const tz = pkg?.operator?.timeZone ?? 'Africa/Lagos';
  const saved = Boolean(s.savedAt && pkg);
  const departures = pkg?.departures ?? [];
  const travellers = departures.reduce(
    (/** @type {number} */ n, /** @type {any} */ m) => n + m.counts.travellers,
    0,
  );

  if (saved) {
    return (
      <div className="frame">
        <main className="stack stack--first stack--tall">
          <span className="badge-circle badge-circle--success">
            <Icon name="check" size={32} width={3} />
          </span>
          <h1 className="h-2xl">You’re ready for no signal</h1>
          <p className="muted">
            {departures.length === 0
              ? 'You have no departures today or tomorrow. '
              : `${departures.length} ${departures.length === 1 ? 'departure' : 'departures'} and ${travellers} travellers are saved on this phone, `}
            good until{' '}
            <strong className="ink">{goodUntil(/** @type {string} */ (s.savedAt), tz)}</strong>. The
            app refreshes them whenever it has signal.
          </p>
          <div className="note note--warning">
            <strong>One tip:</strong> turn off battery saver for OkapiGo, so it can refresh in the
            background.
          </div>
          <button
            type="button"
            className="btn btn--main push-bottom"
            onClick={() => engine.finishFirstRun()}
          >
            Go to Today
          </button>
        </main>
      </div>
    );
  }
  return (
    <div className="frame">
      <div className="strip strip--sending" role="status">
        {failed
          ? 'Waiting for signal… it carries on when it’s back'
          : 'Saving for offline… keep the app open'}
      </div>
      <main className="stack stack--roomy">
        <h1 className="h-xl">Getting your trips ready</h1>
        <div className="progress progress--thick" aria-hidden="true">
          <div className="progress-bar progress-bar--ink" style={{ width: '33%' }} />
        </div>
        <ol className="checklist">
          <li>
            <Icon name="spinner" size={22} className="spin" />
            <span>
              <strong>Today and tomorrow</strong>
              <br />
              <span className="small muted">your departures and manifests · saving…</span>
            </span>
          </li>
          <li>
            <Icon name="ring" size={22} />
            <span>
              <strong>Ticket check codes</strong>
              <br />
              <span className="small muted">so scanning works offline</span>
            </span>
          </li>
        </ol>
        <p className="small muted">
          Usually a few seconds; under 1 MB. If the signal drops, it carries on when it’s back.
        </p>
        {failed && (
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => engine.sync().then(() => setFailed(!engine.getState().savedAt))}
          >
            Try now
          </button>
        )}
      </main>
    </div>
  );
}
