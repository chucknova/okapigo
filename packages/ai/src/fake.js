// @ts-check
/**
 * fake.js — a pretend model with no network (tests, CI, the e2e journeys, offline demos).
 *
 * It answers with the fact that shares the most words with the question, and says it's
 * "unsure" when nothing shares a word with a fact's topic. That's enough to show both paths
 * of journey 7: "What should I wear?" finds the FAQ; "Can I bring my drone?" goes to staff.
 * It never invents anything, and costs nothing.
 */

/** Words too common to mean anything ("what should I…"). */
const STOP = new Set(
  (
    'a an and any are at be bring but can could do does for from have how i in is it me my ' +
    'of on or our should so that the there this to us we what when where which will with ' +
    'would you your'
  ).split(' '),
);

/**
 * "What should I wear?" → ["wear"]. Lower case, letters and digits only, a plural's "s" off.
 * @param {string} text
 */
export function words(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
}

/** @returns {import('./provider.js').AiProvider} */
export function createFakeProvider() {
  return {
    name: 'fake',
    model: 'fake',
    async answer({ facts, question }) {
      const asked = new Set(words(question));
      let best = null;
      let bestScore = 0;
      for (const fact of facts) {
        // A word in the TOPIC counts double: "wear" in "What should I wear?" beats a "wear"
        // somewhere in a long description.
        const inTopic = words(fact.topic).filter((w) => asked.has(w)).length;
        if (inTopic === 0) continue;
        const inText = new Set(words(fact.text).filter((w) => asked.has(w))).size;
        const score = inTopic * 2 + inText;
        if (score > bestScore) {
          best = fact;
          bestScore = score;
        }
      }
      const usage = { inputTokens: 0, outputTokens: 0, costMicroUsd: 0 };
      if (!best) {
        return {
          status: 'unsure',
          answer: '',
          source: null,
          usesBookingDetails: false,
          model: 'fake',
          usage,
        };
      }
      return {
        status: 'answered',
        answer: best.text,
        source: best.topic,
        usesBookingDetails: best.personal === true,
        model: 'fake',
        usage,
      };
    },
  };
}
