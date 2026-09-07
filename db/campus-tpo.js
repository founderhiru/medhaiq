// db/campus-tpo.js — Campus Ready Phase 2 institution-admin (TPO) side.
//
// Isolation contract, same shape as db/campus.js's own comment: every
// query here touches ONLY campus_* / institutions tables, plus read-only
// joins to users(id, name, email) for display. Nothing here writes
// learner progress — this file is read-mostly aggregate/reporting
// queries and the institution_admins grant, kept separate from
// db/campus.js so the learner-facing write path doesn't grow alongside
// the TPO-facing read path.

const { pool } = require('./index');

// ── Authorization ─────────────────────────────────────────────────────────

async function isInstitutionAdmin(userId, institutionId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM campus_institution_admins WHERE user_id = $1 AND institution_id = $2`,
    [userId, institutionId]
  );
  return rows.length > 0;
}

async function listInstitutionsForAdmin(userId) {
  const { rows } = await pool.query(
    `SELECT i.* FROM institutions i
     JOIN campus_institution_admins a ON a.institution_id = i.id
     WHERE a.user_id = $1
     ORDER BY i.name`,
    [userId]
  );
  return rows;
}

// Founder-only — direct grant, no token/invite flow (see server.js /
// routes/campus-admin.js). findOrCreateUser is the existing, unmodified
// db/auth.js function; this file only ever reads/writes the
// campus_institution_admins row itself.
async function grantInstitutionAdmin(institutionId, userId) {
  const { rows } = await pool.query(
    `INSERT INTO campus_institution_admins (institution_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (institution_id, user_id) DO NOTHING
     RETURNING *`,
    [institutionId, userId]
  );
  return rows[0] || null;
}

async function listInstitutionAdmins(institutionId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, a.created_at
     FROM campus_institution_admins a
     JOIN users u ON u.id = a.user_id
     WHERE a.institution_id = $1
     ORDER BY a.created_at`,
    [institutionId]
  );
  return rows;
}

// ── Cohort-level aggregates ─────────────────────────────────────────────

async function listCohortsForInstitutionTpo(institutionId) {
  const { rows } = await pool.query(
    `SELECT c.*, (SELECT COUNT(*) FROM campus_learners l WHERE l.cohort_id = c.id) AS learner_count
     FROM campus_cohorts c WHERE c.institution_id = $1 ORDER BY c.created_at DESC`,
    [institutionId]
  );
  return rows;
}

async function getCohortWithInstitution(cohortId) {
  const { rows } = await pool.query(
    `SELECT c.*, i.id AS institution_id, i.name AS institution_name
     FROM campus_cohorts c JOIN institutions i ON i.id = c.institution_id
     WHERE c.id = $1`,
    [cohortId]
  );
  return rows[0] || null;
}

const TOTAL_MODULES_SQL = `(SELECT COUNT(*)::int FROM campus_modules)`;

// Deliberately plain counts and percentages only — no invented
// "readiness score." Section 12's explicit boundary.
async function getCohortSnapshot(cohortId) {
  const totalsQ = await pool.query(
    `SELECT
       COUNT(*)::int AS enrolled,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM campus_module_progress p WHERE p.learner_id = l.id
       ))::int AS started,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM campus_module_progress p
         WHERE p.learner_id = l.id AND p.updated_at > NOW() - INTERVAL '7 days'
       ))::int AS active_7d,
       COUNT(*) FILTER (WHERE (
         SELECT COUNT(*)::int FROM campus_module_progress p
         WHERE p.learner_id = l.id AND p.status = 'complete'
       ) = ${TOTAL_MODULES_SQL})::int AS completed
     FROM campus_learners l WHERE l.cohort_id = $1`,
    [cohortId]
  );
  const quizAccQ = await pool.query(
    `SELECT ROUND(AVG(CASE WHEN qr.is_correct THEN 100.0 ELSE 0 END))::int AS avg_accuracy
     FROM campus_quiz_responses qr
     JOIN campus_learners l ON l.id = qr.learner_id
     WHERE l.cohort_id = $1`,
    [cohortId]
  );
  const totals = totalsQ.rows[0];
  return {
    ...totals,
    completionPct: totals.enrolled > 0 ? Math.round((totals.completed / totals.enrolled) * 100) : 0,
    avgQuizAccuracy: quizAccQ.rows[0].avg_accuracy || 0,
  };
}

