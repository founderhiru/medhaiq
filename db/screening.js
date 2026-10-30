// db/screening.js — data access for the Screening & Assessment Copilot.
//
// EVERY function that touches recruiter data takes ownerId and scopes by it
// (directly or by joining to screening_jobs / screening_candidates). A row
// that exists but belongs to someone else behaves exactly like a missing row
// (null / false), so ids cannot be probed across accounts.

const { pool } = require('./index');
const cfg = require('../config/screening');
const { ScreeningError } = require('../lib/screening-errors');

const L = cfg.LIMITS;

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// ── Access (founder-granted allowlist) ─────────────────────────────────────
async function getAccess(userId) {
  if (!userId) return null;
  const r = await pool.query('SELECT * FROM screening_access WHERE user_id = $1 LIMIT 1', [userId]);
  return r.rows[0] || null;
}

async function hasActiveAccess(userId) {
  const row = await getAccess(userId);
  return !!row && row.status === 'active';
}

// Sidebar / guard helper: founders are implicitly allowed.
async function canUseScreening(userId) {
  if (!userId) return false;
  const r = await pool.query(
    `SELECT (EXISTS (SELECT 1 FROM screening_access WHERE user_id = $1 AND status = 'active')
          OR EXISTS (SELECT 1 FROM founder_access WHERE user_id = $1)) AS ok`,
    [userId]
  );
  return !!r.rows[0].ok;
}

async function grantAccess({ userId, grantedBy, note }) {
  const r = await pool.query(
    `INSERT INTO screening_access (user_id, status, granted_by, note)
     VALUES ($1, 'active', $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET status = 'active', granted_by = EXCLUDED.granted_by, note = EXCLUDED.note, updated_at = NOW()
     RETURNING *`,
    [userId, grantedBy || null, note ? String(note).slice(0, 300) : null]
  );
  return r.rows[0];
}

async function revokeAccess(userId) {
  const r = await pool.query(
    `UPDATE screening_access SET status = 'revoked', updated_at = NOW() WHERE user_id = $1 RETURNING *`,
    [userId]
  );
  return r.rows[0] || null;
}

async function listAccess() {
  const r = await pool.query(
    `SELECT a.id, a.user_id, a.status, a.note, a.created_at, a.updated_at, u.email
       FROM screening_access a JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC`
  );
  return r.rows;
}

// ── Jobs ───────────────────────────────────────────────────────────────────
async function countJobs(ownerId) {
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM screening_jobs WHERE owner_id = $1', [ownerId]);
  return r.rows[0].n;
}

