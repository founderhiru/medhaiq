// Dashboard routes — history, report views.
const express = require('express');
const router = express.Router();
const { getUserSessions, getReport, getSession } = require('../db/interview');
// requireAuth now lives in middleware/guards.js — single shared
// implementation, built on the Capability Engine. Previously this file had
// its own copy-pasted version identical to feedback.js/interview.js/resume.js.
const { requireAuth } = require('../middleware/guards');

// GET /api/dashboard/history — user's session history with scores
router.get('/history', requireAuth, async (req, res) => {
  const sessions = await getUserSessions(req.user.id, { limit: 20 });

  // Same fix as server.js's /dashboard/history: explicit null/undefined
  // checks (0 is a valid score, not a missing one) plus Number() coercion
  // (Postgres NUMERIC columns come back as strings via node-postgres).
  const toScoreOrNull = (v) => (v === null || v === undefined || v === '') ? null : Number(v);
  const history = sessions.map(s => ({
    id: s.id,
    personaId: s.persona_id,
    roleTitle: s.role_title,
    experienceLevel: s.experience_level,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    overallScore: toScoreOrNull(s.overall_score),
    status: s.status,
  }));

  // Score trend for chart (last 10)
  const trend = history
    .map(s => s.overallScore)
    .filter(v => typeof v === 'number' && !Number.isNaN(v))
    .slice(0, 10)
    .reverse();

  return res.json({ history, trend });
});

// GET /api/dashboard/report/:sessionId — get report (auth required for in-progress)
router.get('/report/:sessionId', async (req, res) => {
  const report = await getReport(req.params.sessionId);
  if (!report) return res.status(404).json({ error: 'Report not found' });

  // Check if user owns this session (if not auth'd, only show completed reports)
  const session = await getSession(req.params.sessionId);
  const userId = req.cookies?.user_id;

  if (session && session.status === 'completed') {
    // Completed reports are publicly viewable per spec
    return res.json({ report });
  }

  // Draft/pending sessions need auth
  if (userId && session && session.user_id === userId) {
    return res.json({ report });
  }

  if (session && session.status === 'completed') {
    return res.json({ report });
  }

  return res.status(404).json({ error: 'Report not found' });
});

module.exports = router;