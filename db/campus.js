// db/campus.js — Campus Ready V1 data access.
//
// Isolation contract: every query here touches ONLY the campus_* tables
// plus a read-only FK reference to users(id) for identity. Nothing here
// reads or writes interview_sessions, package_acquisitions, or any table
// owned by the individual product. No file outside db/campus.js and
// routes/campus*.js should import from here.

const { pool } = require('./index');
const crypto = require('crypto');
const { QUIZ_PASS_THRESHOLD } = require('../config/campus-ready');

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

// Learner-scoped: also returns, per item, whatever state that learner has
// already persisted (Learn viewed / practice saved text / quiz answered +
// correctness) so re-opening a module resumes exactly where the learner
// left off, and computes topic-level completion so the UI can show
// Learn → Practice → Quiz → Complete per topic without any client-side
// business logic. Pass learnerId = null/undefined for the founder-admin
// content-only view (no learner state to attach).
async function getModuleContent(moduleId, learnerId) {
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

  const itemIds = rows.map(r => r.item_id);
  let viewedSet = new Set(), practiceMap = new Map(), quizMap = new Map();
  if (learnerId && itemIds.length > 0) {
    const [viewsQ, practiceQ, quizQ] = await Promise.all([
      pool.query(
        `SELECT content_item_id FROM campus_learn_views
         WHERE learner_id = $1 AND content_item_id = ANY($2::int[])`,
        [learnerId, itemIds]
      ),
      // DISTINCT ON latest submission per item — a learner can resubmit
      // practice; the most recent text is what should redisplay.
      pool.query(
        `SELECT DISTINCT ON (content_item_id) content_item_id, response_text
         FROM campus_practice_submissions
         WHERE learner_id = $1 AND content_item_id = ANY($2::int[])
         ORDER BY content_item_id, submitted_at DESC`,
        [learnerId, itemIds]
      ),
      pool.query(
        `SELECT content_item_id, selected_option_id, is_correct FROM campus_quiz_responses
         WHERE learner_id = $1 AND content_item_id = ANY($2::int[])`,
        [learnerId, itemIds]
      ),
    ]);
    viewedSet = new Set(viewsQ.rows.map(r => r.content_item_id));
    practiceMap = new Map(practiceQ.rows.map(r => [r.content_item_id, r.response_text]));
    quizMap = new Map(quizQ.rows.map(r => [r.content_item_id, { selectedOptionId: r.selected_option_id, isCorrect: r.is_correct }]));
  }

  // Group into topics; quiz options are sent WITHOUT correct_option_id —
  // that stays server-side until the learner submits an answer.
  const topicsMap = new Map();
  for (const r of rows) {
    if (!topicsMap.has(r.topic_id)) {
      topicsMap.set(r.topic_id, { id: r.topic_id, key: r.topic_key, name: r.topic_name, sequence: r.topic_sequence, items: [] });
    }
    const item = {
      id: r.item_id,
      type: r.item_type,
      prompt: r.prompt_text,
      guidance: r.item_type === 'learn_example' ? r.answer_guidance : undefined,
      mistakes: r.item_type === 'learn_example' ? r.common_mistake_notes : undefined,
      options: r.item_type === 'quiz_question' ? r.options : undefined,
    };
    if (r.item_type === 'learn_example') {
      item.viewed = viewedSet.has(r.item_id);
    } else if (r.item_type === 'practice_prompt') {
      const saved = practiceMap.get(r.item_id);
      item.submitted = saved !== undefined;
      item.savedText = saved !== undefined ? saved : null;
    } else if (r.item_type === 'quiz_question') {
      const answered = quizMap.get(r.item_id);
      item.answered = !!answered;
      if (answered) {
        item.selectedOptionId = answered.selectedOptionId;
        item.isCorrect = answered.isCorrect;
        item.explanation = r.answer_guidance;
      }
    }
    topicsMap.get(r.topic_id).items.push(item);
  }

  // Deterministic, pure-code topic completion — no AI, no scoring beyond
  // the objective quiz grading already done in submitQuizAnswer:
  //   Learn:    no learn item in this topic, OR its single learn item
  //             has been viewed
  //   Practice: no practice items, OR every practice item has a
  //             persisted submission
  //   Quiz:     no quiz items, OR every quiz item has been answered AND
  //             accuracy across them is >= QUIZ_PASS_THRESHOLD
  for (const topic of topicsMap.values()) {
    const learnItems = topic.items.filter(i => i.type === 'learn_example');
    const practiceItems = topic.items.filter(i => i.type === 'practice_prompt');
    const quizItems = topic.items.filter(i => i.type === 'quiz_question');

    topic.learnDone = learnItems.every(i => i.viewed);
    topic.practiceDone = practiceItems.every(i => i.submitted);

    const quizAnswered = quizItems.filter(i => i.answered);
    const quizCorrect = quizAnswered.filter(i => i.isCorrect).length;
    const fullyAttempted = quizItems.length > 0 && quizAnswered.length === quizItems.length;
    const quizAccuracy = fullyAttempted ? quizCorrect / quizItems.length : 0;
    topic.quizDone = quizItems.length === 0 || (fullyAttempted && quizAccuracy >= QUIZ_PASS_THRESHOLD);

    topic.complete = topic.learnDone && topic.practiceDone && topic.quizDone;
  }

  return Array.from(topicsMap.values()).sort((a, b) => a.sequence - b.sequence);
}

