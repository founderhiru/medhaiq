// ═══════════════════════════════════════════════════════════════════════════
// Module: BehavioralEvidenceEngine (Phase 2B, 2026-07-25)
//
// Architecture: MedhaIQ Architecture Roadmap — Phase 2B (Behavioral
// Intelligence), first pass. Log-only this phase — see the "Must NOT"
// section below.
//
// Owns:
//   - BEHAVIORAL_CATEGORIES (the fixed category list + detection regex)
//   - detectBehavioralCategories(answerText) — pure function, no LLM call
//
// Writes:
//   Nothing persistent. Returns which categories a given answer's text
//   touches; the caller (services/interview.js's
//   buildBehavioralEvidenceSnapshot) decides what to do with that.
//
// Reads:
//   Raw answer text only.
//
// Must NOT (Phase 2B, first pass — founder-approved scope):
//   - call any LLM
//   - write to the database, or persist anything across process restarts
//   - feed composePrompt, scoring, Coverage Engine, or selectNextCompetency
//     — this module's output is log-only in this phase, full stop
//   - duplicate EVIDENCE_TIERS/runHypothesisEngine's tier logic — this
//     module only detects category PRESENCE per answer; accumulating
//     that into a tier is runHypothesisEngine's job, unchanged, called
//     from services/interview.js
//
// Design note (why this looks like STAR Engine): built deliberately as a
// sibling to services/star/star-engine.js, same philosophy — a fixed set
// of categories, each with one rich, fuzzy-tolerant regex built from real
// executive vocabulary, no exact-phrase requirement. This is a direct,
// intentional reuse of a proven pattern, not a coincidence. The categories
// are NOT mutually exclusive and are NOT scoped to any one structural
// competency (system_design/technical/leadership/communication/strategy)
// — a single answer can legitimately touch several at once, and evidence
// for e.g. "Stakeholder Management" can come from a communication
// question, a leadership question, or a strategy question equally.
// ═══════════════════════════════════════════════════════════════════════════

const BEHAVIORAL_CATEGORIES = [
  'executive_influence',
  'stakeholder_management',
  'conflict_resolution',
  'change_leadership',
  'executive_communication',
];

// Each pattern is deliberately organized around real executive phrasing,
// not a keyword dump — same discipline as STAR_PATTERNS in
// services/star/star-engine.js, built and verified against real example
// language before shipping (see tests/behavioral-evidence-vocabulary.js).
const BEHAVIORAL_PATTERNS = {
  executive_influence: /\b(influenc(e|ed|ing) (the|senior|leadership|executives|board)|i persuaded|persuaded (the|senior|leadership)|i convinced|convinced (the|senior|leadership)|brought (leadership|the board|the executives|executives|them) around|gained (buy-?in|support|alignment) from|changed (their|the) (mind|perspective|position)|shifted (the )?perspective|built (consensus|alignment)|swayed|won over)\b/i,

  stakeholder_management: /\b(aligned (multiple|competing|five|three|several|\d+) (stakeholders|priorities|groups|teams|vps|leaders|executives|directors)|managed (competing|conflicting) (interests|priorities|demands|agendas)|balanced (the needs of|multiple|competing)|coordinated across|cross-functional (alignment|collaboration|team)|multiple stakeholders|competing priorities|navigated (the )?(relationships|politics|dynamics)|juggled (multiple|competing)|kept (everyone|all parties) aligned)\b/i,

  conflict_resolution: /\b(resolved (the )?(conflict|disagreement|tension|dispute|impasse)|mediated (a|between|the)|de-?escalat(e|ed|ing)|found (common ground|middle ground)|reconciled (the )?(differences|views)|worked through[^.]{0,20}disagreement|bridged the gap|diffused (the )?(tension|situation)|brought (both sides|everyone|them) together|navigated a difficult conversation)\b/i,

  change_leadership: /\b(led (the )?(change|transformation|turnaround)|drove (the )?(transformation|adoption|change|migration)|championed|spearheaded|transformed (the|our)|(overcame|overcome)[^.]{0,15}resistance|change management|cultural shift|turned around (the|a)|reorgani[sz]ed|moderni[sz]ed (the|our)|drove organi[sz]ational change|moderni[sz]ation (journey|initiative|effort|program)|transformation (journey|initiative|effort|program))\b/i,

  executive_communication: /\b(presented[^.]{0,30}to (the )?(board|executives|leadership|c-suite|senior leadership)|communicat(e|ed|ing) (the )?(vision|strategy) to|articulated (the|a)|distilled (complex|the)|executive (summary|briefing|presentation)|board (presentation|update|review)|translated (technical|complex) (issues|concepts|topics) for|simplified for (leadership|executives|the board)|delivered a (briefing|readout) to)\b/i,
};

/**
 * Pure, deterministic, zero-cost detection — no LLM call, mirrors
 * computeStarProgress's shape exactly (a plain object of booleans).
 * @returns {Object<string, boolean>} one boolean per BEHAVIORAL_CATEGORIES entry
 */
function detectBehavioralCategories(answerText) {
  const text = String(answerText || '').toLowerCase();
  const result = {};
  BEHAVIORAL_CATEGORIES.forEach((category) => {
    result[category] = BEHAVIORAL_PATTERNS[category].test(text);
  });
  return result;
}

/**
 * Observability only (Phase 2B final hardening, 2026-07-29) — a pure,
 * additive sibling to detectBehavioralCategories, NOT a replacement.
 * Same patterns, same text, zero change to what counts as a match; the
 * only difference is .exec() instead of .test(), so the matched
 * substring itself can be surfaced in diagnostic logs ("Matched: 'led'
 * -> Executive Influence"). detectBehavioralCategories remains the one
 * function actually consumed by buildBehavioralEvidenceSnapshot's tier
 * math — this function exists purely so the log can show WHY a category
 * did or didn't fire, without touching detection itself.
 * @returns {Object<string, string|null>} matched substring per category, or null
 */
function detectBehavioralCategoriesWithMatches(answerText) {
  const text = String(answerText || '').toLowerCase();
  const matches = {};
  BEHAVIORAL_CATEGORIES.forEach((category) => {
    const m = BEHAVIORAL_PATTERNS[category].exec(text);
    matches[category] = m ? m[0] : null;
  });
  return matches;
}

module.exports = {
  BEHAVIORAL_CATEGORIES,
  BEHAVIORAL_PATTERNS,
  detectBehavioralCategories,
  detectBehavioralCategoriesWithMatches,
};
