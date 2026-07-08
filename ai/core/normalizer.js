/**
 * ai/core/normalizer.js
 *
 * Extracts plain text or parsed JSON from a provider's raw API response.
 * This is the highest-compatibility-risk file in the whole migration, so it
 * intentionally does the LEAST possible — it mirrors lib/polsia-ai.js's
 * existing chat()/chatJSON() extraction logic exactly, line for line.
 *
 * COMPATIBILITY NOTE — read before changing anything below:
 * Today, lib/polsia-ai.js's chatJSON() does this:
 *
 *   const raw = response.content[0].text.trim();
 *   const json = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
 *   return JSON.parse(json);
 *
 * Three real call sites depend on JSON.parse THROWING when the model
 * returns malformed JSON, so their own try/catch fallback logic fires:
 *   - services/interview.js        scoreAnswer   → deterministic score floor
 *   - services/interview.js        generateReport → honest low-score report
 *   - services/harmonicAlignmentEngine.js aiExtractJdCompetencies → heuristic parser
 *
 * normalizeJSON() below must keep throwing on invalid JSON. Do NOT wrap the
 * JSON.parse in a try/catch here that swallows the error or returns null —
 * that would silently break all three of those existing fallback paths.
 *
 * Only the Anthropic response shape (response.content[0].text) is
 * implemented right now, matching what's actually in production. A
 * provider argument exists so this can be extended once ai/providers/google.js
 * is actually built — it deliberately throws for any other provider today
 * rather than guessing at a shape that hasn't been verified yet.
 */

function assertAnthropicShape(response) {
  if (!response || !Array.isArray(response.content) || !response.content[0]) {
    throw new Error(
      '[ai/core/normalizer] Unexpected response shape — expected response.content[0].text'
    );
  }
}

function normalizeText(response, provider = 'anthropic') {
  if (provider !== 'anthropic') {
    throw new Error(`[ai/core/normalizer] normalizeText: provider "${provider}" not yet supported`);
  }
  assertAnthropicShape(response);
  return response.content[0].text;
}

function normalizeJSON(response, provider = 'anthropic') {
  if (provider !== 'anthropic') {
    throw new Error(`[ai/core/normalizer] normalizeJSON: provider "${provider}" not yet supported`);
  }
  assertAnthropicShape(response);

  const raw = response.content[0].text.trim();
  const json = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(json); // intentionally not caught — see note above
}

module.exports = {
  normalizeText,
  normalizeJSON,
};
