const screeningDb = require('../../db/screening');
const cfg = require('../../config/screening');
const ai = require('./ai');
const prompt = require('../prompts/screening-evidence.prompt');
const { applyEvidenceRules, normalizeWithMap } = require('../../lib/screening-evidence');
const { ScreeningError } = require('../../lib/screening-errors');

async function analyzeCandidate(ownerId, candidateId, { confirmReset } = {}) {
  const cand = await screeningDb.getCandidate(ownerId, candidateId);
  if (!cand) return null;
  const job = await screeningDb.getJob(ownerId, cand.job_id);
  if (!job) return null;
  if (job.criteria_state !== 'approved') {
    throw new ScreeningError('criteria_not_approved', 409, 'Approve the screening criteria before analysing resumes.');
  }
  const criteria = await screeningDb.listCriteria(ownerId, job.id);
  if (criteria.length === 0) throw new ScreeningError('no_criteria', 409, 'This role has no criteria.');

  const reviewed = await screeningDb.countReviewedEvidence(ownerId, candidateId);
  if (reviewed > 0 && !confirmReset) {
    throw new ScreeningError('confirm_reset', 409,
      `Re-running will replace ${reviewed} item(s) you already reviewed. Confirm to continue.`, { reviewed });
  }

  const p = prompt.build(criteria, cand.redacted_text);
  const parsed = await ai.runJson(ownerId, 'evidence', p);
  const items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
  const byId = new Map();
  for (const it of items) {
    const id = Number(it && it.criterion_id);
    if (Number.isInteger(id) && !byId.has(id)) byId.set(id, it);
  }

  const doc = normalizeWithMap(cand.redacted_text);
  const rows = criteria.map((c) => {
    const raw = byId.get(c.id);
    if (!raw) {
      const r = applyEvidenceRules({ status: 'requires_verification', rationale: 'The AI did not return a finding for this criterion.', quotes: [] }, cand.redacted_text, cand.page_offsets, doc);
      r.downgrade_reason = 'missing_from_model_output';
      return { criterion_id: c.id, ...r };
    }
    return { criterion_id: c.id, ...applyEvidenceRules(raw, cand.redacted_text, cand.page_offsets, doc) };
  });

  await screeningDb.replaceEvidence(ownerId, candidateId, rows, {
    criteriaVersion: job.criteria_version, model: cfg.AI.MODEL || 'default', promptVersion: p.version,
  });
  return { analyzed: rows.length };
}

module.exports = { analyzeCandidate };
