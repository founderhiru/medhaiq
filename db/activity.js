// db/activity.js
const { pool } = require('./index');

async function insertActivityLog(entry) {
  await pool.query(
    `INSERT INTO user_activity_logs
       (user_id, session_id, action, page, feature, target_id, metadata, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      entry.userId || null,
      entry.sessionId || null,
      entry.action,
      entry.page || null,
      entry.feature || null,
      entry.targetId || null,
      JSON.stringify(entry.metadata || {}),
      entry.ipAddress || null,
      entry.userAgent || null,
    ]
  );
}

module.exports = { insertActivityLog };