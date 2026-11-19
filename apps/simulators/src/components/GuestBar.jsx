// @ts-check
/**
 * The simulator's own controls, above the phone (not in the designs: the brief's "choose which
 * guest you are" and "start a new chat"; decided 2026-11-19, simple ones for you to restyle).
 */
import { useState } from 'react';
import { GUESTS } from '../lib/format.js';

/**
 * @param {{
 *   guest: { name: string, phone: string },
 *   onGuest: (g: { name: string, phone: string }) => void,
 *   onNewChat: () => void,
 * }} p
 */
export function GuestBar({ guest, onGuest, onNewChat }) {
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const known = GUESTS.find((g) => g.phone === guest.phone);

  return (
    <div className="okg-guestbar">
      <label className="okg-guestbar-field">
        <span>Chatting as</span>
        <select
          value={custom ? 'custom' : guest.phone}
          onChange={(e) => {
            if (e.target.value === 'custom') return setCustom(true);
            setCustom(false);
            const g = GUESTS.find((x) => x.phone === e.target.value);
            if (g) onGuest(g);
          }}
        >
          {GUESTS.map((g) => (
            <option key={g.phone} value={g.phone}>
              {g.name} · {g.phone}
            </option>
          ))}
          {!known && (
            <option value={guest.phone}>
              {guest.name} · {guest.phone}
            </option>
          )}
          <option value="custom">Someone else…</option>
        </select>
      </label>
      <button type="button" className="okg-guestbar-new" onClick={onNewChat}>
        New chat
      </button>
      {custom && (
        <form
          className="okg-guestbar-custom"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length < 2 || phone.replace(/\D/g, '').length < 10) return;
            setCustom(false);
            onGuest({ name: name.trim(), phone: phone.trim() });
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            aria-label="Guest's name"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0803 000 0000"
            aria-label="Guest's phone number"
            inputMode="tel"
          />
          <button type="submit">Use</button>
        </form>
      )}
    </div>
  );
}
