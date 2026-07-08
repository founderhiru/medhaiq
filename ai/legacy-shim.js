/**
 * ai/legacy-shim.js
 *
 * Drop-in replacement for lib/polsia-ai.js. Exposes the exact same
 * interface — chat(message, options), chatJSON(message, options), and the
 * raw anthropic client — so that when lib/polsia-ai.js is later changed to:
 *
 *   module.exports = require('../ai/legacy-shim');
 *
 * ...every existing call site (services/interview.js,
 * services/harmonicAlignmentEngine.js) keeps working with zero changes.
 *
 * Internally this calls ai/providers/anthropic.js, always defaulting to
 * LEGACY_DEFAULT_MODEL from ai/config/models.js — the same model string
 * lib/polsia-ai.js hardcodes today. An explicit `model` in options can
 * still override it, but nothing does that yet, so behavior stays
 * identical to production until that's a deliberate later decision.
 *
 * This file is temporary. Once every real call site has been migrated to
 * call ai/index.js's named capability methods directly (Step 4 of the
 * migration plan), this file and lib/polsia-ai.js both get deleted.
 */

const { LEGACY_DEFAULT_MODEL } = require('./config/models');
const provider = require('./providers/anthropic');

async function chat(message, options = {}) {
  return provider.chat(message, {
    ...options,
    model: options.model || LEGACY_DEFAULT_MODEL,
  });
}

async function chatJSON(message, options = {}) {
  return provider.chatJSON(message, {
    ...options,
    model: options.model || LEGACY_DEFAULT_MODEL,
  });
}

module.exports = {
  anthropic: provider.anthropic,
  chat,
  chatJSON,
};
