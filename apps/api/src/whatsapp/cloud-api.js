// @ts-check
/**
 * cloud-api.js — the real WhatsApp, through Meta's Cloud API (stage 13c-3).
 *
 *   toGraph(message)          one of our messages (messages.js) → the JSON Meta's API takes
 *   whatsappChannel(config)   the channel: sends a guest's replies, one API call each
 *   verifySignature(…)        is this webhook really from Meta? (X-Hub-Signature-256)
 *   readWebhook(body)         Meta's webhook → guests' messages and delivery receipts
 *
 * The bot itself (engine.js) doesn't change: WhatsApp is a second plug next to the simulator.
 * Docs: developers.facebook.com/docs/whatsapp/cloud-api (messages, webhooks).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { shortName, firstName } from './messages.js';

const GRAPH = 'https://graph.facebook.com';

/**
 * One of our messages as Meta's API wants it. A person from the team signs their message
 * ("*Tolu · Ìrìn team*"), since WhatsApp shows everything as from the business; an event
 * ("Tolu from Ìrìn joined") becomes a line in italics.
 * Outside WhatsApp's 24-hour window, a guest message goes as its approved TEMPLATE instead
 * (stage 14c, templates.js): its name, the language, and the blanks in order.
 * @param {any} body  a message from messages.js
 * @param {{ staffName?: string | null, operatorName: string, useTemplate?: boolean, language?: string }} who
 */
export function toGraph(
  body,
  { staffName = null, operatorName, useTemplate = false, language = 'en' },
) {
  if (useTemplate && body.template) {
    return {
      type: 'template',
      template: {
        name: body.template.name,
        language: { code: language },
        components: [
          {
            type: 'body',
            parameters: body.template.params.map((/** @type {string} */ text) => ({
              type: 'text',
              text,
            })),
          },
        ],
      },
    };
  }
  if (body.kind === 'buttons') {
    return {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body.text },
        action: {
          buttons: body.buttons.map((/** @type {any} */ b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    };
  }
  if (body.kind === 'list') {
    return {
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body.text },
        action: {
          button: body.button,
          sections: [
            {
              rows: body.rows.map((/** @type {any} */ r) => ({
                id: r.id,
                title: r.title,
                ...(r.description && { description: r.description }),
              })),
            },
          ],
        },
      },
    };
  }
  if (body.kind === 'image') {
    return {
      type: 'image',
      image: { link: body.url, ...(body.caption && { caption: body.caption }) },
    };
  }
  const text =
    body.kind === 'notice'
      ? `_${body.text}_`
      : staffName
        ? `*${firstName(staffName)} · ${shortName(operatorName)} team*\n${body.text}`
        : body.text;
  // preview_url: WhatsApp draws a preview from the page (a tour page has one; a payment or
  // trip page deliberately doesn't: its address is the key, stage 12e).
  return { type: 'text', text: { body: text.slice(0, 4096), preview_url: true } };
}

/**
 * The WhatsApp channel. `send` makes one API call per message, in order, and says for each
 * whether Meta took it (its "wamid", for the delivery receipts) or why not.
 * @param {{ accessToken: string, graphVersion: string, templateLanguage?: string, fetch?: typeof fetch, log?: { warn: Function } }} c
 */
