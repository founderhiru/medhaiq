/**
 * ai/core/telemetry.js
 *
 * Additive-only logging around AI provider calls: latency, capability,
 * provider, model, success/failure, and token usage when available.
 *
 * COMPATIBILITY NOTE:
 * Unlike retry.js (which must stay a no-op until a capability deliberately
 * opts in), telemetry is safe to have active immediately: withTelemetry()
 * NEVER changes what the wrapped function returns or throws. It only
 * observes and logs, then passes the result or error straight through
 * unchanged. If this file were deleted entirely, nothing about the app's
 * behavior would change except the absence of these log lines.
 *
 * SCOPE BOUNDARY — same rule as retry.js:
 * This must never swallow an error. services/interview.js and
 * harmonicAlignmentEngine.js depend on specific errors (bad JSON, API
 * failures) reaching their own try/catch blocks so existing fallback logic
 * fires. withTelemetry() logs the failure, then rethrows the original
 * error unmodified.
 *
 * No logging library is installed in this repo today — lib/polsia-ai.js
 * uses plain console.warn(). This matches that: a single-line
 * console.log() with a JSON payload, easy to read or grep in Render logs,
 * no new dependency required.
 */

async function withTelemetry(fn, meta = {}) {
  const { capability, provider, model, onUsage } = meta;
  const startedAt = Date.now();

  try {
    const response = await fn();
    const latencyMs = Date.now() - startedAt;
    logEvent({
      capability,
      provider,
      model,
      success: true,
      latencyMs,
      usage: response && response.usage ? response.usage : undefined,
    });
    // Additive, optional hook (Phase 2F-A prompt-cache metrics). Only
    // fires when a caller explicitly passes onUsage in options — every
    // existing call site is unaffected. Never allowed to throw into the
    // main response path; a metrics-persistence failure must never
    // affect interview behavior.
    if (typeof onUsage === 'function' && response && response.usage) {
      try {
        onUsage(response.usage, latencyMs);
      } catch (hookErr) {
        console.error('[ai:telemetry] onUsage hook failed:', hookErr.message);
      }
    }
    return response;
  } catch (err) {
    logEvent({
      capability,
      provider,
      model,
      success: false,
      latencyMs: Date.now() - startedAt,
      error: err.message,
    });
    throw err; // never swallow — see scope boundary note above
  }
}

function logEvent(event) {
  console.log('[ai:telemetry]', JSON.stringify(event));
}

module.exports = {
  withTelemetry,
};
