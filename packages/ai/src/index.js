// @ts-check
/**
 * @okapigo/ai: the AI companion's model behind one interface (GST-16, session 18).
 *
 *   const ai = createAiProvider({ provider: 'anthropic', apiKey })
 *   const reply = await ai.answer({ instructions, facts, question })
 *
 * Callers only use `answer`, so the fake and Claude are a config change apart (AI_PROVIDER).
 */
import { createFakeProvider } from './fake.js';
import { createAnthropicProvider } from './anthropic.js';

export { createFakeProvider, words } from './fake.js';
export { createAnthropicProvider, systemPrompt, ReplySchema, DEFAULT_MODEL } from './anthropic.js';
export { AiUnavailableError } from './provider.js';
export { costMicroUsd, PRICES } from './cost.js';

/**
 * @param {{ provider: 'fake' | 'anthropic', apiKey?: string, model?: string }} config
 * @returns {import('./provider.js').AiProvider}
 */
export function createAiProvider({ provider, apiKey, model }) {
  if (provider === 'anthropic') {
    if (!apiKey) throw new Error('AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
    return createAnthropicProvider({ apiKey, model });
  }
  return createFakeProvider();
}
