// @ts-check
/**
 * The office screens' states (designs: "Staff screens — states"), around a screen's content:
 *
 *   loading   skeletons; after 10 s "Still loading… slow connection" · Try again
 *   offline   "You’re offline": bookings need a connection; the guides' phones keep working
 *   stale     offline, but shown as it was: greyed, buttons off, "Offline · shown as of 11:02"
 *   error     "This booking didn’t load" · Try again · "quote 5F2A-07:41"
 *   denied    "This page is for managers"
 */
import { Link } from 'wouter';
import { Icon } from './Icon.jsx';
import { useNow, useSync } from '../lib/engine.jsx';
import { liveState, supportCode } from '../lib/live.js';
import { ownerName, whoLine } from '../lib/roles.js';
import { localTime } from '@okapigo/shared/time';

/**
 * @param {{
 *   live: ReturnType<typeof import('../lib/live.js').useLive>,
 *   what: string,                 // "This booking" → "This booking didn’t load"
 *   forWhom?: string,             // "managers" (denied)
 *   tz: string,
 *   children: (data: any) => import('react').ReactNode,
 * }} props
 */
export function LiveFrame({ live, what, forWhom = 'managers', tz, children }) {
  const now = useNow(1000);
  const state = liveState(live.entry, { online: live.online, now: now.getTime() });
  if (state === 'denied') return <NotAllowed forWhom={forWhom} />;
  if (state === 'offline') {
    return (
      <Panel icon="wifi-off" title="You’re offline">
        <p className="muted">
          Bookings need a connection, so you never act on old information. Your guides’ phones keep
          working.
        </p>
        <button type="button" className="btn btn--dark btn--narrow" onClick={() => live.reload()}>
          Try again
        </button>
      </Panel>
    );
  }
  if (state === 'error') {
    return (
      <Panel icon="alert" tone="danger" title={`${what} didn’t load`}>
        <p className="muted">Something went wrong on our side. Nothing was changed.</p>
        <button type="button" className="btn btn--dark btn--narrow" onClick={() => live.reload()}>
          Try again
        </button>
        <p className="small muted">
          Keeps happening? Tell support and quote{' '}
          <code>{supportCode(live.entry.error, now, tz)}</code>.
        </p>
      </Panel>
    );
  }
  if (state === 'loading' || state === 'slow') {
    return (
      <div className="page" aria-busy="true">
        <div className="sk sk--title" />
        <div className="sk sk--card" />
        <div className="sk sk--card sk--tall" />
        {state === 'slow' && (
          <div className="slow">
            <span>Still loading… slow connection</span>
            <button
              type="button"
              className="btn btn--outline btn--narrow"
              onClick={() => live.reload()}
            >
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }
  const at = live.entry.at ? localTime(new Date(live.entry.at), tz) : null;
  return (
    <>
      {state === 'stale' && (
        <div className="stale-note" role="status">
          Offline · shown as of {at}
        </div>
      )}
      <div
        className={state === 'stale' ? 'stale' : undefined}
        inert={state === 'stale' ? true : undefined}
      >
        {children(live.entry.data)}
      </div>
    </>
  );
}

/** @param {{ icon: any, title: string, tone?: 'danger', children: import('react').ReactNode }} props */
function Panel({ icon, title, tone, children }) {
  return (
    <main className="page panel-state">
      <span
        className={`badge-circle${tone === 'danger' ? ' badge-circle--danger' : ' badge-circle--muted'}`}
      >
        <Icon name={icon} size={26} />
      </span>
      <h1 className="h-lg">{title}</h1>
      {children}
    </main>
  );
}

/** "This page is for managers" (a guide opens a manager link). @param {{ forWhom: string }} props */
export function NotAllowed({ forWhom }) {
  const s = useSync();
  return (
    <Panel icon="lock" title={`This page is for ${forWhom}`}>
      <p className="muted">
        You’re signed in as {whoLine(s.me, s.session)}. Ask {ownerName(s.me)} if you need access.
      </p>
      <Link href="/" className="btn btn--main btn--narrow">
        Go to Today
      </Link>
    </Panel>
  );
}
