// db/founder-users.js
// Read-only user list for Founder Dashboard → Section 3 (User Management).
// Last Login is deliberately NOT a users.last_login column — it's derived
// from the login events routes/auth.js already logs via
// services/activity-logger.js. Approved explicitly: don't duplicate data
// the activity log already tracks (see conversation history).
const { pool } = require('./index');

const LOGIN_ACTIONS = ['login_google', 'login_password', 'login_magic_link_verified'];

// Simple, bounded search/list — no advanced CRM functionality per spec.
async function listUsers({ search = '', limit = 25, offset = 0 } = {}) {
  const searchTerm = `%${search.trim().toLowerCase()}%`;
  const res = await pool.query(
    `SELECT
       u.id, u.name, u.email, u.subscription_plan, u.subscription_status, u.created_at,
       (SELECT MAX(al.created_at) FROM user_activity_logs al
          WHERE al.app_user_id = u.id AND al.action = ANY($3::text[])) AS last_login,
       (SELECT COUNT(*) FROM interview_sessions s
          WHERE s.user_id = u.id AND s.status = 'completed') AS interviews_completed
     FROM users u
     WHERE ($1 = '' OR LOWER(u.name) LIKE $2 OR LOWER(u.email) LIKE $2)
     ORDER BY u.created_at DESC
     LIMIT $4 OFFSET $5`,
    [search.trim(), searchTerm, LOGIN_ACTIONS, limit, offset]
  );
  return res.rows;
}

module.exports = { listUsers };
