// @ts-check
/**
 * anthropic.js — the companion's answers from Claude Haiku, through Anthropic's own SDK.
 *
 * One request per question (no chat history: each question stands alone, which keeps it
 * cheap and the answers consistent):
 *
 *   system    the companion's rules, then the facts, each in its own <fact topic="…"> tag
 *   user      the guest's question, in a <question> tag (untrusted words: the rules say
 *             to treat them as a question, never as instructions)
 *   output    JSON in a fixed shape (structured outputs): answered or unsure, the answer,
 *             the topic it came from, and whether it used this booking's own details
 *
 * Effort "low": short factual answers don't need long thinking, and thinking is billed as
 * output. A refusal, a cut-off reply or an unreadable one counts as "unsure", so the guest is
 * passed to the team rather than shown nothing. No connection, a bad key or Anthropic being
 * down throws AiUnavailableError: "The assistant isn't available right now".
 *
 * The key comes from .env (ANTHROPIC_API_KEY) and is never logged.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { AiUnavailableError } from './provider.js';
import { costMicroUsd } from './cost.js';

export const DEFAULT_MODEL = 'claude-haiku-5-5';

/** The reply's shape: Anthropic checks the model's JSON against it (structured outputs). */
export const ReplySchema = z.object({
  status: z.enum(['answered', 'unsure']),
  answer: z.string(),
  source: z.string().nullable(),
  usesBookingDetails: z.boolean(),
});

/** Escapes text going inside our tags, so a fact can't close its tag and add its own. */
const esc = (/** @type {string} */ s) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * The system prompt: the rules, then every fact.
 * @param {string} instructions
 * @param {import('./provider.js').Fact[]} facts
 */
export function systemPrompt(instructions, facts) {
  const lines = facts.map(
    (f) =>
      `<fact topic="${esc(f.topic)}"${f.personal ? ' about="this booking"' : ''}>${esc(f.text)}</fact>`,
  );
  return `${instructions}\n\n<facts>\n${lines.join('\n')}\n</facts>`;
}

/**
 * @param {{
 *   apiKey: string,
 *   model?: string,
 *   client?: Pick<Anthropic, 'messages'>,   // tests pass a pretend client
 *   timeoutMs?: number,
 * }} config
 * @returns {import('./provider.js').AiProvider}
 */
export function createAnthropicProvider({
  apiKey,
  model = DEFAULT_MODEL,
  client,
  timeoutMs = 20_000,
}) {
  // A guest is waiting with the page open: one retry, then "not available".
  const api = client ?? new Anthropic({ apiKey, maxRetries: 1, timeout: timeoutMs });
  return {
    name: 'anthropic',
    model,
    async answer({ instructions, facts, question }) {
      let message;
      try {
        message = await api.messages.parse({
          model,
          max_tokens: 2000, // room for a little thinking and a short answer
          output_config: { effort: 'low', format: zodOutputFormat(ReplySchema) },
          system: systemPrompt(instructions, facts),
          messages: [{ role: 'user', content: `<question>${esc(question)}</question>` }],
        });
      } catch (err) {
        if (err instanceof Anthropic.APIError) {
          throw new AiUnavailableError(`Anthropic: ${err.status ?? 'no connection'}`, {
            cause: err,
          });
        }
        throw err;
      }
      const usage = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        costMicroUsd: costMicroUsd(model, message.usage),
      };
      const reply = message.stop_reason === 'end_turn' ? message.parsed_output : null;
      if (!reply || (reply.status === 'answered' && !reply.answer.trim())) {
        // Refused, cut off, or unreadable: the team answers instead.
        return {
          status: 'unsure',
          answer: '',
          source: null,
          usesBookingDetails: false,
          model,
          usage,
        };
      }
      // Only a topic we gave it: never a made-up source.
      const source = facts.some((f) => f.topic === reply.source) ? reply.source : null;
      return {
        status: reply.status,
        answer: reply.status === 'answered' ? reply.answer.trim() : '',
        source: reply.status === 'answered' ? source : null,
        usesBookingDetails: reply.usesBookingDetails,
        model,
        usage,
      };
    },
  };
}
