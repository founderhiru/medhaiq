// db/presence.js
//
// Founder Dashboard "Online Now" — lightweight presence, backed by the
// user_presence table (migration 027). One row per user, UPSERTed on
// every heartbeat, never grown into a log. Deliberately separate from
// user_activity_logs (see migration 027's comment) — this module owns
// "is this user here right now", not "what did they do historically".
const { pool } = require('./index');

const ONLINE_WINDOW_SECONDS = 90;

/**
 * Records/refreshes a single user's presence row. Called by
 * POST /api/presence/heartbeat roughly every 30s from an authenticated
 * client — see routes/presence.js. page/activity are short, human-
 * readable strings only (e.g. a pathname or a simple label) — never
 * free-form user input, never IP/location/fingerprinting.
 */
async function recordHeartbeat({ userId, page, activity }) {
  await pool.query(
    `INSERT INTO user_presence (user_id, last_seen_at, current_page, current_activity)
     VALUES ($1, NOW(), $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET last_seen_at = NOW(), current_page = $2, current_activity = $3`,
    [userId, (page || '').slice(0, 255), (activity || '').slice(0, 255)]
  );
}

/** Count of distinct users with a heartbeat inside the online window. */
async function getOnlineUsersCount() {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS count FROM user_presence
     WHERE last_seen_at > NOW() - ($1 || ' seconds')::interval`,
    [ONLINE_WINDOW_SECONDS]
  );
  return res.rows[0].count;
}

/**
 * Full rows for the "Who's Online Now" section — name, page, activity,
 * and last-seen — most recently active first. Package is resolved by the
 * caller (db/package-acquisitions.js's getActivePackageAcquisitionsForUsers),
 * not duplicated here, so there's exactly one place that decides what
 * package a user is on.
 */
async function getOnlineUsers() {
  const res = await pool.query(
    `SELECT up.user_id, up.last_seen_at, up.current_page, up.current_activity,
            u.name, u.email
     FROM user_presence up
     JOIN users u ON u.id = up.user_id
     WHERE up.last_seen_at > NOW() - ($1 || ' seconds')::interval
     ORDER BY up.last_seen_at DESC`,
    [ONLINE_WINDOW_SECONDS]
  );
  return res.rows;
}

module.exports = { recordHeartbeat, getOnlineUsersCount, getOnlineUsers, ONLINE_WINDOW_SECONDS };
