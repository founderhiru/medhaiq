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
  const { capability, provider, model } = meta;
  const startedAt = Date.now();

  try {
    const response = await fn();
    logEvent({
      capability,
      provider,
      model,
      success: true,
      latencyMs: Date.now() - startedAt,
      usage: response && response.usage ? response.usage : undefined,
    });
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