export function whatsappChannel({
  accessToken,
  graphVersion,
  templateLanguage = 'en',
  fetch: doFetch = fetch,
  log,
}) {
  return {
    /**
     * @param {{
     *   operator: { name: string, whatsappPhoneNumberId: string | null },
     *   guestPhone: string,
     *   messages: Array<{ id: string, body: any, staffName?: string | null, useTemplate?: boolean }>,
     * }} m
     * @returns {Promise<Array<{ id: string, providerMessageId?: string, error?: string }>>}
     */
    async send({ operator, guestPhone, messages }) {
      const results = [];
      for (const msg of messages) {
        if (!operator.whatsappPhoneNumberId) {
          results.push({
            id: msg.id,
            error: 'NO_NUMBER: this business has no WhatsApp number set',
          });
          continue;
        }
        try {
          const res = await doFetch(
            `${GRAPH}/${graphVersion}/${operator.whatsappPhoneNumberId}/messages`,
            {
              method: 'POST',
              headers: {
                authorization: `Bearer ${accessToken}`,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                // Meta wants the number in international form without the "+".
                to: guestPhone.replace(/^\+/, ''),
                ...toGraph(msg.body, {
                  staffName: msg.staffName,
                  operatorName: operator.name,
                  useTemplate: msg.useTemplate,
                  language: templateLanguage,
                }),
              }),
            },
          );
          const json = /** @type {any} */ (await res.json().catch(() => ({})));
          if (res.ok && json.messages?.[0]?.id) {
            results.push({ id: msg.id, providerMessageId: json.messages[0].id });
          } else {
            const e = json.error ?? {};
            results.push({
              id: msg.id,
              error: `${e.code ?? res.status}: ${e.message ?? 'refused'}`,
            });
          }
        } catch (err) {
          // Meta unreachable: the message is marked failed for staff to see. (Never the token.)
          log?.warn({ err: /** @type {Error} */ (err).message }, 'whatsapp send failed');
          results.push({ id: msg.id, error: 'NETWORK: WhatsApp could not be reached' });
        }
      }
      return results;
    },
  };
}

/**
 * Meta signs each webhook with the app secret: "sha256=" + HMAC-SHA256 of the raw body.
 * Compared in constant time, so the signature can't be guessed byte by byte.
 * @param {string} appSecret @param {Buffer} rawBody @param {string | undefined} header
 */
export function verifySignature(appSecret, rawBody, header) {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`,
  );
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * @typedef {{
 *   phoneNumberId: string,          the business's number it was sent to
 *   from: string,                   the guest's number, "+2348031234567"
 *   name: string,                   their WhatsApp profile name
 *   id: string,                     Meta's id for it ("wamid…"): each is handled once
 *   input: { text: string } | { choice: string, title: string },
 * }} Inbound
 * @typedef {{ id: string, status: string, error: string | null }} Receipt
 */

/**
 * Meta's webhook → what guests sent, and what happened to what we sent.
 *   a typed message           { text }
 *   a tapped button / row     { choice: its id, title }
 *   anything else (a photo, a voice note, a location): "[image]" etc., which the bot answers
 *   with "Sorry, I didn't catch that" and staff can see
 * @param {any} body
 * @returns {{ messages: Inbound[], receipts: Receipt[] }}
 */
export function readWebhook(body) {
  /** @type {Inbound[]} */
  const messages = [];
  /** @type {Receipt[]} */
  const receipts = [];
  if (body?.object !== 'whatsapp_business_account') return { messages, receipts };
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const v = change.value ?? {};
      const phoneNumberId = String(v.metadata?.phone_number_id ?? '');
      const names = new Map(
        (v.contacts ?? []).map((/** @type {any} */ c) => [c.wa_id, c.profile?.name ?? '']),
      );
      for (const m of v.messages ?? []) {
        if (!m?.id || !m?.from) continue;
        /** @type {Inbound['input']} */
        let input;
        if (m.type === 'text') input = { text: String(m.text?.body ?? '') };
        else if (m.type === 'interactive' && m.interactive?.button_reply) {
          input = {
            choice: m.interactive.button_reply.id,
            title: m.interactive.button_reply.title,
          };
        } else if (m.type === 'interactive' && m.interactive?.list_reply) {
          input = { choice: m.interactive.list_reply.id, title: m.interactive.list_reply.title };
        } else if (m.type === 'button') input = { text: String(m.button?.text ?? '') };
        else input = { text: `[${m.type ?? 'message'}]` };
        if ('text' in input && !input.text.trim()) input = { text: `[${m.type ?? 'message'}]` };
        messages.push({
          phoneNumberId,
          from: `+${String(m.from).replace(/\D/g, '')}`,
          name: String(names.get(m.from) ?? '').slice(0, 80),
          id: String(m.id),
          input,
        });
      }
      for (const s of v.statuses ?? []) {
        if (!s?.id || !s?.status) continue;
        const e = s.errors?.[0];
        receipts.push({
          id: String(s.id),
          status: String(s.status),
          error: e ? `${e.code}: ${e.title ?? e.message ?? 'failed'}` : null,
        });
      }
    }
  }
  return { messages, receipts };
}
