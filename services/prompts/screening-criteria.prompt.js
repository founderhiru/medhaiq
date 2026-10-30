const cfg = require('../../config/screening');
const { newNonce, wrapUntrusted, SAFETY_RULES } = require('./screening-shared');

function build(jdText) {
  const nonce = newNonce();
  const system = `You help a recruiter turn a job description into a short list of screening criteria that can be checked against a resume.

${SAFETY_RULES}

TASK:
Read the job description block and propose between 4 and ${cfg.LIMITS.CRITERIA_MAX} screening criteria.
- Each criterion is one concrete, checkable thing: a skill, a tool, a type of experience, a qualification, or a domain.
- "required" = the JD says must / required / essential or it is clearly core to the role. "preferred" = nice to have / plus / preferred.
- Keep each "text" under ${cfg.LIMITS.CRITERION_TEXT_MAX} characters, plain language, no hype.
- "jd_quote" must be an exact, verbatim copy of a short phrase from the job description that the criterion comes from. If you cannot quote it exactly, use an empty string.
- "guidance" (optional, under ${cfg.LIMITS.CRITERION_GUIDANCE_MAX} characters) tells a reviewer what would count as evidence.
- "kind" is one of: ${cfg.CRITERION_KINDS.join(', ')}.
- Do NOT create criteria about age, gender, marital status, religion, caste, nationality, appearance, or similar personal attributes, even if the job description mentions them.
- Do not duplicate criteria.

Respond with JSON only, exactly: {"criteria":[{"text":"","importance":"required|preferred","kind":"","jd_quote":"","guidance":""}]}`;
  const message = `${wrapUntrusted('JOB_DESCRIPTION', nonce, jdText)}\n\nPropose the screening criteria now.`;
  return { system, message, version: cfg.PROMPT_VERSIONS.criteria };
}

module.exports = { build };
