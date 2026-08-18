// lib/cost-recorder.js
//
// The ONLY place that writes into cost_analytics from a live interview or
// provider event. Both routes/vapi.js and routes/interview.js call into
// this file — neither imports db/cost-analytics.js directly. This keeps
// the interview engine and the Vapi webhook decoupled from dashboard
// storage: they know "an event happened", not "here's how the founder
// dashboard's schema works".
//
//   Interview/provider event -> cost recording service -> cost_analytics
//     -> Founder analytics aggregation (db/cost-analytics.js's
//        getFounderDashboardStats(), read by routes/admin.js)
//
// SAFETY CONTRACT: every function here is fire-and-forget safe. Never
// throws. A cost-recording failure is logged and swallowed — it must NEVER
// cause a candidate's interview to fail, block a Vapi webhook response, or
// delay report/email delivery. Callers do not need to wrap these in their
// own try/catch; it's already done here.
const { upsertCostEntry } = require('../db/cost-analytics');
const { getSessionCacheMetrics } = require('../db/prompt-cache-metrics');

/**
 * Vapi call cost — written once the authoritative `end-of-call-report`
 * webhook event arrives (see routes/vapi.js). Uses SET-latest-wins
 * semantics via upsertCostEntry's COALESCE-on-conflict upsert: if Vapi
 * redelivers the same end-of-call-report (their webhooks are at-least-once
 * delivery, not exactly-once), this writes the same value again — not
 * double-counted. That IS the idempotency mechanism for Vapi; no separate
 * dedupe table is needed.
 */
async function recordVapiCallCost({ interviewId, userId, userPlan, vapiCost, durationMinutes }) {
  if (!interviewId) {
    console.error('[cost-recorder] recordVapiCallCost: missing interviewId — skipping write, nothing to attribute this cost to');
    return;
  }
  if (vapiCost === undefined || vapiCost === null) {
    console.error(`[cost-recorder] recordVapiCallCost: no cost value on end-of-call-report for interview=${interviewId} — skipping write rather than recording a fabricated 0`);
    return;
  }
  try {
    await upsertCostEntry({
      interviewId,
      userId: userId ?? null,
      userPlan: userPlan ?? null,
      vapiCost,
      durationMinutes: durationMinutes ?? null,
    });
    console.log(`[cost-recorder] vapi cost recorded: interview=${interviewId} cost=$${Number(vapiCost).toFixed(4)} duration=${durationMinutes ?? 'n/a'}min`);
  } catch (err) {
    console.error(`[cost-recorder] recordVapiCallCost failed for interview=${interviewId} (non-fatal, interview flow unaffected):`, err.message);
  }
}

/**
 * Claude session cost — RECOMPUTED (never incremented) from the
 * authoritative, append-only prompt_cache_metrics log every time this is
 * called. A session that made 3 Claude calls (question generation, answer
 * scoring, report generation) gets SUM(estimated_cost_usd) across all rows
 * for that session, written as one value.
 *
 * Calling this twice for the same session (e.g. a finalize retry after the
 * idempotency guard in routes/interview.js still lets it through) recomputes
 * the identical sum from the same source rows — naturally idempotent by
 * construction, immune to double-counting, and self-correcting if it's
 * ever called again after more Claude calls landed for that session.
 */
async function recordClaudeSessionCost({ interviewId, userId, userPlan }) {
  if (!interviewId) {
    console.error('[cost-recorder] recordClaudeSessionCost: missing interviewId — skipping write, nothing to attribute this cost to');
    return;
  }
  try {
    const rows = await getSessionCacheMetrics(interviewId);
    if (!rows.length) {
      console.warn(`[cost-recorder] recordClaudeSessionCost: no prompt_cache_metrics rows for interview=${interviewId} — nothing to record (not writing a fabricated 0 over what may already be there)`);
      return;
    }
    const claudeCost = rows.reduce((sum, r) => sum + (Number(r.estimated_cost_usd) || 0), 0);
    await upsertCostEntry({
      interviewId,
      userId: userId ?? null,
      userPlan: userPlan ?? null,
      claudeCost,
    });
    console.log(`[cost-recorder] claude cost recorded: interview=${interviewId} calls=${rows.length} cost=$${claudeCost.toFixed(4)}`);
  } catch (err) {
    console.error(`[cost-recorder] recordClaudeSessionCost failed for interview=${interviewId} (non-fatal, report/email delivery unaffected):`, err.message);
  }
}

module.exports = { recordVapiCallCost, recordClaudeSessionCost };
