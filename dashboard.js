// Dashboard routes — history, report views.
const express = require('express');
const router = express.Router();
const { getUserById } = require('../db/auth');
const { getUserSessions, getReport, getSession } = require('../db/interview');

// Middleware
async function requireAuth(req, res, next) {
  const userId = req.cookies?.user_id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  const user = await getUserById(userId);
  if (!user) return res.status(401).json({ error: 'Session expired' });
  req.user = user;
  next();
}

// GET /api/dashboard/history — user's session history with scores
router.get('/history', requireAuth, async (req, res) => {
  const sessions = await getUserSessions(req.user.id, { limit: 20 });

  const history = sessions.map(s => ({
    id: s.id,
    personaId: s.persona_id,
    roleTitle: s.role_title,
    experienceLevel: s.experience_level,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    overallScore: s.overall_score || s.report_score || null,
    status: s.status,
  }));

  // Score trend for chart (last 10)
  const trend = history
    .filter(s => s.overallScore !== null)
    .slice(0, 10)
    .reverse()
    .map(s => s.overallScore);

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