// ═══════════════════════════════════════════════════════════════════════════
// services/discovery/opening-strategy.js
// Opening Strategy — EXECUTION-DECISION layer (Phase 2)
//
// Stateless. Never calls generateNextQuestion(), never touches a DB, never
// calls addQuestion(). Its only job is to answer one question: "does
// Discovery or the existing engine supply the next question for this
// turn?" The actual call to generateNextQuestion() — or the decision to
// skip it — stays entirely in controllers/sessionController.js (turn 0)
// and routes/interview.js (turn 2+), so this module never wraps or
// duplicates the single interview engine.
//
// NOT the same as discovery-router.js (which decides WHICH profile applies)
// or discovery-objective.js (which decides whether the objective is met —
// consulted here, not re-implemented here).
// ═══════════════════════════════════════════════════════════════════════════

const { isDiscoveryObjectiveMet } = require('./discovery-objective');

/**
 * Turn 0 — called once, right after session creation, before the opening
 * question is generated/persisted.
 *
 * @param {object} profile — result of selectDiscoveryProfile(...).profile
 * @returns {{ useDiscovery: boolean, questionText?: string, discoveryQuestionType?: string }}
 */
function decideOpeningTurn(profile) {
  if (!profile || !profile.usesDiscoveryOpening) {
    // Professional / Leadership / Executive in v1 — hard no-op. The caller
    // takes this as "call generateNextQuestion() exactly as before."
    return { useDiscovery: false };
  }
  return {
    useDiscovery: true,
    questionText: profile.openingQuestion,
    discoveryQuestionType: 'discovery_opening',
  };
}

/**
 * Turn 2+ — called on every subsequent turn, before generateNextQuestion()
 * would otherwise be invoked. Once this returns useDiscovery:false for a
 * session, it can never return true again for that same session: profile
 * is a fixed function of immutable session fields (see discovery-router.js)
 * and discoveryAnsweredCount only grows as more discovery rows are
 * answered — so the gate is monotonic and one-way by construction, with no
 * flag to store anywhere.
 *
 * @param {{ profile: object, discoveryAnsweredCount: number }} args
 * @returns {{ useDiscovery: boolean, questionText?: string, discoveryQuestionType?: string }}
 */
function decideNextTurn({ profile, discoveryAnsweredCount }) {
  if (!profile || !profile.usesDiscoveryOpening) {
    return { useDiscovery: false };
  }
  if (isDiscoveryObjectiveMet({ profile, discoveryAnsweredCount })) {
    return { useDiscovery: false }; // explicit handoff — objective met
  }
  return {
    useDiscovery: true,
    questionText: profile.followupQuestion,
    discoveryQuestionType: 'discovery_followup',
  };
}

module.exports = { decideOpeningTurn, decideNextTurn };
