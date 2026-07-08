/**
 * ai/config/models.js
 *
 * Single source of truth for model ID strings. Nothing else in this codebase
 * should hardcode a model string directly — always reference a name from
 * this file, so an upgrade is a one-line change here instead of a hunt
 * across every service file.
 *
 * COMPATIBILITY NOTE (read before changing LEGACY_DEFAULT_MODEL):
 * `lib/polsia-ai.js` currently hardcodes the model string 'claude-haiku-4-5'
 * (no date suffix) via:
 *
 *   const MODEL = process.env.AI_MODEL || 'claude-haiku-4-5';
 *
 * LEGACY_DEFAULT_MODEL below preserves that exact string on purpose. Every
 * capability in ai/config/capabilities.js will point at this constant until
 * we deliberately decide, capability by capability, to move it to something
 * else (that's a later, separate migration step — not something that should
 * happen silently as a side effect of this refactor).
 */

const LEGACY_DEFAULT_MODEL = process.env.AI_MODEL || 'claude-haiku-4-5';

// Named, explicit model IDs available for future per-capability routing
// decisions. These are not used anywhere yet — they exist so that when we
// do decide to move a specific capability (e.g. generateReport) onto a
// different model, there's already a clear, correctly-spelled constant to
// point it at, rather than a fresh hardcoded string in some service file.
const MODELS = {
  // Currently in production use, via LEGACY_DEFAULT_MODEL above.
  CLAUDE_HAIKU_4_5: 'claude-haiku-4-5',

  // Not yet used by any capability. Available once we deliberately decide
  // a capability (e.g. generateReport, the most reasoning-heavy call)
  // should move off Haiku.
  CLAUDE_SONNET_5: 'claude-sonnet-5',

  // Gemini is not installed or used anywhere in the app today. This name
  // exists so ai/providers/google.js and ai/config/capabilities.js have a
  // single correctly-spelled constant to reference once that adapter is
  // built and deliberately wired up.
  GEMINI_2_5_PRO: 'gemini-2.5-pro',
};

module.exports = {
  LEGACY_DEFAULT_MODEL,
  MODELS,
};
