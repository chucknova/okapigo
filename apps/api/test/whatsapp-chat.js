/**
 * The WhatsApp simulator from a test's side (session 13): a guest who types and taps, and the
 * bot's replies, each checked against WhatsApp's own limits.
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
      /** Everything in the chat, as the simulator shows it. */
      chat: async () =>
        /** @type {any[]} */ (
          (await request(ctx.app).get(`/simulator/whatsapp/conversations/${token}/messages`)).body
            .messages
        ),
    };
  }
  /** The last reply's rows or buttons. @param {any[]} replies */
  const options = (replies) => {
    const last = replies.at(-1);
    return last.kind === 'list' ? last.rows : last.kind === 'buttons' ? last.buttons : [];
  };
  /** All replies' text, joined. @param {any[]} replies */
  const words = (replies) => replies.map((r) => r.text ?? '').join('\n');
  /** The open dates (not "Sold out") of a dates list. @param {any[]} replies */
  const openDates = (replies) =>
    options(replies).filter((r) => r.id.startsWith('dep:') && r.description !== 'Sold out');

  /**
   * Books up to the summary the way a guest would, tapping.
   * @param {ReturnType<typeof guest>} g
   * @param {{
   *   tour: string,
   *   pickDate?: (rows: any[]) => any,
   *   adults?: number,
   *   childAges?: number[],
   *   extras?: Array<[string, number]>,   // [name, quantity]
   *   pickup?: string,
   *   name?: string,
   *   email?: string,
   * }} o
   */
  async function toSummary(g, o) {
    /** Taps 1 or 2, or "3 or more" and types the number. @param {number} n */
    const count = async (n) => (n <= 2 ? g.tap(`n:${n}`) : (await g.tap('more'), g.say(String(n))));
    await g.say('Hi');
    await g.tap('tours');
    const dates = await g.tap(`tour:${o.tour}`);
    const row = (o.pickDate ?? ((r) => r[0]))(openDates(dates));
    await g.tap(row.id);
    const adults = o.adults ?? 2;
    let replies = await count(adults);
    if (/Anyone under/.test(words(replies))) {
      const ages = o.childAges ?? [];
      if (ages.length === 0) replies = await g.tap('no');
      else {
        await g.tap('yes');
        await count(ages.length);
        for (const age of ages) replies = await g.say(String(age));
      }
    }
    // Extras, one at a time.
    const wanted = [...(o.extras ?? [])];
    while (
      replies.at(-1).button === 'See extras' ||
      replies.at(-1).text === 'Added. Anything else?'
    ) {
      const last = replies.at(-1);
      if (last.kind === 'buttons') {
        replies = await g.tap(wanted.length ? 'more_extras' : 'done');
        continue;
      }
      const next = wanted.shift();
      if (!next) {
        replies = await g.tap('noextras');
        continue;
      }
      const extra = last.rows.find((/** @type {any} */ r) => r.title === next[0]);
      await g.tap(extra.id);
      replies = await count(next[1]);
    }
    if (replies.at(-1).button === 'Choose pickup point') {
      const rows = replies.at(-1).rows;
      await g.tap((rows.find((/** @type {any} */ r) => r.title === o.pickup) ?? rows[0]).id);
    }
    await g.say(o.name ?? 'Adaeze Okafor');
    return o.email ? g.say(o.email) : g.tap('skip');
  }

  return { guest, options, words, openDates, toSummary };
}
