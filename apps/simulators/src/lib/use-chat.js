// @ts-check
/**
 * useChat — one guest's chat with the booking assistant (stage 13c-2). All the behaviour lives
 * here; the screens only draw `items` and call `send`, `retry`, `newChat`.
 *
 *   send(input)   shows the guest's message at once ("sending"), the bot "typing…", then the
 *                 chat as stored; if it can't be sent, the message stays, marked "Not sent"
 *   polling       every 2 s, so messages nobody replied to arrive by themselves: the ticket
 *                 once the payment settles, "30 minutes are up", a person from the team
 *   newChat()     an empty chat for the same guest (seats it held are given back)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chatItems, memory } from './format.js';

const POLL_MS = 2_000;

/**
 * @param {{
 *   api: typeof import('./api.js').api,
 *   operatorSlug: string,
 *   operatorName: string,
 *   guest: { name: string, phone: string },
 *   pollMs?: number,
 * }} o
 */
export function useChat({ api, operatorSlug, operatorName, guest, pollMs = POLL_MS }) {
  const tokenKey = `chat:${operatorSlug}:${guest.phone.replace(/\D/g, '')}`;
  const [token, setToken] = useState(/** @type {string | null} */ (memory.get(tokenKey)));
  const [messages, setMessages] = useState(/** @type {any[]} */ ([]));
  const [handledBy, setHandledBy] = useState('bot');
  const [outbox, setOutbox] = useState(
    /** @type {Array<{ localId: string, text: string, status: 'sending' | 'failed', at: string, input: any }>} */ ([]),
  );
  const busy = useRef(0);

  // (Another guest is another chat: App mounts a fresh one per guest, so nothing to reset.)

  /** The chat as stored. Sets state only when the answer arrives (never during a render). */
  const refresh = useCallback(
    (/** @type {string | null} */ t) => {
      if (!t) return Promise.resolve();
      return api.messages(t).then(
        (res) => {
          setMessages(res.messages);
          setHandledBy(res.conversation.handledBy);
        },
        (err) => {
          // A chat that no longer exists (a reset database): start afresh.
          if (err?.status === 404) {
            memory.set(tokenKey, null);
            setToken(null);
            setMessages([]);
          }
        },
      );
    },
    [api, tokenKey],
  );

  // Load the chat, then keep it current: messages nobody replied to arrive by themselves.
  useEffect(() => {
    if (!token) return undefined;
    refresh(token);
    const timer = setInterval(() => {
      if (busy.current === 0) refresh(token);
    }, pollMs);
    return () => clearInterval(timer);
  }, [token, refresh, pollMs]);

  const deliver = useCallback(
    async (/** @type {string} */ localId, /** @type {any} */ input) => {
      busy.current++;
      try {
        const res = await api.send(operatorSlug, {
          phone: guest.phone,
          name: guest.name,
          ...input,
        });
        const t = res.conversation.token;
        memory.set(tokenKey, t);
        setToken(t);
        await refresh(t);
        setOutbox((o) => o.filter((x) => x.localId !== localId));
      } catch {
        setOutbox((o) => o.map((x) => (x.localId === localId ? { ...x, status: 'failed' } : x)));
      } finally {
        busy.current--;
      }
    },
    [api, operatorSlug, guest, tokenKey, refresh],
  );

  /**
   * @param {{ text: string } | { choice: string, title: string }} input
   */
  const send = useCallback(
    (input) => {
      const localId = `local:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      const text = 'text' in input ? input.text : input.title;
      setOutbox((o) => [
        ...o,
        { localId, text, status: 'sending', at: new Date().toISOString(), input },
      ]);
      return deliver(localId, input);
    },
    [deliver],
  );

  const retry = useCallback(
    (/** @type {string} */ localId) => {
      const item = outbox.find((x) => x.localId === localId);
      if (!item) return undefined;
      setOutbox((o) => o.map((x) => (x.localId === localId ? { ...x, status: 'sending' } : x)));
      return deliver(localId, item.input);
    },
    [outbox, deliver],
  );

  const newChat = useCallback(async () => {
    if (token) await api.reset(token).catch(() => {});
    setMessages([]);
    setOutbox([]);
    setHandledBy('bot');
  }, [api, token]);

  const items = useMemo(
    () => chatItems(messages, outbox, operatorName),
    [messages, outbox, operatorName],
  );

  return {
    items,
    // The bot is "typing…" while a message is on its way (a person types for themselves).
    typing: handledBy !== 'staff' && outbox.some((o) => o.status === 'sending'),
    staffReplying: handledBy === 'staff',
    empty: items.length === 0,
    send,
    retry,
    newChat,
  };
}
