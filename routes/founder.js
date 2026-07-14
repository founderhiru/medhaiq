// routes/founder.js — Founder Dashboard (Super Admin) API.
// Separate from routes/admin.js (which stays untouched — that's the
// existing ADMIN_SECRET-header Cost Analytics dashboard). This is a new,
// logged-in-user-based surface, authorized via the founder_access table.
const express = require('express');
const router = express.Router();
const { getUserById } = require('../db/auth');
const { isFounder } = require('../db/founder-access');
const { getOverviewStats, getRecentActivity, getBetaAndSubscriptionOverview, getFounderAlerts } = require('../db/founder-stats');
const { getFeedbackSummary, getRecentFeedback } = require('../db/founder-feedback');
const { listUsers } = require('../db/founder-users');
const { createInvitation } = require('../db/invitations');

// Same shape as requireAuth in routes/dashboard.js, plus a founder check.
// Never trusts anything from the client except the cookie's user id —
// role is re-checked against the DB on every request.
async function requireFounder(req, res, next) {
  const userId = req.cookies?.user_id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  const user = await getUserById(userId);
  if (!user) return res.status(401).json({ error: 'Session expired' });
  const founder = await isFounder(user.id);
  if (!founder) return res.status(403).json({ error: 'Forbidden' });
  req.user = user;
  next();
}

// GET /api/founder/overview — Section 1 KPI cards
router.get('/overview', requireFounder, async (_req, res) => {
  try {
    const stats = await getOverviewStats();
    return res.json(stats);
  } catch (err) {
    console.error('[founder] overview error:', err);
    return res.status(500).json({ error: 'Failed to load overview stats' });
  }
});

// GET /api/founder/activity — Section 2 recent activity (latest 10 only;
// pagination/"View All Activity" is a later phase per the sequencing plan)
router.get('/activity', requireFounder, async (_req, res) => {
  try {
    const activity = await getRecentActivity(10);
    return res.json({ activity });
  } catch (err) {
    console.error('[founder] activity error:', err);
    return res.status(500).json({ error: 'Failed to load recent activity' });
  }
});

// GET /api/founder/users — Section 3 User Management (searchable list)
router.get('/users', requireFounder, async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const users = await listUsers({ search, limit: 25 });
    return res.json({ users });
  } catch (err) {
    console.error('[founder] users error:', err);
    return res.status(500).json({ error: 'Failed to load users' });
  }
});

// POST /api/founder/invitations — Quick Actions "Invite User".
// Reuses the exact same db/invitations.js:createInvitation function that
// routes/admin.js already calls — just authorized via the founder's
// logged-in session instead of the ADMIN_SECRET header, so it's usable
// directly from the dashboard UI.
router.post('/invitations', requireFounder, async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\n\r@]+@[^\n\r@]+\.[^\n\r@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  try {
    const invite = await createInvitation(email.trim(), req.user.id);
    return res.json({ success: true, invite });
  } catch (err) {
    console.error('[founder] create invitation error:', err);
    return res.status(500).json({ error: 'Failed to create invitation' });
  }
});

// GET /api/founder/beta-overview — Section 4 Beta & Subscription Overview
router.get('/beta-overview', requireFounder, async (_req, res) => {
  try {
    const overview = await getBetaAndSubscriptionOverview();
    return res.json(overview);
  } catch (err) {
    console.error('[founder] beta-overview error:', err);
    return res.status(500).json({ error: 'Failed to load beta/subscription overview' });
  }
});

// GET /api/founder/feedback — Feedback & Alerts, left column
router.get('/feedback', requireFounder, async (_req, res) => {
  try {
    const [summary, recent] = await Promise.all([getFeedbackSummary(), getRecentFeedback(5)]);
    return res.json({ summary, recent });
  } catch (err) {
    console.error('[founder] feedback error:', err);
    return res.status(500).json({ error: 'Failed to load feedback' });
  }
});

// GET /api/founder/alerts — Feedback & Alerts, right column
router.get('/alerts', requireFounder, async (_req, res) => {
  try {
    const alerts = await getFounderAlerts();
    return res.json(alerts);
  } catch (err) {
    console.error('[founder] alerts error:', err);
    return res.status(500).json({ error: 'Failed to load alerts' });
  }
});

module.exports = router;
