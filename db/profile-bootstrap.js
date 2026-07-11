// db/profile-bootstrap.js
// Creates the default profile/preferences/workspace/career-profile rows for
// a brand-new user. Safe to call more than once — ON CONFLICT DO NOTHING
// means duplicate creation is structurally impossible.
const { pool } = require('./index');

async function ensureUserBootstrap(userId) {
  await pool.query(
    `INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  await pool.query(
    `INSERT INTO preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  await pool.query(
    `INSERT INTO workspaces (user_id, name, is_default)
     SELECT $1, 'My Workspace', true
     WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE user_id = $1)`,
    [userId]
  );
  await pool.query(
    `INSERT INTO career_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

module.exports = { ensureUserBootstrap };