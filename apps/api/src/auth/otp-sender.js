// @ts-check
/**
 * otp-sender.js — delivers one-time codes.
 *
 * An "OTP sender" is anything with this shape:
 *   { send({ channel, destination, code, purpose }) → Promise<void> }
 *
 * For now there's only the LOG sender: it writes the code to the API's log, so in development
 * you sign in by copying the code from your terminal. Session 13 adds real senders
 * (email, and the WhatsApp simulator) with the same shape, and nothing else has to change,
 * because the auth code only ever calls `send()`.
 *
 * Tests pass in a "capturing" sender instead, to read the code without parsing logs.
 */

/**
 * @typedef {{ channel: 'email' | 'phone', destination: string, code: string, purpose: string }} OtpMessage
 * @typedef {{ send: (message: OtpMessage) => Promise<void> }} OtpSender
 */

/**
 * @param {import('pino').Logger} logger
 * @param {{ nodeEnv: string }} options
 * @returns {OtpSender}
 */
export function createLogOtpSender(logger, { nodeEnv }) {
  // Writing working sign-in codes into PRODUCTION logs would let anyone who can read the
  // logs sign in as anyone. Refuse to start rather than allow that by accident.
  if (nodeEnv === 'production') {
    throw new Error('The log OTP sender must not be used in production. Configure a real sender.');
  }

  return {
    async send({ channel, destination, code, purpose }) {
      logger.info(`🔑 ${purpose} code for ${destination} (${channel}): ${code}`);
    },
  };
}
