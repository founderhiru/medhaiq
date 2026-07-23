// ═══════════════════════════════════════════════════════════════════════════
// Module: ConversationMemory
//
// Architecture: MedhaIQ Architecture Specification v1.1
//
// Owns:
//   - runCoverageAndMemoryEngine
//   - qaBelongsToCompetency
//   - textMentionsSubskill
//
// Writes:
//   Conversation Memory (per-competency coverage/memory profile — see §12)
//
// Reads:
//   Coverage configuration (competencyPriority, passed in per call)
//   Subskill matrix (SUBSKILL_MATRIX, injected once via createConversationMemory)
//
// Must NOT:
//   - call LLMs
//   - perform scoring
//   - generate interview language
//   - modify interview state
//
// ─────────────────────────────────────────────────────────────────────────
// Full ownership detail (per Architecture Specification v1.1, §6 / §12):
//   Purpose: attribute each Q&A pair to a competency and build the per-
//   competency coverage/memory profile that InterviewStrategy and the
//   Hypothesis Engine read from.
//
//   Responsibilities: competency attribution (3-layer fallback below),
//   per-competency question counts, score accumulation, observed-subskill
//   tracking, last-asked-turn tracking.
//
//   Forbidden: storing raw audio; acting as the primary retrieval path via
//   full transcript re-scan (this module IS the O(1)-by-key structure other
//   modules should read from, not a thing to be re-scanned itself); deciding
//   what happens next (that's InterviewStrategy, not this module); any
//   LLM call, scoring, language generation, or state mutation (see "Must
//   NOT" above).
//
//   Failure modes: no qaPairs (returns a zero profile, does not throw);
//   malformed qa entries (skipped, does not throw).
//
// Phase 1 extraction note: this file is a pure relocation of
// runCoverageAndMemoryEngine, textMentionsSubskill, and qaBelongsToCompetency
// out of services/interview.js. No logic was changed.
//
// SUBSKILL_MATRIX itself intentionally stayed in interview.js (it wasn't one
// of the three functions approved for this move, and other engines there
// still depend on it) — so this module is exported as a small factory that
// takes SUBSKILL_MATRIX once and closes over it, exactly the way the
// original functions closed over the module-level constant. This keeps the
// call signatures at every call site in interview.js byte-identical to
// before; only the one-line require/wiring at the top of interview.js
// changes.
//
// See tests/conversation-memory-characterization.js for the before/after
// verification this extraction was checked against.
// ═══════════════════════════════════════════════════════════════════════════

function createConversationMemory(SUBSKILL_MATRIX) {
  function textMentionsSubskill(qa, subskill) {
    const haystack = `${qa?.question || ''} ${qa?.answer || ''}`.toLowerCase();
    return haystack.includes(String(subskill).toLowerCase());
  }

  function qaBelongsToCompetency(qa, comp) {
    const metaComp = String(qa?.competency || qa?.metadata?.competency || '').toLowerCase().trim();
    if (metaComp) return metaComp === comp.toLowerCase();

    const subskills = SUBSKILL_MATRIX[comp] || SUBSKILL_MATRIX.default;
    if (subskills.some(sub => textMentionsSubskill(qa, sub))) return true;

    return Boolean(qa?.question && qa.question.toLowerCase().includes('[' + comp.toLowerCase() + ']'));
  }

  function runCoverageAndMemoryEngine(competencyPriority, qaPairs, currentTurn) {
    const profile = {};
    competencyPriority.forEach(comp => {
      profile[comp] = { totalQuestionsAsked: 0, scores: [], observedSubskills: new Set(), lastAskedTurn: -1 };
    });

    (Array.isArray(qaPairs) ? qaPairs : []).forEach((qa, turnIdx) => {
      if (!qa || !qa.question) return;
      competencyPriority.forEach(comp => {
        if (qaBelongsToCompetency(qa, comp)) {
          profile[comp].totalQuestionsAsked++;
          profile[comp].lastAskedTurn = turnIdx;
          if (qa.score !== null && qa.score !== undefined && !qa.wasSkipped) {
            profile[comp].scores.push(Number(qa.score));
          }
          const subskills = SUBSKILL_MATRIX[comp] || SUBSKILL_MATRIX.default;
          subskills.forEach(sub => {
            const token = sub.toLowerCase();
            if (qa.question.toLowerCase().includes(token) || (qa.answer && qa.answer.toLowerCase().includes(token))) {
              profile[comp].observedSubskills.add(sub);
            }
          });
        }
      });
    });
    return profile;
  }

  return { runCoverageAndMemoryEngine, textMentionsSubskill, qaBelongsToCompetency };
}

module.exports = createConversationMemory;
