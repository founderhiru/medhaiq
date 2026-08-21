// Cost analytics DB access — all queries go through here.
// Backs the founder cost dashboard (routes/admin.js).
const { pool } = require('./index');

// Revenue pricing is read directly from config/pricing.js — the same file
// that drives the live pricing page — never a second hardcoded price list.
// If a plan's price changes there, revenue reporting picks it up on next
// deploy with no change needed here. Read-only require; this file is never
// written to.
const { plans: PRICING_PLANS } = require('../config/pricing');
const PACKAGE_PRICE_LOOKUP = PRICING_PLANS.reduce((acc, plan) => {
  acc[plan.id] = plan.price; // { INR, USD }
  return acc;
}, {});

// ─────────────────────────────────────────────────────────────────────────
// FIXED COSTS — now a configurable table (migration 028_fixed_costs),
// replacing the previous hardcoded FIXED_MONTHLY_COSTS object. Adding a new
// fixed-cost line (Stripe fixed fee, domain, email provider, a future Vapi
// platform fee) is a row insert into `fixed_costs` from here forward —
// never a code change.
// ─────────────────────────────────────────────────────────────────────────

async function getActiveFixedCosts() {
  const result = await pool.query(
    `SELECT id, provider, cost_type, amount, currency, billing_period, active, effective_date
     FROM fixed_costs
     WHERE active = true AND effective_date <= CURRENT_DATE
     ORDER BY provider`
  );
  return result.rows;
}

// Daily allocation is an ACCOUNTING SPREAD for reporting purposes only —
// it does not mean the provider actually charges this amount daily. See
// billing_period on each row for the real cadence.
function dailyAllocationUsd(row) {
  const amount = Number(row.amount) || 0;
  if (row.currency !== 'USD') return null; // don't silently mix currencies into a $ figure
  switch (row.billing_period) {
    case 'monthly': return amount / 30;
    case 'yearly': return amount / 365;
    case 'weekly': return amount / 7;
    case 'daily': return amount;
    default: return amount / 30; // conservative default — documented, not silent
  }
}

