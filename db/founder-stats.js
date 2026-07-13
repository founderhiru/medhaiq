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

module.exports = { getOverviewStats, getRecentActivity };
