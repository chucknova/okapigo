// @ts-check
/**
 * invite.js — inviting someone to the team (stage 16e-3; decided 2026-11-21: "email it; copy
 * for phones").
 *
 *   inviteWords()   the invitation in plain words: what the owner copies and sends by
 *                   WhatsApp or SMS to someone with only a phone, and the email's text
 *   inviteEmail()   the same, as an email in OkapiGo's layout (system fonts, inline styles,
 *                   every name escaped: an email is HTML, and a name like "<b>" must stay text)
 *
 * There's no link with a secret in it: the invited person opens the app and signs in with the
 * email or phone they were added with, by a one-time code, like everyone else.
 */
import { LAGOON } from '@okapigo/shared/tokens';
import { escapeHtml as esc } from '../routes/payments.js';

const C = LAGOON.color.light;
const FONT = LAGOON.font.family.replace(/"/g, "'");

/** "a guide", "an operations manager", "an owner". @param {string} roleName */
export const withArticle = (roleName) => {
  const r = roleName.toLowerCase();
  return `${/^[aeiou]/.test(r) ? 'an' : 'a'} ${r}`;
};

/** "Dayo" from "Dayo Ogunleye". @param {string} name */
const first = (name) => name.trim().split(/\s+/)[0] ?? name;

/**
 * @typedef {{ name: string, operatorName: string, roleName: string, invitedBy: string, contact: string, appUrl: string }} Invite
 *   contact: how they sign in, as shown ("0809 777 8899", "dayo@example.com")
 */

/** @param {Invite} i */
export function inviteWords(i) {
  return [
    `Hi ${first(i.name)}, ${first(i.invitedBy)} has added you to ${i.operatorName} on OkapiGo as ${withArticle(i.roleName)}.`,
    `Open ${i.appUrl} on your phone and sign in with ${i.contact}. We’ll send you a code.`,
  ].join('\n\n');
}

/** @param {Invite} i @returns {{ subject: string, html: string, text: string }} */
export function inviteEmail(i) {
  const subject = `Join ${i.operatorName} on OkapiGo`;
  const text = inviteWords(i);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:${C.bg};font-family:${FONT};color:${C.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:${C.surface};border:1px solid ${C.border};border-radius:12px;border-collapse:separate">
<tr><td style="padding:28px">
<div style="font-size:14px;font-weight:700;color:${C.success}">You’re invited</div>
<h1 style="margin:4px 0 16px;font-size:26px;line-height:32px;font-weight:700">Join ${esc(i.operatorName)}</h1>
<p style="margin:0 0 16px;font-size:16px;line-height:24px">Hi ${esc(first(i.name))}, ${esc(first(i.invitedBy))} has added you to ${esc(i.operatorName)} on OkapiGo as ${esc(withArticle(i.roleName))}.</p>
<p style="margin:0 0 20px;font-size:16px;line-height:24px">Sign in with <strong>${esc(i.contact)}</strong>. We’ll send you a code; no password to remember.</p>
<a href="${esc(i.appUrl)}" style="display:block;text-align:center;background:${C.primary};color:${C['on-primary']};font-size:17px;font-weight:700;text-decoration:none;border-radius:12px;padding:16px">Open OkapiGo</a>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid ${C.border};font-size:13px;color:${C['text-muted']}">Not expecting this? You can ignore it: nothing happens until you sign in.</td></tr>
</table>
</body></html>`;
  return { subject, html, text };
}
