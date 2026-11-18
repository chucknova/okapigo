// @ts-check
/**
 * channels.js — how a conversation's messages reach the guest (session 13).
 *
 * A channel is one plug: `send({ operator, guestPhone, replies })`. The engine and the stored
 * conversation are the same for every channel; only delivery differs.
 *
 *   simulator   the in-app WhatsApp simulator (13c): it READS the conversation from our own
 *               database, so there's nothing to send. Free, reliable in demos, testable in CI
 *               (PRD: "the simulator is free, reliable in demos and testable in CI").
 *   whatsapp    the WhatsApp Cloud API test number: sends through Meta's API (13c).
 */

/** @returns {{ send: (m: { operator: any, guestPhone: string, replies: any[] }) => Promise<void> }} */
export function simulatorChannel() {
  return {
    // The messages are already stored; the simulator shows them from there.
    async send() {},
  };
}
