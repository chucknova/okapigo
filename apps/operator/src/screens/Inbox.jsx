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
  deliveryWord,
  firstName,
  takeOverQuestion,
} from '../lib/inbox.js';

export function Inbox() {
  const { id } = useParams();
  const s = useSync();
  const tz = s.me?.operator?.timeZone ?? 'Africa/Lagos';
  const list = useLive('/api/inbox/chats', { every: LIST_EVERY_MS });
  return (
    <main className={`page desk inbox${id ? ' desk--open' : ''}`}>
      <section className="desk-list" aria-label="Inbox">
        <div className="desk-list-head">
          <h1 className="h-xl">Inbox</h1>
          <div role="tablist" aria-label="Inbox" className="filters">
            <span role="tab" aria-selected="true" className="filter" aria-pressed="true">
              {chatsTab(list.entry.data?.chats?.needsCount ?? 0)}
            </span>
          </div>
        </div>
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
                      The bot is handling {chats.bot.length}{' '}
                      {chats.bot.length === 1 ? 'chat' : 'chats'}.
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
      </section>
      {id ? (
        <ChatPane id={id} tz={tz} />
      ) : (
        <p className="desk-pick wide-only muted">Choose a chat to see it here.</p>
      )}
    </main>
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
