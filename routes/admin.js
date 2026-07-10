// Admin routes — founder-only cost/revenue dashboard.
// Protected by ADMIN_SECRET env var (same pattern as routes/waitlist.js export).
const express = require('express');
const router = express.Router();
const { getFounderDashboardStats } = require('../db/cost-analytics');

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

module.exports = router;
