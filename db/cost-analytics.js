// Cost analytics DB access — all queries go through here.
// Backs the founder cost dashboard (routes/admin.js).
const { pool } = require('./index');

// NOTE: revenue is NOT derived from config/pricing.js or users.market
// anymore (see getPurchaseRecords/summarizeRevenue/revenueForRange below).
// It comes directly from package_acquisitions.amount_usd — the actual
// Stripe-settled amount captured at purchase time by routes/stripe.js's
// webhook. This was a real, confirmed bug in the previous design: an INR
// ₹999 purchase was being reported as its configured USD list price
// ($19) whenever users.market wasn't set to exactly 'india' — which
// migration 023_users_market's own comment notes is the common case,
// since that column is nullable and never backfilled. See migration
// 029_package_acquisitions_revenue_fields for the schema this replaces it
// with.

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

// Same idea as getActiveFixedCosts, but for a SELECTED (possibly past)
// month: a fixed-cost row added after that month ended must not retroactively
// appear in that month's numbers. effective_date <= monthEnd (not
// CURRENT_DATE) is the only difference.
async function getFixedCostsAsOf(monthEnd) {
  const result = await pool.query(
    `SELECT id, provider, cost_type, amount, currency, billing_period, active, effective_date
     FROM fixed_costs
     WHERE active = true AND effective_date <= $1
     ORDER BY provider`,
    [monthEnd]
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

// Monthly allocation — used for a SELECTED MONTH's fixed-cost figure. A
// monthly-billed row's month cost IS its configured amount directly (no
// slicing needed); yearly/weekly/daily are converted to a monthly
// equivalent. This is what "do not return today's daily slice when showing
// a selected month" means in practice.
function monthlyAllocationUsd(row) {
  const amount = Number(row.amount) || 0;
  if (row.currency !== 'USD') return null;
  switch (row.billing_period) {
    case 'monthly': return amount;
    case 'yearly': return amount / 12;
    case 'weekly': return amount * (365 / 12 / 7);
    case 'daily': return amount * 30;
    default: return amount; // conservative default — documented, not silent
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MONTH SELECTOR ARCHITECTURE — a "month" is always the string 'YYYY-MM'.
// monthRange() turns that into the [start, end) date boundary Postgres
// needs; getAvailableMonths() returns only months where real activity
// exists (cost_analytics rows OR real purchases) — never a fabricated
// list of the last N calendar months.
// ─────────────────────────────────────────────────────────────────────────
function monthRange(monthValue) {
  const [year, month] = (monthValue || '').split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const label = start.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  return { start, end, label };
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function getAvailableMonths() {
  const result = await pool.query(
    `SELECT DISTINCT date_trunc('month', month_start) AS month_start FROM (
       SELECT created_at AS month_start FROM cost_analytics
       UNION ALL
       SELECT acquired_at AS month_start FROM package_acquisitions WHERE source = 'purchase'
     ) activity
     ORDER BY month_start DESC
     LIMIT 12`
  );
  return result.rows.map((row) => {
    const d = new Date(row.month_start);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { value, label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) };
  });
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
// REVENUE — sourced ONLY from package_acquisitions.amount_usd: the actual
// Stripe-settled USD amount captured at purchase time (routes/stripe.js's
// webhook, via the PaymentIntent's Balance Transaction). NEVER derived
// from users.market or config/pricing.js's configured list price — that
// was the previous design, and it was a confirmed bug: an INR ₹999
// purchase was reported as its configured USD list price ($19) whenever
// users.market wasn't exactly 'india', which is the common case since
// that column is nullable and never backfilled (see migration
// 023_users_market's own comment). Fixed by capturing the real
// transaction instead of reconstructing a guess from static config.
//
// source = 'purchase' ONLY — excludes founder-granted access and
// migration-backfill rows, which are real entitlements but not real money.
// This is also what keeps a provider wallet recharge (Vapi/Claude/
// ElevenLabs top-ups) from ever being mistaken for revenue: recharges
// aren't package_acquisitions rows at all, so they can't leak in here.
//
// CURRENCY NOTE: the Founder Dashboard is USD-only for now. amount_usd is
// the one and only figure summed into every revenue total below.
// original_amount/original_currency (e.g. ₹999/INR) are preserved on each
// row and surfaced alongside (never added into) the USD totals, purely
// for visibility today and to support an INR reporting toggle later
// without any further schema change.
//
// UNRESOLVED: a purchase whose amount_usd is still NULL (Stripe's Balance
// Transaction wasn't available yet at webhook time) is excluded from
// every revenue total here — not zeroed, not estimated — and surfaced via
// unresolved_purchase_count so it stays visible rather than silently
// disappearing. See db/package-acquisitions.js's
// getAcquisitionsPendingRevenueReconciliation() for the retry path that
// resolves these.
// ─────────────────────────────────────────────────────────────────────────
async function getPurchaseRecords() {
  const result = await pool.query(
    `SELECT acquired_at, amount_usd, original_amount, original_currency
     FROM package_acquisitions
     WHERE source = 'purchase'`
  );
  return result.rows;
}

// Breakdown of non-USD currencies actually INCLUDED in a USD revenue
// total — i.e. only rows where amount_usd has resolved (Stripe settlement
// captured), grouped by original_currency. Deliberately excludes
// still-pending rows (amount_usd IS NULL): those aren't part of the USD
// figure yet, so describing them as "included" would be false. This is a
// pure read-only aggregate of data already fetched for revenue — it does
// not change amount_usd, does not touch Stripe, reconciliation, or
// schema, and does not affect any USD total anywhere.
function nonUsdIncludedBreakdown(rows, start, end) {
  const map = {};
  for (const row of rows) {
    if (row.amount_usd === null || row.amount_usd === undefined) continue;
    if (!row.original_currency || row.original_currency === 'USD') continue;
    const acquiredAt = new Date(row.acquired_at);
    if (start && acquiredAt < start) continue;
    if (end && acquiredAt >= end) continue;
    const currency = row.original_currency;
    if (!map[currency]) map[currency] = { amount: 0, count: 0 };
    map[currency].amount += Number(row.original_amount) || 0;
    map[currency].count += 1;
  }
  return map; // e.g. { INR: { amount: 699, count: 1 }, EUR: { amount: 25, count: 1 } }
}

function summarizeRevenue(purchaseRows) {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  let revenueTodayUsd = 0, revenueMonthUsd = 0, revenueYtdUsd = 0, revenueTotalUsd = 0;
  let revenueTodayInr = 0, revenueMonthInr = 0, revenueYtdInr = 0, revenueTotalInr = 0;
  let unresolvedCount = 0;

  for (const row of purchaseRows) {
    const acquiredAt = new Date(row.acquired_at);
    const isToday = acquiredAt >= dayStart;
    const isThisMonth = acquiredAt >= monthStart;
    // Jan 1 of the current year through now — "now" is implicit since every
    // row is a real past purchase, never in the future.
    const isYtd = acquiredAt >= yearStart && acquiredAt <= now;

    if (row.amount_usd === null || row.amount_usd === undefined) {
      unresolvedCount++; // pending Stripe reconciliation — never estimated
    } else {
      const amt = Number(row.amount_usd);
      revenueTotalUsd += amt;
      if (isYtd) revenueYtdUsd += amt;
      if (isThisMonth) revenueMonthUsd += amt;
      if (isToday) revenueTodayUsd += amt;
    }

    // Original-currency INR total — informational only, shown alongside
    // (never summed into) the USD figures above. Unchanged: still mixes
    // resolved + pending, same as before — this feeds the existing
    // "kept separate" revenue_note banner only, not the KPI cards, which
    // now use the resolved-only breakdown below instead.
    if (row.original_currency === 'INR' && row.original_amount !== null) {
      const inrAmt = Number(row.original_amount);
      revenueTotalInr += inrAmt;
      if (isYtd) revenueYtdInr += inrAmt;
      if (isThisMonth) revenueMonthInr += inrAmt;
      if (isToday) revenueTodayInr += inrAmt;
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
    // Resolved-only breakdowns — power the KPI cards' "Includes ₹X..."
    // line. Never includes a still-pending purchase.
    revenue_month_non_usd_breakdown: nonUsdIncludedBreakdown(purchaseRows, monthStart, null),
    revenue_ytd_non_usd_breakdown: nonUsdIncludedBreakdown(purchaseRows, yearStart, null),
    revenue_total_non_usd_breakdown: nonUsdIncludedBreakdown(purchaseRows, null, null),
  };
}

// Generalized revenue-for-an-arbitrary-range — same source/rules as
// summarizeRevenue above, but for any [start, end) window, not just
// "now"-relative periods. Powers the selected-month card and Monthly
// Trend. Reuses the SAME purchaseRows already fetched once — no extra DB
// query per month.
function revenueForRange(purchaseRows, start, end) {
  let usd = 0, inr = 0, unresolvedCount = 0;
  for (const row of purchaseRows) {
    const acquiredAt = new Date(row.acquired_at);
    if (acquiredAt < start || acquiredAt >= end) continue;
    if (row.amount_usd === null || row.amount_usd === undefined) {
      unresolvedCount++;
    } else {
      usd += Number(row.amount_usd);
    }
    if (row.original_currency === 'INR' && row.original_amount !== null) {
      inr += Number(row.original_amount);
    }
  }
  const nonUsdBreakdown = nonUsdIncludedBreakdown(purchaseRows, start, end);
  return { usd, inr, unresolved_purchase_count: unresolvedCount, nonUsdBreakdown };
}

// Month-scoped cost ledger — same shape as the existing today/all-time
// queries, parameterized by [start, end) instead of a fixed date_trunc.
// Also fixes a real gap the all-time/today queries don't need: distinguishing
// "ElevenLabs was never wired" (elevenlabs_capture_count = 0, every row is
// genuinely NULL) from "ElevenLabs was captured and happened to sum to
// exactly $0" (capture_count > 0). COUNT(col) in SQL only counts non-NULL
// values, which is exactly this distinction.
async function getMonthScopedLedger(start, end) {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS interviews_count,
       COALESCE(SUM(COALESCE(vapi_cost, 0)), 0)::float AS vapi_cost,
       COUNT(vapi_cost)::int AS vapi_capture_count,
       COALESCE(SUM(COALESCE(claude_cost, 0)), 0)::float AS claude_cost,
       COALESCE(SUM(COALESCE(elevenlabs_cost, 0)), 0)::float AS elevenlabs_cost,
       COUNT(elevenlabs_cost)::int AS elevenlabs_capture_count,
       COALESCE(SUM(COALESCE(duration_minutes, 0)), 0)::float AS interview_minutes
     FROM cost_analytics
     WHERE created_at >= $1 AND created_at < $2`,
    [start, end]
  );
  return result.rows[0];
}

// Full month financial block — revenue, AI cost (Vapi+Claude+ElevenLabs),
// fixed cost, gross/true profit — for one [start, end) window. Used both
// for the selected month's detail cards and, in a loop, for Monthly Trend.
// AI cost is computed as the literal sum of the three provider components,
// so "Claude + Vapi + ElevenLabs (if captured) reconciles with the
// month-level AI cost" holds by construction, not by a separate check.
async function computeMonthFinancials(monthValue, purchaseRows, paidUsersCount) {
  const { start, end, label } = monthRange(monthValue);
  const [ledger, fixedCosts] = await Promise.all([
    getMonthScopedLedger(start, end),
    getFixedCostsAsOf(end),
  ]);

  const revenue = revenueForRange(purchaseRows, start, end);

  const fixedCostRows = fixedCosts.map((row) => ({
    provider: row.provider,
    cost_type: row.cost_type,
    amount: Number(row.amount),
    currency: row.currency,
    billing_period: row.billing_period,
    monthly_allocation_usd: monthlyAllocationUsd(row),
  }));
  const fixedCostUsd = fixedCostRows.reduce((sum, r) => sum + (r.monthly_allocation_usd || 0), 0);

  const elevenlabsCaptured = ledger.elevenlabs_capture_count > 0;
  const vapiCaptured = ledger.vapi_capture_count > 0;
  const aiCost = (vapiCaptured ? ledger.vapi_cost : 0) + ledger.claude_cost + (elevenlabsCaptured ? ledger.elevenlabs_cost : 0);

  const grossProfit = revenue.usd - aiCost;
  const trueProfit = grossProfit - fixedCostUsd;
  const trueMarginPct = revenue.usd > 0 ? (trueProfit / revenue.usd) * 100 : 0;
  const costPerInterview = ledger.interviews_count > 0 ? aiCost / ledger.interviews_count : 0;
  const costPerPaidUser = paidUsersCount > 0 ? aiCost / paidUsersCount : 0;

  const providerBreakdown = [
    { provider: 'Claude', type: 'PAYG', cost_usd: ledger.claude_cost },
    { provider: 'Vapi', type: 'PAYG', cost_usd: vapiCaptured ? ledger.vapi_cost : null },
    { provider: 'ElevenLabs', type: 'PAYG', cost_usd: elevenlabsCaptured ? ledger.elevenlabs_cost : null },
    ...fixedCostRows.map((r) => ({
      provider: r.provider.charAt(0).toUpperCase() + r.provider.slice(1),
      type: 'Fixed',
      cost_usd: r.currency === 'USD' ? r.monthly_allocation_usd : null,
    })),
  ];

  return {
    value: monthValue,
    label,
    revenue_usd: revenue.usd,
    revenue_inr: revenue.inr,
    revenue_non_usd_breakdown: revenue.nonUsdBreakdown,
    vapi_cost: vapiCaptured ? ledger.vapi_cost : null,
    claude_cost: ledger.claude_cost,
    elevenlabs_cost: elevenlabsCaptured ? ledger.elevenlabs_cost : null,
    ai_cost: aiCost,
    fixed_cost: fixedCostUsd,
    gross_profit: grossProfit,
    true_profit: trueProfit,
    true_margin_pct: trueMarginPct,
    interviews_count: ledger.interviews_count,
    interview_minutes: ledger.interview_minutes,
    cost_per_interview: costPerInterview,
    cost_per_paid_user: costPerPaidUser,
    provider_breakdown: providerBreakdown,
    fixed_cost_rows: fixedCostRows,
    unresolved_purchase_count: revenue.unresolved_purchase_count,
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
async function getFounderDashboardStats(selectedMonthValue) {
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

  const [todayLedgerResult, totalLedgerResult, purchaseRows, userCounts, fixedCosts, availableMonths] = await Promise.all([
    todayLedgerQuery,
    totalLedgerQuery,
    getPurchaseRecords(),
    getUserCounts(),
    getActiveFixedCosts(),
    getAvailableMonths(),
  ]);

  const ledger = todayLedgerResult.rows[0];
  const totalLedger = totalLedgerResult.rows[0];
  const revenue = summarizeRevenue(purchaseRows);

  // ── Month selector resolution ──────────────────────────────────────────
  // Only ever picks from real months with activity (availableMonths). If
  // the requested month isn't one of them (bad input, or a brand-new
  // deploy with zero data yet), fall back to the most recent real month,
  // or the current calendar month string if there's no data at all —
  // computeMonthFinancials degrades to all-zero fields safely in that case.
  const resolvedMonthValue = (selectedMonthValue && availableMonths.some((m) => m.value === selectedMonthValue))
    ? selectedMonthValue
    : (availableMonths[0] ? availableMonths[0].value : currentMonthValue());

  const [selectedMonthFinancials, monthlyTrend] = await Promise.all([
    computeMonthFinancials(resolvedMonthValue, purchaseRows, userCounts.paid_users_count),
    Promise.all(availableMonths.map((m) => computeMonthFinancials(m.value, purchaseRows, userCounts.paid_users_count))),
  ]);

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
    revenue_ytd_non_usd_breakdown: revenue.revenue_ytd_non_usd_breakdown,
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
    total_revenue_non_usd_breakdown: revenue.revenue_total_non_usd_breakdown,
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
    // The exact same number the revenue_note text below quotes — exposed
    // here as its own field so the frontend's persistent reconciliation
    // status can read the real value instead of guessing/duplicating it.
    unresolved_purchase_count: revenue.unresolved_purchase_count,
    // Only shown when something is actually actionable (a purchase still
    // pending reconciliation). Once everything is resolved, the Revenue
    // KPI cards' own "Includes ₹X INR — converted to USD at Stripe
    // settlement" line already tells the complete, accurate story — an
    // always-on banner saying INR is "never added" would then read as
    // contradicting that line, even though both are technically true
    // (the ₹ figure itself is never summed with $ — the USD-EQUIVALENT
    // is). Showing it only when there's a real pending count avoids that
    // confusion entirely.
    revenue_note: revenue.unresolved_purchase_count > 0
      ? `${revenue.unresolved_purchase_count} purchase(s) are pending Stripe revenue reconciliation and excluded from every total until resolved.` +
        (revenue.revenue_total_inr > 0 ? ` Original-currency INR total (₹${revenue.revenue_total_inr.toFixed(2)}) is shown for reference only, never added into the USD figures above.` : '')
      : null,

    // ── Selected month (genuinely month-scoped — the core of this feature) ─
    available_months: availableMonths,
    selected_month: { value: selectedMonthFinancials.value, label: selectedMonthFinancials.label },
    month_revenue_usd: selectedMonthFinancials.revenue_usd,
    month_revenue_inr: selectedMonthFinancials.revenue_inr,
    month_revenue_non_usd_breakdown: selectedMonthFinancials.revenue_non_usd_breakdown,
    month_vapi_cost: selectedMonthFinancials.vapi_cost,
    month_claude_cost: selectedMonthFinancials.claude_cost,
    month_elevenlabs_cost: selectedMonthFinancials.elevenlabs_cost,
    month_ai_cost: selectedMonthFinancials.ai_cost,
    month_fixed_cost: selectedMonthFinancials.fixed_cost,
    month_gross_profit: selectedMonthFinancials.gross_profit,
    month_true_profit: selectedMonthFinancials.true_profit,
    month_true_margin_pct: selectedMonthFinancials.true_margin_pct,
    month_interviews_count: selectedMonthFinancials.interviews_count,
    month_interview_minutes: selectedMonthFinancials.interview_minutes,
    month_cost_per_interview: selectedMonthFinancials.cost_per_interview,
    month_cost_per_paid_user: selectedMonthFinancials.cost_per_paid_user,
    month_provider_breakdown: selectedMonthFinancials.provider_breakdown,
    month_fixed_cost_rows: selectedMonthFinancials.fixed_cost_rows,
    month_unresolved_purchase_count: selectedMonthFinancials.unresolved_purchase_count,

    // ── Monthly trend — real months only, never fabricated ────────────────
    monthly_trend: monthlyTrend.map((m) => ({
      value: m.value,
      label: m.label,
      revenue_usd: m.revenue_usd,
      revenue_inr: m.revenue_inr,
      ai_cost: m.ai_cost,
      fixed_cost: m.fixed_cost,
      true_profit: m.true_profit,
      interviews_count: m.interviews_count,
    })),
  };
}

module.exports = {
  upsertCostEntry,
  getFounderDashboardStats,
  getActiveFixedCosts,
  addOrUpdateFixedCost,
  getAvailableMonths,
};
