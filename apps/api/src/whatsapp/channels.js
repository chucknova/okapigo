// @ts-check
/**
 * channels.js — how a conversation's messages reach the guest (session 13).
 *
 * A channel is one plug: `send({ operator, guestPhone, messages })`, answering for each
 * message whether it went (and the channel's own id for it) or why not. The engine and the
 * stored conversation are the same for every channel; only delivery differs.
 *
 *   simulator   the in-app simulator: it READS the conversation from our own database, so
 *               there's nothing to send. Free, reliable in demos, testable in CI (PRD).
 *   whatsapp    the WhatsApp Cloud API (stage 13c-3, cloud-api.js): only when configured.
 *
 * deliver() is the ONE way messages leave, for the bot's replies, its own notices and staff:
 * it sends, then records on each stored message what happened (delivery, the provider's id).
 */
import { whatsappChannel } from './cloud-api.js';

/** WhatsApp allows free-form messages only within 24 hours of the guest's last message. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{
 *   send: (m: {
 *     operator: any,
 *     guestPhone: string,
 *     messages: Array<{ id: string, body: any, staffName?: string | null, useTemplate?: boolean }>,
 *   }) => Promise<Array<{ id: string, providerMessageId?: string, error?: string }>>,
 * }} Channel
 */

/** @returns {Channel} */
export function simulatorChannel() {
  return {
    // The messages are already stored; the simulator shows them from there.
    async send() {
      return [];
    },
  };
}

/**
 * Every channel the API delivers on. One set, shared by the guest's side (receive), staff
 * (routes/conversations.js) and the notices (notices.js).
 * @param {{ whatsapp?: { accessToken: string, graphVersion: string, fetch?: typeof fetch, log?: any } | null }} [o]
 * @returns {Record<string, Channel>}
 */
export function createChannels({ whatsapp = null } = {}) {
  return {
    simulator: simulatorChannel(),
    ...(whatsapp && { whatsapp: whatsappChannel(whatsapp) }),
  };
}

/**
 * Sends stored messages on the conversation's channel and records what happened.
 * Not configured (no WhatsApp token) → each is marked failed, so staff see it.
 * @param {{ prisma: import('@prisma/client').PrismaClient, channels: Record<string, Channel> }} deps
 * @param {{
 *   conversation: { id?: string, channel: string, guestPhone: string },
 *   operator: any,
 *   messages: Array<{ id: string, body: any, staffName?: string | null }>,
 *   unprompted?: boolean,  not an answer to the guest (a notice, staff): the 24-hour rule applies
 * }} m
 */
export async function deliver(deps, { conversation, operator, messages, unprompted = false }) {
  if (messages.length === 0) return;
  const channel = deps.channels[conversation.channel];
  const outside =
    unprompted &&
    conversation.id &&
    !(await withinServiceWindow(deps.prisma, {
      id: conversation.id,
      channel: conversation.channel,
    }));
  // Outside the window, a message that has an approved TEMPLATE (the guest messages, 14c)
  // goes as that template; anything else would be refused by WhatsApp (error 131047).
  const sendable = outside
    ? messages.filter((m) => m.body?.template).map((m) => ({ ...m, useTemplate: true }))
    : messages;
  const refused = outside ? messages.filter((m) => !m.body?.template) : [];
  const results = !channel
    ? messages.map((msg) => ({
        id: msg.id,
        error: `NO_CHANNEL: ${conversation.channel} is not set up`,
      }))
    : [
        ...refused.map((msg) => ({
          id: msg.id,
          error: 'OUTSIDE_24H: the guest last wrote more than 24 hours ago',
        })),
        ...(sendable.length
          ? await channel.send({
              operator,
              guestPhone: conversation.guestPhone,
              messages: sendable,
            })
          : []),
      ];
  for (const r of results ?? []) {
    await deps.prisma.chatMessage.update({
      where: { id: r.id },
      data: r.error
        ? { delivery: 'failed', deliveryError: r.error.slice(0, 300) }
        : { delivery: 'sent', providerMessageId: r.providerMessageId ?? null },
    });
  }
}

/**
 * Is the guest's last message recent enough for WhatsApp to accept a free-form one from us?
 * (The simulator has no such rule.)
 * @param {import('@prisma/client').PrismaClient | any} db  prisma or a transaction
 * @param {{ id: string, channel: string }} conversation
 * @param {Date} [now]
 */
export async function withinServiceWindow(db, conversation, now = new Date()) {
  if (conversation.channel !== 'whatsapp') return true;
  const last = await db.chatMessage.findFirst({
    where: { conversationId: conversation.id, direction: 'in' },
    orderBy: { seq: 'desc' },
    select: { createdAt: true },
  });
  return Boolean(last && now.getTime() - last.createdAt.getTime() < SERVICE_WINDOW_MS);
}
