// routes/screening.js — Screening & Assessment Copilot API (/api/screening)
//
// Every route is behind requireScreeningApi (login + founder-granted access)
// and scopes data by the signed-in owner. Responses pass through `send`,
// which strips any score / rank / verdict style key as a last line of defence.

const express = require('express');
const multer = require('multer');
const router = express.Router();

const cfg = require('../config/screening');
const screeningDb = require('../db/screening');
const { requireScreeningApi, sameOriginOnly } = require('../middleware/screening-guards');
const { uploadLimiter, aiLimiter } = require('../middleware/screening-rate-limit');
const { ScreeningError, isScreeningError } = require('../lib/screening-errors');
const { stripVerdictKeys } = require('../lib/screening-evidence');
const { detectInjection, detectSensitiveJd, criterionTextIsSensitive } = require('../lib/screening-flags');
const { criteriaHash, cleanCriterion } = require('../lib/screening-criteria');
const { extractPagesFromFile, prepareResume, prepareJd } = require('../services/screening/extract');
const { proposeCriteria } = require('../services/screening/criteria-service');
const { analyzeCandidate } = require('../services/screening/evidence-service');
const { generateQuestions, cleanQuestion } = require('../services/screening/questions-service');
const vm = require('../services/screening/view-model');

const L = cfg.LIMITS;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: L.FILE_MAX_BYTES, files: 1, fields: 10, fieldSize: 64 * 1024 },
});

router.use(requireScreeningApi, sameOriginOnly);

// multer reports its errors through next(err), which would bypass `h` and
// end in the app-wide HTML error page. Translate them to JSON here.
function singleFile(field) {
  const mw = upload.single(field);
  return (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    console.error(`[screening] upload rejected: ${err.code || err.name}`);
    return res.status(tooBig ? 413 : 400).json({
      error: tooBig ? `Files can be up to ${Math.round(L.FILE_MAX_BYTES / 1048576)} MB.` : 'The upload could not be read.',
      code: tooBig ? 'file_too_large' : 'upload_failed',
    });
  });
}

// ── helpers ────────────────────────────────────────────────────────────────
function send(res, payload, status = 200) {
  const clean = stripVerdictKeys(payload, (k) => console.error(`[screening] stripped forbidden response key "${k}"`));
  res.status(status).json(clean);
}

const h = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (isScreeningError(err)) {
      return res.status(err.status).json({ error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) });
    }
    if (err && err.name === 'MulterError') {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig ? `Files can be up to ${Math.round(L.FILE_MAX_BYTES / 1048576)} MB.` : 'Upload failed.',
        code: tooBig ? 'file_too_large' : 'upload_failed',
      });
    }
    console.error('[screening] unexpected error:', err && err.message);
    res.status(500).json({ error: 'Something went wrong.', code: 'server_error' });
  }
};

function id(v) {
  const s = typeof v === 'number' ? String(v) : v;
  if (typeof s !== 'string' || !/^[1-9]\d{0,9}$/.test(s) || Number(s) > 2147483647) throw new ScreeningError('bad_id', 400, 'Invalid id.');
  return Number(s);
}
function str(v, max, { min = 0, field = 'value' } = {}) {
  if (v == null) return '';
  if (typeof v !== 'string') throw new ScreeningError('bad_input', 400, `Invalid ${field}.`);
  const s = v.replace(/\s+/g, ' ').trim();
  if (s.length < min) throw new ScreeningError('bad_input', 400, `Please provide a ${field}.`);
  if (s.length > max) throw new ScreeningError('bad_input', 400, `The ${field} is too long (max ${max} characters).`);
  return s;
}
const notFound = (what) => new ScreeningError('not_found', 404, `${what} not found.`);

function jdFlagsFor(text) {
  return [
    ...detectSensitiveJd(text).map((code) => ({ type: 'sensitive_language', code })),
    ...detectInjection(text).map((code) => ({ type: 'instruction_like_text', code })),
  ];
}

// ── me ─────────────────────────────────────────────────────────────────────
router.get('/me', h(async (req, res) => {
  send(res, { user: { id: req.user.id }, limits: { fileMaxMb: Math.round(L.FILE_MAX_BYTES / 1048576), pdfMaxPages: L.PDF_MAX_PAGES, candidatesPerJob: L.CANDIDATES_PER_JOB }, decisions: cfg.DECISIONS, statuses: cfg.EVIDENCE_STATUSES });
}));

// ── jobs ───────────────────────────────────────────────────────────────────
router.get('/jobs', h(async (req, res) => {
  const jobs = await screeningDb.listJobs(req.screeningOwnerId);
  send(res, { jobs: jobs.map((j) => vm.serializeJob(j)) });
}));

