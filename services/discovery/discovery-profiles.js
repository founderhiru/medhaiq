// ═══════════════════════════════════════════════════════════════════════════
// services/discovery/discovery-profiles.js
// Discovery Profile — CONFIGURATION LAYER (Phase 1)
//
// This file is pure data. It is deliberately kept separate from
// discovery-router.js (which decides WHICH profile applies) so that adding a
// future profile — Career Returner, MBA Graduate, Military Transition, etc.
// — never requires touching routing logic, and never requires touching
// anything in services/interview.js.
//
// NOT YET WIRED to any controller or route. Nothing in the live app calls
// this file yet (Phase 1 of the approved implementation plan).
//
// v1 scope (per founder sign-off):
//   - Discovery-authored openings are enabled ONLY for the two Early Career
//     profiles (EARLY_CAMPUS, EARLY_PROFESSIONAL).
//   - PROFESSIONAL, LEADERSHIP, and EXECUTIVE are pass-through: Discovery
//     Router still resolves one of these keys for observability/logging,
//     but usesDiscoveryOpening=false means the orchestration layer (Phase 2)
//     will call the EXISTING opening path exactly as it does today —
//     byte-for-byte identical output, zero behavior change.
// ═══════════════════════════════════════════════════════════════════════════

const DISCOVERY_PROFILES = Object.freeze({

  EARLY_CAMPUS: Object.freeze({
    key: 'EARLY_CAMPUS',
    careerStage: 'fresher',
    usesDiscoveryOpening: true,
    openingGoal: 'Build confidence and discover the strongest experience — no full-time employer history assumed.',
    openingQuestion: 'Tell me about yourself and what excited you to apply for this opportunity.',
    followupQuestion: 'Tell me about the project or internship you\'re most proud of.',
    discoveryObjective: {
      description: 'Discover one primary project or internship, discover one challenge within it, and establish one interview-quality Experience.',
      maxDiscoveryTurns: 2,
    },
  }),

  EARLY_PROFESSIONAL: Object.freeze({
    key: 'EARLY_PROFESSIONAL',
    careerStage: 'fresher',
    usesDiscoveryOpening: true,
    openingGoal: 'Understand the first professional journey — one or more employers on record.',
    openingQuestion: 'Tell me about your journey so far and what you\'ve learned in your first role.',
    followupQuestion: 'Tell me about a specific challenge you ran into in that role, and how you handled it.',
    discoveryObjective: {
      description: 'Discover one primary early-career experience, discover one challenge within it, and establish one interview-quality Experience.',
      maxDiscoveryTurns: 2,
    },
  }),

  // ── v1: pass-through. Retained here (rather than skipping Discovery
  // Router entirely for these tiers) purely so every session — regardless
  // of career stage — resolves a profile key for logging/observability.
  // usesDiscoveryOpening=false is what makes this a true no-op.
  PROFESSIONAL: Object.freeze({
    key: 'PROFESSIONAL',
    careerStage: 'mid',
    usesDiscoveryOpening: false,
    openingGoal: null,
    openingQuestion: null,
    followupQuestion: null,
    discoveryObjective: { description: null, maxDiscoveryTurns: 0 },
  }),

  LEADERSHIP: Object.freeze({
    key: 'LEADERSHIP',
    careerStage: 'senior',
    usesDiscoveryOpening: false, // v1: pass-through per founder sign-off (§5.1)
    openingGoal: null,
    openingQuestion: null,
    followupQuestion: null,
    discoveryObjective: { description: null, maxDiscoveryTurns: 0 },
  }),

  EXECUTIVE: Object.freeze({
    key: 'EXECUTIVE',
    careerStage: 'executive',
    usesDiscoveryOpening: false, // v1: pass-through per founder sign-off (§5.1)
    openingGoal: null,
    openingQuestion: null,
    followupQuestion: null,
    discoveryObjective: { description: null, maxDiscoveryTurns: 0 },
  }),

});

module.exports = { DISCOVERY_PROFILES };
