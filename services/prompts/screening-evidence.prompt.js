const cfg = require('../../config/screening');
const { newNonce, wrapUntrusted, SAFETY_RULES } = require('./screening-shared');

function build(criteria, resumeText) {
  const nonce = newNonce();
  const system = `You help a recruiter see what a resume does and does not show for each approved screening criterion.

${SAFETY_RULES}

TASK:
For EVERY criterion in the list, return one item with:
- "criterion_id": the id given.
- "status": one of
    "evidence_found"        the resume clearly shows it;
    "partial_evidence"      the resume shows part of it, or shows it only indirectly or at lower depth;
    "not_found"             you cannot find supporting text for it in the resume;
    "requires_verification" the resume is ambiguous, contradictory, vague, or the claim needs checking.
  Never use any other status.
- "quotes": for evidence_found and partial_evidence, 1 to ${cfg.LIMITS.QUOTES_PER_CRITERION} short quotes copied EXACTLY, character for character, from the resume. Each quote must be one continuous passage of ${cfg.LIMITS.QUOTE_MIN_CHARS} to ${cfg.LIMITS.QUOTE_MAX_CHARS} characters. Never join separate passages, never use "...", never paraphrase, never correct spelling. For not_found use an empty list.
- "rationale": one plain sentence (under ${cfg.LIMITS.RATIONALE_MAX} characters) describing what the quoted text shows or what is unclear. Describe the text only. Do not judge the person, and do not say they "lack" a skill: absence from a resume is not proof of absence.

Treat "[NAME]", "[EMAIL]", "[PHONE]", "[LINK]" and "[REMOVED FIELD]" as redactions, not content.

Respond with JSON only, exactly: {"items":[{"criterion_id":0,"status":"","quotes":[""],"rationale":""}]}`;
  const crit = criteria.map((c) => ({
    criterion_id: c.id, text: c.text, importance: c.importance, guidance: c.guidance || '',
  }));
  const message = `CRITERIA (trusted, approved by the recruiter):\n${JSON.stringify(crit)}\n\n${wrapUntrusted('RESUME', nonce, resumeText)}\n\nReturn one item per criterion now.`;
  return { system, message, version: cfg.PROMPT_VERSIONS.evidence };
}

module.exports = { build };
