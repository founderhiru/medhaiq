// routes/campus-tpo.js — Campus Ready Phase 2 TPO-facing API.
//
// Isolation: same contract as routes/campus.js — no import from
// routes/interview.js, no Vapi/ElevenLabs/Claude call, no read of
// package_acquisitions or the Capability Engine. Auth only, via
// middleware/campus-guards.js's requireInstitutionAdmin (Founder always
// passes; a TPO passes only for institutions they're explicitly granted).
//
// Mounted at /api/campus/tpo/:institutionId/... in server.js.

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireInstitutionAdmin } = require('../middleware/campus-guards');
const {
  listCohortsForInstitutionTpo, getCohortWithInstitution, getCohortSnapshot,
  getModulePerformance, listStudents, getStudentDetail, computeInsights,
} = require('../db/campus-tpo');
const { getInstitution } = require('../db/campus');

router.use(requireInstitutionAdmin);

// GET /api/campus/tpo/:institutionId/cohorts
router.get('/cohorts', async (req, res) => {
  const institution = await getInstitution(req.institutionId);
  if (!institution) return res.status(404).json({ error: 'Institution not found' });
  const cohorts = await listCohortsForInstitutionTpo(req.institutionId);
  res.json({ institution, cohorts });
});

// Shared helper — every cohort-scoped route below must confirm the
// requested cohort actually belongs to the authorized institution, so a
// TPO for Institution A can never reach Institution B's cohort data just
// by guessing a cohort id in the URL.
async function loadCohortScoped(req, res) {
  const cohort = await getCohortWithInstitution(req.params.cohortId);
  if (!cohort || cohort.institution_id !== req.institutionId) {
    res.status(404).json({ error: 'Cohort not found' });
    return null;
  }
  return cohort;
}

// GET /api/campus/tpo/:institutionId/cohorts/:cohortId/dashboard
router.get('/cohorts/:cohortId/dashboard', async (req, res) => {
  const cohort = await loadCohortScoped(req, res);
  if (!cohort) return;
  const [snapshot, modulePerformance, students] = await Promise.all([
    getCohortSnapshot(cohort.id),
    getModulePerformance(cohort.id),
    listStudents(cohort.id),
  ]);
  const insights = computeInsights(modulePerformance, students);
  res.json({ cohort, snapshot, modulePerformance, students, insights });
});

// GET /api/campus/tpo/:institutionId/cohorts/:cohortId/students/:learnerId
router.get('/cohorts/:cohortId/students/:learnerId', async (req, res) => {
  const cohort = await loadCohortScoped(req, res);
  if (!cohort) return;
  const detail = await getStudentDetail(req.params.learnerId);
  if (!detail || detail.cohortId !== cohort.id) {
    return res.status(404).json({ error: 'Student not found in this cohort' });
  }
  res.json({ cohort, student: detail });
});

module.exports = router;
