// @ts-check
/**
 * api.js — the simulator's calls to the API (routes/whatsapp-simulator.js). Same origin, so
 * plain fetch. Every failure becomes an ApiError the chat can show ("Not sent").
 */

export class ApiError extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** @param {string} url @param {RequestInit} [init] */
async function call(url, init) {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError(0, 'OFFLINE', 'No connection.');
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? 'ERROR', body?.error?.message ?? 'Failed.');
  }
  return body;
}

export const api = {
  /** The operator's name and time zone, for the header. @param {string} slug */
  operator: async (slug) =>
    /** @type {{ name: string }} */ ((await call(`/public/${encodeURIComponent(slug)}`)).operator),
  /**
   * A guest's message: typed text, or a tapped button / list row (its id and title).
   * @param {string} slug
   * @param {{ phone: string, name: string, text?: string, choice?: string, title?: string }} body
   * @returns {Promise<{ conversation: { token: string, handledBy: string }, replies: any[] }>}
   */
  send: (slug, body) =>
    call(`/simulator/whatsapp/${encodeURIComponent(slug)}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** @param {string} token @returns {Promise<{ conversation: { handledBy: string }, messages: any[] }>} */
  messages: (token) =>
    call(`/simulator/whatsapp/conversations/${encodeURIComponent(token)}/messages`),
  /**
   * The guest's chat, if the business wrote to them first (a website booking's confirmation).
   * @param {string} slug @param {string} phone @returns {Promise<string | null>} its token
   */
  find: (slug, phone) =>
    call(`/simulator/whatsapp/${encodeURIComponent(slug)}/conversations`, {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }).then(
      (r) => r.conversation.token,
      (err) => {
        if (err.status === 404) return null;
        throw err;
      },
    ),
  /** "New chat". @param {string} token */
  reset: (token) =>
    call(`/simulator/whatsapp/conversations/${encodeURIComponent(token)}/reset`, {
      method: 'POST',
    }),
};
