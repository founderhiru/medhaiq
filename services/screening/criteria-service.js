const screeningDb = require('../../db/screening');
const cfg = require('../../config/screening');
const ai = require('./ai');
const prompt = require('../prompts/screening-criteria.prompt');
const { validateAiCriteria, heuristicCriteria } = require('../../lib/screening-criteria');
const { ScreeningError } = require('../../lib/screening-errors');

// Propose criteria from the stored JD. AI first; deterministic bullet-point
// parser if the AI is unavailable or yields nothing usable. Never approves.
async function proposeCriteria(ownerId, jobId) {
  const job = await screeningDb.getJob(ownerId, jobId);
  if (!job) return null;
  if (job.criteria_state === 'approved') {
    throw new ScreeningError('criteria_locked', 409, 'These criteria are approved. Reopen them to propose new ones.');
  }
  let source = 'ai';
  let list = [];
  try {
    const p = prompt.build(job.jd_text);
    const parsed = await ai.runJson(ownerId, 'criteria', p);
    list = validateAiCriteria(parsed, job.jd_text);
  } catch (err) {
    if (err && err.code === 'ai_daily_cap') throw err;
    list = [];
  }
  if (list.length === 0) {
    source = 'heuristic';
    list = heuristicCriteria(job.jd_text);
  }
  if (list.length === 0) {
    throw new ScreeningError('no_criteria_found', 422,
      'We could not identify criteria in this job description. Please add them yourself.');
  }
  await screeningDb.replaceCriteria(ownerId, jobId, list);
  return { source, promptVersion: cfg.PROMPT_VERSIONS.criteria };
}

module.exports = { proposeCriteria };
