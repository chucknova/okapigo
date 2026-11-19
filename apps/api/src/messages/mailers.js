// @ts-check
/**
 * mailers.js — how an email leaves (stage 14b). One plug, two kinds:
 *
 *   mailpit   development: every email lands in a LOCAL mailbox (Mailpit, in Docker), at
 *             http://localhost:8025. Nothing leaves your laptop, so the fictional guests'
 *             addresses never receive anything, and you can read every email we'd send.
 *   resend    real sending, through Resend's API (its free tier; decided 2026-11-19).
 *
 * send({ from, to, replyTo, subject, html, text }) → { id }   or throws MailError
 */

export class MailError extends Error {}

/**
 * @typedef {{ name: string, email: string }} Address
 * @typedef {{ from: Address, to: Address, replyTo?: string | null, subject: string, html: string, text: string }} Email
 * @typedef {{ name: string, send: (e: Email) => Promise<{ id: string }> }} Mailer
 */

/** "Ìrìn Lagos Tours" <bookings@…>, with quotes so a comma in a name can't split it. @param {Address} a */
const named = (a) => `"${a.name.replace(/["\\\r\n]/g, '')}" <${a.email}>`;

/**
 * @param {{ url: string, fetch?: typeof fetch }} c  url: Mailpit's web address
 * @returns {Mailer}
 */
export function mailpitMailer({ url, fetch: doFetch = fetch }) {
  return {
    name: 'mailpit',
    async send(e) {
      // Mailpit's own "send" API: the message goes straight into its mailbox.
      const res = await doFetch(`${url.replace(/\/+$/, '')}/api/v1/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          From: { Email: e.from.email, Name: e.from.name },
          To: [{ Email: e.to.email, Name: e.to.name }],
          ...(e.replyTo && { ReplyTo: [{ Email: e.replyTo }] }),
          Subject: e.subject,
          HTML: e.html,
          Text: e.text,
        }),
      }).catch(() => {
        throw new MailError('MAILPIT_DOWN: the local mailbox isn’t running (docker compose up -d)');
      });
      const json = /** @type {any} */ (await res.json().catch(() => ({})));
      if (!res.ok || !json.ID)
        throw new MailError(`MAILPIT_${res.status}: ${json.Error ?? 'refused'}`);
      return { id: String(json.ID) };
    },
  };
}

/**
 * @param {{ apiKey: string, fetch?: typeof fetch }} c
 * @returns {Mailer}
 */
export function resendMailer({ apiKey, fetch: doFetch = fetch }) {
  return {
    name: 'resend',
    async send(e) {
      const res = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: named(e.from),
          to: [e.to.email],
          ...(e.replyTo && { reply_to: e.replyTo }),
          subject: e.subject,
          html: e.html,
          text: e.text,
        }),
      }).catch(() => {
        throw new MailError('NETWORK: Resend could not be reached');
      });
      const json = /** @type {any} */ (await res.json().catch(() => ({})));
      // Resend's errors say why ("You can only send testing emails to your own email
      // address…"): kept for staff. The key never appears in them.
      if (!res.ok || !json.id) {
        throw new MailError(
          `RESEND_${json.statusCode ?? res.status}: ${json.message ?? 'refused'}`,
        );
      }
      return { id: String(json.id) };
    },
  };
}

/**
 * The mailer the settings ask for, or null (no email).
 * @param {{ EMAIL_PROVIDER: 'none' | 'mailpit' | 'resend', MAILPIT_URL: string, RESEND_API_KEY?: string }} config
 * @returns {Mailer | null}
 */
export function createMailer(config) {
  if (config.EMAIL_PROVIDER === 'mailpit') return mailpitMailer({ url: config.MAILPIT_URL });
  if (config.EMAIL_PROVIDER === 'resend') {
    return resendMailer({ apiKey: /** @type {string} */ (config.RESEND_API_KEY) });
  }
  return null;
}
