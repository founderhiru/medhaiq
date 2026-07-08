/**
 * ai/core/retry.js
 *
 * Bounded, capability-aware retry wrapper for provider API calls.
 *
 * COMPATIBILITY NOTE:
 * lib/polsia-ai.js has no retry logic today — a failed call just throws,
 * straight up to whatever try/catch the business logic already has. Every
 * capability in ai/config/capabilities.js is currently set to
 * `retry: { enabled: false, maxAttempts: 0 }`, so as long as callers pass
 * that config through, withRetry() below is a no-op: it calls the function
 * once and lets errors propagate exactly like today. This file doesn't
 * change any behavior on its own — it only does something once a specific
 * capability is deliberately switched to `enabled: true` later.
 *
 * SCOPE BOUNDARY — read before wiring this into the orchestrator:
 * withRetry() must only ever wrap the raw provider API call (the network
 * request), never the response parsing step. ai/core/normalizer.js
 * deliberately throws on invalid JSON so that services/interview.js's
 * scoreAnswer/generateReport and harmonicAlignmentEngine.js's
 * extractJdCompetencies can catch that specific error and run their
 * existing fallback logic (score floor, heuristic parser, etc). If a
 * parsing error got retried instead of surfaced, those fallbacks might
 * never run, or run after a needless delay. Retry belongs around
 * "call Anthropic", not around "parse what Anthropic said".
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, policy = {}) {
  const { enabled = false, maxAttempts = 0, backoffMs = 500 } = policy;

  // Matches today's behavior exactly: single call, error propagates as-is.
  if (!enabled || maxAttempts <= 0) {
    return fn();
  }

  let lastError;
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt) break;

      const wait = backoffMs * Math.pow(2, attempt);
      await sleep(wait);
    }
  }

  throw lastError;
}

module.exports = {
  withRetry,
};
