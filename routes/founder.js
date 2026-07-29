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
const { getPendingWaitlistEntries } = require('../db/founder-waitlist');
const { listUsers } = require('../db/founder-users');
const { reassignPackage } = require('../db/package-acquisitions');
const { PRODUCT_PACKAGES } = require('../config/product-packages');
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

// GET /api/founder/activity — Recent Activity (latest 5, scrollable box;
// pagination/"View All Activity" is a later phase per the sequencing plan)
router.get('/activity', requireFounder, async (_req, res) => {
  try {
    const activity = await getRecentActivity(5);
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

// PATCH /api/founder/users/:id/package — User Package Management (MVP).
// Persists through package_acquisitions ONLY (Architecture v1.5, ADR-013)
// — never touches users.subscription_plan, never introduces a
// subscription_tier column. Ends the user's current active acquisition
// and creates a new one in a single transaction (db/package-acquisitions.js
// :: reassignPackage), preserving full history rather than overwriting
// anything. Because every capability-dependent surface (Dashboard pill,
// Settings, route guards) already resolves the active package fresh on
// every request with no caching layer, the change is visible everywhere
// the instant this commits — nothing else needs to be told about it.
router.patch('/users/:id/package', requireFounder, async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const packageId = req.body && req.body.packageId;
    if (!targetUserId || !PRODUCT_PACKAGES[packageId]) {
      return res.status(400).json({ error: 'A valid user and package are required' });
    }
    const includedMinutes = PRODUCT_PACKAGES[packageId].entitlements.includedMinutes;
    const acquisition = await reassignPackage({
      userId: targetUserId,
      packageId,
      grantedBy: req.user.id,
      initialMinutes: includedMinutes,
    });
    return res.json({ success: true, package: { id: acquisition.package_id } });
  } catch (err) {
    console.error('[founder] package reassignment error:', err);
    return res.status(500).json({ error: 'Failed to update package' });
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

// POST /api/founder/waitlist-approve — "Approve Beta Users" Quick Action.
// Approving a pending beta request (a waitlist signup with no invitation
// yet) just creates an invitation for that email — the exact same
// mechanism as "Add to Beta Allowlist". Once the invitation exists, this
// entry stops appearing in getPendingWaitlistEntries() automatically —
// no separate "reviewed" flag needed.
router.post('/waitlist-approve', requireFounder, async (req, res) => {
  const { email } = req.body || {};
  if (!email || !/^[^\n\r@]+@[^\n\r@]+\.[^\n\r@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  try {
    const invite = await createInvitation(email.trim(), req.user.id);
    return res.json({ success: true, invite });
  } catch (err) {
    console.error('[founder] waitlist approve error:', err);
    return res.status(500).json({ error: 'Failed to approve request' });
  }
});

module.exports = router;