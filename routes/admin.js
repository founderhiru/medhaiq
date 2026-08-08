// Admin routes — founder-only cost/revenue dashboard.
// Protected by ADMIN_SECRET env var (same pattern as routes/waitlist.js export).
const express = require('express');
const router = express.Router();
const { getFounderDashboardStats } = require('../db/cost-analytics');
const { createInvitation } = require('../db/invitations');
const { getCacheEfficiencyStats, getSessionCacheMetrics } = require('../db/prompt-cache-metrics');
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
// GET /api/admin/prompt-cache-stats — Phase 2F-A cache efficiency snapshot
// (?days=N, default 7). Aggregate hit rate + estimated savings for the
// founder dashboard. Purely additive — reads from prompt_cache_metrics
// only, no interaction with the interview engine.
router.get('/prompt-cache-stats', requireAdmin, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 7));
    const stats = await getCacheEfficiencyStats(days);
    return res.json(stats);
  } catch (err) {
    console.error('[admin] prompt-cache-stats error:', err);
    return res.status(500).json({ error: 'Failed to load prompt cache stats' });
  }
});
// GET /api/admin/prompt-cache-stats/session/:sessionId — turn-by-turn rows
// for one session (used by the Phase 2F-A benchmark report).
router.get('/prompt-cache-stats/session/:sessionId', requireAdmin, async (req, res) => {
  try {
    const rows = await getSessionCacheMetrics(req.params.sessionId);
    return res.json({ sessionId: req.params.sessionId, turns: rows });
  } catch (err) {
    console.error('[admin] prompt-cache-stats/session error:', err);
    return res.status(500).json({ error: 'Failed to load session cache metrics' });
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
