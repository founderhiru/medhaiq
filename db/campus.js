// db/campus.js — Campus Ready V1 data access.
//
// Isolation contract: every query here touches ONLY the campus_* tables
// plus a read-only FK reference to users(id) for identity. Nothing here
// reads or writes interview_sessions, package_acquisitions, or any table
// owned by the individual product. No file outside db/campus.js and
// routes/campus*.js should import from here.

const { pool } = require('./index');
const crypto = require('crypto');

// ── Institutions & Cohorts (founder-admin side) ─────────────────────────

async function createInstitution({ name, contactName, contactEmail }) {
  const { rows } = await pool.query(
    `INSERT INTO institutions (name, contact_name, contact_email)
     VALUES ($1, $2, $3) RETURNING *`,
    [name, contactName || null, contactEmail || null]
  );
  return rows[0];
}

async function listInstitutions() {
  const { rows } = await pool.query(
    `SELECT i.*,
       (SELECT COUNT(*) FROM campus_cohorts c WHERE c.institution_id = i.id) AS cohort_count
     FROM institutions i ORDER BY i.created_at DESC`
  );
  return rows;
}

async function getInstitution(id) {
  const { rows } = await pool.query(`SELECT * FROM institutions WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function createCohort({ institutionId, name, learnerLimit, startsAt, endsAt }) {
  const { rows } = await pool.query(
    `INSERT INTO campus_cohorts (institution_id, name, learner_limit, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [institutionId, name, learnerLimit || null, startsAt || null, endsAt || null]
  );
  return rows[0];
}

async function listCohortsForInstitution(institutionId) {
  const { rows } = await pool.query(
    `SELECT c.*,
       (SELECT COUNT(*) FROM campus_learners l WHERE l.cohort_id = c.id) AS learner_count
     FROM campus_cohorts c WHERE c.institution_id = $1 ORDER BY c.created_at DESC`,
    [institutionId]
  );
  return rows;
}

async function getCohort(id) {
  const { rows } = await pool.query(
    `SELECT c.*, i.name AS institution_name
     FROM campus_cohorts c JOIN institutions i ON i.id = c.institution_id
     WHERE c.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// ── Invites & Join ───────────────────────────────────────────────────────

async function createLearnerInvite({ cohortId, email, invitedByUserId }) {
  const token = crypto.randomBytes(24).toString('hex');
  const { rows } = await pool.query(
    `INSERT INTO campus_learner_invites (cohort_id, email, invite_token, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 days')
     ON CONFLICT (cohort_id, LOWER(email)) DO UPDATE SET invite_token = EXCLUDED.invite_token
     RETURNING *`,
    [cohortId, email, token, invitedByUserId || null]
  );
  return rows[0];
}

async function getInviteByToken(token) {
  const { rows } = await pool.query(
    `SELECT * FROM campus_learner_invites WHERE invite_token = $1`,
    [token]
  );
  return rows[0] || null;
}

// Trusts a valid, unexpired token as proof of institutional invitation —
// V1 does not re-verify the logged-in user's email matches the invited
// email (a pilot-scale simplification the founder can tighten later).
async function acceptInvite(token, userId) {
  const invite = await getInviteByToken(token);
  if (!invite) return { ok: false, reason: 'INVITE_NOT_FOUND' };
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return { ok: false, reason: 'INVITE_EXPIRED' };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO campus_learners (user_id, cohort_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, cohort_id) DO UPDATE SET status = 'active'
       RETURNING *`,
      [userId, invite.cohort_id]
    );
    await client.query(
      `UPDATE campus_learner_invites SET status = 'accepted', accepted_at = NOW() WHERE id = $1`,
      [invite.id]
    );
    await client.query('COMMIT');
    return { ok: true, learner: rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getLearnerForUser(userId) {
  // V1 assumption: one active cohort membership per user. If a user
  // somehow has more than one, the most recently joined wins.
  const { rows } = await pool.query(
    `SELECT l.*, c.name AS cohort_name, i.name AS institution_name
     FROM campus_learners l
     JOIN campus_cohorts c ON c.id = l.cohort_id
     JOIN institutions i ON i.id = c.institution_id
     WHERE l.user_id = $1 AND l.status = 'active'
     ORDER BY l.joined_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

// ── Modules, Topics, Content ─────────────────────────────────────────────

async function listModules() {
  const { rows } = await pool.query(`SELECT * FROM campus_modules ORDER BY sequence`);
  return rows;
}

async function getModuleByKey(key) {
  const { rows } = await pool.query(`SELECT * FROM campus_modules WHERE key = $1`, [key]);
  return rows[0] || null;
}

async function getModuleContent(moduleId) {
  const { rows } = await pool.query(
    `SELECT t.id AS topic_id, t.key AS topic_key, t.name AS topic_name, t.sequence AS topic_sequence,
            ci.id AS item_id, ci.item_type, ci.prompt_text, ci.answer_guidance,
            ci.options, ci.common_mistake_notes, ci.sequence AS item_sequence
     FROM campus_topics t
     JOIN campus_content_items ci ON ci.topic_id = t.id AND ci.is_active = true
     WHERE t.module_id = $1
     ORDER BY t.sequence, ci.item_type, ci.sequence`,
    [moduleId]
  );
  // Group into topics; quiz options are sent WITHOUT correct_option_id —
  // that stays server-side until the learner submits an answer.
  const topicsMap = new Map();
  for (const r of rows) {
    if (!topicsMap.has(r.topic_id)) {
      topicsMap.set(r.topic_id, { id: r.topic_id, key: r.topic_key, name: r.topic_name, items: [] });
    }
    topicsMap.get(r.topic_id).items.push({
      id: r.item_id,
      type: r.item_type,
      prompt: r.prompt_text,
      guidance: r.item_type === 'learn_example' ? r.answer_guidance : undefined,
      mistakes: r.item_type === 'learn_example' ? r.common_mistake_notes : undefined,
      options: r.item_type === 'quiz_question' ? r.options : undefined,
    });
  }
  return Array.from(topicsMap.values());
}

// ── Progress & Submissions ───────────────────────────────────────────────

async function submitPractice({ learnerId, contentItemId, responseText }) {
  await pool.query(
    `INSERT INTO campus_practice_submissions (learner_id, content_item_id, response_text)
     VALUES ($1, $2, $3)`,
    [learnerId, contentItemId, responseText]
  );
}

async function submitQuizAnswer({ learnerId, contentItemId, selectedOptionId }) {
  const { rows } = await pool.query(
    `SELECT correct_option_id, answer_guidance FROM campus_content_items WHERE id = $1`,
    [contentItemId]
  );
  const item = rows[0];
  if (!item) return null;
  const isCorrect = item.correct_option_id === selectedOptionId;
  await pool.query(
    `INSERT INTO campus_quiz_responses (learner_id, content_item_id, selected_option_id, is_correct)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (learner_id, content_item_id)
     DO UPDATE SET selected_option_id = EXCLUDED.selected_option_id, is_correct = EXCLUDED.is_correct, submitted_at = NOW()`,
    [learnerId, contentItemId, selectedOptionId, isCorrect]
  );
  return { isCorrect, correctOptionId: item.correct_option_id, explanation: item.answer_guidance };
}

const { PRACTICE_REQUIRED_PER_MODULE, QUIZ_PASS_THRESHOLD } = require('../config/campus-ready');

// No scoring, no rubric — just completion counting, per founder's
// explicit V1 boundary (no AI/keyword scoring, no readiness verdict).
async function recomputeModuleProgress(learnerId, moduleId) {
  const practiceCountQ = await pool.query(
    `SELECT COUNT(*)::int AS n FROM campus_practice_submissions ps
     JOIN campus_content_items ci ON ci.id = ps.content_item_id
     JOIN campus_topics t ON t.id = ci.topic_id
     WHERE ps.learner_id = $1 AND t.module_id = $2`,
    [learnerId, moduleId]
  );
  const quizStatsQ = await pool.query(
    `SELECT COUNT(*)::int AS attempted, COUNT(*) FILTER (WHERE qr.is_correct)::int AS correct
     FROM campus_quiz_responses qr
     JOIN campus_content_items ci ON ci.id = qr.content_item_id
     JOIN campus_topics t ON t.id = ci.topic_id
     WHERE qr.learner_id = $1 AND t.module_id = $2`,
    [learnerId, moduleId]
  );
  const totalQuizQ = await pool.query(
    `SELECT COUNT(*)::int AS n FROM campus_content_items ci
     JOIN campus_topics t ON t.id = ci.topic_id
     WHERE t.module_id = $1 AND ci.item_type = 'quiz_question' AND ci.is_active = true`,
    [moduleId]
  );

  const practiceCount = practiceCountQ.rows[0].n;
  const { attempted, correct } = quizStatsQ.rows[0];
  const totalQuiz = totalQuizQ.rows[0].n;

  const practicePct = Math.min(1, practiceCount / PRACTICE_REQUIRED_PER_MODULE);
  const quizAccuracy = attempted > 0 ? correct / attempted : 0;
  const quizCoveragePct = totalQuiz > 0 ? Math.min(1, attempted / totalQuiz) : 0;
  const quizPassed = totalQuiz > 0 && attempted >= totalQuiz && quizAccuracy >= QUIZ_PASS_THRESHOLD;

  const percentComplete = Math.round(((practicePct + quizCoveragePct) / 2) * 100);
  const status = (practiceCount >= PRACTICE_REQUIRED_PER_MODULE && quizPassed)
    ? 'complete'
    : (practiceCount > 0 || attempted > 0) ? 'in_progress' : 'not_started';

  const { rows } = await pool.query(
    `INSERT INTO campus_module_progress (learner_id, module_id, status, percent_complete, quiz_passed, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (learner_id, module_id)
     DO UPDATE SET status = EXCLUDED.status, percent_complete = EXCLUDED.percent_complete,
                   quiz_passed = EXCLUDED.quiz_passed, updated_at = NOW()
     RETURNING *`,
    [learnerId, moduleId, status, percentComplete, quizPassed]
  );
  return rows[0];
}

async function listModulesWithProgress(learnerId) {
  const { rows } = await pool.query(
    `SELECT m.id, m.key, m.name, m.sequence, m.description,
            COALESCE(p.status, 'not_started') AS status,
            COALESCE(p.percent_complete, 0) AS percent_complete
     FROM campus_modules m
     LEFT JOIN campus_module_progress p ON p.module_id = m.id AND p.learner_id = $1
     ORDER BY m.sequence`,
    [learnerId]
  );
  return rows;
}

// ── Founder-facing aggregate analytics (counts only — no per-learner
//    answer content, per the privacy boundary in the architecture doc) ──

async function getCohortAnalytics(cohortId) {
  const totalsQ = await pool.query(
    `SELECT COUNT(*)::int AS total_learners,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM campus_module_progress p WHERE p.learner_id = l.id
            ))::int AS started
     FROM campus_learners l WHERE l.cohort_id = $1 AND l.status = 'active'`,
    [cohortId]
  );
  const moduleBreakdownQ = await pool.query(
    `SELECT m.name,
            COUNT(p.*) FILTER (WHERE p.status = 'complete')::int AS complete_count,
            COUNT(p.*) FILTER (WHERE p.status = 'in_progress')::int AS in_progress_count,
            ROUND(AVG(p.percent_complete))::int AS avg_percent
     FROM campus_modules m
     LEFT JOIN campus_module_progress p ON p.module_id = m.id
     LEFT JOIN campus_learners l ON l.id = p.learner_id AND l.cohort_id = $1
     GROUP BY m.name, m.sequence ORDER BY m.sequence`,
    [cohortId]
  );
  return { totals: totalsQ.rows[0], moduleBreakdown: moduleBreakdownQ.rows };
}

module.exports = {
  createInstitution, listInstitutions, getInstitution,
  createCohort, listCohortsForInstitution, getCohort,
  createLearnerInvite, getInviteByToken, acceptInvite, getLearnerForUser,
  listModules, getModuleByKey, getModuleContent,
  submitPractice, submitQuizAnswer, recomputeModuleProgress, listModulesWithProgress,
  getCohortAnalytics,
};
