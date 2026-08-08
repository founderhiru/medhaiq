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

function buildSystemBlock(systemText, cacheEnabled) {
  const block = { type: 'text', text: systemText };
  if (cacheEnabled) {
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
  } = options;

  if (!model) {
    throw new Error('[ai/providers/anthropic] chat: "model" is required');
  }

  const call = () =>
    anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: message }],
      system: system ? buildSystemBlock(system, cache) : undefined,
    });

  const response = await withTelemetry(() => withRetry(call, retry), {
    capability,
    provider: 'anthropic',
    model,
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
  } = options;

  if (!model) {
    throw new Error('[ai/providers/anthropic] chatJSON: "model" is required');
  }

  const systemPrompt = `${system}\n\nYou must respond with valid JSON only. No markdown, no prose.`;

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
  });

  return normalizeJSON(response); // throws on invalid JSON — intentional, see normalizer.js
}

module.exports = {
  anthropic,
  chat,
  chatJSON,
};
