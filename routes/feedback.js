// routes/feedback.js — lightweight in-app feedback (5-star + optional
// comment). Reuses user_activity_logs via db/feedback.js — no new table.
const express = require('express');
const router = express.Router();
const { getUserById } = require('../db/auth');
const { submitFeedback, dismissFeedbackPrompt } = require('../db/feedback');

// Same cookie-auth pattern used across the rest of the app.
async function requireAuth(req, res, next) {
  const userId = req.cookies?.user_id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  const user = await getUserById(userId);
  if (!user) return res.status(401).json({ error: 'Session expired' });
  req.user = user;
  next();
}

// POST /api/feedback — submit a rating (1-5), optional short comment, and
// an optional feature tag (which part of the app triggered the prompt).
router.post('/', requireAuth, async (req, res) => {
  const { rating, comment, feature } = req.body || {};
  const numericRating = Number(rating);
  if (!numericRating || numericRating < 1 || numericRating > 5) {
    return res.status(400).json({ error: 'A rating from 1 to 5 is required' });
  }
  try {
    await submitFeedback({ userId: req.user.id, rating: numericRating, comment: comment || '', feature: feature || null, req });
    return res.json({ success: true });
  } catch (err) {
    console.error('[feedback] submit error:', err);
    return res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// POST /api/feedback/dismiss — "Not now". Suppresses the prompt for the
// same 30-day window as a real submission, to avoid feedback fatigue.
router.post('/dismiss', requireAuth, async (req, res) => {
  try {
    await dismissFeedbackPrompt({ userId: req.user.id, req });
    return res.json({ success: true });
  } catch (err) {
    console.error('[feedback] dismiss error:', err);
    return res.status(500).json({ error: 'Failed to dismiss' });
  }
});

module.exports = router;
