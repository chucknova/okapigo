// @ts-check
/**
 * O9 · Inbox, the chats (designs: O9 Inbox — chats; phone and states; Inbox gaps. Stage 16d-1;
 * requests come in 16d-2, alerts in 16d-3).
 *
 *   wide screen   the chats on the left (NEEDS A PERSON, then WITH THE BOT), the open chat on
 *                 the right with the booking it's about
 *   phone         the list; tap a chat for it, "‹ Inbox" to go back
 *
 * A chat: take over (the bot pauses), reply, hand back (the bot tells the guest where things
 * were). Only whoever took it over replies; a colleague takes over on purpose. Outside
 * WhatsApp's 24 hours, the approved "Can we help you finish booking?" or a call. A message
 * that failed: retry, or by email.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'wouter';
import { LiveFrame } from '../components/LiveFrame.jsx';
import { Sheet } from '../components/Sheet.jsx';
import { MoveSheet } from '../components/MoveSheet.jsx';
import { useLive } from '../lib/live.js';
import { useNow } from '../lib/now.js';
import { useEngine, useSync } from '../lib/engine.jsx';
import { act, actionError } from '../lib/office.js';
import { chipText } from '../lib/desk.js';
import {
  CHAT_EVERY_MS,
  LIST_EVERY_MS,
  boldParts,
  chatActions,
  chatsTab,
  alertsHeading,
  alertsTab,
  movedReply,
  replyLabel,
  requestsTab,
  deliveryWord,
  firstName,
  takeOverQuestion,
  assistantNote,
} from '../lib/inbox.js';

/** @param {{ tab?: 'chats' | 'requests' | 'alerts' }} props */
export function Inbox({ tab = 'chats' }) {
  const { id, rid } = useParams();
  const s = useSync();
  const tz = s.me?.operator?.timeZone ?? 'Africa/Lagos';
  const list = useLive('/api/inbox/chats', { every: LIST_EVERY_MS });
  const asked = useLive('/api/inbox/requests?tab=open', { every: LIST_EVERY_MS });
  const alerted = useLive('/api/inbox/alerts', { every: LIST_EVERY_MS });
  const open = tab === 'chats' ? id : rid;
  return (
    <main className={`page desk inbox${open ? ' desk--open' : ''}`}>
      <section className="desk-list" aria-label="Inbox">
        <div className="desk-list-head">
          <h1 className="h-xl">Inbox</h1>
          <nav aria-label="Inbox" className="filters">
            <Link
              href="/inbox"
              className="filter"
              aria-current={tab === 'chats' ? 'page' : undefined}
            >
              {chatsTab(list.entry.data?.chats?.needsCount ?? 0)}
            </Link>
            <Link
              href="/inbox/requests"
              className="filter"
              aria-current={tab === 'requests' ? 'page' : undefined}
            >
              {requestsTab(asked.entry.data?.requests?.openCount ?? 0)}
            </Link>
            <Link
              href="/inbox/alerts"
              className="filter"
              aria-current={tab === 'alerts' ? 'page' : undefined}
            >
              {alertsTab(alerted.entry.data?.alerts?.length ?? 0)}
            </Link>
          </nav>
        </div>
        {tab === 'chats' && <ChatList list={list} id={id} tz={tz} />}
        {tab === 'requests' && <RequestList rid={rid} tz={tz} />}
        {tab === 'alerts' && <AlertList live={alerted} tz={tz} />}
      </section>
      {tab === 'chats' &&
        (id ? (
          <ChatPane id={id} tz={tz} />
        ) : (
          <p className="desk-pick wide-only muted">Choose a chat to see it here.</p>
        ))}
      {tab === 'alerts' && <DonePane live={alerted} tz={tz} />}
      {tab === 'requests' &&
        (rid ? (
          <RequestPane rid={rid} tz={tz} />
        ) : (
          <p className="desk-pick wide-only muted">Choose a request to see it here.</p>
        ))}
    </main>
  );
}

