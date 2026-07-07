// Interview sessions DB access — all queries go through here.
const { pool } = require('./index');

async function createSession({ userId, personaId, roleTitle, experienceLevel, orgPreset, jdText, competencyMatrix }) {
  const result = await pool.query(
    `INSERT INTO interview_sessions (user_id, persona_id, role_title, experience_level, org_preset, jd_text, competency_matrix)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      userId,
      personaId,
      roleTitle || null,
      experienceLevel || null,
      orgPreset || null,
      jdText || null,
      competencyMatrix ? JSON.stringify(competencyMatrix) : null,
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

async function abandonSession(sessionId) {
  await pool.query(
    `UPDATE interview_sessions
     SET ended_at = NOW(), status = 'abandoned'
     WHERE id = $1`,
    [sessionId]
  );
}

async function getSessionQuestions(sessionId) {
  const result = await pool.query(
    `SELECT DISTINCT ON (q.id) q.*, a.answer_text, a.submitted_at as answer_time
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

async function addQuestion({ sessionId, questionText, personaId, questionType, questionOrder }) {
  const result = await pool.query(
    `INSERT INTO interview_questions (session_id, question_text, persona_id, question_type, question_order)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [sessionId, questionText, personaId, questionType, questionOrder]
  );
  return result.rows[0];
}

async function addAnswer({ sessionId, questionId, answerText }) {
  // ON CONFLICT + the unique index from migration 002: if a question has
  // already been answered (including by a concurrent duplicate request
  // that lost the race), this returns no row instead of inserting a
  // second answer. Callers must check for a falsy return.
  const result = await pool.query(
    `INSERT INTO interview_answers (session_id, question_id, answer_text)
     VALUES ($1, $2, $3)
     ON CONFLICT (question_id) DO NOTHING
     RETURNING *`,
    [sessionId, questionId, answerText]
  );
  return result.rows[0] || null;
}

async function addScore({ sessionId, questionId, star, technical, executive, gcc, friction, weighted }) {
  const result = await pool.query(
    `INSERT INTO interview_scores (session_id, question_id, star_score, technical_depth, executive_presence, gcc_readiness, core_friction, weighted_overall)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [sessionId, questionId, star, technical, executive, gcc, friction, weighted]
  );
  return result.rows[0];
}

async function saveReport({ sessionId, overallScore, strengthsJson, improvementsJson, personaVerdict, nextStepsJson, reportMarkdown, executiveSummary, recommendation, strongestResponse, weakestResponse, structuralFlow, linguisticNuances, scoreboard }) {
  const result = await pool.query(
    `INSERT INTO interview_reports (
       session_id, overall_score, strengths_json, improvements_json, persona_verdict,
       next_steps_json, report_markdown, executive_summary, recommendation,
       strongest_response, weakest_response, structural_flow, linguistic_nuances, scoreboard
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (session_id) DO UPDATE SET
       overall_score = $2, strengths_json = $3, improvements_json = $4, persona_verdict = $5,
       next_steps_json = $6, report_markdown = $7, executive_summary = $8, recommendation = $9,
       strongest_response = $10, weakest_response = $11, structural_flow = $12,
       linguistic_nuances = $13, scoreboard = $14
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
    ]
  );
  return result.rows[0];
}

async function getReport(sessionId) {
  const result = await pool.query(
    `SELECT r.*, s.persona_id, s.role_title, s.experience_level, s.org_preset, s.started_at, s.ended_at
     FROM interview_reports r
     JOIN interview_sessions s ON s.id = r.session_id
     WHERE r.session_id = $1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

module.exports = {
  createSession, getSession, getUserSessions, completeSession, abandonSession,
  getSessionQuestions, getSessionScores,
  addQuestion, addAnswer, addScore,
  saveReport, getReport,
};