router.post('/jobs', uploadLimiter, singleFile('jdFile'), h(async (req, res) => {
  const body = req.body || {};
  const title = str(body.title, L.TITLE_MAX, { min: 2, field: 'role title' });
  let raw = typeof body.jdText === 'string' ? body.jdText : '';
  if (req.file) {
    const { pages } = await extractPagesFromFile(req.file.buffer);
    raw = pages.join('\n\n');
  }
  if (!raw) throw new ScreeningError('jd_missing', 400, 'Paste the job description or upload a file.');
  const jdText = prepareJd(raw);
  const job = await screeningDb.createJob(req.screeningOwnerId, { title, jdText, jdFlags: jdFlagsFor(jdText) });
  send(res, { job: vm.serializeJob(job, { withJd: true }) }, 201);
}));

router.get('/jobs/:jobId', h(async (req, res) => {
  const jobId = id(req.params.jobId);
  const job = await screeningDb.getJob(req.screeningOwnerId, jobId);
  if (!job) throw notFound('Role');
  const [criteria, candidates] = await Promise.all([
    screeningDb.listCriteria(req.screeningOwnerId, jobId),
    screeningDb.listCandidates(req.screeningOwnerId, jobId),
  ]);
  send(res, {
    job: vm.serializeJob(job, { withJd: true }),
    criteria: criteria.map(vm.serializeCriterion),
    candidates: candidates.map(vm.serializeCandidateRow),
  });
}));

router.patch('/jobs/:jobId', h(async (req, res) => {
  const jobId = id(req.params.jobId);
  const title = str(req.body && req.body.title, L.TITLE_MAX, { min: 2, field: 'role title' });
  const out = await screeningDb.updateJob(req.screeningOwnerId, jobId, { title });
  if (!out) throw notFound('Role');
  send(res, { job: vm.serializeJob(out.job) });
}));

router.delete('/jobs/:jobId', h(async (req, res) => {
  const ok = await screeningDb.deleteJob(req.screeningOwnerId, id(req.params.jobId));
  if (!ok) throw notFound('Role');
  send(res, { deleted: true });
}));

// ── criteria ───────────────────────────────────────────────────────────────
router.post('/jobs/:jobId/criteria/propose', aiLimiter, h(async (req, res) => {
  const jobId = id(req.params.jobId);
  const r = await proposeCriteria(req.screeningOwnerId, jobId);
  if (!r) throw notFound('Role');
  const [job, criteria] = await Promise.all([
    screeningDb.getJob(req.screeningOwnerId, jobId),
    screeningDb.listCriteria(req.screeningOwnerId, jobId),
  ]);
  send(res, { source: r.source, job: vm.serializeJob(job), criteria: criteria.map(vm.serializeCriterion) });
}));

function criterionInput(body, { partial } = {}) {
  const b = body || {};
  const out = {};
  if (!partial || b.text !== undefined) {
    out.text = str(b.text, L.CRITERION_TEXT_MAX, { min: 3, field: 'criterion' });
    if (criterionTextIsSensitive(out.text)) {
      throw new ScreeningError('sensitive_criterion', 422, 'Criteria cannot be based on age, gender, marital status, religion, caste, nationality, appearance or similar personal attributes.');
    }
  }
  if (!partial || b.importance !== undefined) {
    if (!cfg.IMPORTANCE.includes(b.importance)) throw new ScreeningError('bad_input', 400, 'Importance must be required or preferred.');
    out.importance = b.importance;
  }
  if (!partial || b.kind !== undefined) {
    out.kind = cfg.CRITERION_KINDS.includes(b.kind) ? b.kind : 'other';
  }
  if (b.guidance !== undefined) out.guidance = str(b.guidance, L.CRITERION_GUIDANCE_MAX, { field: 'guidance' }) || null;
  return out;
}

router.post('/jobs/:jobId/criteria', h(async (req, res) => {
  const jobId = id(req.params.jobId);
  const row = await screeningDb.addCriterion(req.screeningOwnerId, jobId, criterionInput(req.body));
  if (!row) throw notFound('Role');
  send(res, { criterion: vm.serializeCriterion(row) }, 201);
}));

router.patch('/jobs/:jobId/criteria/:criterionId', h(async (req, res) => {
  const row = await screeningDb.updateCriterion(req.screeningOwnerId, id(req.params.jobId), id(req.params.criterionId), criterionInput(req.body, { partial: true }));
  if (!row) throw notFound('Criterion');
  send(res, { criterion: vm.serializeCriterion(row) });
}));

