// db/founder-stats.js
// Read-only aggregate queries for the Founder Dashboard. Never writes.
// Reuses existing tables only — no new tables besides founder_access.
const { pool } = require('./index');

// Section 1 — Executive Snapshot (6 KPI cards).
async function getOverviewStats() {
  const [
    totalUsers,
    activeToday,
    betaSignupsToday,
    paidSubscribers,
    interviewsCompleted,
    reportsGenerated,
  ] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS count FROM users'),
    pool.query(
      `SELECT COUNT(DISTINCT app_user_id)::int AS count
       FROM user_activity_logs
       WHERE app_user_id IS NOT NULL AND created_at >= CURRENT_DATE`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM waitlist WHERE created_at >= CURRENT_DATE`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM users
       WHERE subscription_status = 'active' AND subscription_plan IS NOT NULL`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM interview_sessions WHERE status = 'completed'`
    ),
    pool.query('SELECT COUNT(*)::int AS count FROM interview_reports'),
  ]);

  return {
    totalUsers: totalUsers.rows[0].count,
    activeUsersToday: activeToday.rows[0].count,
    newBetaSignupsToday: betaSignupsToday.rows[0].count,
    paidSubscribers: paidSubscribers.rows[0].count,
    interviewsCompleted: interviewsCompleted.rows[0].count,
    reportsGenerated: reportsGenerated.rows[0].count,
  };
}

// Section 2 — Recent User Activity (latest 10, no pagination yet).
// Joins users for display name/email; falls back gracefully if the actor
// has been deleted (app_user_id ON DELETE SET NULL leaves it null).
async function getRecentActivity(limit = 10) {
  const res = await pool.query(
    `SELECT
       al.id, al.action, al.page, al.feature, al.created_at,
       u.name AS user_name, u.email AS user_email
     FROM user_activity_logs al
     LEFT JOIN users u ON u.id = al.app_user_id
     ORDER BY al.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows;
}

// Section 4 — Beta & Subscription Overview.
// Beta counts come straight from `invitations.status` as it actually
// exists today (pending/accepted only — no invented "rejected" state).
// Plan counts are grouped dynamically from whatever distinct
// subscription_plan values are actually in use (currently 'professional'
// and 'leadership', per db/cost-analytics.js) rather than hardcoding a
// plan list that doesn't match real billing data — if a new plan name
// appears later, it shows up here automatically, nothing to update.
async function getBetaAndSubscriptionOverview() {
  const [betaResult, plansResult] = await Promise.all([
    pool.query(`SELECT status, COUNT(*)::int AS count FROM invitations GROUP BY status`),
    pool.query(
      `SELECT LOWER(subscription_plan) AS plan, COUNT(*)::int AS count
       FROM users
       WHERE subscription_status = 'active' AND subscription_plan IS NOT NULL
       GROUP BY LOWER(subscription_plan)
       ORDER BY count DESC`
    ),
  ]);

  const beta = { pending: 0, accepted: 0 };
  betaResult.rows.forEach(row => {
    beta[row.status] = row.count;
  });

  return {
    beta,
    plans: plansResult.rows, // [{ plan: 'professional', count: 3 }, ...] — empty array if none yet
  };
}

module.exports = { getOverviewStats, getRecentActivity, getBetaAndSubscriptionOverview };
