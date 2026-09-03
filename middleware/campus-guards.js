// middleware/campus-guards.js
//
// Deliberately separate from middleware/guards.js (not edited) — Campus
// Ready membership is not a subscription-tier capability, so it doesn't
// belong in the Capability Engine's model. Same "API guards return JSON,
// page guards redirect" contract as guards.js.

const { getUserById } = require('../db/auth');
const { getLearnerForUser } = require('../db/campus');

// API guard — attaches req.user and req.campusLearner.
async function requireCampusLearner(req, res, next) {
  const userId = req.cookies?.user_id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  const user = await getUserById(userId);
  if (!user) return res.status(401).json({ error: 'Session expired' });
  const learner = await getLearnerForUser(user.id);
  if (!learner) return res.status(403).json({ error: 'Not enrolled in a Campus Ready cohort' });
  req.user = user;
  req.campusLearner = learner;
  next();
}

module.exports = { requireCampusLearner };