async function getModulePerformance(cohortId) {
  const { rows } = await pool.query(
    `SELECT m.id, m.name, m.sequence,
       COUNT(p.*) FILTER (WHERE p.status = 'complete')::int AS complete_count,
       COUNT(p.*) FILTER (WHERE p.status = 'in_progress')::int AS in_progress_count,
       (SELECT COUNT(*)::int FROM campus_learners l2 WHERE l2.cohort_id = $1) -
         COUNT(p.*) FILTER (WHERE p.status IN ('complete','in_progress'))::int AS not_started_count,
       COALESCE(ROUND(AVG(p.percent_complete)), 0)::int AS avg_percent
     FROM campus_modules m
     LEFT JOIN campus_learners l ON l.cohort_id = $1
     LEFT JOIN campus_module_progress p ON p.module_id = m.id AND p.learner_id = l.id
     GROUP BY m.id, m.name, m.sequence ORDER BY m.sequence`,
    [cohortId]
  );
  const quizQ = await pool.query(
    `SELECT t.module_id, ROUND(AVG(CASE WHEN qr.is_correct THEN 100.0 ELSE 0 END))::int AS avg_accuracy
     FROM campus_quiz_responses qr
     JOIN campus_learners l ON l.id = qr.learner_id AND l.cohort_id = $1
     JOIN campus_content_items ci ON ci.id = qr.content_item_id
     JOIN campus_topics t ON t.id = ci.topic_id
     GROUP BY t.module_id`,
    [cohortId]
  );
  const quizMap = new Map(quizQ.rows.map(r => [r.module_id, r.avg_accuracy]));
  return rows.map(r => ({ ...r, avgQuizAccuracy: quizMap.get(r.id) || 0 }));
}

// ── Student table + detail ─────────────────────────────────────────────

async function listStudents(cohortId) {
  const studentsQ = await pool.query(
    `SELECT l.id AS learner_id, u.name, u.email, l.joined_at, l.status,
       COALESCE(ROUND(AVG(p.percent_complete)), 0)::int AS overall_progress,
       (SELECT MAX(x.updated_at) FROM campus_module_progress x WHERE x.learner_id = l.id) AS last_active
     FROM campus_learners l
     JOIN users u ON u.id = l.user_id
     LEFT JOIN campus_module_progress p ON p.learner_id = l.id
     WHERE l.cohort_id = $1
     GROUP BY l.id, u.name, u.email, l.joined_at, l.status
     ORDER BY u.name`,
    [cohortId]
  );
  const quizQ = await pool.query(
    `SELECT qr.learner_id, ROUND(AVG(CASE WHEN qr.is_correct THEN 100.0 ELSE 0 END))::int AS accuracy
     FROM campus_quiz_responses qr JOIN campus_learners l ON l.id = qr.learner_id WHERE l.cohort_id = $1
     GROUP BY qr.learner_id`,
    [cohortId]
  );
  const quizMap = new Map(quizQ.rows.map(r => [r.learner_id, r.accuracy]));

  const totalPracticeItemsQ = await pool.query(
    `SELECT COUNT(*)::int AS n FROM campus_content_items WHERE item_type = 'practice_prompt' AND is_active = true`
  );
  const totalPracticeItems = totalPracticeItemsQ.rows[0].n;
  const practiceQ = await pool.query(
    `SELECT ps.learner_id, COUNT(DISTINCT ps.content_item_id)::int AS n
     FROM campus_practice_submissions ps JOIN campus_learners l ON l.id = ps.learner_id WHERE l.cohort_id = $1
     GROUP BY ps.learner_id`,
    [cohortId]
  );
  const practiceMap = new Map(practiceQ.rows.map(r => [r.learner_id, r.n]));

  return studentsQ.rows.map(r => {
    const practiceCompletionPct = totalPracticeItems > 0
      ? Math.round(((practiceMap.get(r.learner_id) || 0) / totalPracticeItems) * 100) : 0;
    const inactive7d = r.last_active && new Date(r.last_active) < new Date(Date.now() - 7 * 24 * 3600 * 1000);
    let status = 'Not Started';
    if (r.overall_progress >= 100) status = 'Completed';
    else if (inactive7d) status = 'Inactive';
    else if (r.overall_progress > 0 || r.last_active) status = 'In Progress';
    return {
      learnerId: r.learner_id, name: r.name, email: r.email, joinedAt: r.joined_at,
      overallProgress: r.overall_progress, quizAccuracy: quizMap.get(r.learner_id) || 0,
      practiceCompletionPct, lastActive: r.last_active, status,
    };
  });
}

