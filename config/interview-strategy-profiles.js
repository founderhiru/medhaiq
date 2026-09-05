// config/interview-strategy-profiles.js
//
// ═══════════════════════════════════════════════════════════════════════════
// Interview Strategy Profiles (feature, 2026-07-23)
//
// Replaces the single hardcoded EXECUTIVE_STRATEGY_POSITIONS in
// services/interview.js. A profile defines the TYPE and RHYTHM of each of
// the 5 primary questions — it does NOT decide which competency to test.
//
//   Interview Strategy  ──▶  Allowed Question Type
//                                    │
//                                    ▼
//   Coverage Engine (unchanged)  ──▶  Best Competency (within any
//                                     constraint the question type sets)
//                                    │
//                                    ▼
//                             Story Selection ──▶ LLM
//
// Deliberately NOT hardcoded to a single competency name per position (e.g.
// "Q3 = leadership") — a CFO's, a VP Engineering's, and a Head of HR's
// definition of "leadership" differs, and the Coverage Engine already knows
// how to rank competencies for whichever role it's given. This file carries
// question TYPE/intent only ('resume_story', 'jd_scenario', 'behavioural',
// 'executive_judgment') — it holds NO competency names or lists at all.
// Resolving "behavioural" into an actual competency set is entirely the
// Coverage Engine's job (COMPETENCY_CATEGORY_TAGS + resolveCompetenciesFor-
// Category in services/interview.js), specifically so growing the
// competency taxonomy later (Influence, Stakeholder Management, Conflict
// Resolution, Coaching, Decision Making, etc.) never requires touching this
// file — only the taxonomy map that already lives next to COMPETENCY_MAP.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Question types and what each one means for downstream orchestration:
 *   - 'resume_story'       : try to ground the question in a résumé story
 *                            (existing selectStoryForCompetency behavior,
 *                            diversity-penalized so repeats are avoided —
 *                            this is what makes Q4's "different resume
 *                            story" work with zero new logic).
 *   - 'jd_scenario'        : NO résumé story — forces the existing
 *                            "no story selected" generic/hypothetical
 *                            framing, scenario grounded in the JD instead.
 *   - 'behavioural'        : a semantic INTENT only — this file carries no
 *                            list of which competencies count as
 *                            "behavioural". That resolution belongs to the
 *                            Coverage Engine's own taxonomy
 *                            (COMPETENCY_CATEGORY_TAGS in
 *                            services/interview.js), specifically so
 *                            growing the competency model (adding
 *                            Influence, Stakeholder Management, Conflict
 *                            Resolution, Coaching, Decision Making, etc.)
 *                            never requires touching this profile config.
 *                            Résumé story usage is unconstrained here too
 *                            (a behavioural story is often résumé-grounded).
 *   - 'executive_judgment' : NO résumé story — synthesis/judgment framing,
 *                            competency choice left completely open.
 */

// Human-readable source/purpose text per question type — feeds the
// existing blueprint.strategy_source / strategy_purpose debug fields.
// Independent of position number now (previously each of the 5 fixed
// positions had its own bespoke purpose string); the type itself carries
// the purpose.
const QUESTION_TYPE_META = {
  resume_story:       { source: 'ResumeStory',       purpose: "Validate a proven achievement from the candidate's resume." },
  jd_scenario:         { source: 'JDScenario',        purpose: 'Evaluate role fit through a realistic scenario grounded in the target role.' },
  behavioural:         { source: 'Behavioural',       purpose: 'Assess the highest-value behavioural competency not yet covered.' },
  executive_judgment:  { source: 'ExecutiveJudgment', purpose: 'Measure strategic thinking and judgment beyond what the resume already shows.' },
};

// ── Profiles ─────────────────────────────────────────────────────────────
// Each profile maps primary-question position (1-5) to a question type.
// 'executive' is the guaranteed fallback — every resolution path below
// ends there if nothing more specific matches, so an unmapped role never
// breaks the interview flow.
const STRATEGY_PROFILES = {
  executive: {
    1: { questionType: 'resume_story' },
    2: { questionType: 'jd_scenario' },
    3: { questionType: 'behavioural' },
    4: { questionType: 'resume_story' },
    5: { questionType: 'executive_judgment' },
  },
  // BUG FIX (2026-09-03): Q4 was 'jd_scenario' (a duplicate of Q3's type)
  // and Q5 was 'executive_judgment' — a Fresher/Graduate candidate has no
  // basis for board-level judgment questions. Q4 -> 'behavioural' gives
  // the intended team/problem-solving turn; Q5 -> 'jd_scenario' gives a
  // role-fit/synthesis close (jd_scenario's own stated purpose is
  // "Evaluate role fit through a realistic scenario grounded in the
  // target role" — exactly the intended Q5 shape, using an existing
  // question type rather than inventing a new one).
  graduate: {
    1: { questionType: 'resume_story' },
    2: { questionType: 'resume_story' },
    3: { questionType: 'jd_scenario' },
    4: { questionType: 'behavioural' },
    5: { questionType: 'jd_scenario' },
  },
  // PATCH A (2026-09-04): 'professional' — for Mid-Career and Senior
  // candidates of ANY role. Deliberately the same safe rhythm as
  // 'engineering' below (no executive_judgment slot — a mid/senior
  // candidate isn't yet being asked for board-level synthesis) rather
  // than inventing a new shape. Named separately from 'engineering'
  // because it now applies universally by experience level, not just to
  // the 3 roles in ROLE_TO_PROFILE — see the new resolution order in
  // resolveStrategyProfileName() below.
  professional: {
    1: { questionType: 'resume_story' },
    2: { questionType: 'jd_scenario' },
    3: { questionType: 'behavioural' },
    4: { questionType: 'jd_scenario' },
    5: { questionType: 'resume_story' },
  },
  engineering: {
    1: { questionType: 'resume_story' },
    2: { questionType: 'jd_scenario' },
    3: { questionType: 'behavioural' },
    4: { questionType: 'jd_scenario' },
    5: { questionType: 'resume_story' },
  },
};

// Roles that should use the 'engineering' or 'graduate' profile instead of
// the 'executive' default. Deliberately conservative/small — easy to
// extend without touching the interview engine itself, per the founder's
// "profiles that can evolve by role and seniority" goal. Unmatched roles
// (including any future role title) fall through to 'executive'.
const ROLE_TO_PROFILE = {
  'Software Engineer': 'engineering',
  'AI Engineer': 'engineering',
  'Data Engineer': 'engineering',
};

// BUG FIX (2026-09-03): 'fresher' — the actual value the production UI
// sends (views/interview-setup.ejs's data-exp="fresher" -> state.exp ->
// experienceLevel: state.exp) — was never in this set. Every Fresher
// session fell through resolveStrategyProfileName() to the 'executive'
// hard fallback below, so Q3 (behavioural) and Q5 (executive_judgment)
// were generated with zero seniority constraint, surfacing board-level/
// executive-scoped questions for entry-level candidates. Root-caused via
// end-to-end log trace (session showing "Profile: executive" for a
// Fresher-selected interview with no matching role in ROLE_TO_PROFILE).
const GRADUATE_EXPERIENCE_LEVELS = new Set(['fresher', 'entry', 'graduate', 'junior', 'intern']);

// PATCH A (2026-09-04): the two new recognized-level sets that complete
// the resolution table. 'mid' and 'senior' previously matched NEITHER
// GRADUATE_EXPERIENCE_LEVELS nor any role-name check, so they fell all
// the way through to the 'executive' hard fallback — identical treatment
// to a true 15+-year Executive candidate, for any role not in
// ROLE_TO_PROFILE (7 of the 10 launch roles). Explicitly recognizing
// 'executive' here too (rather than leaving it to also reach the same
// hard fallback by accident) is what fixes the inverse bug: a Software
// Engineer + Executive candidate was previously resolving to
// 'engineering' (via ROLE_TO_PROFILE) instead of 'executive', because
// role-mapping was checked before any level-based rule existed for
// 'executive'. Recognizing all three non-Fresher levels explicitly, and
// checking them BEFORE role mapping, makes experience level the sole
// determinant whenever it's a recognized value — role only matters when
// experience level is missing or unrecognized.
const PROFESSIONAL_EXPERIENCE_LEVELS = new Set(['mid', 'senior']);
const EXECUTIVE_EXPERIENCE_LEVELS = new Set(['executive']);

/**
 * Resolves which strategy profile applies to this session.
 *
 * PATCH A (2026-09-04) resolution order — recognized experience level
 * ALWAYS wins over role, for all four stages, not just the Fresher
 * family as before:
 *   1. Fresher-family experience level  -> 'graduate'
 *   2. Mid or Senior experience level   -> 'professional'
 *   3. Executive experience level       -> 'executive'
 *   4. Experience level missing/unrecognized -> ROLE_TO_PROFILE fallback
 *      (this is the ONLY path that still reaches 'engineering' — kept
 *      intact, unchanged, exactly as before, purely as a fallback for
 *      callers that don't send a recognized experienceLevel at all)
 *   5. Still nothing -> 'executive' (final hard fallback, unchanged)
 *
 * This intentionally makes 'engineering' unreachable via the normal UI
 * flow (which always sends a recognized experienceLevel) — it remains
 * defined and wired up solely for the missing/unrecognized-level
 * fallback path, per explicit instruction not to delete ROLE_TO_PROFILE
 * or the 'engineering' profile.
 */
function resolveStrategyProfileName(roleTitle, experienceLevel) {
  const levelKey = String(experienceLevel || '').toLowerCase().trim();
  if (GRADUATE_EXPERIENCE_LEVELS.has(levelKey)) return 'graduate';
  if (PROFESSIONAL_EXPERIENCE_LEVELS.has(levelKey)) return 'professional';
  if (EXECUTIVE_EXPERIENCE_LEVELS.has(levelKey)) return 'executive';
  const roleProfile = ROLE_TO_PROFILE[roleTitle];
  if (roleProfile && STRATEGY_PROFILES[roleProfile]) return roleProfile;
  return 'executive';
}

/**
 * @returns {{questionType: string, source: string, purpose: string}|null}
 *   null for follow-ups or any position outside 1-5 (unchanged from before).
 */
function getStrategyPosition(roleTitle, experienceLevel, position) {
  if (!Number.isInteger(position)) return null;
  const profileName = resolveStrategyProfileName(roleTitle, experienceLevel);
  const profile = STRATEGY_PROFILES[profileName] || STRATEGY_PROFILES.executive;
  const entry = profile[position] || STRATEGY_PROFILES.executive[position];
  if (!entry) return null;
  const meta = QUESTION_TYPE_META[entry.questionType] || { source: entry.questionType, purpose: '' };
  return {
    questionType: entry.questionType,
    profileName,
    source: meta.source,
    purpose: meta.purpose,
  };
}

module.exports = {
  STRATEGY_PROFILES,
  QUESTION_TYPE_META,
  resolveStrategyProfileName,
  getStrategyPosition,
};
