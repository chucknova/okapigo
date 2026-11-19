// @ts-check
/**
 * Reading what a guest was SENT, for the journeys (stage 14c):
 *   chatOf(request, slug, phone)       their chat, as the simulator shows it
 *   emailTo(request, address, part)    an email to them in Mailpit (the local mailbox)
 * Both wait a little: the API's sender runs every 5 seconds.
 *
 * Mailpit keeps emails from earlier runs too, so an email is found by its address AND a part
 * of its subject that only this run has (the booking's reference).
 */
import { expect } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} slug @param {string} phone
 * @returns {Promise<string[]>} every message's text, oldest first
 */
export async function chatOf(request, slug, phone) {
  const found = await request.post(`/simulator/whatsapp/${slug}/conversations`, {
    data: { phone },
  });
  if (!found.ok()) return [];
  const { token } = (await found.json()).conversation;
  const res = await request.get(`/simulator/whatsapp/conversations/${token}/messages`);
  return (await res.json()).messages.map((/** @type {any} */ m) => m.body.text ?? '');
}

/**
 * Waits for the message, and returns the chat's texts.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} slug @param {string} phone @param {RegExp} pattern
 */
export async function waitForChat(request, slug, phone, pattern) {
  await expect
    .poll(async () => (await chatOf(request, slug, phone)).some((t) => pattern.test(t)), {
      timeout: 30_000,
      message: `a chat message matching ${pattern} to ${phone}`,
    })
    .toBe(true);
  return chatOf(request, slug, phone);
}

/**
 * The email to `address` whose subject contains `part` (and, when given, whose text contains
 * `inText`: for subjects without the reference), with its plain-text body.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} address @param {string} part @param {string} [inText]
 * @returns {Promise<{ subject: string, from: string, text: string, html: string }>}
 */
export async function emailTo(request, address, part, inText) {
  const up = await request.get(`${MAILPIT}/api/v1/info`).catch(() => null);
  if (!up?.ok()) throw new Error(`Mailpit isn't running at ${MAILPIT}: run pnpm services:up`);
  /** @type {any} */
  let found = null;
  await expect
    .poll(
      async () => {
        const res = await request.get(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=50`,
        );
        const { messages } = await res.json();
        for (const m of messages.filter((/** @type {any} */ x) => x.Subject.includes(part))) {
          const full = await (await request.get(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
          if (!inText || full.Text.includes(inText)) {
            found = full;
            return true;
          }
        }
        return false;
      },
      { timeout: 30_000, message: `an email to ${address} about "${part}"` },
    )
    .toBe(true);
  return {
    subject: found.Subject,
    from: `${found.From.Name} <${found.From.Address}>`,
    text: found.Text,
    html: found.HTML,
  };
}
