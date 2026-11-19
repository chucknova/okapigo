// @ts-check
/**
 * The WhatsApp simulator (BKG-09, stage 13c-2): a free, reliable stand-in for WhatsApp, for
 * demos, the walkthrough video and the tests. /simulator/whatsapp/?operator=irin-lagos-tours
 * chats with that business's booking assistant: the SAME engine the real WhatsApp uses.
 */
import { useEffect, useState } from 'react';
import { api as realApi } from './lib/api.js';
import { GUESTS, memory } from './lib/format.js';
import { useChat } from './lib/use-chat.js';
import { GuestBar } from './components/GuestBar.jsx';
import { Phone } from './components/Phone.jsx';

/** @param {{ api?: typeof realApi, operatorSlug?: string, pollMs?: number }} p */
export function App({ api = realApi, operatorSlug, pollMs }) {
  const slug =
    operatorSlug ??
    new URLSearchParams(globalThis.location?.search ?? '').get('operator') ??
    'irin-lagos-tours';
  const [operatorName, setOperatorName] = useState('');
  const [missing, setMissing] = useState(false);
  const [guest, setGuest] = useState(memory.get('guest') ?? GUESTS[0]);

  useEffect(() => {
    api.operator(slug).then(
      (o) => setOperatorName(o.name),
      () => setMissing(true),
    );
  }, [api, slug]);

  if (missing) {
    return (
      <main className="okg-sim">
        <p className="okg-sim-missing">No business called “{slug}”. Check the address.</p>
      </main>
    );
  }
  return (
    <main className="okg-sim">
      {/* One chat per guest: choosing another guest mounts their own (key). */}
      <Chat
        key={`${slug}:${guest.phone}`}
        api={api}
        slug={slug}
        operatorName={operatorName}
        guest={guest}
        pollMs={pollMs}
        onGuest={(g) => {
          memory.set('guest', g);
          setGuest(g);
        }}
      />
    </main>
  );
}

/**
 * @param {{
 *   api: typeof realApi, slug: string, operatorName: string,
 *   guest: { name: string, phone: string }, pollMs?: number,
 *   onGuest: (g: { name: string, phone: string }) => void,
 * }} p
 */
function Chat({ api, slug, operatorName, guest, pollMs, onGuest }) {
  const chat = useChat({ api, operatorSlug: slug, operatorName, guest, pollMs });
  return (
    <>
      <GuestBar guest={guest} onGuest={onGuest} onNewChat={chat.newChat} />
      {operatorName && <Phone operatorName={operatorName} chat={chat} />}
    </>
  );
}
