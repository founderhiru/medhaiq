// Phase 2F-A — Prompt cache metrics DB access.
//
// Purely additive instrumentation. Nothing in the interview engine reads
// from this table — it exists only to answer "is caching actually saving
// money" with turn-by-turn evidence, and to feed the founder dashboard.
//
// One row per AI call that opts into cache-metrics tracking (currently
// only generateNextQuestion — see services/interview.js). Never blocks or
// throws into the interview flow: every call site wraps this in
// .catch(), so a DB hiccup here can never affect a candidate's session.
const { pool } = require('./index');

// Same rates Anthropic publishes for the model this app currently uses in
// production (claude-haiku-4-5, see ai/config/models.js). Kept here, not
// in the interview engine, since it's a cost-reporting concern only —
// update if the model or published rates change.
const HAIKU_4_5_RATES = {
  baseInputPerMTok: 1.0,
  cacheWritePerMTok: 1.25, // 5-minute TTL write premium
  cacheReadPerMTok: 0.10,
  outputPerMTok: 5.0,
};

function estimateCostUsd(usage, rates = HAIKU_4_5_RATES) {
  const inputTokens = usage.input_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;

  return (
    (inputTokens / 1_000_000) * rates.baseInputPerMTok +
    (cacheCreation / 1_000_000) * rates.cacheWritePerMTok +
    (cacheRead / 1_000_000) * rates.cacheReadPerMTok +
    (outputTokens / 1_000_000) * rates.outputPerMTok
  );
}

async function recordPromptCacheMetrics({ sessionId, turnLabel, capability, usage, latencyMs }) {
  if (!sessionId || !usage) return null;

  const estimatedCostUsd = estimateCostUsd(usage);

  const result = await pool.query(
    `INSERT INTO prompt_cache_metrics
       (session_id, turn_label, capability, input_tokens, cache_creation_input_tokens,
        cache_read_input_tokens, output_tokens, latency_ms, estimated_cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      sessionId,
      turnLabel || null,
      capability || null,
      usage.input_tokens || 0,
      usage.cache_creation_input_tokens || 0,
      usage.cache_read_input_tokens || 0,
      usage.output_tokens || 0,
      latencyMs || null,
      estimatedCostUsd,
    ]
  );
  return result.rows[0];
}

// Turn-by-turn rows for one session — exactly the shape the Phase 2F-A
// benchmark report needs (Q1..Qn, no averaging).
async function getSessionCacheMetrics(sessionId) {
  const result = await pool.query(
    `SELECT turn_label, capability, input_tokens, cache_creation_input_tokens,
            cache_read_input_tokens, output_tokens, latency_ms, estimated_cost_usd, created_at
     FROM prompt_cache_metrics
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sessionId]
  );
  return result.rows;
}

// Founder-dashboard aggregate: cache hit rate and estimated savings over a
// trailing window. Savings estimate compares actual estimated cost against
// what the same cache_read tokens would have cost as full-price input.
async function getCacheEfficiencyStats(days = 7) {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total_calls,
       COUNT(*) FILTER (WHERE cache_read_input_tokens > 0)::int AS calls_with_cache_hit,
       COALESCE(SUM(input_tokens), 0)::bigint AS total_input_tokens,
       COALESCE(SUM(cache_creation_input_tokens), 0)::bigint AS total_cache_creation_tokens,
       COALESCE(SUM(cache_read_input_tokens), 0)::bigint AS total_cache_read_tokens,
       COALESCE(SUM(estimated_cost_usd), 0)::float AS total_estimated_cost_usd,
       COALESCE(AVG(latency_ms), 0)::float AS avg_latency_ms
     FROM prompt_cache_metrics
     WHERE created_at >= NOW() - ($1 || ' days')::interval`,
    [days]
  );
  const row = result.rows[0];
  const cacheHitRatePct = row.total_calls > 0
    ? (row.calls_with_cache_hit / row.total_calls) * 100
    : 0;
  // What the cache_read tokens would have cost at full base-input price,
  // vs. what they actually cost at the 0.1x cache-read rate — the delta
  // is the savings actually attributable to caching.
  const cacheReadTokensAtFullPrice = (row.total_cache_read_tokens / 1_000_000) * HAIKU_4_5_RATES.baseInputPerMTok;
  const cacheReadTokensAtCachedPrice = (row.total_cache_read_tokens / 1_000_000) * HAIKU_4_5_RATES.cacheReadPerMTok;
  const estimatedSavingsUsd = cacheReadTokensAtFullPrice - cacheReadTokensAtCachedPrice;

  return {
    ...row,
    cache_hit_rate_pct: cacheHitRatePct,
    estimated_savings_usd: estimatedSavingsUsd,
  };
}

module.exports = {
  recordPromptCacheMetrics,
  getSessionCacheMetrics,
  getCacheEfficiencyStats,
  estimateCostUsd,
  HAIKU_4_5_RATES,
};
