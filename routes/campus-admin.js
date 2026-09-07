// routes/campus-admin.js — Campus Ready V1 founder/admin API.
//
// Deliberately its own file, not an addition to routes/founder.js's
// existing 300+ lines — keeps Campus Ready reviewable and revertible as
// one unit. requireFounder here is a duplicate of the one already private
// to routes/founder.js (same shape, same tables) rather than an import,
// so this file has zero coupling to founder.js internals.

const express = require('express');
const router = express.Router();
const { getUserById, findOrCreateUser } = require('../db/auth');
const { isFounder } = require('../db/founder-access');
const {
  createInstitution, listInstitutions, getInstitution,
  createCohort, listCohortsForInstitution, getCohort,
  createLearnerInvite, getCohortAnalytics,
} = require('../db/campus');
const { grantInstitutionAdmin, listInstitutionAdmins } = require('../db/campus-tpo');

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

router.use(requireFounder);

router.get('/institutions', async (req, res) => {
  res.json({ institutions: await listInstitutions() });
});

router.post('/institutions', async (req, res) => {
  const { name, contactName, contactEmail } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const institution = await createInstitution({ name, contactName, contactEmail });
  res.json({ institution });
});

router.get('/institutions/:id', async (req, res) => {
  const institution = await getInstitution(req.params.id);
  if (!institution) return res.status(404).json({ error: 'Institution not found' });
  const cohorts = await listCohortsForInstitution(req.params.id);
  res.json({ institution, cohorts });
});

router.post('/institutions/:id/cohorts', async (req, res) => {
  const { name, learnerLimit, startsAt, endsAt } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const cohort = await createCohort({ institutionId: req.params.id, name, learnerLimit, startsAt, endsAt });
  res.json({ cohort });
});

router.get('/cohorts/:id', async (req, res) => {
  const cohort = await getCohort(req.params.id);
  if (!cohort) return res.status(404).json({ error: 'Cohort not found' });
  const analytics = await getCohortAnalytics(req.params.id);
  res.json({ cohort, analytics });
});

router.post('/cohorts/:id/invites', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  const invite = await createLearnerInvite({ cohortId: req.params.id, email, invitedByUserId: req.user.id });
  // V1: no email send wired up here — the founder copies/shares the join
  // link manually during pilot outreach. Resend integration is a fast
  // follow, not a Phase 1-2 requirement.
  res.json({ invite, joinUrl: `/campus/invite/${invite.invite_token}` });
});

// POST /api/founder/campus/institutions/:id/admins — direct grant, no
// token/invite flow (deliberate: the Founder is provisioning an
// institution administrator directly, not inviting an unknown student —
// see conversation decision). Reuses the existing, unmodified
// findOrCreateUser from db/auth.js; the TPO still authenticates entirely
// through the normal MedhaIQ login flow on their own — this endpoint
// never logs anyone in or issues a session.
router.post('/institutions/:id/admins', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  const institution = await getInstitution(req.params.id);
  if (!institution) return res.status(404).json({ error: 'Institution not found' });
  const user = await findOrCreateUser(email, null);
  const admin = await grantInstitutionAdmin(req.params.id, user.id);
  res.json({ ok: true, admin: admin || { institution_id: Number(req.params.id), user_id: user.id }, email: user.email });
});

router.get('/institutions/:id/admins', async (req, res) => {
  const admins = await listInstitutionAdmins(req.params.id);
  res.json({ admins });
});

module.exports = router;
