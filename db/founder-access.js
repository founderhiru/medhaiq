// db/founder-access.js
// Founder Dashboard authorization — reads/writes the standalone
// `founder_access` table only. Deliberately never touches `users`.
const { pool } = require('./index');

// Supported role values. The `role` column is a plain VARCHAR(50) with no
// CHECK constraint, so adding 'super_admin' cost nothing — it's already
// valid to insert. This constant exists purely so any future admin-grant
// UI (Section 3+) has one place to source the dropdown options from.
const FOUNDER_ROLES = ['founder', 'super_admin'];

// Returns the founder_access row for a user, or null if they have none.
async function getFounderAccess(userId) {
  if (!userId) return null;
  const res = await pool.query(
    'SELECT * FROM founder_access WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  return res.rows[0] || null;
}

// Cheap boolean check for middleware use.
async function isFounder(userId) {
  const row = await getFounderAccess(userId);
  return !!row;
}

// Founder-only utility for granting access to another admin later.
// Not exposed via any route yet — call manually (e.g. via a one-off
// script or DB console) until Section 3 (User Management) ships.
async function grantFounderAccess(userId, role = 'founder') {
  const res = await pool.query(
    `INSERT INTO founder_access (user_id, role) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING *`,
    [userId, role]
  );
  return res.rows[0];
}

module.exports = { getFounderAccess, isFounder, grantFounderAccess, FOUNDER_ROLES };
