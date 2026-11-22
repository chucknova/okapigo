// @ts-check
/**
 * provider.js — the INTERFACE every AI provider implements (GST-16, session 18).
 *
 * The PRD: "Provider-agnostic adapter; Anthropic or OpenAI, whichever has credits". OkapiGo's
 * code only ever calls one method:
 *
 *   answer({ instructions, facts, question })   answer a guest's question from these facts,
 *                                               or say it isn't sure
 *
 * Two implementations:
 *   fake.js        no network: the best-matching fact, by shared words (tests, CI, offline demos)
 *   anthropic.js   Claude Haiku through Anthropic's API (your key, in .env)
 *
 * The provider knows nothing about bookings, limits or the database: the companion
 * (packages/db/src/companion.js) decides what to ask and what to do with the reply.
 */

/**
 * One thing the companion may answer from. `topic` names it for the guest ("What should I
 * wear?", "Meeting point"); `personal` marks facts about THIS booking (date, travellers…), so
 * an answer built on them is never reused for another guest.
 * @typedef {{ topic: string, text: string, personal?: boolean }} Fact
 */

/**
 * @typedef {{
 *   instructions: string,   // how to answer (the companion's rules)
 *   facts: Fact[],          // what it may answer from, and nothing else
 *   question: string,       // the guest's words: untrusted
 * }} AnswerInput
 */

/**
 * What the model replied, and what it cost.
 * @typedef {{
 *   status: 'answered' | 'unsure',
 *   answer: string,               // empty when unsure
 *   source: string | null,        // the topic of the fact it used most ("What should I wear?")
 *   usesBookingDetails: boolean,  // built on a personal fact: never cached for others
 *   model: string,
 *   usage: { inputTokens: number, outputTokens: number, costMicroUsd: number },
 * }} AnswerResult
 */

/**
 * @typedef {{
 *   name: 'fake' | 'anthropic',
 *   model: string,
 *   answer: (input: AnswerInput) => Promise<AnswerResult>,
 * }} AiProvider
 */

/**
 * The provider couldn't answer at all (no connection, a bad key, rate-limited, down). The
 * guest sees "The assistant isn't available right now"; nothing is charged or counted.
 */
export class AiUnavailableError extends Error {
  /** @param {string} message @param {{ cause?: unknown }} [opts] */
  constructor(message, opts) {
    super(message, opts);
    this.name = 'AiUnavailableError';
  }
}
