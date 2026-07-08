/**
 * ai/config/capabilities.js
 *
 * Maps each real AI capability in the app to its model, caching, retry, and
 * batch policy. This is the "Configuration" piece — the router and
 * orchestrator read from here; they never decide models themselves, and
 * providers never decide models either.
 *
 * COMPATIBILITY NOTE — read before changing anything below:
 * Every capability here points at LEGACY_DEFAULT_MODEL, matching exactly
 * what lib/polsia-ai.js already does today (one hardcoded model for every
 * call). Moving a specific capability onto a different model is a real,
 * deliberate decision for later — Step 4 of the migration plan — not
 * something that should happen as a side effect of this file existing.
 *
 * Similarly, `cache: true` on every entry matches lib/polsia-ai.js's current
 * behavior of caching unconditionally whenever a system prompt is present.
 * `retry.enabled: false` matches today's reality too — the existing wrapper
 * has no retry logic, so this file doesn't quietly introduce any.
 *
 * The four capabilities below are named after the real functions that call
 * them today, not invented names:
 *   - generateNextQuestion   → services/interview.js
 *   - scoreAnswer            → services/interview.js
 *   - generateReport          → services/interview.js
 *   - extractJdCompetencies    → services/harmonicAlignmentEngine.js
 */

const { LEGACY_DEFAULT_MODEL } = require('./models');

const CAPABILITIES = {
  generateNextQuestion: {
    model: LEGACY_DEFAULT_MODEL,
    cache: true,
    retry: { enabled: false, maxAttempts: 0 },
    batchEligible: false,
    notes:
      'services/interview.js generateNextQuestion — latency-sensitive, live session',
  },

  scoreAnswer: {
    model: LEGACY_DEFAULT_MODEL,
    cache: true,
    retry: { enabled: false, maxAttempts: 0 },
    batchEligible: false,
    notes: 'services/interview.js scoreAnswer — has deterministic score-floor fallback',
  },

  generateReport: {
    model: LEGACY_DEFAULT_MODEL,
    cache: true,
    retry: { enabled: false, maxAttempts: 0 },
    batchEligible: false,
    notes: 'services/interview.js generateReport — end of session',
  },

  extractJdCompetencies: {
    model: LEGACY_DEFAULT_MODEL,
    cache: true,
    retry: { enabled: false, maxAttempts: 0 },
    batchEligible: false,
    notes: 'services/harmonicAlignmentEngine.js aiExtractJdCompetencies',
  },
};

function getCapability(name) {
  const config = CAPABILITIES[name];
  if (!config) {
    throw new Error(
      `[ai/config/capabilities] Unknown capability "${name}". ` +
        `Registered capabilities: ${Object.keys(CAPABILITIES).join(', ')}`
    );
  }
  return config;
}

module.exports = {
  CAPABILITIES,
  getCapability,
};
