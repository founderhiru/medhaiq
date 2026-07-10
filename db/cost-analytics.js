// Cost analytics DB access — all queries go through here.
// Backs the founder cost dashboard (routes/admin.js).
const { pool } = require('./index');

// Plan pricing — keep in sync with actual billing plans.
// Trial is $0; only Professional and Leadership are counted as paying.
const PLAN_PRICES = {
  professional: 15,
  leadership: 35,
};

// Insert or update today's ledger row for an interview. Safe to call multiple
// times for the same interview_id (e.g. Vapi cost lands first, Claude report
// cost lands later) — upserts on interview_id.
async function upsertCostEntry({ userId, interviewId, durationMinutes, vapiCost, claudeCost, userPlan }) {
  const result = await pool.query(
    `INSERT INTO cost_analytics (user_id, interview_id, duration_minutes, vapi_cost, claude_cost, user_plan)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (interview_id) DO UPDATE SET
       duration_minutes = COALESCE(EXCLUDED.duration_minutes, cost_analytics.duration_minutes),
       vapi_cost = COALESCE(EXCLUDED.vapi_cost, cost_analytics.vapi_cost),
       claude_cost = COALESCE(EXCLUDED.claude_cost, cost_analytics.claude_cost),
       user_plan = COALESCE(EXCLUDED.user_plan, cost_analytics.user_plan),
       updated_at = NOW()
     RETURNING *`,
    [
      userId ?? null,
      interviewId,
      durationMinutes ?? 0,
      vapiCost ?? 0,
      claudeCost ?? 0,
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
       COALESCE(SUM(vapi_cost), 0)::float AS todays_vapi_cost,
       COALESCE(SUM(claude_cost), 0)::float AS todays_claude_cost,
       COALESCE(AVG(duration_minutes), 0)::float AS avg_interview_duration,
       COALESCE(AVG(vapi_cost + claude_cost), 0)::float AS avg_cost_per_interview,
       COALESCE(MAX(vapi_cost + claude_cost), 0)::float AS most_expensive_interview_cost
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

  const todaysTotalAiCost = ledger.todays_vapi_cost + ledger.todays_claude_cost;
  const grossProfit = revenueToday - todaysTotalAiCost;
  const todayProfitMarginPct = revenueToday > 0 ? (grossProfit / revenueToday) * 100 : 0;

  return {
    revenue_today: revenueToday,
    monthly_revenue: monthlyRevenue,
    paying_users_count: plans.paying_users_count,
    trial_users_count: plans.trial_users_count,
    new_users_today: plans.new_users_today,
    new_trial_users_today: plans.new_trial_users_today,
    todays_vapi_cost: ledger.todays_vapi_cost,
    todays_claude_cost: ledger.todays_claude_cost,
    todays_total_ai_cost: todaysTotalAiCost,
    gross_profit: grossProfit,
    interviews_today_count: ledger.interviews_today_count,
    avg_interview_duration: ledger.avg_interview_duration,
    avg_cost_per_interview: ledger.avg_cost_per_interview,
    most_expensive_interview_cost: ledger.most_expensive_interview_cost,
    today_profit_margin_pct: todayProfitMarginPct,
  };
}

module.exports = { upsertCostEntry, getFounderDashboardStats, PLAN_PRICES };