// ── Progress & Submissions ───────────────────────────────────────────────

async function markLearnViewed({ learnerId, contentItemId }) {
  await pool.query(
    `INSERT INTO campus_learn_views (learner_id, content_item_id)
     VALUES ($1, $2)
     ON CONFLICT (learner_id, content_item_id) DO NOTHING`,
    [learnerId, contentItemId]
  );
}

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

// No scoring, no rubric — module completion is derived entirely from
// topic completion (see getModuleContent above), which is itself derived
// from persisted Learn/Practice/Quiz state. Per founder's explicit V1
// boundary: no AI/keyword scoring, no readiness verdict, nothing
// hard-coded — a module is "complete" only when every one of its topics
// genuinely is.
async function recomputeModuleProgress(learnerId, moduleId) {
  const topics = await getModuleContent(moduleId, learnerId);
  const totalTopics = topics.length;
  const completeTopics = topics.filter(t => t.complete).length;
  const percentComplete = totalTopics > 0 ? Math.round((completeTopics / totalTopics) * 100) : 0;

  const anyProgress = topics.some(t =>
    t.learnDone || t.practiceDone || t.items.some(i => i.type === 'quiz_question' && i.answered)
  );
  const status = totalTopics > 0 && completeTopics === totalTopics
    ? 'complete'
    : anyProgress ? 'in_progress' : 'not_started';

  // quiz_passed here means "every topic's quiz requirement is satisfied"
  // (independent of Learn/Practice) — kept as its own column since a
  // learner can finish all quizzes before finishing all practice, or
  // vice versa, and the two are worth tracking separately.
  const quizPassed = totalTopics > 0 && topics.every(t => t.quizDone);

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

// Sequential progression (Phase 1 — supersedes the earlier "independent
// modules" decision this table's queries were originally written for).
// Module 1 is always unlocked; module N is locked until module N-1's
// status is 'complete'. Computed here, once, so the API response, the
// Next Best Action resolver, and the server-side enforcement in
// routes/campus.js all agree on the same locked flags.
async function listModulesWithProgress(learnerId) {
  const { rows } = await pool.query(
    `SELECT m.id, m.key, m.name, m.sequence, m.description,
            COALESCE(p.status, 'not_started') AS status,
            COALESCE(p.percent_complete, 0) AS percent_complete,
            COALESCE(p.quiz_passed, false) AS quiz_passed
     FROM campus_modules m
     LEFT JOIN campus_module_progress p ON p.module_id = m.id AND p.learner_id = $1
     ORDER BY m.sequence`,
    [learnerId]
  );
  return rows.map((m, i) => ({
    ...m,
    locked: i > 0 && rows[i - 1].status !== 'complete',
  }));
}

// Server-side lock check — routes/campus.js calls this before serving a
// module's content or accepting a learn-view/practice/quiz submission,
// so a learner can't reach a later module just by calling the API
// directly with its key/id (the frontend disabling the button is not
// enforcement).
async function isModuleLocked(learnerId, moduleId) {
  const modules = await listModulesWithProgress(learnerId);
  const target = modules.find(m => m.id === Number(moduleId));
  return target ? target.locked : true;
}

// Single source of truth for "what should this learner do next" — the
// Campus Ready page and the Workspace sidebar entry point both read this
// so they can never disagree about the current state. Resolves down to
// topic-level granularity (which step — Learn, Practice, or Quiz — is
// actually the gap) rather than just "this module isn't done yet".
async function getCampusNextAction(learnerId) {
  const modules = await listModulesWithProgress(learnerId);
  if (modules.length === 0) return null;

  const allComplete = modules.every(m => m.status === 'complete');
  if (allComplete) {
    return {
      type: 'LAUNCH_AI_INTERVIEW',
      title: 'Launch MedhaIQ AI Interview',
      description: 'Put your preparation into a realistic interview.',
      ctaLabel: 'Launch AI Interview →',
      href: '/interview',
    };
  }

  // Sequential progression guarantees the first non-complete module is
  // also the first unlocked one — but the !m.locked check is kept
  // explicit rather than assumed, in case that ever changes.
  const target = modules.find(m => m.status !== 'complete' && !m.locked);
  if (!target) return null;

  const topics = await getModuleContent(target.id, learnerId);
  const paddedSeq = String(target.sequence).padStart(2, '0');

  const moduleUntouched = topics.every(t =>
    !t.learnDone && !t.practiceDone && !t.items.some(i => i.type === 'quiz_question' && i.answered)
  );
  if (moduleUntouched) {
    return target.sequence === 1
      ? {
          type: 'START_MODULE',
          moduleKey: target.key,
          title: `Start Module ${paddedSeq}: ${target.name}`,
          description: target.description || '',
          ctaLabel: 'Start Preparation →',
        }
      : {
          type: 'CONTINUE_NEXT_MODULE',
          moduleKey: target.key,
          title: `Continue to Module ${paddedSeq}: ${target.name}`,
          description: target.description || '',
          ctaLabel: 'Continue →',
        };
  }

  const currentTopic = topics.find(t => !t.complete);
  if (!currentTopic) return null; // target isn't 'complete', so this shouldn't happen — fail safe.

  if (!currentTopic.learnDone) {
    return {
      type: 'CONTINUE_LEARN',
      moduleKey: target.key,
      topicKey: currentTopic.key,
      title: `Continue: ${currentTopic.name}`,
      description: 'Review the concept before practicing.',
      ctaLabel: 'Continue Learning →',
    };
  }
  if (!currentTopic.practiceDone) {
    return {
      type: 'CONTINUE_PRACTICE',
      moduleKey: target.key,
      topicKey: currentTopic.key,
      title: `Continue: ${currentTopic.name}`,
      description: 'Finish the practice prompt(s) for this topic.',
      ctaLabel: 'Complete Practice →',
    };
  }

  const quizItems = currentTopic.items.filter(i => i.type === 'quiz_question');
  const quizAnswered = quizItems.filter(i => i.answered);
  const fullyAttempted = quizItems.length > 0 && quizAnswered.length === quizItems.length;
  if (fullyAttempted) {
    return {
      type: 'REVIEW_QUIZ',
      moduleKey: target.key,
      topicKey: currentTopic.key,
      title: `Retake ${currentTopic.name} Quiz`,
      description: `You need ${Math.round(QUIZ_PASS_THRESHOLD * 100)}% to pass. Review and try again.`,
      ctaLabel: 'Review & Retake →',
    };
  }
  return {
    type: 'TAKE_QUIZ',
    moduleKey: target.key,
    topicKey: currentTopic.key,
    title: `Continue: ${currentTopic.name}`,
    description: 'Test your understanding with a short quiz.',
    ctaLabel: 'Take Quiz →',
  };
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
  markLearnViewed, submitPractice, submitQuizAnswer, recomputeModuleProgress, listModulesWithProgress,
  isModuleLocked, getCampusNextAction,
  getCohortAnalytics,
};
