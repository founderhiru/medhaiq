// db/founder-stats.js
// Read-only aggregate queries for the Founder Dashboard. Never writes.
// Reuses existing tables only — no new tables besides founder_access.
const { pool } = require('./index');
// Anti-Abuse & Free-Offer Guardrail — merged into this same KPI object
// (rather than a separate dashboard section) so the 3 new counters reuse
// the existing config-driven kpiConfig array, fetch, and auto-refresh in
// views/founder-dashboard.ejs with zero new front-end code.
const { getFreeOfferOverview } = require('./free-offer-claims');
const { getOnlineUsersCount } = require('./presence');

// Section 1 — Executive Snapshot (7 KPI cards + 3 free-offer guardrail counters).
async function getOverviewStats() {
  const [
    totalUsers,
    activeToday,
    betaSignupsToday,
    paidSubscribers,
    interviewsCompleted,
    reportsGenerated,
    freeOffer,
    onlineNow,
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
    // Paid Subscribers — package_acquisitions (Architecture v1.5, ADR-013)
    // is the source of truth here, NOT users.subscription_status/plan.
    // Those legacy columns are never written to by the real purchase flow
    // (routes/stripe.js's createPackageAcquisition only ever touches
    // package_acquisitions/credit_ledger). Explorer's 30-minute welcome
    // grant is deliberately excluded — only a paid package_id counts.
    // COUNT(DISTINCT user_id) so a user with more than one acquisition
    // (e.g. a package plus a Buy More Minutes top-up) is never counted
    // twice.
    pool.query(
      `SELECT COUNT(DISTINCT user_id)::int AS count
       FROM package_acquisitions
       WHERE package_id IN ('growth', 'leadership')
         AND (expires_at IS NULL OR expires_at > NOW())`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM interview_sessions WHERE status = 'completed'`
    ),
    pool.query('SELECT COUNT(*)::int AS count FROM interview_reports'),
    getFreeOfferOverview(),
    getOnlineUsersCount(),
  ]);

  return {
    totalUsers: totalUsers.rows[0].count,
    onlineNow,
    activeUsersToday: activeToday.rows[0].count,
    newBetaSignupsToday: betaSignupsToday.rows[0].count,
    paidSubscribers: paidSubscribers.rows[0].count,
    interviewsCompleted: interviewsCompleted.rows[0].count,
    reportsGenerated: reportsGenerated.rows[0].count,
    welcomeOffersGranted: freeOffer.welcomeOffersGranted,
    restrictedClaims: freeOffer.restrictedClaims,
    suspiciousDevices: freeOffer.suspiciousDevices,
  };
}

// Human-readable labels for the Founder Dashboard's Recent Activity feed
// (Section 2) — presentation only. The raw `action` value is preserved
// unchanged on every returned row; this only adds a derived
// `activityLabel` alongside it. Only covers action values that actually
// exist in user_activity_logs today (confirmed by inspection) —
// interview-completion and purchase events are not currently logged to
// this table at all (services/interview.js and routes/stripe.js don't
// call insertActivityLog for those), and adding that logging would mean
// touching the interview engine / Stripe webhook, both explicitly out of
// scope here. When those are added in a future, separately-approved
// task, they'll need their own entries in this map.
const ACTIVITY_LABELS = {
  login_google: 'Logged in',
  login_password: 'Logged in',
  login_magic_link_verified: 'Logged in',
  signup_password: 'Signed up',
  feedback_submitted: 'Submitted feedback',
  feedback_dismissed: 'Dismissed the feedback prompt',
  welcome_offer_granted: 'Received the welcome offer',
};

function humanizeActivity(row) {
  return ACTIVITY_LABELS[row.action] || row.action;
}

// Section 2 — Recent User Activity. `offset` added for the paginated
// "View All Activity" page; the dashboard's inline preview still just
// calls this with the default offset of 0.
// Joins users for display name/email; falls back gracefully if the actor
// has been deleted (app_user_id ON DELETE SET NULL leaves it null).
async function getRecentActivity(limit = 10, offset = 0) {
  const res = await pool.query(
    `SELECT
       al.id, al.action, al.page, al.feature, al.created_at,
       u.name AS user_name, u.email AS user_email
     FROM user_activity_logs al
     LEFT JOIN users u ON u.id = al.app_user_id
     ORDER BY al.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  // action/page/feature/created_at/user_name/user_email all preserved
  // exactly as before — activityLabel is a pure addition.
  return res.rows.map(row => ({ ...row, activityLabel: humanizeActivity(row) }));
}

// Section 4 — Beta & Subscription Overview.
// Beta counts come straight from `invitations.status` — HISTORICAL only.
// The beta gate has been permanently removed from the auth path
// (db/invitations.js's own header comment confirms getValidInvitation is
// no longer called anywhere) — these are no longer live/current-access
// numbers, just a record of who was ever invited before the gate came
// out. The Founder Dashboard view labels them accordingly ("Historical
// Beta Requests"/"Historical Beta Accepted") rather than removing the
// data or this query — nothing here is deleted, only how it's presented.
async function getBetaAndSubscriptionOverview() {
  const [betaResult, plansResult] = await Promise.all([
    pool.query(`SELECT status, COUNT(*)::int AS count FROM invitations GROUP BY status`),
    // Same source-of-truth fix as paidSubscribers above — package_id from
    // package_acquisitions, not the legacy subscription_plan column
    // (which produced a permanently-empty "No paid subscribers yet" card
    // even when a real customer had genuinely purchased Growth). Explorer
    // excluded — its welcome grant is not a purchase.
    pool.query(
      `SELECT package_id AS plan, COUNT(DISTINCT user_id)::int AS count
       FROM package_acquisitions
       WHERE package_id IN ('growth', 'leadership')
         AND (expires_at IS NULL OR expires_at > NOW())
       GROUP BY package_id
       ORDER BY count DESC`
    ),
  ]);

  const beta = { pending: 0, accepted: 0 };
  betaResult.rows.forEach(row => {
    beta[row.status] = row.count;
  });

  return {
    beta,
    plans: plansResult.rows, // [{ plan: 'growth', count: 1 }, ...] — empty array if none yet
  };
}

// Section 6 — Founder Alerts. Read-only; reuses queries already used
// elsewhere on this dashboard (waitlist review count, activity logs,
// feedback summary) — no new data sources beyond founder-waitlist.js.
async function getFounderAlerts() {
  const { getPendingWaitlistCount } = require('./founder-waitlist');
  const [pendingWaitlistCount, recentActivityResult] = await Promise.all([
    getPendingWaitlistCount(),
    pool.query(`SELECT COUNT(*)::int AS count FROM user_activity_logs WHERE created_at >= NOW() - INTERVAL '24 hours'`),
  ]);
  const { getFeedbackSummary } = require('./founder-feedback');
  const feedbackSummary = await getFeedbackSummary();

  return {
    pendingBetaCount: pendingWaitlistCount,
    newFeedbackCount: feedbackSummary.newThisWeek,
    activityFeedHealthy: recentActivityResult.rows[0].count > 0,
  };
}

module.exports = { getOverviewStats, getRecentActivity, getBetaAndSubscriptionOverview, getFounderAlerts };