async function createJob(ownerId, { title, jdText, jdFlags }) {
  if ((await countJobs(ownerId)) >= L.JOBS_PER_OWNER) {
    throw new ScreeningError('job_limit', 409, `You can keep up to ${L.JOBS_PER_OWNER} roles. Delete one to add another.`);
  }
  const r = await pool.query(
    `INSERT INTO screening_jobs (owner_id, title, jd_text, jd_flags)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
    [ownerId, title, jdText, JSON.stringify(jdFlags || [])]
  );
  return r.rows[0];
}

async function listJobs(ownerId) {
  const r = await pool.query(
    `SELECT j.id, j.title, j.criteria_state, j.criteria_version, j.approved_at, j.created_at, j.updated_at,
            (SELECT COUNT(*)::int FROM screening_criteria c WHERE c.job_id = j.id) AS criteria_count,
            (SELECT COUNT(*)::int FROM screening_candidates k WHERE k.job_id = j.id) AS candidate_count
       FROM screening_jobs j
      WHERE j.owner_id = $1
      ORDER BY j.created_at DESC`,
    [ownerId]
  );
  return r.rows;
}

async function getJob(ownerId, jobId) {
  const r = await pool.query('SELECT * FROM screening_jobs WHERE id = $1 AND owner_id = $2', [jobId, ownerId]);
  return r.rows[0] || null;
}

async function updateJob(ownerId, jobId, { title, jdText, jdFlags }) {
  const job = await getJob(ownerId, jobId);
  if (!job) return null;
  const jdChanged = jdText != null && jdText !== job.jd_text;
  const r = await pool.query(
    `UPDATE screening_jobs
        SET title = COALESCE($3, title),
            jd_text = COALESCE($4, jd_text),
            jd_flags = COALESCE($5::jsonb, jd_flags),
            updated_at = NOW()
      WHERE id = $1 AND owner_id = $2 RETURNING *`,
    [jobId, ownerId, title ?? null, jdText ?? null, jdFlags ? JSON.stringify(jdFlags) : null]
  );
  return { job: r.rows[0], jdChanged };
}

async function deleteJob(ownerId, jobId) {
  const r = await pool.query('DELETE FROM screening_jobs WHERE id = $1 AND owner_id = $2', [jobId, ownerId]);
  return r.rowCount > 0;
}

// ── Criteria ───────────────────────────────────────────────────────────────
async function listCriteria(ownerId, jobId) {
  const r = await pool.query(
    `SELECT c.* FROM screening_criteria c
       JOIN screening_jobs j ON j.id = c.job_id
      WHERE c.job_id = $1 AND j.owner_id = $2
      ORDER BY c.position, c.id`,
    [jobId, ownerId]
  );
  return r.rows;
}

function assertDraft(job) {
  if (job.criteria_state === 'approved') {
    throw new ScreeningError('criteria_locked', 409, 'These criteria are approved. Reopen them to make changes.');
  }
}

// Replace the whole criteria set (AI proposal). Only while not approved.
async function replaceCriteria(ownerId, jobId, criteria) {
  return tx(async (c) => {
    const j = await c.query('SELECT * FROM screening_jobs WHERE id = $1 AND owner_id = $2 FOR UPDATE', [jobId, ownerId]);
    const job = j.rows[0];
    if (!job) return null;
    assertDraft(job);
    await c.query('DELETE FROM screening_criteria WHERE job_id = $1', [jobId]);
    let pos = 0;
    for (const x of criteria.slice(0, L.CRITERIA_MAX)) {
      pos += 1;
      await c.query(
        `INSERT INTO screening_criteria (job_id, position, text, importance, kind, jd_quote, jd_quote_verified, guidance, origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [jobId, pos, x.text, x.importance, x.kind, x.jd_quote, !!x.jd_quote_verified, x.guidance, x.origin]
      );
    }
    await c.query(`UPDATE screening_jobs SET criteria_state = 'draft', updated_at = NOW() WHERE id = $1`, [jobId]);
    return true;
  });
}

async function addCriterion(ownerId, jobId, x) {
  return tx(async (c) => {
    const j = await c.query('SELECT * FROM screening_jobs WHERE id = $1 AND owner_id = $2 FOR UPDATE', [jobId, ownerId]);
    const job = j.rows[0];
    if (!job) return null;
    assertDraft(job);
    const n = await c.query('SELECT COUNT(*)::int AS n, COALESCE(MAX(position),0)::int AS p FROM screening_criteria WHERE job_id = $1', [jobId]);
    if (n.rows[0].n >= L.CRITERIA_MAX) {
      throw new ScreeningError('criteria_limit', 409, `A role can have up to ${L.CRITERIA_MAX} criteria.`);
    }
    const r = await c.query(
      `INSERT INTO screening_criteria (job_id, position, text, importance, kind, jd_quote, jd_quote_verified, guidance, origin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'recruiter') RETURNING *`,
      [jobId, n.rows[0].p + 1, x.text, x.importance, x.kind, x.jd_quote || null, false, x.guidance || null]
    );
    await c.query(`UPDATE screening_jobs SET criteria_state = 'draft', updated_at = NOW() WHERE id = $1`, [jobId]);
    return r.rows[0];
  });
}

async function updateCriterion(ownerId, jobId, criterionId, patch) {
  return tx(async (c) => {
    const j = await c.query('SELECT * FROM screening_jobs WHERE id = $1 AND owner_id = $2 FOR UPDATE', [jobId, ownerId]);
    const job = j.rows[0];
    if (!job) return null;
    assertDraft(job);
    const r = await c.query(
      `UPDATE screening_criteria
          SET text = COALESCE($3, text),
              importance = COALESCE($4, importance),
              kind = COALESCE($5, kind),
              guidance = CASE WHEN $6::boolean THEN $7 ELSE guidance END,
              updated_at = NOW()
        WHERE id = $2 AND job_id = $1 RETURNING *`,
      [jobId, criterionId, patch.text ?? null, patch.importance ?? null, patch.kind ?? null,
        Object.prototype.hasOwnProperty.call(patch, 'guidance'), patch.guidance ?? null]
    );
    return r.rows[0] || null;
  });
}

