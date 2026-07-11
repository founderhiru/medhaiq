// Admin routes — founder-only cost/revenue dashboard.
// Protected by ADMIN_SECRET env var (same pattern as routes/waitlist.js export).
const express = require('express');
const router = express.Router();
const { getFounderDashboardStats } = require('../db/cost-analytics');
const { createInvitation } = require('../db/invitations');
function requireAdmin(req, res, next) {
  if (process.env.ADMIN_SECRET && req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// GET /api/admin/founder-dashboard — today's revenue/cost snapshot
router.get('/founder-dashboard', requireAdmin, async (_req, res) => {
  try {
    const stats = await getFounderDashboardStats();
    return res.json(stats);
  } catch (err) {
    console.error('[admin] founder-dashboard error:', err);
    return res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});
// POST /api/admin/invitations — invite an email to the private beta
router.post('/invitations', requireAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\n\r@]+@[^\n\r@]+\.[^\n\r@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  try {
    const invite = await createInvitation(email.trim());
    return res.json({ success: true, invite });
  } catch (err) {
    console.error('[admin] create invitation error:', err);
    return res.status(500).json({ error: 'Failed to create invitation' });
  }
});
module.exports = router;
