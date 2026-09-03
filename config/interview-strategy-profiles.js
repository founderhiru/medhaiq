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
  graduate: {
    1: { questionType: 'resume_story' },
    2: { questionType: 'resume_story' },
    3: { questionType: 'jd_scenario' },
    4: { questionType: 'jd_scenario' },
    5: { questionType: 'behavioural' },
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
// Practitioner-level roles across the canonical taxonomy that should use
// the 'engineering' rhythm instead of the 'executive' default at Mid/
// Senior stages. Deliberately NOT a new/duplicate profile object — this
// file's own header states profiles carry question TYPE only, not
// competency content, so the existing 5-question rhythm (resume_story/
// jd_scenario/behavioural/jd_scenario/resume_story) is reasonably generic
// across these roles. Includes both the 10 currently-visible launch roles
// and the 8 parked-but-still-configured roles (Engineering Director,
// Technical Program Manager, Product Director, MLOps Engineer, Research
// Scientist, LLM Engineer, Strategy & Transformation) as defense-in-depth
// in case they're ever reachable outside the UI's visible catalog.
// 'Executive Leadership' is intentionally absent — it should fall through
// to 'executive', per spec ("Executive Leadership -> Executive should
// generate true executive-level questions").
const ROLE_TO_PROFILE = {
  'Software Engineer': 'engineering',
  'Engineering Manager': 'engineering',
  'Engineering Director': 'engineering',
  'Solutions Architect': 'engineering',
  'Technical Program Manager': 'engineering',
  'AI Engineer': 'engineering',
  'AI Product Manager': 'engineering',
  'Data Engineer': 'engineering',
  'ML Engineer': 'engineering',
  'MLOps Engineer': 'engineering',
  'Research Scientist': 'engineering',
  'LLM Engineer': 'engineering',
  'Product Manager': 'engineering',
  'Product Director': 'engineering',
  'Program Manager': 'engineering',
  'Business Analyst': 'engineering',
  'Management Consultant': 'engineering',
  'Strategy & Transformation': 'engineering',
};

const GRADUATE_EXPERIENCE_LEVELS = new Set(['fresher', 'entry', 'graduate', 'junior', 'intern']);

/**
 * Resolves which strategy profile applies to this session. Experience
 * level takes precedence over role (an early-career engineer gets the
 * graduate rhythm, not the engineering one) since question rhythm should
 * match seniority first. Always resolves to something real — 'executive'
 * is the hard fallback.
 */
function resolveStrategyProfileName(roleTitle, experienceLevel) {
  const levelKey = String(experienceLevel || '').toLowerCase().trim();
  if (GRADUATE_EXPERIENCE_LEVELS.has(levelKey)) return 'graduate';
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
