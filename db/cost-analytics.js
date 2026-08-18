// Cost analytics DB access — all queries go through here.
// Backs the founder cost dashboard (routes/admin.js).
const { pool } = require('./index');

// Plan pricing — keep in sync with actual billing plans.
// Trial is $0; only Professional and Leadership are counted as paying.
const PLAN_PRICES = {
  professional: 15,
  leadership: 35,
};

// Fixed monthly infrastructure costs — flat bills that exist regardless of
// usage volume. Deliberately separate from AI cost (Vapi/Claude/ElevenLabs),
// which is usage-metered and already tracked per-interview in cost_analytics.
//
// NOTE: Claude API spend is NOT listed here. The Anthropic console balance
// is prepaid credit funding the same token usage already captured in
// cost_analytics.claude_cost — listing it again here would double-count it.
// Vapi and ElevenLabs are both confirmed pay-as-you-go — no fixed line for
// either; their real spend lives in vapi_cost / elevenlabs_cost above.
const FIXED_MONTHLY_COSTS = {
  render: 7,
  supabase: 0,
};
const TOTAL_FIXED_MONTHLY = Object.values(FIXED_MONTHLY_COSTS).reduce((a, b) => a + b, 0);

// Insert or update today's ledger row for an interview. Safe to call multiple
// times for the same interview_id — e.g. Vapi's end-of-call-report cost
// lands first, Claude session cost is aggregated in later at report
// completion. A field left out of a given call is passed as NULL (not 0),
// so COALESCE(EXCLUDED.col, cost_analytics.col) on conflict correctly
// preserves whatever was already recorded for that field — a NULL here
// means "not written by THIS call", never "zero, overwrite what's there".
async function upsertCostEntry({ userId, interviewId, durationMinutes, vapiCost, claudeCost, elevenlabsCost, userPlan }) {
  const result = await pool.query(
    `INSERT INTO cost_analytics (user_id, interview_id, duration_minutes, vapi_cost, claude_cost, elevenlabs_cost, user_plan)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (interview_id) DO UPDATE SET
       user_id = COALESCE(cost_analytics.user_id, EXCLUDED.user_id),
       duration_minutes = COALESCE(EXCLUDED.duration_minutes, cost_analytics.duration_minutes),
       vapi_cost = COALESCE(EXCLUDED.vapi_cost, cost_analytics.vapi_cost),
       claude_cost = COALESCE(EXCLUDED.claude_cost, cost_analytics.claude_cost),
       elevenlabs_cost = COALESCE(EXCLUDED.elevenlabs_cost, cost_analytics.elevenlabs_cost),
       user_plan = COALESCE(EXCLUDED.user_plan, cost_analytics.user_plan),
       updated_at = NOW()
     RETURNING *`,
    [
      userId ?? null,
      interviewId,
      durationMinutes ?? null,
      vapiCost ?? null,
      claudeCost ?? null,
      elevenlabsCost ?? null,
      userPlan ?? null,
    ]
  );
  return result.rows[0];
}

