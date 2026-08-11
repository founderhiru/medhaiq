/**
 * CANONICAL CAREER INTELLIGENCE REPORT — buildCareerIntelligenceReport()
 * ─────────────────────────────────────────────────────────────────────────
 * V1 Reporting Architecture — Step 1 (builder only; no routes/templates
 * touched yet).
 *
 * DO NOT CHANGE SCORING OR THE INTERVIEW ENGINE.
 * This file performs ZERO AI calls and ZERO database calls. It is a pure
 * function of data already fetched by the caller (getReport/getSessionScores/
 * getSessionQuestions — exactly the same three calls both the web report
 * route and the PDF route already make today). It only reorganizes existing
 * values into one shared shape so Web, Email, and PDF stop computing their
 * own separate answers.
 *
 * LOCKED 5-VECTOR MAPPING (product-facing names shown in the live interview
 * terminal, mapped onto the EXISTING raw scoring fields — values and
 * weights UNCHANGED):
 *
 *   Structure               ← star_score
 *   Domain Expertise        ← technical_depth
 *   Strategic Thinking      ← executive_presence   * compatibility mapping
 *   Communication            ← core_friction
 *   Leadership & Execution  ← gcc_readiness         * compatibility mapping
 *
 *   * "Strategic Thinking" and "Leadership & Execution" are CURRENT
 *     COMPATIBILITY LABELS for executive_presence / gcc_readiness. This is
 *     NOT a claim that the underlying scorer measures trade-off reasoning,
 *     prioritization, ownership, or stakeholder management. A future V2
 *     scoring-model project may redefine what those raw fields measure —
 *     that is explicitly out of scope here. See services/interview.js
 *     SCORING_SYSTEM for the actual rubric each raw field is scored against.
 *
 * No weight percentages are exposed by this builder (the engine's real
 * weights — 25/25/20/15/15 — don't match the product's stated 35/25/20/10/10
 * language; showing either would be its own inconsistency, so V1 shows
 * scores only, no weights).
 *
 * WHAT THIS FILE DOES NOT DO:
 *   - Does not call any AI/LLM (scoreAnswer, generateReport, chatJSON, etc).
 *   - Does not query the database (no `require('pg')`, no pool, no SQL).
 *   - Does not read/trust `interview_reports.scoreboard`'s numeric fields
 *     (career_intelligence / leadership_readiness / executive_presence /
 *     gcc_readiness / promotion_readiness) — that AI-generated JSON is the
 *     confirmed root cause of the Web/PDF vs Email divergence and is being
 *     retired as a numeric source. Only `scoreboard`-adjacent NARRATIVE
 *     fields already on the `report` row itself (executive_summary,
 *     strongest_response, weakest_response, structural_flow,
 *     linguistic_nuances, persona_verdict, next_steps_json) are reused —
 *     those come from the report's own columns, not from re-parsing
 *     scoreboard JSON.
 *   - Does not touch routes, views, or services/email.js. Nothing calls
 *     this function yet.
 * ─────────────────────────────────────────────────────────────────────────
 */

const { computeStarProgress } = require('../services/star/star-engine');

function safeParse(json, fallback) {
  if (json == null) return fallback;
  if (typeof json !== 'string') return json; // pg may already return parsed JSONB
  try { return JSON.parse(json); } catch { return fallback; }
}

function round(n) {
  return Math.round(n || 0);
}

/** Same averaging logic already duplicated in server.js's web + PDF report
 *  routes — centralized here, not recalculated differently. */
function avgOf(scoresData, key) {
  if (!scoresData || !scoresData.length) return 0;
  return scoresData.reduce((sum, row) => sum + parseFloat(row[key] || 0), 0) / scoresData.length;
}

/** Locked product-facing vector list — order matters (used for display and
 *  for ranking). Each entry's `raw` is the exact interview_scores column
 *  name it reads, unchanged. */
const VECTOR_DEFINITIONS = [
  { key: 'structure',              label: 'Structure',               raw: 'star_score' },
  { key: 'domainExpertise',        label: 'Domain Expertise',        raw: 'technical_depth' },
  { key: 'strategicThinking',      label: 'Strategic Thinking',      raw: 'executive_presence' },
  { key: 'communication',          label: 'Communication',           raw: 'core_friction' },
  { key: 'leadershipExecution',    label: 'Leadership & Execution',  raw: 'gcc_readiness' },
];

