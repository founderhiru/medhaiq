// Interview sessions DB access — all queries go through here.
const { pool } = require('./index');

async function createSession({ userId, personaId, roleTitle, experienceLevel, orgPreset, jdText, competencyMatrix, resumeCompetencies, resumeContext, storyLibrary, questionBudget, sessionDurationMinutes, executiveExtensionBudget }) {
  const result = await pool.query(
    `INSERT INTO interview_sessions (user_id, persona_id, role_title, experience_level, org_preset, jd_text, competency_matrix, resume_competencies, resume_context, story_library, question_budget, session_duration_minutes, executive_extension_budget)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [
      userId,
      personaId,
      roleTitle || null,
      experienceLevel || null,
      orgPreset || null,
      jdText || null,
      competencyMatrix ? JSON.stringify(competencyMatrix) : null,
      (resumeCompetencies && resumeCompetencies.length) ? JSON.stringify(resumeCompetencies) : null,
      resumeContext ? JSON.stringify(resumeContext) : null,
      (storyLibrary && storyLibrary.length) ? JSON.stringify(storyLibrary) : null,
      // Frozen at creation, never recomputed afterward — plain integers,
      // not a JSON blob (kept simple per explicit instruction: simpler
      // SQL, easier debugging/reporting/Founder Dashboard analytics).
      // NULL if not supplied — routes/interview.js falls back to its
      // pre-existing hardcoded defaults for NULL values.
      questionBudget || null,
      sessionDurationMinutes || null,
      executiveExtensionBudget || null,
    ]
  );
  return result.rows[0];
}

async function getSession(sessionId) {
  const result = await pool.query(
    `SELECT * FROM interview_sessions WHERE id = $1`, [sessionId]
  );
  return result.rows[0] || null;
}

async function getUserSessions(userId, { limit = 20, offset = 0 } = {}) {
  const result = await pool.query(
    `SELECT s.*, r.overall_score as report_score
     FROM interview_sessions s
     LEFT JOIN interview_reports r ON r.session_id = s.id
     WHERE s.user_id = $1
     ORDER BY s.started_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows;
}

async function completeSession(sessionId, overallScore) {
  const result = await pool.query(
    `UPDATE interview_sessions
     SET ended_at = NOW(), overall_score = $2, status = 'completed'
     WHERE id = $1 RETURNING *`,
    [sessionId, overallScore]
  );
  return result.rows[0];
}

// Founder Dashboard diagnostics (bug fix, 2026-07-24; extended 2026-07-24
// follow-up with 'superseded_by_new_session'). Every value here is a
// distinct, analyzable outcome — NULL means "voluntarily ended via the
// candidate's own End Session button", which must stay separate from
// every involuntary/explicit reason below.
const ABANDONED_REASON_ALLOWLIST = new Set([
  'browser_closed',
  'heartbeat_timeout',
  // Feature, 2026-07-24 follow-up: the candidate was shown a recoverable
  // session (Resume / Start New modal, see findRecoverableSession above)
  // and explicitly chose Start New. This is neither a generic
  // cancellation nor an involuntary timeout — the founder specifically
  // asked that this be its own distinguishable outcome, since "candidate
  // deliberately restarted after a recoverable interruption" is a
  // meaningfully different signal for dashboard analytics than either of
  // those.
  'superseded_by_new_session',
]);

async function abandonSession(sessionId, reason) {
  // reason (bug fix, 2026-07-24): optional, for Founder Dashboard
  // diagnostics. Existing callers (candidate's own "End Session" button)
  // pass no reason — NULL there correctly reads as "voluntarily ended,"
  // distinct from an involuntary abandonment. Any reason NOT on the
  // allowlist above is silently treated as null rather than stored
  // verbatim — this function is reachable from a route that now accepts
  // a client-supplied reason (Start New), so an allowlist here is the
  // real trust boundary, not just documentation.
  const safeReason = ABANDONED_REASON_ALLOWLIST.has(reason) ? reason : null;
  await pool.query(
    `UPDATE interview_sessions
     SET ended_at = NOW(), status = 'abandoned', abandoned_reason = $2
     WHERE id = $1`,
    [sessionId, safeReason]
  );
}

// Server-owned session lifecycle management (bug fix, 2026-07-24).
// Refreshes last_activity_at so a genuinely-in-progress session is never
// mistaken for stale — called by the heartbeat endpoint and by ordinary
// in-interview activity (answer submission).
async function touchSessionActivity(sessionId) {
  await pool.query(
    `UPDATE interview_sessions SET last_activity_at = NOW() WHERE id = $1 AND status = 'active'`,
    [sessionId]
  );
}

// Idle-timeout feature (minimal version, 2026-08-05). Updates ONLY on
// genuine candidate actions (submit/skip — see routes/interview.js) —
// never on the unconditional 60s heartbeat above, never on AI speech,
// TTS, score updates, or polling.
async function touchUserActivity(sessionId) {
  await pool.query(
    `UPDATE interview_sessions SET last_user_activity_at = NOW() WHERE id = $1 AND status = 'active'`,
    [sessionId]
  );
}

// Idle-timeout feature (minimal version, 2026-08-05). ended_at is set to
// the session's last real activity, NOT NOW() — minutes billing
// (lib/capability-engine.js's cappedSessionMinutes) computes duration as
// ended_at - started_at, so this excludes all idle time from billing
// with zero changes to the billing logic itself. Any answers/scores
// already saved are untouched.
//
// NON-NEGOTIABLE: The idle timeout must never bill idle time. The
// interview end time must always be recorded as the user's last genuine
// activity timestamp, never the timeout execution timestamp.
async function expireSessionForInactivity(sessionId) {
  await pool.query(
    `UPDATE interview_sessions
     SET status = 'expired',
         ended_at = COALESCE(last_user_activity_at, started_at),
         abandoned_reason = 'inactivity_timeout'
     WHERE id = $1 AND status = 'active'`,
    [sessionId]
  );
}

/**
 * If this user has an ACTIVE session that's gone silent, auto-abandons it
 * and returns the abandoned session's id(s). Two timeouts apply:
 *   - unconfirmedTimeoutMinutes: for a session that NEVER received a real
 *     heartbeat (last_activity_at is still exactly its creation-time
 *     default, since the candidate never actually reached the live
 *     interview page — a failed launch attempt, not a genuine interview).
 *     Deliberately short (bug fix, 2026-07-24, same-day follow-up):
 *     several repeated test launches during debugging created sessions
 *     that were never confirmed active at all, and the original single,
 *     longer timeout correctly-but-unhelpfully treated every one of them
 *     as "still recent" for a full 10 minutes.
 *   - confirmedTimeoutMinutes: for a session that WAS confirmed active
 *     (at least one real heartbeat/activity landed) and has since gone
 *     silent — SESSION_RECOVERY_WINDOW_MINUTES (config/plans.js). Beyond
 *     this, a session is auto-abandoned unconditionally, fully
 *     automatic, no candidate interaction (this function's job).
 *     WITHIN this window but past the grace period is handled instead by
 *     findRecoverableSession() below — that's the "Resume / Start New"
 *     case, not an auto-abandon.
 * Returns null (not abandoned — genuinely recent, either case) if neither
 * condition is met; a real conflict, not something to silently clear.
 * Loops until no more stale sessions remain for this user.
 */
async function abandonStaleActiveSession(userId, confirmedTimeoutMinutes, reason, unconfirmedTimeoutMinutes) {
  const abandonedIds = [];
  const effectiveUnconfirmedTimeout = unconfirmedTimeoutMinutes || confirmedTimeoutMinutes;
  // Bounded loop — a real backlog is small (accumulated test/crash
  // sessions), and this guards against ever looping indefinitely if
  // something unexpected keeps producing "stale" rows.
  for (let i = 0; i < 20; i++) {
    const result = await pool.query(
      `UPDATE interview_sessions
       SET ended_at = NOW(), status = 'abandoned', abandoned_reason = $4
       WHERE id = (
         SELECT id FROM interview_sessions
         WHERE user_id = $1 AND status = 'active'
           AND (
             -- Never confirmed active (no heartbeat ever landed) -> short timeout
             (last_activity_at = started_at AND last_activity_at < NOW() - ($3 || ' minutes')::interval)
             OR
             -- Confirmed active at least once, then went silent -> full timeout
             (last_activity_at > started_at AND last_activity_at < NOW() - ($2 || ' minutes')::interval)
           )
         ORDER BY last_activity_at ASC
         LIMIT 1
       )
       RETURNING id`,
      [userId, confirmedTimeoutMinutes, effectiveUnconfirmedTimeout, reason || 'heartbeat_timeout']
    );
    if (!result.rows.length) break;
    abandonedIds.push(result.rows[0].id);
  }
  return abandonedIds;
}

/**
 * Three-tier session recovery (feature, 2026-07-24 follow-up). Call this
 * ONLY after abandonStaleActiveSession has already cleared anything past
 * SESSION_RECOVERY_WINDOW_MINUTES — this function's job is the middle
 * tier specifically: a CONFIRMED session (real progress exists) that has
 * gone quiet longer than graceMinutes (so it's not just "another tab,
 * still pinging") but is still within recoveryWindowMinutes (so it
 * hasn't been auto-abandoned). Returns the session's basic progress info
 * for the Resume/Start New modal, or null if no such session exists
 * (either genuinely live — within grace — or none active at all).
 *
 * Progress is a simple answered-question count (not distinguishing
 * primary vs. follow-up — that distinction lives in routes/interview.js
 * and isn't worth importing here just for a rough "Question 3 of 5"
 * display string).
 */
async function findRecoverableSession(userId, graceMinutes, recoveryWindowMinutes) {
  const result = await pool.query(
    `SELECT s.id, s.role_title, s.persona_id, s.started_at, s.last_activity_at,
            (SELECT COUNT(*) FROM interview_questions q
             JOIN interview_answers a ON a.question_id = q.id
             WHERE q.session_id = s.id) AS answered_count
     FROM interview_sessions s
     WHERE s.user_id = $1 AND s.status = 'active'
       AND s.last_activity_at > s.started_at
       AND s.last_activity_at < NOW() - ($2 || ' minutes')::interval
       AND s.last_activity_at > NOW() - ($3 || ' minutes')::interval
     ORDER BY s.last_activity_at DESC
     LIMIT 1`,
    [userId, graceMinutes, recoveryWindowMinutes]
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    roleTitle: row.role_title,
    personaId: row.persona_id,
    answeredCount: parseInt(row.answered_count, 10) || 0,
    lastActiveAt: row.last_activity_at,
  };
}

async function getSessionQuestions(sessionId) {
  const result = await pool.query(
    `SELECT DISTINCT ON (q.id) q.*, a.answer_text, a.submitted_at as answer_time, a.response_intent
     FROM interview_questions q
     LEFT JOIN interview_answers a ON a.question_id = q.id
     WHERE q.session_id = $1
     ORDER BY q.id, a.submitted_at DESC`,
    [sessionId]
  );
  // Re-sort by question_order after DISTINCT ON
  return result.rows.sort((a, b) => (a.question_order || a.id) - (b.question_order || b.id));
}

async function getSessionScores(sessionId) {
  const result = await pool.query(
    `SELECT s.*
     FROM interview_scores s
     WHERE s.session_id = $1
     ORDER BY s.question_id`,
    [sessionId]
  );
  return result.rows;
}

// New for the Career Workspace (Home) page's Interview Insights panel.
// Same 5 columns interview-report.ejs already averages per-session
// (star_score, technical_depth, executive_presence, gcc_readiness,
// core_friction) — this just averages them across ALL of a user's
// sessions instead of one. No schema change; additive query only.
async function getUserAggregateScores(userId) {
  const result = await pool.query(
    `SELECT
       AVG(sc.star_score)::float          AS star_avg,
       AVG(sc.technical_depth)::float     AS technical_avg,
       AVG(sc.executive_presence)::float  AS executive_avg,
       AVG(sc.gcc_readiness)::float       AS gcc_avg,
       AVG(sc.core_friction)::float       AS friction_avg
     FROM interview_scores sc
     JOIN interview_sessions s ON s.id = sc.session_id
     WHERE s.user_id = $1`,
    [userId]
  );
  const row = result.rows[0] || {};
  const toNum = (v) => (v === null || v === undefined) ? null : Number(v);
  return {
    starAvg: toNum(row.star_avg),
    technicalAvg: toNum(row.technical_avg),
    executiveAvg: toNum(row.executive_avg),
    gccAvg: toNum(row.gcc_avg),
    frictionAvg: toNum(row.friction_avg),
  };
}

async function addQuestion({ sessionId, questionText, personaId, questionType, questionOrder, competency, storyKey, parentQuestionId, questionBlueprint, questionPosition, strategySource, strategyPurpose }) {
  const result = await pool.query(
    `INSERT INTO interview_questions (session_id, question_text, persona_id, question_type, question_order, competency, story_key, parent_question_id, question_blueprint, question_position, strategy_source, strategy_purpose)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [sessionId, questionText, personaId, questionType, questionOrder, competency || null, storyKey || null, parentQuestionId || null, questionBlueprint ? JSON.stringify(questionBlueprint) : null, Number.isInteger(questionPosition) ? questionPosition : null, strategySource || null, strategyPurpose || null]
  );
  return result.rows[0];
}

async function addAnswer({ sessionId, questionId, answerText, responseIntent }) {
  // ON CONFLICT + the unique index from migration 002: if a question has
  // already been answered (including by a concurrent duplicate request
  // that lost the race), this returns no row instead of inserting a
  // second answer. Callers must check for a falsy return.
  //
  // responseIntent (migration 025, approved 2026-08-13): one of 'ANSWER',
  // 'SKIP', 'DONT_KNOW' — passed explicitly by every NEW call site in
  // routes/interview.js's processInterviewAnswer(). Defaults to null only
  // if a caller omits it, which should not happen for any live code path
  // after this change; null is reserved for rows that predate this
  // migration and must never be treated as an implicit ANSWER by any
  // downstream consumer.
  const result = await pool.query(
    `INSERT INTO interview_answers (session_id, question_id, answer_text, response_intent)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (question_id) DO NOTHING
     RETURNING *`,
    [sessionId, questionId, answerText, responseIntent || null]
  );
  return result.rows[0] || null;
}

// Bounded reprompt loop (migration 030, 2026-08-31): a question that gets
// reprompted (SPARSE/OFF_TOPIC/NON_RESPONSIVE) never reaches addAnswer()
// above -- the question isn't "finally answered" yet, so its retry count
// has to live on interview_questions itself, the one row that persists
// across however many times the SAME question gets reprompted. Atomic
// increment-and-return (not a separate read then write) so two
// near-simultaneous requests for the same question can never both read a
// stale count and both decide "this is still attempt #1".
async function incrementRepromptCount(questionId) {
  const result = await pool.query(
    `UPDATE interview_questions SET reprompt_count = reprompt_count + 1
     WHERE id = $1 RETURNING reprompt_count`,
    [questionId]
  );
  return result.rows[0] ? result.rows[0].reprompt_count : null;
}

async function addScore({ sessionId, questionId, star, technical, executive, gcc, friction, weighted }) {
  const result = await pool.query(
    `INSERT INTO interview_scores (session_id, question_id, star_score, technical_depth, executive_presence, gcc_readiness, core_friction, weighted_overall)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [sessionId, questionId, star, technical, executive, gcc, friction, weighted]
  );
  return result.rows[0];
}

async function saveReport({ sessionId, overallScore, strengthsJson, improvementsJson, personaVerdict, nextStepsJson, reportMarkdown, executiveSummary, recommendation, strongestResponse, weakestResponse, structuralFlow, linguisticNuances, scoreboard, executiveInterpretation, roleReadiness, nextLevelDirection }) {
  const result = await pool.query(
    `INSERT INTO interview_reports (
       session_id, overall_score, strengths_json, improvements_json, persona_verdict,
       next_steps_json, report_markdown, executive_summary, recommendation,
       strongest_response, weakest_response, structural_flow, linguistic_nuances, scoreboard,
       executive_interpretation, role_readiness, next_level_direction
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (session_id) DO UPDATE SET
       overall_score = $2, strengths_json = $3, improvements_json = $4, persona_verdict = $5,
       next_steps_json = $6, report_markdown = $7, executive_summary = $8, recommendation = $9,
       strongest_response = $10, weakest_response = $11, structural_flow = $12,
       linguistic_nuances = $13, scoreboard = $14,
       executive_interpretation = $15, role_readiness = $16, next_level_direction = $17
     RETURNING *`,
    [
      sessionId, overallScore,
      JSON.stringify(strengthsJson), JSON.stringify(improvementsJson),
      personaVerdict, JSON.stringify(nextStepsJson), reportMarkdown,
      executiveSummary || null, recommendation || null,
      strongestResponse ? JSON.stringify(strongestResponse) : null,
      weakestResponse ? JSON.stringify(weakestResponse) : null,
      structuralFlow || null, linguisticNuances || null,
      scoreboard ? JSON.stringify(scoreboard) : null,
      executiveInterpretation || null, roleReadiness || null, nextLevelDirection || null,
    ]
  );
  return result.rows[0];
}

async function getReport(sessionId) {
  const result = await pool.query(
    `SELECT r.*, s.user_id, s.persona_id, s.role_title, s.experience_level, s.org_preset, s.started_at, s.ended_at
     FROM interview_reports r
     JOIN interview_sessions s ON s.id = r.session_id
     WHERE r.session_id = $1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

// Added — the report page was calling this but it didn't exist anywhere in
// this codebase, causing "getUserCompletedReportCount is not a function".
// Purely additive: counts how many of this user's sessions have a
// completed report, using the same status='completed' value completeSession()
// already writes. If the real call site expects a different signature or
// semantics, this is a safe starting point to adjust rather than a guess
// that could break anything currently working (nothing currently calls it).
async function getUserCompletedReportCount(userId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM interview_sessions s
     JOIN interview_reports r ON r.session_id = s.id
     WHERE s.user_id = $1 AND s.status = 'completed'`,
    [userId]
  );
  return result.rows[0]?.count || 0;
}

module.exports = {
  createSession, getSession, getUserSessions, completeSession, abandonSession,
  touchSessionActivity, touchUserActivity, expireSessionForInactivity,
  abandonStaleActiveSession, findRecoverableSession,
  getSessionQuestions, getSessionScores, getUserAggregateScores,
  addQuestion, addAnswer, addScore, incrementRepromptCount,
  saveReport, getReport, getUserCompletedReportCount,
};