// Aggregated stats for the founder dashboard — today's interview cost ledger
// plus current active-plan counts from the users table.
async function getFounderDashboardStats() {
  const ledgerQuery = pool.query(
    `SELECT
       COUNT(*)::int AS interviews_today_count,
       COALESCE(SUM(COALESCE(vapi_cost, 0)), 0)::float AS todays_vapi_cost,
       COALESCE(SUM(COALESCE(claude_cost, 0)), 0)::float AS todays_claude_cost,
       COALESCE(SUM(COALESCE(elevenlabs_cost, 0)), 0)::float AS todays_elevenlabs_cost,
       COALESCE(AVG(COALESCE(duration_minutes, 0)), 0)::float AS avg_interview_duration,
       COALESCE(AVG(COALESCE(vapi_cost, 0) + COALESCE(claude_cost, 0) + COALESCE(elevenlabs_cost, 0)), 0)::float AS avg_cost_per_interview,
       COALESCE(MAX(COALESCE(vapi_cost, 0) + COALESCE(claude_cost, 0) + COALESCE(elevenlabs_cost, 0)), 0)::float AS most_expensive_interview_cost
     FROM cost_analytics
     WHERE created_at >= date_trunc('day', NOW())
       AND created_at < date_trunc('day', NOW()) + INTERVAL '1 day'`
  );

  const plansQuery = pool.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE LOWER(subscription_plan) = 'professional' AND subscription_status = 'active'
       )::int AS professional_count,
       COUNT(*) FILTER (
         WHERE LOWER(subscription_plan) = 'leadership' AND subscription_status = 'active'
       )::int AS leadership_count,
       COUNT(*) FILTER (
         WHERE LOWER(subscription_plan) IN ('professional', 'leadership') AND subscription_status = 'active'
       )::int AS paying_users_count,
       COUNT(*) FILTER (
         WHERE NOT (LOWER(subscription_plan) IN ('professional', 'leadership') AND subscription_status = 'active')
       )::int AS trial_users_count,
       COUNT(*) FILTER (
         WHERE created_at >= date_trunc('day', NOW())
           AND created_at < date_trunc('day', NOW()) + INTERVAL '1 day'
       )::int AS new_users_today,
       COUNT(*) FILTER (
         WHERE created_at >= date_trunc('day', NOW())
           AND created_at < date_trunc('day', NOW()) + INTERVAL '1 day'
           AND NOT (LOWER(subscription_plan) IN ('professional', 'leadership') AND subscription_status = 'active')
       )::int AS new_trial_users_today
     FROM users`
  );

  const [ledgerResult, plansResult] = await Promise.all([ledgerQuery, plansQuery]);

  const ledger = ledgerResult.rows[0];
  const plans = plansResult.rows[0];

  const monthlyRevenue =
    plans.professional_count * PLAN_PRICES.professional +
    plans.leadership_count * PLAN_PRICES.leadership;

  // "Today's revenue" is approximated as a daily slice of MRR, per spec.
  const revenueToday = monthlyRevenue / 30;

  const todaysTotalAiCost = ledger.todays_vapi_cost + ledger.todays_claude_cost + ledger.todays_elevenlabs_cost;
  const fixedCostsToday = TOTAL_FIXED_MONTHLY / 30;

  // Gross profit/margin stays AI-cost-only — this is the number you're used
  // to reading, unaffected by fixed overhead.
  const grossProfit = revenueToday - todaysTotalAiCost;
  const todayProfitMarginPct = revenueToday > 0 ? (grossProfit / revenueToday) * 100 : 0;

  // Separate ROI view — same profit, minus fixed monthly overhead. Kept as
  // its own set of fields so it never gets mixed into the headline numbers.
  const trueProfitToday = grossProfit - fixedCostsToday;
  const trueMarginPct = revenueToday > 0 ? (trueProfitToday / revenueToday) * 100 : 0;

  return {
    revenue_today: revenueToday,
    monthly_revenue: monthlyRevenue,
    paying_users_count: plans.paying_users_count,
    trial_users_count: plans.trial_users_count,
    new_users_today: plans.new_users_today,
    new_trial_users_today: plans.new_trial_users_today,
    todays_vapi_cost: ledger.todays_vapi_cost,
    todays_claude_cost: ledger.todays_claude_cost,
    todays_elevenlabs_cost: ledger.todays_elevenlabs_cost,
    todays_total_ai_cost: todaysTotalAiCost,
    gross_profit: grossProfit,
    interviews_today_count: ledger.interviews_today_count,
    avg_interview_duration: ledger.avg_interview_duration,
    avg_cost_per_interview: ledger.avg_cost_per_interview,
    most_expensive_interview_cost: ledger.most_expensive_interview_cost,
    today_profit_margin_pct: todayProfitMarginPct,
    // Separate ROI block — fixed overhead included, kept apart from the
    // AI-only numbers above.
    fixed_costs_today: fixedCostsToday,
    true_profit_today: trueProfitToday,
    true_margin_pct: trueMarginPct,
  };
}

module.exports = { upsertCostEntry, getFounderDashboardStats, PLAN_PRICES, FIXED_MONTHLY_COSTS };
