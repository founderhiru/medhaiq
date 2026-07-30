// ═══════════════════════════════════════════════════════════════════════════
// services/discovery/discovery-objective.js
// Discovery Objective — completion check (Phase 2)
//
// Deliberately independent: does NOT import computeStarProgress, the
// Coverage Engine, Evidence Graph, or Scoring. Per founder sign-off, this
// mechanism must never depend on STAR signals — so completion is judged
// purely by whether the profile's own configured turn budget
// (discoveryObjective.maxDiscoveryTurns, see discovery-profiles.js) has
// been used. The "objective" — e.g. "discover one project + one challenge"
// for EARLY_CAMPUS — is expressed entirely as that turn budget; reaching it
// IS the objective being met, by construction of the profile config.
//
// Pure function, no side effects, no DB access.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {{ profile: object, discoveryAnsweredCount: number }} args
 * @returns {boolean} true when Discovery's objective has been met and the
 *   interview should hand off to the existing pipeline.
 */
function isDiscoveryObjectiveMet({ profile, discoveryAnsweredCount }) {
  const maxTurns = (profile && profile.discoveryObjective && Number.isInteger(profile.discoveryObjective.maxDiscoveryTurns))
    ? profile.discoveryObjective.maxDiscoveryTurns
    : 0;
  return discoveryAnsweredCount >= maxTurns;
}

module.exports = { isDiscoveryObjectiveMet };
