// ═══════════════════════════════════════════════════════════════════════════
// services/discovery/discovery-router.js
// Discovery Router — ROUTING LAYER (Phase 1)
//
// Decides WHICH Discovery Profile applies. Never decides WHAT the profile
// does (that's discovery-profiles.js) and never decides HOW the opening gets
// executed (that's Phase 2, inside controllers/sessionController.js).
//
// Pure function. No DB access, no AI call, no side effects. Does not import
// anything from services/interview.js. NOT YET WIRED — Phase 1 only.
//
// Inputs are exactly what controllers/sessionController.js already has in
// scope by the time it calls createSession() (line 93 of the live file):
// experienceLevel, resumeContext, storyLibrary. No new data fetch required.
// ═══════════════════════════════════════════════════════════════════════════

const { DISCOVERY_PROFILES } = require('./discovery-profiles');

// ── Layered heuristic keyword set (founder-approved, §3 of the architecture
// review). Matched case-insensitively as whole-word/phrase substrings against
// resume_context text fields and story_library entries. This list is data,
// not logic — extend it here, never by touching the routing function below.
const CAMPUS_SIGNAL_KEYWORDS = [
  'internship',
  'intern',
  'trainee',
  'graduate program',
  'graduate trainee',
  'capstone',
  'thesis',
  'university',
  'college',
  'hackathon',
];

/**
 * Gathers every piece of resume text worth scanning for campus-signal
 * keywords, from the exact fields confirmed present in resume_context /
 * story_library (services/prompts/resume-intelligence.prompt.js schema).
 * Never throws — a missing/malformed resumeContext or storyLibrary just
 * yields an empty haystack, which is the same as "no signal either way."
 */
function buildKeywordHaystack(resumeContext, storyLibrary) {
  const rc = resumeContext && typeof resumeContext === 'object' ? resumeContext : {};
  const stories = Array.isArray(storyLibrary) ? storyLibrary : [];

  const parts = [
    rc.summary,
    rc.career_level,
    ...(Array.isArray(rc.industries) ? rc.industries : []),
    ...(Array.isArray(rc.companies) ? rc.companies : []),
    ...(Array.isArray(rc.top_achievements) ? rc.top_achievements : []),
    ...stories.map(s => s && s.summary),
    ...stories.map(s => s && s.company),
  ].filter(p => typeof p === 'string' && p.trim().length);

  return parts.join(' \n ').toLowerCase();
}

function countFullTimeEmployers(resumeContext) {
  const rc = resumeContext && typeof resumeContext === 'object' ? resumeContext : {};
  return Array.isArray(rc.companies) ? rc.companies.length : 0;
}

function matchesCampusKeyword(haystack) {
  return CAMPUS_SIGNAL_KEYWORDS.some(kw => haystack.includes(kw));
}

/**
 * selectDiscoveryProfile — deterministic, layered decision.
 *
 * Layer 1 — Career Stage is authoritative for everything above "fresher."
 *   mid → PROFESSIONAL, senior → LEADERSHIP, executive → EXECUTIVE.
 *   These never run the resume heuristic below; Career Stage alone decides.
 *
 * Layer 2 — Only when Career Stage === 'fresher' does resume evidence get
 * consulted, per the approved layered heuristic:
 *   a) keyword signal found (internship/trainee/capstone/etc.) AND at most
 *      one employer on record  → EARLY_CAMPUS
 *   b) one or more employers on record AND no campus keyword signal
 *      → EARLY_PROFESSIONAL
 *   c) no employers AND no keyword signal at all (empty or absent resume)
 *      → EARLY_CAMPUS (safer default: build confidence rather than assume
 *      undocumented professional history)
 *   d) employers present AND campus keywords also present (e.g. "internship
 *      at Infosys" plus a later full-time entry) → EARLY_PROFESSIONAL wins;
 *      an actual employer entry is the stronger signal of the two.
 *
 * @param {{experienceLevel: string, resumeContext: object|null, storyLibrary: array|null}} args
 * @returns {{profileKey: string, profile: object, signals: object}}
 */
function selectDiscoveryProfile({ experienceLevel, resumeContext, storyLibrary }) {
  const stage = (experienceLevel || 'mid').toLowerCase();

  if (stage === 'mid') {
    return finalize('PROFESSIONAL', { reason: 'career_stage=mid' });
  }
  if (stage === 'senior') {
    return finalize('LEADERSHIP', { reason: 'career_stage=senior' });
  }
  if (stage === 'executive') {
    return finalize('EXECUTIVE', { reason: 'career_stage=executive' });
  }
  if (stage !== 'fresher') {
    // Unknown/unexpected value — fail safe to today's default tier rather
    // than guessing. Mirrors controllers/sessionController.js's own
    // `experienceLevel || 'mid'` fallback (line 28 of the live file).
    return finalize('PROFESSIONAL', { reason: `unrecognized experienceLevel="${experienceLevel}", defaulted` });
  }

  // stage === 'fresher' — run the layered resume heuristic
  const employerCount = countFullTimeEmployers(resumeContext);
  const haystack = buildKeywordHaystack(resumeContext, storyLibrary);
  const hasCampusKeyword = matchesCampusKeyword(haystack);

  const signals = { employerCount, hasCampusKeyword };

  if (employerCount === 0 && !hasCampusKeyword) {
    return finalize('EARLY_CAMPUS', { ...signals, reason: 'no resume evidence — default to campus' });
  }
  if (employerCount >= 1 && !hasCampusKeyword) {
    return finalize('EARLY_PROFESSIONAL', { ...signals, reason: 'employer(s) on record, no campus keywords' });
  }
  if (hasCampusKeyword && employerCount <= 1) {
    return finalize('EARLY_CAMPUS', { ...signals, reason: 'campus keyword present, at most one employer' });
  }
  // employerCount >= 2 with campus keywords also present — real employer
  // history outweighs an incidental keyword match.
  return finalize('EARLY_PROFESSIONAL', { ...signals, reason: 'multiple employers outweigh incidental keyword match' });

  function finalize(profileKey, signalDetail) {
    return { profileKey, profile: DISCOVERY_PROFILES[profileKey], signals: signalDetail };
  }
}

module.exports = {
  selectDiscoveryProfile,
  CAMPUS_SIGNAL_KEYWORDS, // exported for testing/inspection only
};