async function addOrUpdateFixedCost({ provider, costType = 'fixed', amount, currency = 'USD', billingPeriod = 'monthly', active = true, effectiveDate }) {
  const result = await pool.query(
    `INSERT INTO fixed_costs (provider, cost_type, amount, currency, billing_period, active, effective_date)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_DATE))
     RETURNING *`,
    [provider, costType, amount, currency, billingPeriod, active, effectiveDate || null]
  );
  return result.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────
// COST LEDGER WRITE PATH — preserved byte-for-byte from the live version.
// Not touched by Phase 1. Idempotent upsert on interview_id; NULL (not 0)
// for an omitted field so a partial write from one provider never
// overwrites another provider's already-recorded cost. See
// lib/cost-recorder.js for the only callers.
// ─────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────
// REVENUE — sourced from package_acquisitions (the real purchase/
// entitlement ledger), never users.subscription_plan/subscription_status.
// package_acquisitions itself stores no dollar amount, so each row's price
// is resolved via PACKAGE_PRICE_LOOKUP (config/pricing.js) at query time,
// keyed by the purchasing user's market (users.market: 'india' -> INR,
// anything else -> USD, matching lib/pricing-market.js's own fallback).
//
// source = 'purchase' ONLY — excludes founder-granted access and
// migration-backfill rows, which are real entitlements but not real money.
// This is also what keeps a provider wallet recharge (Vapi/Claude/
// ElevenLabs top-ups) from ever being mistaken for revenue: recharges
// aren't package_acquisitions rows at all, so they can't leak in here.
//
// CURRENCY NOTE: INR and USD are NEVER summed together. INR revenue is
// tracked and returned as its own field, not converted at a fabricated
// exchange rate. See getFounderDashboardStats' revenue_note field.
// ─────────────────────────────────────────────────────────────────────────
async function getPurchaseRecords() {
  const result = await pool.query(
    `SELECT pa.package_id, pa.acquired_at, pa.user_id, COALESCE(u.market, 'international') AS market
     FROM package_acquisitions pa
     JOIN users u ON u.id = pa.user_id
     WHERE pa.source = 'purchase'`
  );
  return result.rows;
}

function priceForPurchase(row) {
  const priceObj = PACKAGE_PRICE_LOOKUP[row.package_id];
  if (!priceObj) return null; // unknown package_id — don't fabricate a price
  const currency = row.market === 'india' ? 'INR' : 'USD';
  const amount = priceObj[currency];
  if (amount === undefined || amount === null) return null;
  return { amount, currency };
}

function summarizeRevenue(purchaseRows) {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  let revenueTodayUsd = 0, revenueTodayInr = 0;
  let revenueMonthUsd = 0, revenueMonthInr = 0;
  let revenueYtdUsd = 0, revenueYtdInr = 0;
  let revenueTotalUsd = 0, revenueTotalInr = 0;
  let unresolvedCount = 0;

  for (const row of purchaseRows) {
    const priced = priceForPurchase(row);
    if (!priced) { unresolvedCount++; continue; }
    const acquiredAt = new Date(row.acquired_at);
    const isToday = acquiredAt >= dayStart;
    const isThisMonth = acquiredAt >= monthStart;
    // Jan 1 of the current year through now — "now" is implicit since every
    // row is a real past purchase, never in the future.
    const isYtd = acquiredAt >= yearStart && acquiredAt <= now;

    if (priced.currency === 'USD') {
      revenueTotalUsd += priced.amount;
      if (isYtd) revenueYtdUsd += priced.amount;
      if (isThisMonth) revenueMonthUsd += priced.amount;
      if (isToday) revenueTodayUsd += priced.amount;
    } else {
      revenueTotalInr += priced.amount;
      if (isYtd) revenueYtdInr += priced.amount;
      if (isThisMonth) revenueMonthInr += priced.amount;
      if (isToday) revenueTodayInr += priced.amount;
    }
  }

  return {
    revenue_today_usd: revenueTodayUsd,
    revenue_today_inr: revenueTodayInr,
    revenue_month_usd: revenueMonthUsd,
    revenue_month_inr: revenueMonthInr,
    revenue_ytd_usd: revenueYtdUsd,
    revenue_ytd_inr: revenueYtdInr,
    revenue_total_usd: revenueTotalUsd,
    revenue_total_inr: revenueTotalInr,
    unresolved_purchase_count: unresolvedCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PAID USER COUNT — from package_acquisitions (currently active, non-
// explorer package), not users.subscription_plan. Distinct user_id, so
// multiple acquisitions for the same user never inflate the count.
// ─────────────────────────────────────────────────────────────────────────
async function getUserCounts() {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM users) AS total_users,
       (SELECT COUNT(DISTINCT user_id)::int FROM package_acquisitions
          WHERE package_id != 'explorer' AND (expires_at IS NULL OR expires_at > NOW())
       ) AS paid_users_count,
       (SELECT COUNT(*)::int FROM users
          WHERE created_at >= date_trunc('day', NOW()) AND created_at < date_trunc('day', NOW()) + INTERVAL '1 day'
       ) AS new_users_today,
       (SELECT COUNT(*)::int FROM users u
          WHERE u.created_at >= date_trunc('day', NOW()) AND u.created_at < date_trunc('day', NOW()) + INTERVAL '1 day'
            AND NOT EXISTS (
              SELECT 1 FROM package_acquisitions pa
              WHERE pa.user_id = u.id AND pa.package_id != 'explorer' AND (pa.expires_at IS NULL OR pa.expires_at > NOW())
            )
       ) AS new_trial_users_today`
  );
  return result.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────
// FOUNDER DASHBOARD AGGREGATE — today's ledger (unchanged query shape from
// the live version) + all-time ledger totals (new) + fixed costs from the
// DB (new) + revenue from real purchases (new, replaces the old MRR/30
// approximation entirely). All existing dashboard-compatible field names
// are preserved so the current founder-dashboard.html keeps working
// unmodified.
// ─────────────────────────────────────────────────────────────────────────
async function getFounderDashboardStats() {
  const todayLedgerQuery = pool.query(
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

  // All-time ledger — no date filter. Backs the new "Total" metrics,
  // distinct from the existing "Today's" ones.
  const totalLedgerQuery = pool.query(
    `SELECT
       COUNT(*)::int AS interviews_total_count,
       COALESCE(SUM(COALESCE(vapi_cost, 0)), 0)::float AS total_vapi_cost,
       COALESCE(SUM(COALESCE(claude_cost, 0)), 0)::float AS total_claude_cost,
       COALESCE(SUM(COALESCE(elevenlabs_cost, 0)), 0)::float AS total_elevenlabs_cost,
       COALESCE(SUM(COALESCE(duration_minutes, 0)), 0)::float AS total_interview_minutes
     FROM cost_analytics`
  );

  const [todayLedgerResult, totalLedgerResult, purchaseRows, userCounts, fixedCosts] = await Promise.all([
    todayLedgerQuery,
    totalLedgerQuery,
    getPurchaseRecords(),
    getUserCounts(),
    getActiveFixedCosts(),
  ]);

  const ledger = todayLedgerResult.rows[0];
  const totalLedger = totalLedgerResult.rows[0];
  const revenue = summarizeRevenue(purchaseRows);

  // Fixed costs — from the DB now, not a hardcoded object. Only USD rows
  // roll into the dollar totals below (see dailyAllocationUsd); a non-USD
  // fixed cost would need its own explicit handling, not silent conversion.
  const fixedCostRows = fixedCosts.map((row) => ({
    provider: row.provider,
    cost_type: row.cost_type,
    amount: Number(row.amount),
    currency: row.currency,
    billing_period: row.billing_period,
    daily_allocation_usd: dailyAllocationUsd(row),
  }));
  const fixedCostsTodayUsd = fixedCostRows.reduce((sum, r) => sum + (r.daily_allocation_usd || 0), 0);
  const totalMonthlyFixedUsd = fixedCostRows
    .filter((r) => r.currency === 'USD')
    .reduce((sum, r) => sum + (r.billing_period === 'monthly' ? r.amount : (r.daily_allocation_usd || 0) * 30), 0);

  // ── Today ──────────────────────────────────────────────────────────────
  const todaysTotalAiCost = ledger.todays_vapi_cost + ledger.todays_claude_cost + ledger.todays_elevenlabs_cost;
  const grossProfitToday = revenue.revenue_today_usd - todaysTotalAiCost;
  const todayProfitMarginPct = revenue.revenue_today_usd > 0 ? (grossProfitToday / revenue.revenue_today_usd) * 100 : 0;
  const trueProfitToday = grossProfitToday - fixedCostsTodayUsd;
  const trueMarginPctToday = revenue.revenue_today_usd > 0 ? (trueProfitToday / revenue.revenue_today_usd) * 100 : 0;

  // ── All-time ("Total") ────────────────────────────────────────────────
  const totalAiCost = totalLedger.total_vapi_cost + totalLedger.total_claude_cost + totalLedger.total_elevenlabs_cost;
  const totalGrossProfit = revenue.revenue_total_usd - totalAiCost;
  const totalGrossMarginPct = revenue.revenue_total_usd > 0 ? (totalGrossProfit / revenue.revenue_total_usd) * 100 : 0;
  const totalTrueProfit = totalGrossProfit - totalMonthlyFixedUsd; // lifetime fixed cost isn't tracked (no MedhaIQ start date basis); shown as one period's worth, documented limitation
  const totalTrueMarginPct = revenue.revenue_total_usd > 0 ? (totalTrueProfit / revenue.revenue_total_usd) * 100 : 0;
  const costPerInterviewTotal = totalLedger.interviews_total_count > 0 ? totalAiCost / totalLedger.interviews_total_count : 0;
  const costPerPaidUser = userCounts.paid_users_count > 0 ? totalAiCost / userCounts.paid_users_count : 0;

  // ── Provider breakdown table (today-scoped costs; fixed costs shown at
  // their configured recurring amount, not a daily slice) ────────────────
  const providerBreakdown = [
    { provider: 'Claude', type: 'PAYG', usage: null, cost_usd: ledger.todays_claude_cost },
    { provider: 'Vapi', type: 'PAYG', usage: null, cost_usd: ledger.todays_vapi_cost },
    { provider: 'ElevenLabs', type: 'PAYG', usage: null, cost_usd: ledger.todays_elevenlabs_cost === 0 ? null : ledger.todays_elevenlabs_cost },
    ...fixedCostRows.map((r) => ({
      provider: r.provider.charAt(0).toUpperCase() + r.provider.slice(1),
      type: 'Fixed',
      usage: r.billing_period,
      cost_usd: r.currency === 'USD' ? r.amount : null,
    })),
  ];

  return {
    // ── Today ──
    revenue_today: revenue.revenue_today_usd,
    revenue_today_inr: revenue.revenue_today_inr,
    monthly_revenue: revenue.revenue_month_usd,
    monthly_revenue_inr: revenue.revenue_month_inr,
    revenue_ytd_usd: revenue.revenue_ytd_usd,
    revenue_ytd_inr: revenue.revenue_ytd_inr,
    paying_users_count: userCounts.paid_users_count,
    trial_users_count: Math.max(0, userCounts.total_users - userCounts.paid_users_count),
    new_users_today: userCounts.new_users_today,
    new_trial_users_today: userCounts.new_trial_users_today,
    todays_vapi_cost: ledger.todays_vapi_cost,
    todays_claude_cost: ledger.todays_claude_cost,
    todays_elevenlabs_cost: ledger.todays_elevenlabs_cost,
    todays_total_ai_cost: todaysTotalAiCost,
    gross_profit: grossProfitToday,
    interviews_today_count: ledger.interviews_today_count,
    avg_interview_duration: ledger.avg_interview_duration,
    avg_cost_per_interview: ledger.avg_cost_per_interview,
    most_expensive_interview_cost: ledger.most_expensive_interview_cost,
    today_profit_margin_pct: todayProfitMarginPct,
    fixed_costs_today: fixedCostsTodayUsd,
    true_profit_today: trueProfitToday,
    true_margin_pct: trueMarginPctToday,

    // ── Total / lifetime ──
    total_revenue_usd: revenue.revenue_total_usd,
    total_revenue_inr: revenue.revenue_total_inr,
    total_ai_cost: totalAiCost,
    total_fixed_cost_monthly: totalMonthlyFixedUsd,
    total_gross_profit: totalGrossProfit,
    total_gross_margin_pct: totalGrossMarginPct,
    total_true_profit: totalTrueProfit,
    total_true_margin_pct: totalTrueMarginPct,
    interviews_total_count: totalLedger.interviews_total_count,
    total_interview_minutes: totalLedger.total_interview_minutes,
    cost_per_interview_total: costPerInterviewTotal,
    cost_per_paid_user: costPerPaidUser,

    // ── Breakdown & limitations ──
    provider_breakdown: providerBreakdown,
    fixed_cost_rows: fixedCostRows,
    revenue_note: revenue.unresolved_purchase_count > 0 || revenue.revenue_total_inr > 0
      ? `INR revenue (₹${revenue.revenue_total_inr.toFixed(2)} total) is tracked separately, not converted into the USD figures above.` +
        (revenue.unresolved_purchase_count > 0 ? ` ${revenue.unresolved_purchase_count} purchase row(s) reference an unknown package_id and were excluded.` : '')
      : null,
  };
}

module.exports = {
  upsertCostEntry,
  getFounderDashboardStats,
  getActiveFixedCosts,
  addOrUpdateFixedCost,
  PACKAGE_PRICE_LOOKUP,
};
