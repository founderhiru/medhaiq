const cfg = require('../../config/screening');
const { newNonce, wrapUntrusted, SAFETY_RULES } = require('./screening-shared');

function build(items, resumeText) {
  const nonce = newNonce();
  const system = `You help a recruiter prepare short follow-up questions to verify specific points that a resume left unclear or missing.

${SAFETY_RULES}

TASK:
For each listed criterion, write up to ${cfg.LIMITS.QUESTIONS_PER_CRITERION} open, neutral verification questions the recruiter could ask the candidate.
- Ask for a concrete example, situation, scope, or outcome. Each question under ${cfg.LIMITS.QUESTION_MAX} characters.
- Questions must not hint that the candidate is weak, must not assume they lack the skill, and must not touch personal attributes (age, family, religion, origin, health, etc.).
- Do not quote private details. Do not ask the candidate to confirm a verdict.

Respond with JSON only, exactly: {"questions":[{"criterion_id":0,"text":""}]}`;
  const message = `CRITERIA NEEDING VERIFICATION (trusted):\n${JSON.stringify(items)}\n\n${wrapUntrusted('RESUME', nonce, resumeText)}\n\nWrite the questions now.`;
  return { system, message, version: cfg.PROMPT_VERSIONS.questions };
}

module.exports = { build };