router.delete('/jobs/:jobId/criteria/:criterionId', h(async (req, res) => {
  const r = await screeningDb.deleteCriterion(req.screeningOwnerId, id(req.params.jobId), id(req.params.criterionId));
  if (r === null || r === false) throw notFound('Criterion');
  send(res, { deleted: true });
}));

router.post('/jobs/:jobId/criteria/approve', h(async (req, res) => {
  const jobId = id(req.params.jobId);
  const criteria = await screeningDb.listCriteria(req.screeningOwnerId, jobId);
  const job = await screeningDb.approveCriteria(req.screeningOwnerId, jobId, criteriaHash(criteria));
  if (!job) throw notFound('Role');
  send(res, { job: vm.serializeJob(job) });
}));

router.post('/jobs/:jobId/criteria/reopen', h(async (req, res) => {
  const job = await screeningDb.reopenCriteria(req.screeningOwnerId, id(req.params.jobId));
  if (!job) throw notFound('Role');
  send(res, { job: vm.serializeJob(job) });
}));

// ── candidates ─────────────────────────────────────────────────────────────
router.post('/jobs/:jobId/candidates', uploadLimiter, singleFile('resumeFile'), h(async (req, res) => {
  const jobId = id(req.params.jobId);
  const job = await screeningDb.getJob(req.screeningOwnerId, jobId);
  if (!job) throw notFound('Role');
  const body = req.body || {};
  const label = str(body.label, L.LABEL_MAX, { field: 'label' }) || null;

  let pages; let sourceType;
  if (req.file) {
    ({ pages, sourceType } = await extractPagesFromFile(req.file.buffer));
  } else if (typeof body.resumeText === 'string' && body.resumeText.trim()) {
    const t = body.resumeText.replace(/\r\n?/g, '\n').trim();
    if (t.length > L.RESUME_MAX_CHARS * 2) throw new ScreeningError('resume_too_long', 422, 'This resume is too long.');
    pages = [t]; sourceType = 'text';
  } else {
    throw new ScreeningError('resume_missing', 400, 'Upload a resume file or paste the resume text.');
  }

  const prepared = prepareResume(pages, sourceType);
  const made = await screeningDb.createCandidate(req.screeningOwnerId, jobId, { ...prepared, label });
  if (!made) throw notFound('Role');
  if (made.duplicate) {
    return send(res, { duplicate: true, existing: made.existing }, 200);
  }
  const k = made.candidate;
  send(res, {
    duplicate: false,
    candidate: vm.serializeCandidateRow({ ...k, injection_flag_count: (k.injection_flags || []).length }),
    redactionSummary: k.redaction_summary,
    injectionFlags: k.injection_flags,
  }, 201);
}));

router.get('/candidates/:candidateId', h(async (req, res) => {
  const model = await vm.buildCandidateModel(req.screeningOwnerId, id(req.params.candidateId));
  if (!model) throw notFound('Candidate');
  const { job, ...rest } = model;
  send(res, { ...rest, job: vm.serializeJob(job) });
}));

router.patch('/candidates/:candidateId', h(async (req, res) => {
  const label = str(req.body && req.body.label, L.LABEL_MAX, { field: 'label' }) || null;
  const row = await screeningDb.updateCandidateLabel(req.screeningOwnerId, id(req.params.candidateId), label);
  if (!row) throw notFound('Candidate');
  send(res, { candidate: { id: row.id, label: row.label } });
}));

router.delete('/candidates/:candidateId', h(async (req, res) => {
  const ok = await screeningDb.deleteCandidate(req.screeningOwnerId, id(req.params.candidateId));
  if (!ok) throw notFound('Candidate');
  send(res, { deleted: true });
}));

router.post('/candidates/:candidateId/analyze', aiLimiter, h(async (req, res) => {
  const candidateId = id(req.params.candidateId);
  const r = await analyzeCandidate(req.screeningOwnerId, candidateId, { confirmReset: !!(req.body && req.body.confirmReset) });
  if (!r) throw notFound('Candidate');
  const model = await vm.buildCandidateModel(req.screeningOwnerId, candidateId);
  const { job, ...rest } = model;
  send(res, { ...rest, job: vm.serializeJob(job) });
}));

