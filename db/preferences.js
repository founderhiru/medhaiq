// db/preferences.js
//
// Data access for the `preferences` table. The table itself already
// existed (created via db/profile-bootstrap.js's ensureUserBootstrap, one
// row per user, guaranteed to exist for every authenticated user) — but no
// route or service anywhere read or wrote it before Account Settings.

const { pool } = require('./index');

async function getPreferences(userId) {
  const result = await pool.query(
    `SELECT theme, email_notifications, product_updates FROM preferences WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  if (result.rows.length === 0) {
    // Defensive fallback only — every user should have a row via
    // ensureUserBootstrap. Matches that function's own column defaults.
    return { theme: 'dark', email_notifications: true, product_updates: true };
  }
  return result.rows[0];
}

async function updatePreferences(userId, { email_notifications, product_updates }) {
  const result = await pool.query(
    `UPDATE preferences
     SET email_notifications = $2, product_updates = $3
     WHERE user_id = $1
     RETURNING theme, email_notifications, product_updates`,
    [userId, !!email_notifications, !!product_updates]
  );
  return result.rows[0];
}

module.exports = { getPreferences, updatePreferences };
