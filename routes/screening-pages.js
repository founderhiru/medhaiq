// routes/screening-pages.js — server-rendered pages for /screening.
// Pages are thin shells; data loads through /api/screening (same guards).
const express = require('express');
const router = express.Router();
const { requireScreeningPage } = require('../middleware/screening-guards');
const screeningDb = require('../db/screening');
const vm = require('../services/screening/view-model');
const cfg = require('../config/screening');

router.use(requireScreeningPage);

function shell(req, extra) {
  return { shellUser: req.user, activeNav: 'screening', isScreeningUser: true, ...extra };
}
function idOrNull(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
}
const missing = (req, res) => res.status(404).render('screening-missing', shell(req, { pageTitle: 'Not found — MedhaIQ' }));

router.get('/', (req, res) => {
  res.render('screening-home', shell(req, { pageTitle: 'Screening — MedhaIQ' }));
});

router.get('/jobs/:jobId', async (req, res, next) => {
  try {
    const jobId = idOrNull(req.params.jobId);
    const job = jobId && await screeningDb.getJob(req.screeningOwnerId, jobId);
    if (!job) return missing(req, res);
    res.render('screening-job', shell(req, { pageTitle: `${job.title} — Screening`, jobId: job.id }));
  } catch (e) { next(e); }
});

router.get('/candidates/:candidateId', async (req, res, next) => {
  try {
    const cid = idOrNull(req.params.candidateId);
    const cand = cid && await screeningDb.getCandidate(req.screeningOwnerId, cid);
    if (!cand) return missing(req, res);
    res.render('screening-candidate', shell(req, { pageTitle: `${screeningDb.candidateCode(cand.seq)} — Screening`, candidateId: cand.id, jobId: cand.job_id }));
  } catch (e) { next(e); }
});

router.get('/candidates/:candidateId/report', async (req, res, next) => {
  try {
    const cid = idOrNull(req.params.candidateId);
    const model = cid && await vm.buildCandidateModel(req.screeningOwnerId, cid);
    if (!model) return missing(req, res);
    res.render('screening-report', {
      model, DECISIONS: cfg.DECISIONS, generatedAt: new Date(), shellUser: req.user,
    });
  } catch (e) { next(e); }
});

module.exports = router;
