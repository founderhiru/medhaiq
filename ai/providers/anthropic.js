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
const { createSession: createRedactionSession, isEnabled: isRedactionEnabled } = require('../core/redactor');

// PII REDACTION (opt-in, default OFF). Only active when AI_REDACTION=on.
// When off, beginRedaction() returns null and every call below behaves
// byte-for-byte as before. Callers may pass options.redact =
// { names: [...], detectHeaderName: true } to add known names; options.redact
// === false opts a single call out. Mapping stays in memory for the duration
// of one call; only per-type COUNTS are logged, never values.
// One-line boot status so the flag is verifiable from the logs without
// uploading anything. JSON.stringify exposes stray spaces/newlines in the
// value (the flag only turns on for the exact string 'on'). Never logs PII.
console.log(`[redactor] boot status=${isRedactionEnabled() ? 'ON' : 'OFF'} AI_REDACTION=${JSON.stringify(process.env.AI_REDACTION === undefined ? null : process.env.AI_REDACTION)}`);

function beginRedaction(options, capability) {
  try {
    if (!isRedactionEnabled() || options.redact === false) return null;
    const cfg = (options.redact && typeof options.redact === 'object') ? options.redact : {};
    return { session: createRedactionSession(cfg), capability };
  } catch (err) {
    console.error('[redactor] init failed, continuing without redaction:', err.message);
    return null;
  }
}

function logRedaction(r) {
  if (!r) return;
  const total = r.session.getTotal();
  if (total > 0) {
    console.log(`[redactor] capability=${r.capability || 'n/a'} removed=${JSON.stringify(r.session.getCounts())}`);
  }
}

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

// PHASE 2F-A — CACHE BOUNDARY DIAGNOSTIC (2026-08-09):
// Off by default. Set ANTHROPIC_PROMPT_CACHE_DEBUG=true to log the exact,
// server-measured token count of the static prefix vs. the dynamic tail
// for every split-form chatJSON call, using Anthropic's own
// /v1/messages/count_tokens endpoint (not a local estimate) — so it's
// directly comparable to the 4,096-token minimum cacheable length Haiku
// 4.5 requires. Adds 3 extra read-only API calls per turn while enabled;
// never touches prompt content, never affects the real request. Meant to
// be turned on for a diagnostic run only, then back off.
const CACHE_DEBUG_ENABLED = process.env.ANTHROPIC_PROMPT_CACHE_DEBUG === 'true';

async function logCacheBoundaryDiagnostics({ model, system, message, capability }) {
  if (!CACHE_DEBUG_ENABLED) return;
  if (!system || typeof system !== 'object' || Array.isArray(system)) return; // only meaningful for the split form

  try {
    const [staticCount, dynamicCount, messageOnlyCount] = await Promise.all([
      system.static
        ? anthropic.messages.countTokens({
            model,
            system: [{ type: 'text', text: system.static }],
            messages: [{ role: 'user', content: message }],
          })
        : Promise.resolve({ input_tokens: 0 }),
      system.dynamic
        ? anthropic.messages.countTokens({
            model,
            system: [{ type: 'text', text: system.dynamic }],
            messages: [{ role: 'user', content: message }],
          })
        : Promise.resolve({ input_tokens: 0 }),
      // countTokens always counts a full request (system + messages), so
      // the user message itself is counted in both calls above. Subtract
      // it once, measured on its own, to isolate the system text alone.
      anthropic.messages.countTokens({
        model,
        messages: [{ role: 'user', content: message }],
      }),
    ]);

    const staticPrefixTokens = system.static ? Math.max(0, staticCount.input_tokens - messageOnlyCount.input_tokens) : 0;
    const dynamicTailTokens = system.dynamic ? Math.max(0, dynamicCount.input_tokens - messageOnlyCount.input_tokens) : 0;
    const HAIKU_4_5_CACHE_MIN_TOKENS = 4096;

    console.log(
      `[CACHE-DIAG] capability=${capability || 'n/a'} ` +
      `static_prefix_tokens=${staticPrefixTokens} ` +
      `dynamic_tail_tokens=${dynamicTailTokens} ` +
      `message_only_tokens=${messageOnlyCount.input_tokens} ` +
      `haiku_4_5_cache_min=${HAIKU_4_5_CACHE_MIN_TOKENS} ` +
      `meets_threshold=${staticPrefixTokens >= HAIKU_4_5_CACHE_MIN_TOKENS}`
    );
  } catch (err) {
    // Diagnostic-only — must never affect the real request or throw
    // upstream. Errors here (e.g. count_tokens rate limit) are logged and
    // swallowed.
    console.error('[CACHE-DIAG] countTokens diagnostic failed (real request unaffected):', err.message);
  }
}

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

  const redaction = beginRedaction(options, capability);
  // Message first: a name found at the top of the user content (e.g. a resume)
  // is then also removed from the system prompt.
  const sendMessage = redaction ? redaction.session.redact(message) : message;
  const sendSystem = redaction ? redaction.session.redactSystem(system) : system;
  logRedaction(redaction);

  const hasSystem = sendSystem && (typeof sendSystem === 'string' ? true : (sendSystem.static || sendSystem.dynamic));

  const call = () =>
    anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: sendMessage }],
      system: hasSystem ? buildSystemBlock(sendSystem, cache) : undefined,
    });

  const response = await withTelemetry(() => withRetry(call, retry), {
    capability,
    provider: 'anthropic',
    model,
    onUsage,
  });

  const text = normalizeText(response);
  return redaction ? redaction.session.restore(text) : text;
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

  const redaction = beginRedaction(options, capability);
  // Message first: a name found at the top of the user content (e.g. a resume)
  // is then also removed from the system prompt.
  const sendMessage = redaction ? redaction.session.redact(message) : message;
  const sendSystem = redaction ? redaction.session.redactSystem(system) : system;
  logRedaction(redaction);

  // Object form: { static, dynamic } — the JSON instruction is per-turn
  // boilerplate, so it belongs on the dynamic (uncached) tail, appended
  // in the exact same position it always occupied relative to the rest
  // of the system text (immediately after it, nothing in between).
  const systemPrompt = (sendSystem && typeof sendSystem === 'object' && !Array.isArray(sendSystem))
    ? { static: sendSystem.static || '', dynamic: `${sendSystem.dynamic || ''}${JSON_INSTRUCTION}` }
    : `${sendSystem}${JSON_INSTRUCTION}`;

  // Diagnostic-only, fire-and-forget — never blocks or delays the real
  // call. Measures exactly what's being sent (systemPrompt, post
  // JSON_INSTRUCTION), not the raw input.
  logCacheBoundaryDiagnostics({ model, system: systemPrompt, message: sendMessage, capability });

  const call = () =>
    anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: sendMessage }],
      system: buildSystemBlock(systemPrompt, cache),
    });

  const response = await withTelemetry(() => withRetry(call, retry), {
    capability,
    provider: 'anthropic',
    model,
    onUsage,
  });

  const json = normalizeJSON(response); // throws on invalid JSON — intentional, see normalizer.js
  return redaction ? redaction.session.restore(json) : json;
}

module.exports = {
  anthropic,
  chat,
  chatJSON,
};
