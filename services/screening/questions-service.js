const screeningDb = require('../../db/screening');
const cfg = require('../../config/screening');
const ai = require('./ai');
const prompt = require('../prompts/screening-questions.prompt');
const { effectiveStatus, hasVerdictLanguage } = require('../../lib/screening-evidence');
const { questionIsSensitive } = require('../../lib/screening-flags');
const { ScreeningError } = require('../../lib/screening-errors');

function cleanQuestion(t) {
  const s = String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, cfg.LIMITS.QUESTION_MAX);
  if (s.length < 10) return null;
  if (hasVerdictLanguage(s) || questionIsSensitive(s)) return null;
  return s;
}

async function generateQuestions(ownerId, candidateId) {
  const cand = await screeningDb.getCandidate(ownerId, candidateId);
  if (!cand) return null;
  const job = await screeningDb.getJob(ownerId, cand.job_id);
  const [criteria, evidence] = await Promise.all([
    screeningDb.listCriteria(ownerId, job.id),
    screeningDb.listEvidence(ownerId, candidateId),
  ]);
  const cmap = new Map(criteria.map((c) => [c.id, c]));
  const needs = evidence
    .filter((e) => cfg.QUESTION_STATUSES.includes(effectiveStatus(e)) && cmap.has(e.criterion_id))
    .map((e) => ({
      criterion_id: e.criterion_id,
      criterion: cmap.get(e.criterion_id).text,
      status: effectiveStatus(e),
      note: e.ai_rationale || '',
    }));
  if (needs.length === 0) {
    await screeningDb.replaceAiQuestions(ownerId, candidateId, []);
    return { generated: 0 };
  }
  const p = prompt.build(needs, cand.redacted_text);
  const parsed = await ai.runJson(ownerId, 'questions', p);
  const arr = parsed && Array.isArray(parsed.questions) ? parsed.questions : [];
  const allowed = new Set(needs.map((n) => n.criterion_id));
  const perCrit = new Map();
  const out = [];
  for (const q of arr) {
    const id = Number(q && q.criterion_id);
    if (!allowed.has(id)) continue;
    const text = cleanQuestion(q.text);
    if (!text) continue;
    const n = perCrit.get(id) || 0;
    if (n >= cfg.LIMITS.QUESTIONS_PER_CRITERION) continue;
    perCrit.set(id, n + 1);
    out.push({ criterion_id: id, text });
  }
  if (out.length === 0) {
    throw new ScreeningError('no_questions', 422, 'No usable questions came back. Try again, or add your own.');
  }
  await screeningDb.replaceAiQuestions(ownerId, candidateId, out);
  return { generated: out.length };
}

module.exports = { generateQuestions, cleanQuestion };
