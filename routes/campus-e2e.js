// routes/campus-e2e.js — Campus Ready Founder E2E Test Lab (Phase 2F).
//
// Founder-only. Kept in its own file, separate from routes/campus-admin.js,
// because the reset endpoint here is uniquely destructive and deserves a
// small, easily-auditable surface. No new authentication mechanism: every
// route here is guarded by the same requireFounder check as
// routes/campus-admin.js, reusing the existing founder_access table.
//
// Test-data isolation: every institution this file creates has
// is_test = true. The reset endpoint ONLY ever deletes rows reachable
// from institutions WHERE is_test = true — existing ON DELETE CASCADE
// chains (campus_cohorts -> campus_learners -> module_progress/practice/
// quiz/learn_views) mean a single DELETE on institutions is sufficient
// and provably cannot reach any real institution, user, interview
// session, or payment record.

const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');
const { getUserById } = require('../db/auth');
const { isFounder } = require('../db/founder-access');
const { createInstitution, createCohort, createLearnerInvite } = require('../db/campus');

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

// GET /api/founder/campus/e2e/institutions — list only test institutions.
router.get('/institutions', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.*, (SELECT COUNT(*) FROM campus_cohorts c WHERE c.institution_id = i.id) AS cohort_count
     FROM institutions i WHERE i.is_test = true ORDER BY i.created_at DESC`
  );
  res.json({ institutions: rows });
});

// POST /api/founder/campus/e2e/institutions — create a labeled test
// institution + one test cohort in a single step, since the Test Lab
// UI's whole point is a fast one-click setup.
router.post('/institutions', async (req, res) => {
  const name = (req.body?.name || '').trim() || `E2E Test — ${new Date().toISOString().slice(0, 10)}`;
  const institution = await createInstitution({ name: `${name} (E2E TEST — DO NOT USE FOR LIVE STUDENTS)` });
  await pool.query(`UPDATE institutions SET is_test = true WHERE id = $1`, [institution.id]);
  const cohort = await createCohort({ institutionId: institution.id, name: 'E2E TEST — Campus Ready' });
  res.json({ institution: { ...institution, is_test: true }, cohort });
});

// POST /api/founder/campus/e2e/cohorts/:cohortId/invites — generate a
// real test invite, using the EXACT same mechanism as a production
// learner invite (createLearnerInvite). No special fake invitation path.
router.post('/cohorts/:cohortId/invites', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  const cohortCheck = await pool.query(
    `SELECT c.id FROM campus_cohorts c JOIN institutions i ON i.id = c.institution_id
     WHERE c.id = $1 AND i.is_test = true`,
    [req.params.cohortId]
  );
  if (!cohortCheck.rows.length) return res.status(404).json({ error: 'Test cohort not found' });
  const invite = await createLearnerInvite({ cohortId: req.params.cohortId, email, invitedByUserId: req.user.id });
  res.json({ invite, joinUrl: `/campus/invite/${invite.invite_token}` });
});

// POST /api/founder/campus/e2e/reset — destructive, Founder-only, scoped
// entirely to is_test institutions. The existing FK cascades do all the
// work; this is intentionally a single statement, not custom
// deletion-order logic, because the schema already guarantees safety.
router.post('/reset', async (req, res) => {
  const { confirm } = req.body || {};
  if (confirm !== 'RESET') {
    return res.status(400).json({ error: 'Type RESET to confirm — this permanently deletes all E2E test data.' });
  }
  const result = await pool.query(`DELETE FROM institutions WHERE is_test = true RETURNING id`);
  res.json({ ok: true, institutionsDeleted: result.rows.length });
});

module.exports = router;