/** The chats: needs a person, then with the bot. @param {{ list: any, id: string | undefined, tz: string }} props */
function ChatList({ list, id, tz }) {
  return (
    <LiveFrame live={list} what="The chats" tz={tz}>
      {({ chats }) =>
        chats.needs.length === 0 && chats.bot.length === 0 ? (
          <p className="desk-none muted">No chats this week.</p>
        ) : (
          <>
            <h2 className="eyebrow inbox-h">Needs a person</h2>
            {chats.needs.length === 0 ? (
              <div className="desk-none">
                <p className="strong">Nothing needs you right now</p>
                <p className="small muted">
                  The bot is handling {chats.bot.length} {chats.bot.length === 1 ? 'chat' : 'chats'}
                  .
                </p>
              </div>
            ) : (
              <ul className="desk-rows">
                {chats.needs.map((/** @type {any} */ c) => (
                  <li key={c.id}>
                    <ChatRow c={c} open={c.id === id} />
                  </li>
                ))}
              </ul>
            )}
            {chats.bot.length > 0 && (
              <>
                <h2 className="eyebrow inbox-h">With the bot</h2>
                <ul className="desk-rows">
                  {chats.bot.map((/** @type {any} */ c) => (
                    <li key={c.id}>
                      <ChatRow c={c} open={c.id === id} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )
      }
    </LiveFrame>
  );
}

/** @param {{ c: any, open: boolean }} props */
function ChatRow({ c, open }) {
  return (
    <Link
      href={`/inbox/${c.id}`}
      className={`desk-row${open ? ' is-open' : ''}`}
      aria-current={open ? 'page' : undefined}
    >
      <span className="row-between">
        <strong>{c.name}</strong>
        <span className={`small ${c.waiting ? 'tone--urgent strong' : 'muted'}`}>{c.wait}</span>
      </span>
      <span className="small muted one-line">{c.last}</span>
      {c.state && (
        <span className={`small strong ${c.waiting ? 'tone--urgent' : ''}`}>{c.state}</span>
      )}
    </Link>
  );
}

/** @param {{ id: string, tz: string }} props */
function ChatPane({ id, tz }) {
  const live = useLive(`/api/inbox/chats/${id}`, { every: CHAT_EVERY_MS });
  return (
    <section className="desk-page" aria-label="Chat">
      <Link href="/inbox" className="back-link narrow-only">
        ‹ Inbox
      </Link>
      <LiveFrame live={live} what="This chat" tz={tz}>
        {({ chat }) => <ChatView key={chat.id} chat={chat} />}
      </LiveFrame>
    </section>
  );
}

/** @param {{ chat: any }} props */
function ChatView({ chat }) {
  const engine = useEngine();
  const s = useSync();
  const me = firstName(s.me?.user?.name ?? 'you');
  const can = chatActions(chat);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [done, setDone] = useState(/** @type {string | null} */ (null));
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState(false);
  const base = `/api/conversations/${chat.id}`;
  const now = useNow(1000, chat.booking?.chip.key === 'held');
  // Open at the newest message, and follow new ones as they arrive.
  const log = useRef(/** @type {HTMLOListElement | null} */ (null));
  const count = chat.messages.length;
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  /** @param {string} path @param {any} [body] @param {string | null} [said] */
  const send = async (path, body = {}, said = null) => {
    setBusy(true);
    setError(null);
    setDone(null);
    const r = await act(engine, path, { method: 'POST', body });
    setBusy(false);
    if (!r.ok) {
      setError(actionError(r.error));
      return false;
    }
    if (said) setDone(said);
    return true;
  };

  return (
    <article className="chat">
      <header className="chat-head">
        <div>
          <h2 className="h-lg">{chat.name}</h2>
          <div className="small muted">{chat.sub}</div>
          <div className="small strong">{chat.stateLine}</div>
        </div>
        <div className="chat-head-btns">
          {can.takeOver && (
            <button
              type="button"
              className="btn btn--dark btn--compact"
              disabled={busy}
              onClick={() => send(`${base}/take-over`)}
            >
              Take over
            </button>
          )}
          {can.handBack && (
            <button
              type="button"
              className="btn btn--outline btn--compact"
              disabled={busy}
              onClick={() =>
                send(
                  `${base}/hand-back`,
                  {},
                  'Handed back. The bot tells the guest where things were.',
                )
              }
            >
              Hand back to the bot
            </button>
          )}
          {can.takeOverFrom && (
            <button
              type="button"
              className="btn btn--outline btn--compact"
              onClick={() => setAsking(true)}
            >
              Take over from {can.takeOverFrom}
            </button>
          )}
        </div>
      </header>
      {chat.theirsNote && <p className="small muted">{chat.theirsNote}</p>}
      {done && (
        <p role="status" className="done-note">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}

      <div className="chat-body">
        <ol className="chat-log" aria-label="Messages" ref={log}>
          {chat.messages.map((/** @type {any} */ m) =>
            m.side === 'notice' ? (
              <li key={m.id} className="chat-notice">
                {m.text} · {m.time}
              </li>
            ) : (
              <li
                key={m.id}
                className={`bubble bubble--${m.side}${m.failed ? ' bubble--failed' : ''}`}
              >
                {m.side === 'out' && <span className="bubble-who">{m.who}</span>}
                <span className="bubble-text">
                  {boldParts(m.text).map((p, i) =>
                    p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>,
                  )}
                </span>
                {m.buttons.length > 0 && (
                  <span className="bubble-btns">
                    {m.buttons.map((/** @type {string} */ b, /** @type {number} */ i) => (
                      <span key={i} className="bubble-btn">
                        {b}
                      </span>
                    ))}
                  </span>
                )}
                <span className="bubble-time">
                  {m.time}
                  {deliveryWord(m.delivery) ? ` · ${deliveryWord(m.delivery)}` : ''}
                </span>
                {m.failed && (
                  <span className="bubble-failed">
                    <span className="tone--urgent strong small">Not delivered: {m.failedWhy}</span>
                    <span className="row-gap">
                      <button
                        type="button"
                        className="btn btn--outline btn--compact"
                        disabled={busy}
                        onClick={() => send(`${base}/messages/${m.id}/retry`, {}, 'Sent again.')}
                      >
                        Retry
                      </button>
                      {chat.booking?.hasEmail && (
                        <button
                          type="button"
                          className="btn btn--outline btn--compact"
                          disabled={busy}
                          onClick={() =>
                            send(
                              `${base}/messages/${m.id}/email`,
                              {},
                              'It’ll go by email in a moment.',
                            )
                          }
                        >
                          Send by email
                        </button>
                      )}
                    </span>
                  </span>
                )}
              </li>
            ),
          )}
        </ol>

        {chat.booking && (
          <aside className="panel panel--pad chat-booking" aria-label="Booking from this chat">
            <h3 className="h-md">Booking from this chat</h3>
            <div className="row-between">
              <strong>{chat.booking.reference}</strong>
              <span className={`status-chip status-chip--${chat.booking.chip.tone}`}>
                {chipText(chat.booking.chip, now)}
              </span>
            </div>
            <div>{chat.booking.tour}</div>
            <div className="small muted">
              {chat.booking.when} · {chat.booking.people} · {chat.booking.total}
            </div>
            <div className="row-gap">
              <button
                type="button"
                className="btn btn--outline btn--compact"
                onClick={() => setNote(true)}
              >
                Add a note to the booking
              </button>
              <Link href={`/bookings/${chat.booking.id}`} className="btn btn--outline btn--compact">
                Open booking
              </Link>
            </div>
          </aside>
        )}
      </div>

      {can.reply && (
        <form
          className="composer"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await send(`${base}/messages`, { text: text.trim() })) setText('');
          }}
        >
          <label className="field grow">
            Reply as {me}
            <textarea
              className="textarea"
              rows={2}
              maxLength={4096}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn btn--dark btn--compact"
            disabled={busy || !text.trim()}
          >
            Send
          </button>
        </form>
      )}
      {can.handBack && chat.window.open && (
        <p className="small muted">
          When you hand back, the bot tells {firstName(chat.name)} where things were.
        </p>
      )}
      {!chat.window.open && (
        <section className="desk-banner desk-banner--warning" aria-label="WhatsApp’s 24-hour rule">
          <p>{chat.window.text}</p>
          <div className="desk-banner-btns">
            {can.followUp && (
              <button
                type="button"
                className="btn btn--dark btn--compact"
                disabled={busy}
                onClick={() =>
                  send(
                    `${base}/follow-up`,
                    {},
                    'Sent. When they reply, you can write freely again.',
                  )
                }
              >
                Send “Can we help you finish booking?”
              </button>
            )}
            <a
              className="btn btn--outline btn--compact"
              href={`tel:${chat.phone.replace(/\s/g, '')}`}
            >
              Call {chat.phone} instead
            </a>
          </div>
          <p className="small muted">The reply box comes back when they write again.</p>
        </section>
      )}

      {asking && (
        <Sheet title="Take over?" alert center onClose={() => setAsking(false)}>
          <div className="dialog">
            <h2 className="h-lg">{takeOverQuestion(chat.holder ?? 'them')}</h2>
            <button
              type="button"
              className="btn btn--dark"
              disabled={busy}
              onClick={async () => {
                if (await send(`${base}/take-over`, { fromColleague: true })) setAsking(false);
              }}
            >
              Take over
            </button>
            <button type="button" className="btn btn--outline" onClick={() => setAsking(false)}>
              Leave it with {firstName(chat.holder ?? 'them')}
            </button>
          </div>
        </Sheet>
      )}
      {note && chat.booking && (
        <NoteOnBooking
          booking={chat.booking}
          onClose={() => setNote(false)}
          onSave={async (t) => {
            const ok = await send(
              `/api/bookings/${chat.booking.id}/notes`,
              { text: t },
              'Note added to the booking.',
            );
            if (ok) setNote(false);
          }}
        />
      )}
    </article>
  );
}

/** A note on the chat's booking (designs: "Add a note to the booking"). @param {{ booking: any, onClose: () => void, onSave: (text: string) => Promise<void> }} props */
function NoteOnBooking({ booking, onClose, onSave }) {
  const [text, setText] = useState('');
  return (
    <Sheet title="Add a note" onClose={onClose}>
      <form
        className="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          await onSave(text);
        }}
      >
        <h2 className="h-lg">Note on {booking.reference}</h2>
        <label className="field">
          Note
          <textarea
            className="textarea"
            rows={3}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn--dark" disabled={!text.trim()}>
          Save note
        </button>
      </form>
    </Sheet>
  );
}

// --- Requests (16d-2) ------------------------------------------------------------------------

/** Open requests (oldest first) or Done. @param {{ rid: string | undefined, tz: string }} props */
function RequestList({ rid, tz }) {
  const [view, setView] = useState(/** @type {'open' | 'done'} */ ('open'));
  const live = useLive(`/api/inbox/requests?tab=${view}`, { every: LIST_EVERY_MS });
  return (
    <>
      <div role="group" aria-label="Requests" className="filters inbox-h">
        {[
          { key: 'open', label: 'Open' },
          { key: 'done', label: 'Done' },
        ].map((f) => (
          <button
            key={f.key}
            type="button"
            className="filter"
            aria-pressed={view === f.key}
            onClick={() => setView(/** @type {any} */ (f.key))}
          >
            {f.label}
          </button>
        ))}
      </div>
      <LiveFrame live={live} what="The requests" tz={tz}>
        {({ requests }) =>
          requests.rows.length === 0 ? (
            <p className="desk-none muted">
              {view === 'open'
                ? 'No open requests. Guests ask from their trip page.'
                : 'Nothing answered yet.'}
            </p>
          ) : (
            <ul className="desk-rows">
              {requests.rows.map((/** @type {any} */ r) => (
                <li key={r.id}>
                  <Link
                    href={`/inbox/requests/${r.id}`}
                    className={`desk-row${r.id === rid ? ' is-open' : ''}`}
                    aria-current={r.id === rid ? 'page' : undefined}
                  >
                    <span className="row-between">
                      <strong>{r.lead}</strong>
                      <span
                        className={`small ${view === 'open' ? 'tone--urgent strong' : 'muted'}`}
                      >
                        {view === 'open' ? r.waiting : 'ANSWERED'}
                      </span>
                    </span>
                    <span className="small strong">{r.kindLabel}</span>
                    <span className="small muted one-line">
                      {view === 'open' ? r.message : r.done}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </LiveFrame>
    </>
  );
}

/** One request, found in the open or the done list. @param {{ rid: string, tz: string }} props */
function RequestPane({ rid, tz }) {
  const open = useLive('/api/inbox/requests?tab=open', { every: LIST_EVERY_MS });
  const done = useLive('/api/inbox/requests?tab=done', { every: LIST_EVERY_MS });
  const r =
    open.entry.data?.requests.rows.find((/** @type {any} */ x) => x.id === rid) ??
    done.entry.data?.requests.rows.find((/** @type {any} */ x) => x.id === rid) ??
    null;
  return (
    <section className="desk-page" aria-label="Request">
      <Link href="/inbox/requests" className="back-link narrow-only">
        ‹ Requests
      </Link>
      <LiveFrame live={open} what="This request" tz={tz}>
        {() =>
          r ? (
            <RequestCard key={r.id} r={r} />
          ) : (
            <p className="muted">
              {done.entry.data ? 'This request isn’t here any more.' : 'Loading…'}
            </p>
          )
        }
      </LiveFrame>
    </section>
  );
}

/** @param {{ r: any }} props */
function RequestCard({ r }) {
  const engine = useEngine();
  const isOpen = !r.done;
  const [text, setText] = useState('');
  const [markAnswered, setMarkAnswered] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [done, setDone] = useState(/** @type {string | null} */ (null));
  const [sheet, setSheet] = useState(/** @type {'move' | 'note' | null} */ (null));
  const first = firstName(r.lead);
  // Asked the assistant (18a-2): a question to answer, not a booking to change.
  const note = assistantNote(r);

  /** @param {string} path @param {any} body @param {string} said */
  const send = async (path, body, said) => {
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await act(engine, path, { method: 'POST', body });
    setBusy(false);
    if (!res.ok) {
      setError(actionError(res.error));
      return false;
    }
    setDone(said);
    return true;
  };

  return (
    <article className="stack-md">
      <header>
        <div className="eyebrow">{r.kindLabel}</div>
        <div className="row-between row-start">
          <h2 className="h-xl">{r.lead}</h2>
          {isOpen && <span className="small tone--urgent strong">{r.waiting}</span>}
        </div>
        {isOpen && <div className="small muted">{r.sent}</div>}
        {!isOpen && <div className="small muted">{r.done}</div>}
      </header>
      <blockquote className="request-quote">“{r.message}”</blockquote>
      {note && (
        <div className="info-box">
          <strong>{note.title}</strong>
          <span>{note.body}</span>
        </div>
      )}
      {done && (
        <p role="status" className="done-note">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}

      <section className="panel panel--pad stack-xs" aria-label="The booking">
        <div className="row-between">
          <strong>
            {r.booking.reference} · {r.booking.tour}
          </strong>
          <span className={`status-chip status-chip--${r.booking.chip.tone}`}>
            {r.booking.chip.text}
          </span>
        </div>
        <div className="small muted">
          {r.booking.when} · {r.booking.people} · {r.booking.paid}
        </div>
        <div className="row-gap">
          {isOpen && !note && r.booking.canMove && (
            <button
              type="button"
              className="btn btn--dark btn--compact"
              onClick={() => setSheet('move')}
            >
              Move to another date…
            </button>
          )}
          {isOpen && !note && (
            <Link href={`/bookings/${r.booking.id}`} className="btn btn--outline btn--compact">
              Cancel with a refund…
            </Link>
          )}
          <Link href={`/bookings/${r.booking.id}`} className="btn btn--outline btn--compact">
            Open booking
          </Link>
        </div>
      </section>

      {isOpen && r.replied && (
        <p className="small muted">
          You replied {r.replied.at}: “{r.replied.text}”
        </p>
      )}
      {isOpen && (
        <form
          className="stack-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await send(
              `/api/guest-requests/${r.id}/reply`,
              { text: text.trim(), markAnswered },
              markAnswered ? 'Sent, and marked answered.' : 'Sent.',
            );
            if (ok) setText('');
          }}
        >
          <label className="field">
            Reply to {first} ({r.reach})
            <textarea
              className="textarea"
              rows={3}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <span className="small muted plain">Their trip page shows your reply too.</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={markAnswered}
              onChange={(e) => setMarkAnswered(e.target.checked)}
            />
            Mark answered when sent
          </label>
          <div className="row-gap">
            <button
              type="submit"
              className="btn btn--dark btn--compact"
              disabled={busy || !text.trim() || !r.reach}
            >
              {replyLabel(markAnswered)}
            </button>
            <button type="button" className="text-link" onClick={() => setSheet('note')}>
              Mark answered without replying
            </button>
          </div>
        </form>
      )}

      {note && (
        <div className="row-between faq-nudge">
          <span className="small muted">{note.faqs}</span>
          <Link href={`/settings/tours/${r.booking.productId}`} className="text-link">
            Add to the FAQs
          </Link>
        </div>
      )}

      {sheet === 'move' && (
        <MoveSheet
          bookingId={r.booking.id}
          reference={r.booking.reference}
          error={error}
          onClose={() => setSheet(null)}
          onMove={async (departureId, when) => {
            const ok = await send(
              `/api/bookings/${r.booking.id}/move`,
              { departureId, requestId: r.id },
              `Moved to ${when}. ${first} is told by WhatsApp and email.`,
            );
            if (ok) {
              setSheet(null);
              setText(movedReply(when));
            }
            return ok;
          }}
        />
      )}
      {sheet === 'note' && (
        <AnsweredNote
          lead={first}
          onClose={() => setSheet(null)}
          onSave={async (note) => {
            if (await send(`/api/guest-requests/${r.id}/answer`, { note }, 'Marked answered.'))
              setSheet(null);
          }}
        />
      )}
    </article>
  );
}

/** "Mark answered without replying" asks for a short note (designs: Inbox gaps). @param {{ lead: string, onClose: () => void, onSave: (note: string) => Promise<void> }} props */
function AnsweredNote({ lead, onClose, onSave }) {
  const [note, setNote] = useState('');
  return (
    <Sheet title="Mark answered" onClose={onClose}>
      <form
        className="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          await onSave(note.trim());
        }}
      >
        <h2 className="h-lg">Answered another way?</h2>
        <label className="field">
          What happened
          <input
            className="input"
            type="text"
            maxLength={300}
            placeholder={`e.g. Called ${lead}, told them about the side street.`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn--dark" disabled={note.trim().length < 3}>
          Mark answered
        </button>
      </form>
    </Sheet>
  );
}

// --- Alerts (16d-3) --------------------------------------------------------------------------

/** What needs dealing with: each with its action; it clears by itself once fixed. @param {{ live: any, tz: string }} props */
function AlertList({ live, tz }) {
  return (
    <LiveFrame live={live} what="The alerts" tz={tz}>
      {({ alerts }) =>
        alerts.length === 0 ? (
          <div className="desk-none">
            <p className="strong">Nothing to deal with</p>
            <p className="small muted">Alerts appear here when money or a departure needs you.</p>
          </div>
        ) : (
          <>
            <h2 className="eyebrow inbox-h">{alertsHeading(alerts.length)}</h2>
            <ul className="desk-rows">
              {alerts.map((/** @type {any} */ a) => (
                <li key={a.key} className={`alert-row alert-row--${a.tone}`}>
                  <span className="alert-icon" aria-hidden="true">
                    {a.icon}
                  </span>
                  <span className="grow">
                    <strong className="block">{a.title}</strong>
                    <span className="small muted">{a.detail}</span>
                  </span>
                  <Link href={a.href} className="btn btn--outline btn--compact">
                    {a.action}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="small muted">
              An alert clears by itself when its cause is fixed (balance paid, cash confirmed, guide
              assigned).
            </p>
          </>
        )
      }
    </LiveFrame>
  );
}

/** "Done this week": who dealt with what, and when. @param {{ live: any, tz: string }} props */
function DonePane({ live, tz }) {
  return (
    <section className="desk-page" aria-label="Done this week">
      <LiveFrame live={live} what="Done this week" tz={tz}>
        {({ done }) => (
          <>
            <h2 className="h-md">Done this week ({done.length})</h2>
            {done.length === 0 ? (
              <p className="sm muted">Nothing yet this week.</p>
            ) : (
              <ul className="plain-list done-list">
                {done.map((/** @type {any} */ d, /** @type {number} */ i) => (
                  <li key={i}>
                    <Link href={d.href} className="done-item">
                      <span className="block">{d.text}</span>
                      <span className="small muted">{d.detail}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </LiveFrame>
    </section>
  );
}