/** Per-question vector scores, using the same locked mapping — needed for
 *  questionEvidence[]. Mirrors the qaCards shape already built inline in
 *  server.js's PDF route, just relabeled to the product-facing names. */
function buildQuestionEvidence(questions, scoresData) {
  const scoreByQuestionId = new Map((scoresData || []).map((s) => [s.question_id, s]));
  return (questions || [])
    .filter((q) => q.answer_text !== null && q.answer_text !== undefined)
    .map((q, i) => {
      const s = scoreByQuestionId.get(q.id) || null;
      return {
        index: i + 1,
        questionText: q.question_text,
        answerText: q.answer_text,
        overallScore: s ? round(s.weighted_overall) : null,
        vectors: s
          ? VECTOR_DEFINITIONS.reduce((acc, v) => {
              acc[v.key] = round(s[v.raw]);
              return acc;
            }, {})
          : null,
      };
    });
}

/** Rank the five vectors by score. Returns { strengths, developmentPriorities }
 *  where developmentPriorities excludes anything already listed as a
 *  strength — same non-overlap rule already used in server.js's PDF route
 *  (with only 5 vectors, a strict top-3/bottom-3 split would double-count
 *  the middle vector). `strengthCount` lets callers ask for fewer (Explorer
 *  wants 1; Growth/Leadership can show more) without a second calculation —
 *  slicing a shared ranked list, not re-ranking per tier.
 *
 *  `narrative` (added for the email's Priority section, approved narrow
 *  correction to Step 4) is attached ONLY to the top-ranked development
 *  priority entry. It is a PASS-THROUGH of report.improvements_json[0]'s
 *  existing AI-generated coaching sentence — the same text the pre-Step-4
 *  email used to show, and the same text still shown on the Web Report's
 *  own "Top 3 Development Priorities" section (views/interview-report.ejs,
 *  which reads improvements_json directly, unchanged since Step 3). This
 *  is NOT a new calculation, NOT a new AI call, and NOT the same array as
 *  strengths_json used a second time — improvements_json is read here
 *  once, for its `.fix` sentence only, and only attached to whichever
 *  vector the numeric ranking already determined was the top development
 *  priority. If improvementsJson is absent or empty, `narrative` is simply
 *  omitted — no fallback text is invented here (the caller, e.g. the
 *  email template, decides what to show when narrative is unavailable). */
function rankVectors(fiveVectors, strengthCount = 2, improvementsJson) {
  const ranked = VECTOR_DEFINITIONS.map((v) => ({
    vector: v.key,
    label: v.label,
    score: fiveVectors[v.key],
  })).sort((a, b) => b.score - a.score);

  const strengths = ranked.slice(0, strengthCount);
  const strengthKeys = strengths.map((s) => s.vector);
  const developmentPriorities = ranked
    .filter((v) => strengthKeys.indexOf(v.vector) === -1)
    .slice()
    .reverse();

  if (developmentPriorities.length && Array.isArray(improvementsJson) && improvementsJson.length) {
    const top = improvementsJson[0] || {};
    const narrative = top.fix || top.action || top.observation || null;
    if (narrative) {
      developmentPriorities[0] = { ...developmentPriorities[0], narrative };
    }
  }

  return { ranked, strengths, developmentPriorities };
}

/** STAR Intelligence — reuses computeStarProgress() EXACTLY as the PDF
 *  route already does today: same function, same regex patterns, same
 *  order, called again at report time over the stored answer text.
 *  Per-question star_components were never persisted (pre-existing gap,
 *  not introduced here), so this recomputes the keyword-detection half of
 *  that same function rather than inventing a different STAR
 *  representation. */
