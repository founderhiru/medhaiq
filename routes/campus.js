// routes/campus.js — Campus Ready V1 learner-facing API.
//
// Isolation: no import from routes/interview.js, no Vapi/ElevenLabs/Claude
// call anywhere in this file, no read of package_acquisitions or the
// Capability Engine. Auth only, via middleware/campus-guards.js.

const express = require('express');
const router = express.Router();
const { requireCampusLearner } = require('../middleware/campus-guards');
const {
  acceptInvite, getLearnerForUser, listModulesWithProgress,
  getModuleByKey, getModuleContent, markLearnViewed, submitPractice, submitQuizAnswer,
  recomputeModuleProgress, isModuleLocked, getCampusNextAction,
} = require('../db/campus');

// POST /api/campus/join — accept an invite token for the logged-in user.
router.post('/join', async (req, res) => {
  const userId = req.cookies?.user_id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing invite token' });
  const result = await acceptInvite(token, userId);
  if (!result.ok) return res.status(400).json({ error: result.reason });
  return res.json({ ok: true });
});

// GET /api/campus/me — learner status, all 5 modules with progress + lock
// state (Phase 1: sequential progression), and the resolved Next Best
// Action so the frontend never has to re-derive it.
router.get('/me', requireCampusLearner, async (req, res) => {
  const modules = await listModulesWithProgress(req.campusLearner.id);
  const nextAction = await getCampusNextAction(req.campusLearner.id);
  res.json({ learner: req.campusLearner, modules, nextAction });
});

// GET /api/campus/modules/:key — topics + content for one module, with
// this learner's already-persisted state (Learn viewed / practice saved
// text / quiz answers) attached to each item so reopening a module
// resumes exactly where the learner left off.
// Enforced server-side: a locked module's content is never sent, even if
// the request is made directly against the API.
router.get('/modules/:key', requireCampusLearner, async (req, res) => {
  const mod = await getModuleByKey(req.params.key);
  if (!mod) return res.status(404).json({ error: 'Module not found' });
  if (await isModuleLocked(req.campusLearner.id, mod.id)) {
    return res.status(403).json({ error: 'This module is locked. Complete the previous module first.' });
  }
  const topics = await getModuleContent(mod.id, req.campusLearner.id);
  res.json({ module: mod, topics });
});

// POST /api/campus/learn/view — persists that the learner has viewed a
// Learn item. No AI, no comprehension check — viewing is sufficient for
// V1, per the founder's explicit boundary (see db/campus.js).
router.post('/learn/view', requireCampusLearner, async (req, res) => {
  const { contentItemId, moduleId } = req.body || {};
  if (!contentItemId || !moduleId) {
    return res.status(400).json({ error: 'contentItemId and moduleId are required' });
  }
  if (await isModuleLocked(req.campusLearner.id, moduleId)) {
    return res.status(403).json({ error: 'This module is locked. Complete the previous module first.' });
  }
  await markLearnViewed({ learnerId: req.campusLearner.id, contentItemId });
  const progress = await recomputeModuleProgress(req.campusLearner.id, moduleId);
  res.json({ ok: true, progress });
});

// POST /api/campus/practice — self-written, NOT graded. No AI call, no
// rubric — the learner compares their own answer to the Learn example.
router.post('/practice', requireCampusLearner, async (req, res) => {
  const { contentItemId, responseText, moduleId } = req.body || {};
  if (!contentItemId || !responseText || !moduleId) {
    return res.status(400).json({ error: 'contentItemId, moduleId, and responseText are required' });
  }
  if (await isModuleLocked(req.campusLearner.id, moduleId)) {
    return res.status(403).json({ error: 'This module is locked. Complete the previous module first.' });
  }
  await submitPractice({ learnerId: req.campusLearner.id, contentItemId, responseText });
  const progress = await recomputeModuleProgress(req.campusLearner.id, moduleId);
  res.json({ ok: true, progress });
});

// POST /api/campus/quiz — objective, auto-graded, multiple choice only.
router.post('/quiz', requireCampusLearner, async (req, res) => {
  const { contentItemId, selectedOptionId, moduleId } = req.body || {};
  if (!contentItemId || !selectedOptionId || !moduleId) {
    return res.status(400).json({ error: 'contentItemId, moduleId, and selectedOptionId are required' });
  }
  if (await isModuleLocked(req.campusLearner.id, moduleId)) {
    return res.status(403).json({ error: 'This module is locked. Complete the previous module first.' });
  }
  const result = await submitQuizAnswer({ learnerId: req.campusLearner.id, contentItemId, selectedOptionId });
  if (!result) return res.status(404).json({ error: 'Question not found' });
  const progress = await recomputeModuleProgress(req.campusLearner.id, moduleId);
  res.json({ ...result, progress });
});

module.exports = router;
