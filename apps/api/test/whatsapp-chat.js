/**
 * The WhatsApp simulator from a test's side (sessions 13a, 13b): a guest who types and taps,
 * and the bot's replies, each checked against WhatsApp's own limits.
 */
import { expect } from 'vitest';
import request from 'supertest';
import { fitsWhatsApp } from '../src/whatsapp/messages.js';

/** @param {{ app: any }} ctx */
export function chatHelpers(ctx) {
  /**
   * A guest on the simulator. `say('hi')` types; `tap('tours')` taps a button or list row.
   * Each returns the bot's replies, after checking they all fit WhatsApp.
   * @param {string} operatorSlug
   * @param {string} [phone]
   */
  function guest(operatorSlug, phone = '0803 123 4567') {
    let token = '';
    const send = async (/** @type {object} */ body) => {
      const res = await request(ctx.app)
        .post(`/simulator/whatsapp/${operatorSlug}/messages`)
        .send({ phone, name: 'Adaeze', ...body });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      token = res.body.conversation.token;
      for (const r of res.body.replies) expect(fitsWhatsApp(r), JSON.stringify(r)).toBe(true);
      return /** @type {any[]} */ (res.body.replies);
    };
    return {
      say: (/** @type {string} */ text) => send({ text }),
      tap: (/** @type {string} */ choice) => send({ choice }),
      token: () => token,
    };
  }
  /** The last reply's rows or buttons. @param {any[]} replies */
  const options = (replies) => {
    const last = replies.at(-1);
    return last.kind === 'list' ? last.rows : last.kind === 'buttons' ? last.buttons : [];
  };
  /** All replies' text, joined. @param {any[]} replies */
  const words = (replies) => replies.map((r) => r.text ?? '').join('\n');

  return { guest, options, words };
}
