// db/feedback.js
// Lightweight in-app feedback (5-star + optional comment). Reuses the
// existing user_activity_logs table on purpose — reviewed the schema
// first, and it already has everything this needs: app_user_id, an
// indexed action column, a metadata JSONB field (the app's established
// general-purpose extensible field), and created_at. A dedicated
// user_feedback table would just duplicate that infrastructure, so this
// is deliberately NOT a new table.
const { pool } = require('./index');
const { insertActivityLog } = require('./activity');

const SUPPRESSION_DAYS = 30;

function reqMeta(req) {
  return {
    ipAddress: req?.headers?.['x-forwarded-for']?.split(',')[0].trim() || req?.socket?.remoteAddress || null,
    userAgent: req?.headers?.['user-agent'] || null,
  };
}

// Records a real feedback submission. `feature` is optional and tags which
// part of the app the prompt was triggered from (e.g. 'interview_report'),
// so future trigger points (Resume Intelligence, Dashboard) stay
// distinguishable in the same metadata shape without any schema change.
async function submitFeedback({ userId, rating, comment, feature, req }) {
  const meta = reqMeta(req);
  await insertActivityLog({
    userId,
    action: 'feedback_submitted',
    page: '/interview/report',
    feature: feature || null,
    metadata: { rating: rating || null, comment: (comment || '').slice(0, 500), feature: feature || null },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

// Records a "Not now" dismissal. Uses the same 30-day suppression window
// as a real submission — dismissing also avoids feedback fatigue.
async function dismissFeedbackPrompt({ userId, req }) {
  const meta = reqMeta(req);
  await insertActivityLog({
    userId,
    action: 'feedback_dismissed',
    page: '/interview/report',
    metadata: {},
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

// True if this user has neither submitted nor dismissed feedback in the
// last 30 days — i.e. it's OK to show the prompt again.
async function shouldShowFeedbackPrompt(userId) {
  if (!userId) return false;
  const res = await pool.query(
    `SELECT 1 FROM user_activity_logs
     WHERE app_user_id = $1
       AND action IN ('feedback_submitted', 'feedback_dismissed')
       AND created_at >= NOW() - ($2 || ' days')::interval
     LIMIT 1`,
    [userId, SUPPRESSION_DAYS]
  );
  return res.rows.length === 0;
}

module.exports = { submitFeedback, dismissFeedbackPrompt, shouldShowFeedbackPrompt };