// ── evidence review (human) ────────────────────────────────────────────────
router.put('/candidates/:candidateId/evidence/:criterionId', h(async (req, res) => {
  const candidateId = id(req.params.candidateId);
  const criterionId = id(req.params.criterionId);
  const b = req.body || {};
  const note = str(b.note, L.NOTE_MAX, { field: 'note' }) || null;
  let row;
  if (b.action === 'clear') {
    row = await screeningDb.clearReview(req.screeningOwnerId, candidateId, criterionId);
  } else if (b.action === 'confirm') {
    const list = await screeningDb.listEvidence(req.screeningOwnerId, candidateId);
    const cur = list.find((e) => e.criterion_id === criterionId);
    if (!cur) throw notFound('Evidence');
    row = await screeningDb.reviewEvidence(req.screeningOwnerId, candidateId, criterionId, { status: cur.ai_status, note });
  } else if (b.action === 'override') {
    if (!Object.prototype.hasOwnProperty.call(cfg.EVIDENCE_STATUSES, b.status)) throw new ScreeningError('bad_input', 400, 'Choose a valid evidence status.');
    row = await screeningDb.reviewEvidence(req.screeningOwnerId, candidateId, criterionId, { status: b.status, note });
  } else {
    throw new ScreeningError('bad_input', 400, 'Action must be confirm, override or clear.');
  }
  if (!row) throw notFound('Evidence');
  const model = await vm.buildCandidateModel(req.screeningOwnerId, candidateId);
  const { job, ...rest } = model;
  send(res, { ...rest, job: vm.serializeJob(job) });
}));

// ── inbox ──────────────────────────────────────────────────────────────────
router.get('/jobs/:jobId/inbox', h(async (req, res) => {
  const inbox = await vm.buildInbox(req.screeningOwnerId, id(req.params.jobId));
  if (!inbox) throw notFound('Role');
  send(res, inbox);
}));

// ── decision (recruiter only) ──────────────────────────────────────────────
router.put('/candidates/:candidateId/decision', h(async (req, res) => {
  const b = req.body || {};
  let decision = b.decision;
  if (decision === null || decision === '' || decision === undefined) decision = null;
  else if (!Object.prototype.hasOwnProperty.call(cfg.DECISIONS, decision)) throw new ScreeningError('bad_input', 400, 'Choose one of the four decision labels.');
  const note = str(b.note, L.NOTE_MAX, { field: 'note' }) || null;
  const row = await screeningDb.setDecision(req.screeningOwnerId, id(req.params.candidateId), decision, note);
  if (!row) throw notFound('Candidate');
  send(res, { candidate: { id: row.id, decision: row.decision, decisionLabel: row.decision ? cfg.DECISIONS[row.decision] : null, decisionNote: row.decision_note, decidedAt: row.decided_at } });
}));

// ── verification questions ─────────────────────────────────────────────────
router.post('/candidates/:candidateId/questions/generate', aiLimiter, h(async (req, res) => {
  const candidateId = id(req.params.candidateId);
  const r = await generateQuestions(req.screeningOwnerId, candidateId);
  if (!r) throw notFound('Candidate');
  const qs = await screeningDb.listQuestions(req.screeningOwnerId, candidateId);
  send(res, { generated: r.generated, questions: qs.map((q) => ({ id: q.id, criterionId: q.criterion_id, text: q.text, origin: q.origin, state: q.state })) });
}));

router.post('/candidates/:candidateId/questions', h(async (req, res) => {
  const b = req.body || {};
  const text = cleanQuestion(b.text);
  if (!text) throw new ScreeningError('bad_input', 400, 'Write a question of at least a few words, without personal-attribute or verdict language.');
  const row = await screeningDb.addQuestion(req.screeningOwnerId, id(req.params.candidateId), id(b.criterionId), text);
  if (!row) throw notFound('Candidate or criterion');
  send(res, { question: { id: row.id, criterionId: row.criterion_id, text: row.text, origin: row.origin, state: row.state } }, 201);
}));

router.patch('/candidates/:candidateId/questions/:questionId', h(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.text !== undefined) {
    patch.text = cleanQuestion(b.text);
    if (!patch.text) throw new ScreeningError('bad_input', 400, 'Write a question of at least a few words, without personal-attribute or verdict language.');
  }
  if (b.state !== undefined) {
    if (!['draft', 'approved', 'dismissed'].includes(b.state)) throw new ScreeningError('bad_input', 400, 'Invalid state.');
    patch.state = b.state;
  }
  const row = await screeningDb.updateQuestion(req.screeningOwnerId, id(req.params.candidateId), id(req.params.questionId), patch);
  if (!row) throw notFound('Question');
  send(res, { question: { id: row.id, criterionId: row.criterion_id, text: row.text, origin: row.origin, state: row.state } });
}));

router.delete('/candidates/:candidateId/questions/:questionId', h(async (req, res) => {
  const ok = await screeningDb.deleteQuestion(req.screeningOwnerId, id(req.params.candidateId), id(req.params.questionId));
  if (!ok) throw notFound('Question');
  send(res, { deleted: true });
}));

// Unknown API paths stay JSON.
router.use((_req, res) => res.status(404).json({ error: 'Not found', code: 'not_found' }));

module.exports = router;