async function deleteCriterion(ownerId, jobId, criterionId) {
  return tx(async (c) => {
    const j = await c.query('SELECT * FROM screening_jobs WHERE id = $1 AND owner_id = $2 FOR UPDATE', [jobId, ownerId]);
    const job = j.rows[0];
    if (!job) return null;
    assertDraft(job);
    const r = await c.query('DELETE FROM screening_criteria WHERE id = $1 AND job_id = $2', [criterionId, jobId]);
    return r.rowCount > 0;
  });
}

async function approveCriteria(ownerId, jobId, hash) {
  return tx(async (c) => {
    const j = await c.query('SELECT * FROM screening_jobs WHERE id = $1 AND owner_id = $2 FOR UPDATE', [jobId, ownerId]);
    const job = j.rows[0];
    if (!job) return null;
    const cnt = await c.query('SELECT COUNT(*)::int AS n FROM screening_criteria WHERE job_id = $1', [jobId]);
    if (cnt.rows[0].n < 1) {
      throw new ScreeningError('no_criteria', 409, 'Add at least one criterion before approving.');
    }
    const bump = hash !== job.criteria_hash;
    const r = await c.query(
      `UPDATE screening_jobs
          SET criteria_state = 'approved', criteria_hash = $2,
              criteria_version = criteria_version + $3, approved_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [jobId, hash, bump ? 1 : 0]
    );
    return r.rows[0];
  });
}

async function reopenCriteria(ownerId, jobId) {
  const r = await pool.query(
    `UPDATE screening_jobs SET criteria_state = 'draft', updated_at = NOW()
      WHERE id = $1 AND owner_id = $2 AND criteria_state = 'approved' RETURNING *`,
    [jobId, ownerId]
  );
  if (r.rows[0]) return r.rows[0];
  return getJob(ownerId, jobId);
}

// ── Candidates ─────────────────────────────────────────────────────────────
function candidateCode(seq) { return `C-${String(seq).padStart(3, '0')}`; }

async function createCandidate(ownerId, jobId, d) {
  return tx(async (c) => {
    const j = await c.query('SELECT * FROM screening_jobs WHERE id = $1 AND owner_id = $2 FOR UPDATE', [jobId, ownerId]);
    const job = j.rows[0];
    if (!job) return null;
    const dup = await c.query('SELECT id, seq, label FROM screening_candidates WHERE job_id = $1 AND file_hash = $2', [jobId, d.fileHash]);
    if (dup.rows[0]) return { duplicate: true, existing: { id: dup.rows[0].id, code: candidateCode(dup.rows[0].seq), label: dup.rows[0].label } };
    const cnt = await c.query('SELECT COUNT(*)::int AS n FROM screening_candidates WHERE job_id = $1', [jobId]);
    if (cnt.rows[0].n >= L.CANDIDATES_PER_JOB) {
      throw new ScreeningError('candidate_limit', 409, `A role can hold up to ${L.CANDIDATES_PER_JOB} resumes.`);
    }
    const seq = job.candidate_seq + 1;
    await c.query('UPDATE screening_jobs SET candidate_seq = $2, updated_at = NOW() WHERE id = $1', [jobId, seq]);
    const r = await c.query(
      `INSERT INTO screening_candidates
         (job_id, owner_id, seq, label, source_type, file_hash, redacted_text, page_offsets, page_count, redaction_summary, injection_flags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11::jsonb) RETURNING *`,
      [jobId, ownerId, seq, d.label || null, d.sourceType, d.fileHash, d.text,
        JSON.stringify(d.pageOffsets || [0]), d.pageCount || 1,
        JSON.stringify(d.redactionSummary || {}), JSON.stringify(d.injectionFlags || [])]
    );
    return { duplicate: false, candidate: r.rows[0] };
  });
}

async function listCandidates(ownerId, jobId) {
  const r = await pool.query(
    `SELECT k.id, k.seq, k.label, k.source_type, k.decision, k.decided_at, k.analyzed_at, k.created_at,
            jsonb_array_length(k.injection_flags) AS injection_flag_count
       FROM screening_candidates k
      WHERE k.job_id = $1 AND k.owner_id = $2
      ORDER BY k.seq`,
    [jobId, ownerId]
  );
  return r.rows;
}

async function getCandidate(ownerId, candidateId) {
  const r = await pool.query('SELECT * FROM screening_candidates WHERE id = $1 AND owner_id = $2', [candidateId, ownerId]);
  return r.rows[0] || null;
}

async function updateCandidateLabel(ownerId, candidateId, label) {
  const r = await pool.query(
    'UPDATE screening_candidates SET label = $3, updated_at = NOW() WHERE id = $1 AND owner_id = $2 RETURNING *',
    [candidateId, ownerId, label]
  );
  return r.rows[0] || null;
}

async function deleteCandidate(ownerId, candidateId) {
  const r = await pool.query('DELETE FROM screening_candidates WHERE id = $1 AND owner_id = $2', [candidateId, ownerId]);
  return r.rowCount > 0;
}

async function setDecision(ownerId, candidateId, decision, note) {
  const r = await pool.query(
    `UPDATE screening_candidates
        SET decision = $3::varchar(20), decision_note = $4,
            decided_at = CASE WHEN $3::varchar(20) IS NULL THEN NULL ELSE NOW() END, updated_at = NOW()
      WHERE id = $1 AND owner_id = $2 RETURNING *`,
    [candidateId, ownerId, decision, note || null]
  );
  return r.rows[0] || null;
}

// ── Evidence ───────────────────────────────────────────────────────────────
async function listEvidence(ownerId, candidateId) {
  const r = await pool.query(
    `SELECT e.* FROM screening_evidence e
       JOIN screening_candidates k ON k.id = e.candidate_id
      WHERE e.candidate_id = $1 AND k.owner_id = $2`,
    [candidateId, ownerId]
  );
  return r.rows;
}

async function countReviewedEvidence(ownerId, candidateId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM screening_evidence e
       JOIN screening_candidates k ON k.id = e.candidate_id
      WHERE e.candidate_id = $1 AND k.owner_id = $2 AND e.reviewed_at IS NOT NULL`,
    [candidateId, ownerId]
  );
  return r.rows[0].n;
}

async function replaceEvidence(ownerId, candidateId, rows, meta) {
  return tx(async (c) => {
    const k = await c.query('SELECT id FROM screening_candidates WHERE id = $1 AND owner_id = $2 FOR UPDATE', [candidateId, ownerId]);
    if (!k.rows[0]) return null;
    await c.query('DELETE FROM screening_evidence WHERE candidate_id = $1', [candidateId]);
    // A re-run refreshes AI drafts only. Questions the recruiter approved or wrote stay.
    await c.query(`DELETE FROM screening_questions WHERE candidate_id = $1 AND origin = 'ai' AND state IN ('draft','dismissed')`, [candidateId]);
    for (const e of rows) {
      await c.query(
        `INSERT INTO screening_evidence
           (candidate_id, criterion_id, ai_status, ai_rationale, quotes, downgrade_reason, criteria_version, model, prompt_version)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)`,
        [candidateId, e.criterion_id, e.ai_status, e.ai_rationale, JSON.stringify(e.quotes || []),
          e.downgrade_reason || null, meta.criteriaVersion, meta.model || null, meta.promptVersion || null]
      );
    }
    await c.query('UPDATE screening_candidates SET analyzed_at = NOW(), updated_at = NOW() WHERE id = $1', [candidateId]);
    return true;
  });
}

// status === null clears the recruiter override (back to the AI finding).
async function reviewEvidence(ownerId, candidateId, criterionId, { status, note }) {
  const r = await pool.query(
    `UPDATE screening_evidence e
        SET recruiter_status = $4, recruiter_note = $5,
            reviewed_at = NOW(), updated_at = NOW()
       FROM screening_candidates k
      WHERE e.candidate_id = $1 AND e.criterion_id = $2 AND k.id = e.candidate_id AND k.owner_id = $3
      RETURNING e.*`,
    [candidateId, criterionId, ownerId, status, note || null]
  );
  return r.rows[0] || null;
}

async function clearReview(ownerId, candidateId, criterionId) {
  const r = await pool.query(
    `UPDATE screening_evidence e
        SET recruiter_status = NULL, recruiter_note = NULL, reviewed_at = NULL, updated_at = NOW()
       FROM screening_candidates k
      WHERE e.candidate_id = $1 AND e.criterion_id = $2 AND k.id = e.candidate_id AND k.owner_id = $3
      RETURNING e.*`,
    [candidateId, criterionId, ownerId]
  );
  return r.rows[0] || null;
}

async function listJobEvidence(ownerId, jobId) {
  const r = await pool.query(
    `SELECT e.candidate_id, e.criterion_id, e.ai_status, e.recruiter_status, e.reviewed_at, e.criteria_version
       FROM screening_evidence e
       JOIN screening_candidates k ON k.id = e.candidate_id
      WHERE k.job_id = $1 AND k.owner_id = $2`,
    [jobId, ownerId]
  );
  return r.rows;
}

// ── Questions ──────────────────────────────────────────────────────────────
async function listQuestions(ownerId, candidateId) {
  const r = await pool.query(
    `SELECT q.* FROM screening_questions q
       JOIN screening_candidates k ON k.id = q.candidate_id
      WHERE q.candidate_id = $1 AND k.owner_id = $2
      ORDER BY q.criterion_id, q.id`,
    [candidateId, ownerId]
  );
  return r.rows;
}

async function replaceAiQuestions(ownerId, candidateId, questions) {
  return tx(async (c) => {
    const k = await c.query('SELECT id FROM screening_candidates WHERE id = $1 AND owner_id = $2 FOR UPDATE', [candidateId, ownerId]);
    if (!k.rows[0]) return null;
    await c.query(`DELETE FROM screening_questions WHERE candidate_id = $1 AND origin = 'ai' AND state IN ('draft','dismissed')`, [candidateId]);
    for (const q of questions) {
      await c.query(
        `INSERT INTO screening_questions (candidate_id, criterion_id, text, origin, state) VALUES ($1,$2,$3,'ai','draft')`,
        [candidateId, q.criterion_id, q.text]
      );
    }
    return true;
  });
}

async function addQuestion(ownerId, candidateId, criterionId, text) {
  const r = await pool.query(
    `INSERT INTO screening_questions (candidate_id, criterion_id, text, origin, state)
     SELECT k.id, c.id, $4, 'recruiter', 'approved'
       FROM screening_candidates k JOIN screening_criteria c ON c.job_id = k.job_id
      WHERE k.id = $1 AND k.owner_id = $2 AND c.id = $3
     RETURNING *`,
    [candidateId, ownerId, criterionId, text]
  );
  return r.rows[0] || null;
}

async function updateQuestion(ownerId, candidateId, questionId, { text, state }) {
  const r = await pool.query(
    `UPDATE screening_questions q
        SET text = COALESCE($4, q.text), state = COALESCE($5, q.state), updated_at = NOW()
       FROM screening_candidates k
      WHERE q.id = $1 AND q.candidate_id = $2 AND k.id = q.candidate_id AND k.owner_id = $3
      RETURNING q.*`,
    [questionId, candidateId, ownerId, text ?? null, state ?? null]
  );
  return r.rows[0] || null;
}

async function deleteQuestion(ownerId, candidateId, questionId) {
  const r = await pool.query(
    `DELETE FROM screening_questions q USING screening_candidates k
      WHERE q.id = $1 AND q.candidate_id = $2 AND k.id = q.candidate_id AND k.owner_id = $3`,
    [questionId, candidateId, ownerId]
  );
  return r.rowCount > 0;
}

// ── AI usage ───────────────────────────────────────────────────────────────
async function recordAiRun(ownerId, { kind, model, inputTokens, outputTokens, ok, errorCode }) {
  try {
    await pool.query(
      `INSERT INTO screening_ai_runs (owner_id, kind, model, input_tokens, output_tokens, ok, error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ownerId, kind, model || null, inputTokens ?? null, outputTokens ?? null, ok !== false, errorCode || null]
    );
  } catch (e) {
    console.error('[screening] recordAiRun failed (non-fatal):', e.message);
  }
}

async function countAiRunsToday(ownerId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM screening_ai_runs WHERE owner_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
    [ownerId]
  );
  return r.rows[0].n;
}

module.exports = {
  candidateCode,
  getAccess, hasActiveAccess, canUseScreening, grantAccess, revokeAccess, listAccess,
  countJobs, createJob, listJobs, getJob, updateJob, deleteJob,
  listCriteria, replaceCriteria, addCriterion, updateCriterion, deleteCriterion, approveCriteria, reopenCriteria,
  createCandidate, listCandidates, getCandidate, updateCandidateLabel, deleteCandidate, setDecision,
  listEvidence, countReviewedEvidence, replaceEvidence, reviewEvidence, clearReview, listJobEvidence,
  listQuestions, replaceAiQuestions, addQuestion, updateQuestion, deleteQuestion,
  recordAiRun, countAiRunsToday,
};
