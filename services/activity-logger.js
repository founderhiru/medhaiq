// services/activity-logger.js
// Reusable, fire-and-forget activity logger. Never blocks the response and
// never throws — a logging failure must not break the feature the user is
// actually using.
const { insertActivityLog } = require('../db/activity');

function logUserActivity({ userId, sessionId, action, page, feature, targetId, metadata, req }) {
  const entry = {
    userId,
    sessionId,
    action,
    page,
    feature,
    targetId,
    metadata,
    ipAddress: req?.headers?.['x-forwarded-for']?.split(',')[0].trim() || req?.socket?.remoteAddress || null,
    userAgent: req?.headers?.['user-agent'] || null,
  };
  insertActivityLog(entry).catch(err => {
    console.error('[activity] log failed (non-fatal):', err.message);
  });
}

module.exports = { logUserActivity };