function buildStarIntelligence(questions) {
  const answered = (questions || []).filter((q) => q.answer_text !== null && q.answer_text !== undefined);
  const results = answered.map((q) => computeStarProgress(q.answer_text));
  const counts = { situation: 0, task: 0, action: 0, result: 0 };
  results.forEach((r) => {
    ['situation', 'task', 'action', 'result'].forEach((k) => { if (r[k]) counts[k]++; });
  });
  const total = results.length;
  const pct = (n) => (total ? round((n / total) * 100) : 0);

  return {
    situation: { detected: counts.situation, of: total, pct: pct(counts.situation) },
    task:      { detected: counts.task,      of: total, pct: pct(counts.task) },
    action:    { detected: counts.action,    of: total, pct: pct(counts.action) },
    result:    { detected: counts.result,    of: total, pct: pct(counts.result) },
    // Same "overall STAR score" definition already shown on the PDF today —
    // count of fully-complete (all 4 components true) answers.
    overallStarScore: results.filter((r) => r.stepsComplete === 4).length,
    totalAnswered: total,
  };
}

/**
 * @param {Object} report      row from getReport(sessionId) — db/interview.js
 * @param {Array}  scoresData  rows from getSessionScores(sessionId)
 * @param {Array}  questions   rows from getSessionQuestions(sessionId)
 * @param {Object} [persona]   optional { name, title, org } — caller already
 *                              has PERSONAS[report.persona_id] resolved; not
 *                              re-resolved here to keep this file free of
 *                              config-lookup side effects.
 * @returns {Object} CareerIntelligenceReport
 */
function buildCareerIntelligenceReport({ report, scoresData, questions, persona }) {
  if (!report) throw new Error('buildCareerIntelligenceReport: report is required');

  const fiveVectors = VECTOR_DEFINITIONS.reduce((acc, v) => {
    acc[v.key] = round(avgOf(scoresData, v.raw));
    return acc;
  }, {});

  const { ranked, strengths, developmentPriorities } = rankVectors(fiveVectors, 2, report.improvements_json);
  const lowestVector = ranked[ranked.length - 1];

  const startedAt = report.started_at ? new Date(report.started_at) : null;
  const endedAt = report.ended_at ? new Date(report.ended_at) : null;
  const durationMinutes = (startedAt && endedAt)
    ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000))
    : null;

  const answeredQuestions = (questions || []).filter(
    (q) => q.answer_text !== null && q.answer_text !== undefined
  );

  return {
    sessionContext: {
      sessionId: report.session_id,
      role: report.role_title || 'General Professional',
      careerStage: report.experience_level || 'Mid-Career',
      orgPreset: report.org_preset || null,
      interviewerPersona: persona ? { name: persona.name, title: persona.title, org: persona.org } : null,
      questionCount: answeredQuestions.length,
      durationMinutes,
      completedAt: report.ended_at || report.created_at || null,
    },

    // Unchanged — already the same value across Web/PDF/Email today, this
    // was never the source of the divergence.
    overallScore: round(report.overall_score),
    recommendation: report.recommendation || null,

    // Locked 5-vector mapping — see file header. Values are the existing
    // interview_scores averages, unchanged.
    fiveVectors: {
      structure: fiveVectors.structure,
      domainExpertise: fiveVectors.domainExpertise,
      strategicThinking: fiveVectors.strategicThinking,
      communication: fiveVectors.communication,
      leadershipExecution: fiveVectors.leadershipExecution,
    },
    vectorDefinitions: VECTOR_DEFINITIONS.map(({ key, label }) => ({ key, label })),

    starIntelligence: buildStarIntelligence(questions),

    executiveSummary: report.executive_summary || '',

    // Full ranked list — callers (Explorer/Growth/Leadership renderers)
    // slice to the depth their tier allows. Same ranked data underneath
    // every tier, per the locked entitlement matrix.
    strengths,
    developmentPriorities,

    questionEvidence: buildQuestionEvidence(questions, scoresData),

    coachingInsights: {
      structuralFlow: report.structural_flow || null,
      linguisticNuances: report.linguistic_nuances || null,
      personaVerdict: report.persona_verdict || null,
      strongestResponse: safeParse(report.strongest_response, null),
      weakestResponse: safeParse(report.weakest_response, null),
    },

    careerRoadmap: safeParse(report.next_steps_json, []),

    nextPracticeFocus: lowestVector
      ? { vector: lowestVector.vector, label: lowestVector.label, score: lowestVector.score }
      : null,
  };
}

module.exports = { buildCareerIntelligenceReport, VECTOR_DEFINITIONS };