async function getStudentDetail(learnerId) {
  const learnerQ = await pool.query(
    `SELECT l.id AS learner_id, l.joined_at, l.cohort_id, u.name, u.email,
            c.name AS cohort_name, i.id AS institution_id, i.name AS institution_name
     FROM campus_learners l
     JOIN users u ON u.id = l.user_id
     JOIN campus_cohorts c ON c.id = l.cohort_id
     JOIN institutions i ON i.id = c.institution_id
     WHERE l.id = $1`,
    [learnerId]
  );
  const learner = learnerQ.rows[0];
  if (!learner) return null;

  const modulesQ = await pool.query(
    `SELECT m.id, m.name, m.sequence,
            COALESCE(p.status, 'not_started') AS status,
            COALESCE(p.percent_complete, 0) AS percent_complete
     FROM campus_modules m
     LEFT JOIN campus_module_progress p ON p.module_id = m.id AND p.learner_id = $1
     ORDER BY m.sequence`,
    [learnerId]
  );
  const quizQ = await pool.query(
    `SELECT COUNT(*)::int AS attempted, COUNT(*) FILTER (WHERE is_correct)::int AS correct
     FROM campus_quiz_responses WHERE learner_id = $1`,
    [learnerId]
  );
  const practiceQ = await pool.query(
    `SELECT COUNT(DISTINCT content_item_id)::int AS n FROM campus_practice_submissions WHERE learner_id = $1`,
    [learnerId]
  );
  const totalPracticeItemsQ = await pool.query(
    `SELECT COUNT(*)::int AS n FROM campus_content_items WHERE item_type = 'practice_prompt' AND is_active = true`
  );
  const totalTopicsQ = await pool.query(`SELECT COUNT(*)::int AS n FROM campus_topics`);

  const { attempted, correct } = quizQ.rows[0];
  const overallProgress = modulesQ.rows.length
    ? Math.round(modulesQ.rows.reduce((s, m) => s + Number(m.percent_complete), 0) / modulesQ.rows.length) : 0;
  const topicsCompleted = Math.round((overallProgress / 100) * totalTopicsQ.rows[0].n);

  return {
    learnerId: learner.learner_id, name: learner.name, email: learner.email,
    joinedAt: learner.joined_at, cohortId: learner.cohort_id, cohortName: learner.cohort_name,
    institutionId: learner.institution_id, institutionName: learner.institution_name,
    overallProgress,
    modules: modulesQ.rows,
    quizAccuracy: attempted > 0 ? Math.round((correct / attempted) * 100) : 0,
    practiceCompletionPct: totalPracticeItemsQ.rows[0].n > 0
      ? Math.round((practiceQ.rows[0].n / totalPracticeItemsQ.rows[0].n) * 100) : 0,
    topicsCompleted, topicsTotal: totalTopicsQ.rows[0].n,
  };
}

// ── Deterministic insights (Section 15) — no LLM, pure DB values ───────

function computeInsights(modulePerf, students) {
  const insights = [];
  if (!students.length) return insights;

  const lowestCompletion = modulePerf.reduce((a, b) => (a.avg_percent < b.avg_percent ? a : b), modulePerf[0]);
  if (lowestCompletion) insights.push(`${lowestCompletion.name} has the lowest cohort completion (${lowestCompletion.avg_percent}%).`);

  const mostNotStarted = modulePerf.reduce((a, b) => (a.not_started_count > b.not_started_count ? a : b), modulePerf[0]);
  if (mostNotStarted && mostNotStarted.not_started_count > 0) {
    insights.push(`${mostNotStarted.not_started_count} student${mostNotStarted.not_started_count === 1 ? '' : 's'} have not started ${mostNotStarted.name}.`);
  }

  const inactiveCount = students.filter(s => s.status === 'Inactive').length;
  if (inactiveCount > 0) insights.push(`${inactiveCount} student${inactiveCount === 1 ? '' : 's'} have been inactive for 7+ days.`);

  const lowestQuiz = modulePerf.reduce((a, b) => (a.avgQuizAccuracy < b.avgQuizAccuracy ? a : b), modulePerf[0]);
  if (lowestQuiz) insights.push(`${lowestQuiz.name} quiz accuracy is ${lowestQuiz.avgQuizAccuracy}%.`);

  const nearComplete = students.filter(s => s.overallProgress >= 90 && s.overallProgress < 100).length;
  if (nearComplete > 0) insights.push(`${nearComplete} student${nearComplete === 1 ? ' is' : 's are'} within 10% of completion.`);

  return insights;
}

module.exports = {
  isInstitutionAdmin, listInstitutionsForAdmin, grantInstitutionAdmin, listInstitutionAdmins,
  listCohortsForInstitutionTpo, getCohortWithInstitution, getCohortSnapshot, getModulePerformance,
  listStudents, getStudentDetail, computeInsights,
};
