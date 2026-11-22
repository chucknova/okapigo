// @ts-check
/**
 * cost.js — what one answer cost, in millionths of a US dollar (micro-dollars), so the
 * monthly spend cap can add them up in whole numbers.
 *
 * Prices are Anthropic's, for prompts up to 100K tokens (ours are a few thousand), written in
 * NANO-dollars per token so the sums stay whole numbers (0.1 × 30 in floating point is
 * 3.0000000000000004, which rounds up to 4). Thinking counts as output. Cache reads cost a
 * tenth of input; cache writes a quarter more. Rounded UP, so the cap is never under-counted.
 */

/**
 * Nano-dollars per token: US$ per million tokens × 1,000.
 * @type {Record<string, { input: number, output: number }>}
 */
export const PRICES = {
  'claude-haiku-5-5': { input: 100, output: 500 }, // $0.10 and $0.50 per million tokens
};

/**
 * @param {string} model
 * @param {{ input_tokens?: number | null, output_tokens?: number | null, cache_read_input_tokens?: number | null, cache_creation_input_tokens?: number | null }} usage
 */
export function costMicroUsd(model, usage) {
  const price = PRICES[model];
  if (!price) throw new Error(`No price for model ${model}: add it to cost.js`);
  // ×10 for whole numbers: a cache read is 1/10 of input, a cache write 12.5/10.
  const tenthsOfNano =
    (usage.input_tokens ?? 0) * price.input * 10 +
    (usage.output_tokens ?? 0) * price.output * 10 +
    (usage.cache_read_input_tokens ?? 0) * price.input +
    (usage.cache_creation_input_tokens ?? 0) * price.input * 12.5;
  return Math.ceil(tenthsOfNano / 10_000);
}
