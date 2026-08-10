/**
 * ai/providers/anthropic.js
 *
 * The only file in ai/ that touches @anthropic-ai/sdk directly. No model
 * selection happens here — every call requires an explicit `model` passed
 * in by the caller (which will be the orchestrator, reading from
 * ai/config/capabilities.js). This keeps the adapter provider-focused only.
 *
 * COMPATIBILITY NOTE:
 * chat() and chatJSON() mirror lib/polsia-ai.js's existing functions
 * behaviorally:
 *   - chat(): same max_tokens default (400), same conditional system block
 *     (only added if a system prompt is passed), same cache_control
 *     ephemeral marker on that block.
 *   - chatJSON(): same max_tokens default (800), same fixed instruction
 *     text appended to the system prompt, same unconditional cache_control
 *     marker, same markdown-fence-stripping + JSON.parse via
 *     ai/core/normalizer.js — including throwing on invalid JSON.
 *
 * Called with the same defaults lib/polsia-ai.js uses today (same model,
 * cache: true, retry disabled), this produces identical output. Retry and
 * telemetry are layered on top without changing what's returned or thrown.
 *
 * PHASE 2F-A — PROMPT CACHING (2026-08-08):
 * Two additive changes, both backward-compatible:
 *
 * 1. ANTHROPIC_PROMPT_CACHE env flag — global kill switch. Defaults to
 *    enabled (matches the pre-existing `cache: true` default). Set to the
 *    literal string 'false' to disable prompt caching entirely without a
 *    code change/deploy. Does not change any prompt content — only
 *    whether cache_control is attached to the request.
 *
 * 2. `system` may now be either a string (unchanged, existing behavior —
 *    used by SCORING_SYSTEM/REPORT_SYSTEM and every other caller today)
 *    OR an object `{ static, dynamic }`. When an object is passed, the
 *    two parts are sent as two separate blocks in the `system` array, in
 *    order — cache_control is attached ONLY to the static block. This is
 *    the fix for the one real caching bug found in the Phase 2F-A audit:
 *    the question-generation call previously packed session-stable
 *    content (persona/role/competency matrix/JD) and per-turn content
 *    (conversation history, current answer) into a single block, so the
 *    cache breakpoint hash changed on every turn and never got a read.
 *    Concatenating static.text + dynamic.text reproduces the exact same
 *    text the model previously saw as one string — no prompt content is
 *    added, removed, or reordered.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { withRetry } = require('../core/retry');
const { withTelemetry } = require('../core/telemetry');
const { normalizeText, normalizeJSON } = require('../core/normalizer');

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[ai/providers/anthropic] WARNING: ANTHROPIC_API_KEY is not set. AI features will fail.');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Global kill switch for Phase 2F-A prompt caching. Only the literal
// string 'false' disables it — unset, '', or any other value keeps the
// pre-existing default (caching on, gated per-call by the existing
// `cache` option as before).
const PROMPT_CACHE_ENV_ENABLED = process.env.ANTHROPIC_PROMPT_CACHE !== 'false';

function buildSystemBlock(systemText, cacheEnabled) {
  const shouldCache = !!cacheEnabled && PROMPT_CACHE_ENV_ENABLED;

  // New split form: { static, dynamic } -> two ordered blocks, cache
  // breakpoint on the static one only. Either half may be omitted/empty.
  if (systemText && typeof systemText === 'object' && !Array.isArray(systemText)) {
    const blocks = [];
    if (systemText.static) {
      const staticBlock = { type: 'text', text: systemText.static };
      if (shouldCache) {
        staticBlock.cache_control = { type: 'ephemeral' };
      }
      blocks.push(staticBlock);
    }
    if (systemText.dynamic) {
      blocks.push({ type: 'text', text: systemText.dynamic });
    }
    return blocks;
  }

  // Existing single-string form — unchanged.
  const block = { type: 'text', text: systemText };
  if (shouldCache) {
    block.cache_control = { type: 'ephemeral' };
  }
  return [block];
}

async function chat(message, options = {}) {
  const {
    model,
    system,
    maxTokens = 400,
    cache = true,
    retry = { enabled: false, maxAttempts: 0 },
    capability,
    onUsage,
  } = options;

  if (!model) {
    throw new Error('[ai/providers/anthropic] chat: "model" is required');
  }

  const hasSystem = system && (typeof system === 'string' ? true : (system.static || system.dynamic));

  const call = () =>
    anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: message }],
      system: hasSystem ? buildSystemBlock(system, cache) : undefined,
    });

  const response = await withTelemetry(() => withRetry(call, retry), {
    capability,
    provider: 'anthropic',
    model,
    onUsage,
  });

  return normalizeText(response);
}

async function chatJSON(message, options = {}) {
  const {
    model,
    system = '',
    maxTokens = 800,
    cache = true,
    retry = { enabled: false, maxAttempts: 0 },
    capability,
    onUsage,
  } = options;

  if (!model) {
    throw new Error('[ai/providers/anthropic] chatJSON: "model" is required');
  }

  const JSON_INSTRUCTION = '\n\nYou must respond with valid JSON only. No markdown, no prose.';

  // Object form: { static, dynamic } — the JSON instruction is per-turn
  // boilerplate, so it belongs on the dynamic (uncached) tail, appended
  // in the exact same position it always occupied relative to the rest
  // of the system text (immediately after it, nothing in between).
  const systemPrompt = (system && typeof system === 'object' && !Array.isArray(system))
    ? { static: system.static || '', dynamic: `${system.dynamic || ''}${JSON_INSTRUCTION}` }
    : `${system}${JSON_INSTRUCTION}`;

  const call = () =>
    anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: message }],
      system: buildSystemBlock(systemPrompt, cache),
    });

  const response = await withTelemetry(() => withRetry(call, retry), {
    capability,
    provider: 'anthropic',
    model,
    onUsage,
  });

  return normalizeJSON(response); // throws on invalid JSON — intentional, see normalizer.js
}

module.exports = {
  anthropic,
  chat,
  chatJSON,
};
