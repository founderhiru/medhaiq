// middleware/campus-guards.js
//
// Deliberately separate from middleware/guards.js (not edited) — Campus
// Ready membership is not a subscription-tier capability, so it doesn't
// belong in the Capability Engine's model. Same "API guards return JSON,
// page guards redirect" contract as guards.js.

const { getUserById } = require('../db/auth');
const { getLearnerForUser } = require('../db/campus');
const { isFounder } = require('../db/founder-access');
const { isInstitutionAdmin } = require('../db/campus-tpo');

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

// Shared resolver — Founder is ALWAYS authorized for every institution
// (same "Founder retains full control" principle as everywhere else in
// the app), via the existing founder_access table. This is not
// impersonation or a bypass flag: it's the identical authorization
// mechanism that already gates /founder and /api/founder/*, just also
// consulted here. A TPO (no founder_access row) is authorized only for
// institutions where they have an explicit campus_institution_admins row.
async function resolveInstitutionAdmin(userId, institutionId) {
  const founder = await isFounder(userId);
  if (founder) return { authorized: true, isFounderOverride: true };
  const admin = await isInstitutionAdmin(userId, institutionId);
  return { authorized: admin, isFounderOverride: false };
}

// API guard for /api/campus/tpo/* — JSON 401/403, same contract as
// requireCampusLearner above.
async function requireInstitutionAdmin(req, res, next) {
  const userId = req.cookies?.user_id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  const user = await getUserById(userId);
  if (!user) return res.status(401).json({ error: 'Session expired' });
  const institutionId = Number(req.params.institutionId);
  if (!institutionId) return res.status(400).json({ error: 'Missing institution id' });
  const { authorized, isFounderOverride } = await resolveInstitutionAdmin(user.id, institutionId);
  if (!authorized) return res.status(403).json({ error: 'Not authorized for this institution' });
  req.user = user;
  req.institutionId = institutionId;
  req.isFounderOverride = isFounderOverride;
  next();
}

// Page guard for /campus/tpo/:institutionId/... — redirect, never JSON,
// same "page guards redirect" contract as middleware/guards.js
// (unmodified) uses for the individual product.
async function requireInstitutionAdminPage(req, res, next) {
  const userId = req.cookies?.user_id;
  if (!userId) return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl));
  const user = await getUserById(userId);
  if (!user) return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl));
  const institutionId = Number(req.params.institutionId);
  if (!institutionId) return res.redirect('/dashboard/history');
  const { authorized, isFounderOverride } = await resolveInstitutionAdmin(user.id, institutionId);
  if (!authorized) return res.redirect('/dashboard/history');
  req.user = user;
  req.institutionId = institutionId;
  req.isFounderOverride = isFounderOverride;
  next();
}

module.exports = { requireCampusLearner, requireInstitutionAdmin, requireInstitutionAdminPage };
