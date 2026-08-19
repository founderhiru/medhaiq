// db/founder-feedback.js
// Founder Dashboard read-only queries over the feedback captured in
// user_activity_logs (action = 'feedback_submitted'). No new table —
// see db/feedback.js for the reasoning.
const { pool } = require('./index');

// Compact summary: average rating, total responses, new this week.
// "New this week" stands in deliberately for a reviewed/unread flag —
// not building a stateful review workflow yet, per the beta-stage scope.
async function getFeedbackSummary() {
  const res = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       AVG((metadata->>'rating')::numeric) FILTER (WHERE metadata->>'rating' IS NOT NULL) AS avg_rating,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_this_week
     FROM user_activity_logs
     WHERE action = 'feedback_submitted'`
  );
  const row = res.rows[0];
  return {
    total: row.total,
    averageRating: row.avg_rating !== null ? Math.round(parseFloat(row.avg_rating) * 10) / 10 : null,
    newThisWeek: row.new_this_week,
  };
}

// Latest N feedback entries with a short preview. `offset` added for the
// paginated "View All Feedback" page.
async function getRecentFeedback(limit = 5, offset = 0) {
  const res = await pool.query(
    `SELECT
       al.id, al.created_at, al.metadata,
       u.name AS user_name
     FROM user_activity_logs al
     LEFT JOIN users u ON u.id = al.app_user_id
     WHERE al.action = 'feedback_submitted'
     ORDER BY al.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return res.rows.map(row => ({
    id: row.id,
    createdAt: row.created_at,
    userName: row.user_name || 'Anonymous',
    rating: row.metadata && row.metadata.rating != null ? row.metadata.rating : null,
    comment: (row.metadata && row.metadata.comment) || '',
    feature: (row.metadata && row.metadata.feature) || null,
    // Ties this feedback back to the specific interview it was about
    // (Part 2) — null for older feedback rows submitted before this
    // field existed, or from any future trigger point that doesn't have
    // a session to attach (e.g. general product feedback).
    interviewSessionId: (row.metadata && row.metadata.interview_session_id) || null,
  }));
}

module.exports = { getFeedbackSummary, getRecentFeedback };